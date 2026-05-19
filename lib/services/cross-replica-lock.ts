/**
 * Cross-replica leader-election helper for periodic tasks.
 *
 * Why this exists
 * ---------------
 * Every Next.js replica that calls `MachineCleanupService.start()` (and any
 * future setInterval-based service) fires the cron on its own schedule. Before
 * this helper, that produced two production incidents:
 *
 *   1. 2026-04-30  Auto-blog cron fanned out across both api replicas →
 *      18 posts instead of 10 with slug collisions. Fixed in Python by
 *      `auto_blog_runs` (migration 012).
 *
 *   2. 2026-05-02  runPeriodicSnapshots fanned out across both Next.js
 *      replicas → 6× AWS `InvalidAMIName.Duplicate` errors when both
 *      replicas computed the same second-precision AMI name. 3 user
 *      machines missed their 4-hour snapshot.
 *
 * Strategy
 * --------
 * Each replica computes a deterministic `runWindow` string for the current
 * cycle (e.g. `2026-05-02T14:00` for a 2-hour-bucketed job) and races to
 * `INSERT INTO cron_runs (job_name, run_window, ...)`. The PRIMARY KEY
 * (job_name, run_window) lets exactly one replica's INSERT succeed; the
 * loser hits Postgres 23505 unique-violation and skips this cycle.
 *
 * The lock SURVIVES the entire run because it's row-based, not session-
 * based. It is NOT released on success: it persists as the run-history
 * record for that bucket. The next bucket boundary is a fresh
 * competition. This is intentional — a stuck/crashed leader does NOT
 * release the lock back to a peer mid-bucket, which would re-trigger
 * the original double-execution bug.
 *
 * Failure semantics
 * -----------------
 * Fail SAFE: if the supabase client is missing, the table doesn't exist,
 * or any unexpected DB error fires, `tryAcquireCronLock` returns `null`
 * (= do not run). Better to skip a cycle than to risk the original
 * race-induced damage.
 */

import { createServiceClient } from "@/lib/supabase/service";
import os from "node:os";

// ── Periodic-summary state ──────────────────────────────────────────────
// The cooperative skip is logged at DEBUG (was INFO, contributing the
// majority of cron-lock log volume — 90% of 13k lines / 4 days in the
// audited window). We still want operators to see at a glance that the
// lock IS working, so every SUMMARY_INTERVAL_MS we emit an INFO-level
// rollup of running counters. Counters live at module scope so they
// accumulate across all jobs sharing this process; they reset after
// each summary emission so the next window's number is a fresh diff.
const SUMMARY_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

let _acquiredCount = 0;
let _skippedCount = 0;
let _failedCount = 0;
let _lastSummaryEmit = Date.now();

function _maybeEmitSummary(): void {
  const now = Date.now();
  if (now - _lastSummaryEmit < SUMMARY_INTERVAL_MS) return;
  console.log(
    `[cron-lock] stats: acquired=${_acquiredCount} skipped=${_skippedCount} ` +
      `failed=${_failedCount} window_ms=${now - _lastSummaryEmit}`
  );
  _acquiredCount = 0;
  _skippedCount = 0;
  _failedCount = 0;
  _lastSummaryEmit = now;
}

/**
 * Result of a lock-acquisition attempt.
 */
export interface CronLockHandle {
  jobName: string;
  runWindow: string;
  hostname: string;
  acquiredAt: number; // ms epoch
}

/**
 * Round a Date to the nearest bucket boundary BELOW it (floor) and return
 * an ISO string truncated to the bucket precision. Replicas computing the
 * same `runWindow` for the same `bucketMinutes` will compete for the same lock.
 *
 * @param now            current Date (defaults to `new Date()`)
 * @param bucketMinutes  bucket size in minutes. Examples:
 *                         60   = hourly
 *                         120  = 2-hourly
 *                         240  = 4-hourly
 *                         1440 = daily
 *
 * Output:
 *   bucketMinutes < 1440 → "YYYY-MM-DDTHH:MM"
 *   bucketMinutes ≥ 1440 → "YYYY-MM-DD"
 */
export function bucketRunWindow(now: Date, bucketMinutes: number): string {
  if (!Number.isFinite(bucketMinutes) || bucketMinutes <= 0) {
    throw new Error(`bucketMinutes must be > 0, got ${bucketMinutes}`);
  }
  const ms = now.getTime();
  const bucketMs = bucketMinutes * 60 * 1000;
  // Floor to the bucket boundary in UTC. We use Math.floor on the absolute
  // epoch so all replicas agree on the boundary regardless of TZ.
  const floored = new Date(Math.floor(ms / bucketMs) * bucketMs);
  if (bucketMinutes >= 1440) {
    return floored.toISOString().slice(0, 10); // "YYYY-MM-DD"
  }
  return floored.toISOString().slice(0, 16); // "YYYY-MM-DDTHH:MM"
}

/**
 * Try to acquire the cross-replica lock for a given job + run-window.
 *
 * Returns a handle if THIS replica won the leader election. Returns `null`
 * if another replica has the lock OR if the DB is unavailable / migration
 * not applied (fail-safe).
 *
 * Idempotent: calling twice in the same window from the same replica
 * returns null on the second call (the row already exists), which is the
 * correct behaviour — the in-progress run is the lock holder.
 *
 * @param jobName   stable identifier for the cron, e.g. "runPeriodicSnapshots"
 * @param runWindow output of `bucketRunWindow(now, bucketMinutes)`
 */
