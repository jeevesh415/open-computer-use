/**
 * Tests for the generic cross-replica leader-election helper.
 *
 * Background: 2026-05-02 NEW-3 audit finding. `runPeriodicSnapshots` in
 * `lib/services/machine-cleanup.ts` fired on both Next.js replicas
 * concurrently, both computed the same second-precision AMI name
 * (`coasty-snapshot-USERID-20260503130442.`), and AWS rejected the second
 * with `InvalidAMIName.Duplicate` 6 times. Same root cause class as the
 * previously fixed N1 auto_blog double-publish.
 *
 * The fix is `lib/services/cross-replica-lock.ts` + migration 013
 * (`cron_runs` table with PRIMARY KEY (job_name, run_window)). One
 * replica's INSERT wins; others get 23505 unique-violation and skip.
 *
 * Run: `npx vitest run tests/cross-replica-lock.test.ts`
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ---- Mock @/lib/supabase/service ------------------------------------------
//
// The lock helper calls `createServiceClient()` and then
// `client.from("cron_runs").insert(...)` / `.update(...)`. We mock the chain
// so tests can choreograph: insert success, 23505 conflict, 42P01 missing
// table, transient errors, and update flows.

type ChainCalls = {
  inserts: any[];
  updates: any[];
  updateEqs: Array<{ col: string; val: string }>;
};

function makeMockSupabase(behaviour: {
  insertResult?: { error: any | null };
  updateResult?: { error: any | null };
}): { client: any; calls: ChainCalls } {
  const calls: ChainCalls = { inserts: [], updates: [], updateEqs: [] };

  const tableMock = (name: string) => {
    return {
      insert: vi.fn(async (row: any) => {
        calls.inserts.push({ table: name, row });
        return behaviour.insertResult ?? { error: null };
      }),
      update: vi.fn((patch: any) => {
        calls.updates.push({ table: name, patch });
        // After two .eq()s (job_name + run_window), the LAST .eq returns a
        // thenable resolving to the update result so `await
        // .update().eq().eq()` resolves correctly. Single definition with
        // union return type — initializing eq twice triggers a TS narrowing
        // error because the second assignment widens the original mock type.
        let eqCount = 0;
        const updateChain: {
          eq: (col: string, val: string) => typeof updateChain | Promise<{ error: any }>;
        } = {
          eq: vi.fn((col: string, val: string) => {
            eqCount++;
            calls.updateEqs.push({ col, val });
            if (eqCount === 2) {
              return Promise.resolve(behaviour.updateResult ?? { error: null });
            }
            return updateChain;
          }),
        };
        return updateChain;
      }),
    };
  };

  const client = {
    from: vi.fn((name: string) => tableMock(name)),
  };

  return { client, calls };
}

// We mock the supabase service module module-globally and reset between tests.
let mockClientRef: any = null;
let createServiceClientShouldReturnNull = false;

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => {
    if (createServiceClientShouldReturnNull) return null;
    return mockClientRef;
  },
}));

import {
  bucketRunWindow,
  tryAcquireCronLock,
  finalizeCronLock,
  withCronLock,
} from "@/lib/services/cross-replica-lock";

beforeEach(() => {
  mockClientRef = null;
  createServiceClientShouldReturnNull = false;
});

// ═══════════════════════════════════════════════════════════════════════════
// bucketRunWindow — replicas computing the same value race for the same lock
// ═══════════════════════════════════════════════════════════════════════════

describe("bucketRunWindow", () => {
  it("floors to the bucket boundary in UTC", () => {
    // 2026-05-02T14:35:42Z with 60-min bucket → 14:00
    const w = bucketRunWindow(new Date("2026-05-02T14:35:42Z"), 60);
    expect(w).toBe("2026-05-02T14:00");
  });

  it("two replicas at slightly-different timestamps within a bucket get the same window", () => {
    const a = bucketRunWindow(new Date("2026-05-02T14:00:00.001Z"), 120);
    const b = bucketRunWindow(new Date("2026-05-02T15:59:59.999Z"), 120);
    expect(a).toBe(b);
    expect(a).toBe("2026-05-02T14:00");
  });

  it("two replicas across a bucket boundary get DIFFERENT windows", () => {
    // 14:00 boundary at 120-min bucket: 12:00–13:59 vs 14:00–15:59
    const a = bucketRunWindow(new Date("2026-05-02T13:59:59Z"), 120);
    const b = bucketRunWindow(new Date("2026-05-02T14:00:01Z"), 120);
    expect(a).toBe("2026-05-02T12:00");
    expect(b).toBe("2026-05-02T14:00");
  });

  it("daily bucket truncates to YYYY-MM-DD", () => {
    const w = bucketRunWindow(new Date("2026-05-02T17:30:00Z"), 1440);
    expect(w).toBe("2026-05-02");
  });

  it("4-hour bucket aligns to 0/4/8/12/16/20Z", () => {
    expect(bucketRunWindow(new Date("2026-05-02T03:59Z"), 240)).toBe("2026-05-02T00:00");
    expect(bucketRunWindow(new Date("2026-05-02T04:00Z"), 240)).toBe("2026-05-02T04:00");
    expect(bucketRunWindow(new Date("2026-05-02T19:59Z"), 240)).toBe("2026-05-02T16:00");
    expect(bucketRunWindow(new Date("2026-05-02T20:00Z"), 240)).toBe("2026-05-02T20:00");
  });

  it("rejects non-positive / non-finite buckets", () => {
    expect(() => bucketRunWindow(new Date(), 0)).toThrow();
    expect(() => bucketRunWindow(new Date(), -10)).toThrow();
    expect(() => bucketRunWindow(new Date(), NaN)).toThrow();
    expect(() => bucketRunWindow(new Date(), Infinity)).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// tryAcquireCronLock — fail-safe behavior
// ═══════════════════════════════════════════════════════════════════════════

describe("tryAcquireCronLock", () => {
  it("returns a handle when INSERT succeeds (this replica is leader)", async () => {
    const { client, calls } = makeMockSupabase({ insertResult: { error: null } });
    mockClientRef = client;

    const handle = await tryAcquireCronLock("runPeriodicSnapshots", "2026-05-02T14:00");

    expect(handle).not.toBeNull();
    expect(handle!.jobName).toBe("runPeriodicSnapshots");
    expect(handle!.runWindow).toBe("2026-05-02T14:00");
    expect(handle!.hostname).toBeTruthy();
    expect(typeof handle!.acquiredAt).toBe("number");

    // The insert MUST hit cron_runs with the right shape
    expect(calls.inserts).toHaveLength(1);
    expect(calls.inserts[0].table).toBe("cron_runs");
    expect(calls.inserts[0].row).toMatchObject({
      job_name: "runPeriodicSnapshots",
      run_window: "2026-05-02T14:00",
      status: "running",
    });
    expect(calls.inserts[0].row.started_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(calls.inserts[0].row.hostname).toBeTruthy();
  });

  it("returns null on 23505 unique-violation (another replica is leader)", async () => {
    const { client } = makeMockSupabase({
      insertResult: {
        error: { code: "23505", message: "duplicate key value violates unique constraint" },
      },
    });
    mockClientRef = client;

    const handle = await tryAcquireCronLock("runPeriodicSnapshots", "2026-05-02T14:00");

    expect(handle).toBeNull();
  });

  it("detects 23505 by message text alone (no code field)", async () => {
    // Some PostgREST error shapes don't surface `.code` — only message.
    const { client } = makeMockSupabase({
      insertResult: {
        error: { message: 'duplicate key value violates unique constraint "cron_runs_pkey"' },
      },
    });
    mockClientRef = client;

    const handle = await tryAcquireCronLock("runPeriodicSnapshots", "2026-05-02T14:00");
    expect(handle).toBeNull();
  });

  it("returns null (FAIL-SAFE) when table is missing (42P01)", async () => {
    // If the migration hasn't been applied, we MUST skip rather than run
    // unsafely — the whole point of the lock is to prevent the
    // double-execution that the missing table would re-enable.
    const { client } = makeMockSupabase({
      insertResult: {
        error: { code: "42P01", message: 'relation "cron_runs" does not exist' },
      },
    });
    mockClientRef = client;

    const handle = await tryAcquireCronLock("runPeriodicSnapshots", "2026-05-02T14:00");

    expect(handle).toBeNull();
  });

  it("returns null (FAIL-SAFE) on any other DB error", async () => {
    const { client } = makeMockSupabase({
      insertResult: { error: { code: "08006", message: "connection failure" } },
    });
    mockClientRef = client;

    const handle = await tryAcquireCronLock("runPeriodicSnapshots", "2026-05-02T14:00");
    expect(handle).toBeNull();
  });

  it("returns null when supabase service client is unavailable", async () => {
    createServiceClientShouldReturnNull = true;

    const handle = await tryAcquireCronLock("runPeriodicSnapshots", "2026-05-02T14:00");
    expect(handle).toBeNull();
  });

  it("simulates the production race: two replicas, same window — exactly one wins", async () => {
    // Replica A: insert returns no error
    // Replica B: insert returns 23505
    const { client: clientA } = makeMockSupabase({ insertResult: { error: null } });
    const { client: clientB } = makeMockSupabase({
      insertResult: { error: { code: "23505", message: "duplicate key" } },
    });

    mockClientRef = clientA;
    const handleA = await tryAcquireCronLock("runPeriodicSnapshots", "2026-05-02T14:00");

    mockClientRef = clientB;
    const handleB = await tryAcquireCronLock("runPeriodicSnapshots", "2026-05-02T14:00");

    // Exactly ONE replica got the lock — the other got null.
    const winners = [handleA, handleB].filter((h) => h !== null);
    expect(winners).toHaveLength(1);
    const losers = [handleA, handleB].filter((h) => h === null);
    expect(losers).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// finalizeCronLock — best-effort UPDATE
// ═══════════════════════════════════════════════════════════════════════════

describe("finalizeCronLock", () => {
  it("UPDATEs the row with status + finished_at + details", async () => {
    const { client, calls } = makeMockSupabase({ updateResult: { error: null } });
    mockClientRef = client;

    await finalizeCronLock(
      {
        jobName: "runPeriodicSnapshots",
        runWindow: "2026-05-02T14:00",
        hostname: "host-x",
        acquiredAt: Date.now(),
      },
      "completed",
      { snapshots_created: 7, errors: 0 }
    );

    expect(calls.updates).toHaveLength(1);
    expect(calls.updates[0].table).toBe("cron_runs");
    expect(calls.updates[0].patch).toMatchObject({
      status: "completed",
      details: { snapshots_created: 7, errors: 0 },
    });
    expect(calls.updates[0].patch.finished_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // Filtered by both job_name AND run_window
    expect(calls.updateEqs).toEqual(
      expect.arrayContaining([
        { col: "job_name", val: "runPeriodicSnapshots" },
        { col: "run_window", val: "2026-05-02T14:00" },
      ])
    );
  });

  it("swallows DB errors silently (best-effort contract)", async () => {
    const { client } = makeMockSupabase({
      updateResult: { error: { code: "08006", message: "transient connection failure" } },
    });
    mockClientRef = client;

    // Must NOT throw — the calling cron has already done its user-visible work.
    await expect(
      finalizeCronLock(
        {
          jobName: "runPeriodicSnapshots",
          runWindow: "2026-05-02T14:00",
          hostname: "host-x",
          acquiredAt: Date.now(),
        },
        "crashed",
        { error: "boom" }
      )
    ).resolves.toBeUndefined();
  });

  it("no-ops when supabase client is unavailable", async () => {
    createServiceClientShouldReturnNull = true;
    await expect(
      finalizeCronLock(
        { jobName: "x", runWindow: "y", hostname: "h", acquiredAt: Date.now() },
        "completed"
      )
    ).resolves.toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// withCronLock — convenience wrapper
// ═══════════════════════════════════════════════════════════════════════════

describe("withCronLock", () => {
  it("runs the work and returns true when lock acquired", async () => {
    const { client } = makeMockSupabase({ insertResult: { error: null }, updateResult: { error: null } });
    mockClientRef = client;

    const work = vi.fn(async (report) => {
      report({ widgets_processed: 42 });
    });

    const ran = await withCronLock("widgetSweep", 60, work);

    expect(ran).toBe(true);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("does NOT run the work and returns false when lock contended (23505)", async () => {
    const { client } = makeMockSupabase({
      insertResult: { error: { code: "23505", message: "duplicate key" } },
    });
    mockClientRef = client;

    const work = vi.fn(async () => {});

    const ran = await withCronLock("widgetSweep", 60, work);

    expect(ran).toBe(false);
    expect(work).not.toHaveBeenCalled();
  });

  it("finalizes with status='crashed' if work throws", async () => {
    const { client, calls } = makeMockSupabase({
      insertResult: { error: null },
      updateResult: { error: null },
    });
    mockClientRef = client;

    const work = vi.fn(async () => {
      throw new Error("boom");
    });

    // Must NOT propagate the throw (fire-and-forget cron contract)
    const ran = await withCronLock("widgetSweep", 60, work);

    expect(ran).toBe(true);
    expect(calls.updates).toHaveLength(1);
    expect(calls.updates[0].patch).toMatchObject({
      status: "crashed",
      details: expect.objectContaining({ error: "boom" }),
    });
  });

  it("finalizes with status='completed' on success and includes reported details", async () => {
    const { client, calls } = makeMockSupabase({
      insertResult: { error: null },
      updateResult: { error: null },
    });
    mockClientRef = client;

    await withCronLock("widgetSweep", 60, async (report) => {
      report({ widgets: 5 });
      report({ errors: 0 });
    });

    expect(calls.updates).toHaveLength(1);
    expect(calls.updates[0].patch.status).toBe("completed");
    // Both report() calls merged into details
    expect(calls.updates[0].patch.details).toEqual({ widgets: 5, errors: 0 });
  });

  it("uses the bucket window of NOW (correct cadence)", async () => {
    const { client, calls } = makeMockSupabase({
      insertResult: { error: null },
      updateResult: { error: null },
    });
    mockClientRef = client;

    const before = Date.now();
    await withCronLock("widgetSweep", 120, async () => {});
    const after = Date.now();

    // The inserted run_window must equal the 120-min bucket of NOW
    const insertedWindow = calls.inserts[0].row.run_window;
    // Must look like "YYYY-MM-DDTHH:MM"
    expect(insertedWindow).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    // And the bucket boundary must be ≤ now
    const insertedMs = new Date(insertedWindow + ":00Z").getTime();
    expect(insertedMs).toBeLessThanOrEqual(after);
    expect(insertedMs).toBeGreaterThanOrEqual(before - 120 * 60 * 1000);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Source-level guards: machine-cleanup wires the lock; AMI name has jitter
// ═══════════════════════════════════════════════════════════════════════════

describe("source-level guards", () => {
  it("MachineCleanupService start() goes through *Locked wrappers, not raw cleanups", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "..", "lib", "services", "machine-cleanup.ts"),
      "utf-8"
    );
    // The setInterval body must call the locked variants:
    expect(src).toMatch(/this\.runCleanupLocked\(\)/);
    expect(src).toMatch(/this\.cleanupLiteMachinesLocked\(\)/);
    expect(src).toMatch(/this\.runPeriodicSnapshotsLocked\(\)/);
    expect(src).toMatch(/this\.cleanupSwarmMachinesLocked\(\)/);

    // And those wrappers must call withCronLock, not the raw private methods directly:
    expect(src).toMatch(/withCronLock\("runCleanup"/);
    expect(src).toMatch(/withCronLock\("cleanupLiteMachines"/);
    expect(src).toMatch(/withCronLock\("runPeriodicSnapshots"/);
    expect(src).toMatch(/withCronLock\("cleanupSwarmMachines"/);
  });

  it("createMachineImage AMI name includes random jitter (defense-in-depth)", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "..", "lib", "aws", "ec2-service.ts"),
      "utf-8"
    );
    // The AMI-naming block must include random hex jitter.
    expect(src).toMatch(/jitter/);
    expect(src).toMatch(/Math\.random\(\)/);
    // And it must be appended to the AMI name template.
    expect(src).toMatch(/coasty-snapshot-\$\{userId\.substring\(0, 8\)\}-\$\{ts\}-\$\{jitter\}/);
  });

  it("migration 013 exists with PRIMARY KEY (job_name, run_window)", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const repoRoot = path.resolve(__dirname, "..");
    const migration = fs.readFileSync(
      path.join(repoRoot, "supabase", "migrations", "013_cron_runs.sql"),
      "utf-8"
    );
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS cron_runs/);
    expect(migration).toMatch(/PRIMARY KEY \(job_name, run_window\)/);
    expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(migration).toMatch(/service_role/);
  });
});