export async function tryAcquireCronLock(
  jobName: string,
  runWindow: string
): Promise<CronLockHandle | null> {
  const supabase = createServiceClient();
  if (!supabase) {
    console.warn(
      `[cron-lock] cannot acquire ${jobName}@${runWindow} — supabase service client unavailable; skipping run (fail-safe)`
    );
    return null;
  }

  const hostname = os.hostname();
  const acquiredAt = Date.now();

  try {
    const { error } = await (supabase as any).from("cron_runs").insert({
      job_name: jobName,
      run_window: runWindow,
      started_at: new Date().toISOString(),
      hostname,
      status: "running",
    });

    if (!error) {
      console.log(
        `[cron-lock] acquired ${jobName}@${runWindow} (host=${hostname})`
      );
      _acquiredCount += 1;
      _maybeEmitSummary();
      return { jobName, runWindow, hostname, acquiredAt };
    }

    // 23505 = unique violation = another replica already holds the lock.
    // PostgREST surfaces this in `.code` (string "23505") and/or in `.message`.
    const code = (error as any).code as string | undefined;
    const message = ((error as any).message ?? "") as string;
    if (code === "23505" || message.includes("23505") || /duplicate key/i.test(message)) {
      // Demoted to console.debug — this is the designed cooperative skip
      // and fires once per replica per run-window. Visible via the
      // periodic summary instead (acquired/skipped/failed counts).
      console.debug(
        `[cron-lock] another replica is running ${jobName}@${runWindow}; skipping`
      );
      _skippedCount += 1;
      _maybeEmitSummary();
      return null;
    }

    // 42P01 = relation does not exist (migration not applied) → fail SAFE.
    if (code === "42P01" || /does not exist/i.test(message)) {
      console.error(
        `[cron-lock] table 'cron_runs' missing — apply supabase/migrations/013_cron_runs.sql. Skipping ${jobName}@${runWindow} to avoid the cross-replica race we just patched.`
      );
      _failedCount += 1;
      _maybeEmitSummary();
      return null;
    }

    console.error(
      `[cron-lock] unexpected error acquiring ${jobName}@${runWindow}: ${code ?? "(no code)"}: ${message}`
    );
    _failedCount += 1;
    _maybeEmitSummary();
    return null;
  } catch (err: any) {
    console.error(
      `[cron-lock] threw acquiring ${jobName}@${runWindow}: ${err?.message ?? err}`
    );
    _failedCount += 1;
    _maybeEmitSummary();
    return null;
  }
}

/**
 * Update the lock row with completion stats. Best-effort: failures here
 * do NOT propagate because by this point the user-visible work is done.
 *
 * Caller passes the same handle returned by `tryAcquireCronLock` plus
 * arbitrary `details` JSON (counts, error summaries) that show up in the
 * `cron_runs.details` column for postmortem.
 */
export async function finalizeCronLock(
  handle: CronLockHandle,
  status: "completed" | "crashed",
  details: Record<string, unknown> = {}
): Promise<void> {
  const supabase = createServiceClient();
  if (!supabase) return;

  try {
    const { error } = await (supabase as any)
      .from("cron_runs")
      .update({
        finished_at: new Date().toISOString(),
        status,
        details,
      })
      .eq("job_name", handle.jobName)
      .eq("run_window", handle.runWindow);

    if (error) {
      console.warn(
        `[cron-lock] failed to finalize ${handle.jobName}@${handle.runWindow}: ${
          (error as any).message ?? error
        }`
      );
    }
  } catch (err: any) {
    console.warn(
      `[cron-lock] threw finalizing ${handle.jobName}@${handle.runWindow}: ${err?.message ?? err}`
    );
  }
}

/**
 * Convenience wrapper: acquire → run → finalize. Skips silently if the lock
 * is contended. Catches and logs but does NOT re-throw caller exceptions
 * (matches the existing fire-and-forget cron contract in
 * MachineCleanupService — caller doesn't await per-cycle results).
 *
 * Returns `true` if THIS replica ran the work, `false` if it was skipped.
 *
 * @param jobName        stable cron identifier
 * @param bucketMinutes  bucket size — replicas with the same value race for the lock
 * @param work           the actual cron body. Receives a `report` callback to
 *                       record details in the lock row.
 */
export async function withCronLock<T = void>(
  jobName: string,
  bucketMinutes: number,
  work: (report: (details: Record<string, unknown>) => void) => Promise<T>
): Promise<boolean> {
  const runWindow = bucketRunWindow(new Date(), bucketMinutes);
  const handle = await tryAcquireCronLock(jobName, runWindow);
  if (!handle) return false;

  let collectedDetails: Record<string, unknown> = {};
  const report = (d: Record<string, unknown>) => {
    collectedDetails = { ...collectedDetails, ...d };
  };

  let status: "completed" | "crashed" = "completed";
  try {
    await work(report);
  } catch (err: any) {
    status = "crashed";
    collectedDetails.error =
      err?.message ?? (typeof err === "string" ? err : "unknown");
    console.error(
      `[cron-lock] ${jobName}@${runWindow} crashed: ${collectedDetails.error}`
    );
    // Don't re-throw — finalize first, then swallow (fire-and-forget contract).
  } finally {
    await finalizeCronLock(handle, status, collectedDetails);
  }
  return true;
}
