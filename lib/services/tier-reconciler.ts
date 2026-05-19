/**
 * Tier Reconciler
 *
 * Brings a user's resources into compliance with their current subscription
 * tier.  Called from the Stripe webhook on `customer.subscription.updated`
 * (downgrade detection) and `customer.subscription.deleted` (cancel).
 *
 * Designed to be idempotent — if the user is already within their tier's
 * limits the reconciler is a no-op.  Safe to call on every subscription event.
 *
 * What it reconciles:
 *   1. Machines  — terminates excess cloud machines (oldest first).
 *                  Snapshots non-swarm machines pre-terminate so the user
 *                  can restore on re-subscribe.  Skips electron / local /
 *                  already-deleting / temp-swarm machines.
 *   2. Schedules — pauses excess enabled schedules (oldest first) by
 *                  setting `room_settings.schedule.enabled=false` and
 *                  `paused_reason=<reason>`.
 *   3. Sessions  — left to backend `agent_billing._periodic_credit_check`,
 *                  which observes `user_credits.has_active_subscription`
 *                  and ends sessions that started paid.
 *
 * Tier vocabulary: see lib/tier.ts.  Numeric limits:
 *   maxMachines  → from subscription_plans.max_machines (or free defaults)
 *   maxSchedules → from lib/tier.SCHEDULE_LIMITS (mirrors backend)
 */
import { getScheduleLimit, normalizeTier, type UserTier } from "@/lib/tier"

export type ReconcileReason =
  | "subscription_canceled"
  | "subscription_downgraded"
  | "subscription_paused"

export interface ReconcileOptions {
  reason: ReconcileReason
  /** Snapshot machines pre-terminate so user can restore.  Default: true. */
  snapshotBeforeTerminate?: boolean
  /** Override max machines (test injection).  Defaults to plan lookup. */
  maxMachinesOverride?: number
  /** Override max schedules.  Defaults to lib/tier.SCHEDULE_LIMITS. */
  maxSchedulesOverride?: number
}

export interface ReconcileResult {
  tier: UserTier
  maxMachines: number
  maxSchedules: number
  /** Cloud machines actually terminated (DB row deleted). */
  machinesTerminated: number
  /** Cloud machines that were already in `deleting` status — skipped. */
  machinesDeferred: number
  /** Cloud machines that failed AWS terminate (DB row left intact). */
  machinesFailedToTerminate: number
  /** Schedules whose `enabled` flag was just flipped from true → false. */
  schedulesPaused: number
  /** Schedules already paused (different reason or same) — left untouched. */
  schedulesAlreadyPaused: number
  /** Per-resource error log (truncated to 50 entries). */
  errors: Array<{ kind: "machine" | "schedule"; id: string; error: string }>
}

interface ReconcileArgs {
  // The Supabase service-role client.  Use `unknown` to allow either typed
  // or `as any` clients without coupling this module to a generated types
  // file.
  supabase: unknown
  userId: string
  newTier: string
  reason: ReconcileReason
  options?: Omit<ReconcileOptions, "reason">
}

// ---- Free-tier defaults — must match `subscription_plans` row OR the
//      hard-coded fallback in app/api/machines/route.ts when no plan exists.
const FREE_DEFAULT_LIMITS = {
  maxMachines: 1,
  // Schedule defaults come from lib/tier.SCHEDULE_LIMITS.
} as const

/**
 * Resolve numeric resource limits for a tier.  Reads `subscription_plans`
 * for `max_machines`; falls back to the free defaults if no row exists.
 */
export async function getTierResourceLimits(
  supabase: unknown,
  rawTier: string
): Promise<{ maxMachines: number; maxSchedules: number }> {
  const tier = normalizeTier(rawTier)
  const maxSchedules = getScheduleLimit(tier)

  if (tier === "free") {
    return { maxMachines: FREE_DEFAULT_LIMITS.maxMachines, maxSchedules }
  }

  try {
    const { data } = await (supabase as any)
      .from("subscription_plans")
      .select("max_machines")
      .eq("tier", tier)
      .maybeSingle()
    const maxMachines = (data?.max_machines as number | undefined) ?? FREE_DEFAULT_LIMITS.maxMachines
    return { maxMachines, maxSchedules }
  } catch (err) {
    console.error("getTierResourceLimits: subscription_plans lookup failed:", err)
    return { maxMachines: FREE_DEFAULT_LIMITS.maxMachines, maxSchedules }
  }
}

interface UserMachineRow {
  id: string
  user_id: string
  display_name: string | null
  status: string
  settings: Record<string, any> | null
  created_at: string
  last_active_at: string | null
}

/**
 * List the user's machines that count against `max_machines` and are
 * eligible for reconciliation.  Excludes:
 *   * electron / local machines (not cloud, don't count toward limit)
 *   * already-deleting machines
 *   * temp-swarm machines (have their own 30-min TTL cleanup)
 *
 * Sorted oldest-first by `last_active_at` (nulls last) so the *newest* are
 * the last to be terminated.
 */
export async function listEnforceableMachines(
  supabase: unknown,
  userId: string
): Promise<UserMachineRow[]> {
  const { data, error } = await (supabase as any)
    .from("user_machines")
    .select("id, user_id, display_name, status, settings, created_at, last_active_at")
    .eq("user_id", userId)
  if (error) {
    throw new Error(`listEnforceableMachines: ${error.message}`)
  }
  const rows = (data ?? []) as UserMachineRow[]

  const enforceable = rows.filter(m => {
    const s = m.settings ?? {}
    if (s.provider === "electron" || s.isLocal === true || s.is_local === true) return false
    if (m.status === "deleting") return false
    // Temp swarm machines: skip — handled by the 30-min cleanup sweep.
    if (s.is_swarm === true && !s.persistent_swarm) return false
    return true
  })

  enforceable.sort((a, b) => {
    // Sort oldest → newest by last_active_at, falling back to created_at.
    const aKey = a.last_active_at ?? a.created_at ?? ""
    const bKey = b.last_active_at ?? b.created_at ?? ""
    if (aKey === bKey) return 0
    return aKey < bKey ? -1 : 1
  })

  return enforceable
}

/**
 * Terminate excess cloud machines via the existing deleteMachine logic.
 * Keeps the newest `keepCount` machines.
 *
 * Errors per-machine are caught and logged; the function continues with the
 * remaining excess.  Returns counts and an error array.
 */
export async function reconcileMachines(
  supabase: unknown,
  userId: string,
  maxMachines: number,
  options: { snapshotBeforeTerminate?: boolean; reason: ReconcileReason }
): Promise<{
  terminated: number
  deferred: number
  failed: number
  errors: ReconcileResult["errors"]
}> {
  const enforceable = await listEnforceableMachines(supabase, userId)
  const errors: ReconcileResult["errors"] = []

  if (enforceable.length <= maxMachines) {
    return { terminated: 0, deferred: 0, failed: 0, errors }
  }

  // Sorted oldest → newest, so excess = the leading slice.
  const excess = enforceable.slice(0, enforceable.length - maxMachines)

  let terminated = 0
  let deferred = 0
  let failed = 0

  for (const machine of excess) {
    try {
      await terminateOneMachine(supabase, machine, {
        snapshotBeforeTerminate: options.snapshotBeforeTerminate ?? true,
        reason: options.reason,
      })
      terminated += 1
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // Defer-vs-fail distinction: if the row was already in "deleting" by
      // the time we tried, treat as deferred.  Anything else is failed.
      if (msg.includes("already deleting")) {
        deferred += 1
      } else {
        failed += 1
        if (errors.length < 50) {
          errors.push({ kind: "machine", id: machine.id, error: msg })
        }
        console.error(
          `reconcileMachines: failed to terminate machine ${machine.id} for user ${userId}:`,
          err
        )
      }
    }
  }

  return { terminated, deferred, failed, errors }
}

/**
 * Terminate a single cloud machine.  Mirrors the deleteMachine logic from
 * lib/services/machine-cleanup.ts: marks `deleting`, snapshots if eligible,
 * calls AWS terminate, deletes DB row.
 *
 * Snapshot failures don't block termination.  AWS terminate failures
 * propagate (DB row left as `deleting` for a retry sweep).
 */
async function terminateOneMachine(
  supabase: unknown,
  machine: UserMachineRow,
  opts: { snapshotBeforeTerminate: boolean; reason: ReconcileReason }
): Promise<void> {
  // Optimistic-ish lock: flip status to deleting; a second concurrent
  // reconciler will see status='deleting' on its read and skip the row.
  const { error: lockError } = await (supabase as any)
    .from("user_machines")
    .update({ status: "deleting" })
    .eq("id", machine.id)
    .eq("user_id", machine.user_id)
    // Only flip if not already deleting.
    .neq("status", "deleting")

  if (lockError) {
    throw new Error(`already deleting: ${lockError.message ?? "unknown"}`)
  }

  const settings = machine.settings ?? {}

  // AWS termination + snapshot (best-effort, mirrors machine-cleanup.ts).
  if (settings.provider === "aws" && settings.awsInstanceId) {
    try {
      const { getAwsEc2Service } = await import("@/lib/aws/ec2-service")
      const awsService = getAwsEc2Service()

      // Snapshot only for non-swarm machines, only when requested.
      if (
        opts.snapshotBeforeTerminate &&
        settings.is_swarm !== true
      ) {
        try {
          const snapshot = await awsService.createMachineImage(
            settings.awsInstanceId,
            machine.user_id,
            machine.display_name ?? "machine"
          )
          // null = instance already gone / non-snapshottable. Race-safe skip.
          if (snapshot) {
            await (supabase as any).from("machine_snapshots").insert({
              machine_id: machine.id,
              user_id: machine.user_id,
              snapshot_name: snapshot.name,
              snapshot_type: "pre_shutdown",
              storage_location: snapshot.amiId,
              size_gb: settings.storageGb || 16,
              os_state: {
                provider: "aws",
                region: settings.awsRegion || process.env.AWS_REGION || "us-east-1",
                source_instance: settings.awsInstanceId,
                desktop_enabled: settings.desktopEnabled,
                reason: opts.reason,
              },
            })
            await awsService.cleanupOldSnapshots(machine.user_id, 2)
          }
        } catch (snapErr) {
          // Snapshot failure shouldn't block termination — see existing
          // machine-cleanup.ts behavior at line ~408.
          console.warn(
            `terminateOneMachine: snapshot failed for ${settings.awsInstanceId}:`,
            snapErr
          )
        }
      }

      await awsService.terminateInstance(
        settings.awsInstanceId,
        settings.awsKeyPairName
      )
    } catch (awsErr) {
      // Continue with DB delete — instance may already be gone or AWS API
      // is briefly unavailable.  The DB row stays in `deleting` status
      // which prevents counting against limit; the periodic cleaner will
      // eventually retry.
      console.warn(
        `terminateOneMachine: AWS terminate failed for ${settings.awsInstanceId}:`,
        awsErr
      )
      throw awsErr
    }
  }

  // Delete the DB row last so a partial-failure retry can re-enter.
  const { error: deleteError } = await (supabase as any)
    .from("user_machines")
    .delete()
    .eq("id", machine.id)
  if (deleteError) {
    throw new Error(`db delete failed: ${deleteError.message}`)
  }
}

interface ChatRow {
  id: string
  user_id: string
  room_settings: Record<string, any> | null
  updated_at: string | null
  created_at: string | null
}

/**
 * Pause excess enabled schedules.  Keeps the newest `maxSchedules` enabled;
 * pauses the rest by setting `enabled=false` and `paused_reason=<reason>`.
 *
 * Schedules already disabled (regardless of reason) are not modified.
 * Soft-deleted schedules (`paused_reason="deleted"`) are not counted.
 */
export async function reconcileSchedules(
  supabase: unknown,
  userId: string,
  maxSchedules: number,
  reason: ReconcileReason
): Promise<{
  paused: number
  alreadyPaused: number
  errors: ReconcileResult["errors"]
}> {
  const errors: ReconcileResult["errors"] = []

  const { data, error } = await (supabase as any)
    .from("chats")
    .select("id, user_id, room_settings, updated_at, created_at")
    .eq("user_id", userId)
    .not("room_settings", "is", null)
  if (error) {
    throw new Error(`reconcileSchedules: ${error.message}`)
  }

  const rows = (data ?? []) as ChatRow[]

  // Partition into enabled vs already-paused (skipping deleted schedules entirely).
  const enabled: ChatRow[] = []
  let alreadyPaused = 0
  for (const chat of rows) {
    const schedule = (chat.room_settings ?? {}).schedule as
      | Record<string, any>
      | undefined
    if (!schedule) continue
    if (schedule.paused_reason === "deleted") continue // soft-deleted: ignore
    if (schedule.enabled === true) {
      enabled.push(chat)
    } else {
      alreadyPaused += 1
    }
  }

  if (enabled.length <= maxSchedules) {
    return { paused: 0, alreadyPaused, errors }
  }

  // Sort newest first so we KEEP the most-recently-updated schedules.
  enabled.sort((a, b) => {
    const aKey = a.updated_at ?? a.created_at ?? ""
    const bKey = b.updated_at ?? b.created_at ?? ""
    if (aKey === bKey) return 0
    return aKey < bKey ? 1 : -1
  })

  const toPause = enabled.slice(maxSchedules)
  let paused = 0

  for (const chat of toPause) {
    const roomSettings = { ...(chat.room_settings ?? {}) }
    const schedule = { ...(roomSettings.schedule ?? {}) }
    schedule.enabled = false
    schedule.paused_reason = reason
    roomSettings.schedule = schedule

    const { error: updateError } = await (supabase as any)
      .from("chats")
      .update({ room_settings: roomSettings })
      .eq("id", chat.id)
      .eq("user_id", userId)

    if (updateError) {
      if (errors.length < 50) {
        errors.push({ kind: "schedule", id: chat.id, error: updateError.message ?? "unknown" })
      }
      console.error(
        `reconcileSchedules: failed to pause schedule on chat ${chat.id} for user ${userId}:`,
        updateError
      )
    } else {
      paused += 1
    }
  }

  return { paused, alreadyPaused, errors }
}

/**
 * Top-level orchestrator.  Resolve limits → reconcile machines → reconcile
 * schedules.  Each step's errors are captured and surfaced; one step's
 * failure does NOT abort subsequent steps.
 */
export async function reconcileForTierChange(
  args: ReconcileArgs
): Promise<ReconcileResult> {
  const tier = normalizeTier(args.newTier)
  const limits = await getTierResourceLimits(args.supabase, tier)
  const maxMachines = args.options?.maxMachinesOverride ?? limits.maxMachines
  const maxSchedules = args.options?.maxSchedulesOverride ?? limits.maxSchedules

  const result: ReconcileResult = {
    tier,
    maxMachines,
    maxSchedules,
    machinesTerminated: 0,
    machinesDeferred: 0,
    machinesFailedToTerminate: 0,
    schedulesPaused: 0,
    schedulesAlreadyPaused: 0,
    errors: [],
  }

  try {
    const m = await reconcileMachines(args.supabase, args.userId, maxMachines, {
      snapshotBeforeTerminate: args.options?.snapshotBeforeTerminate ?? true,
      reason: args.reason,
    })
    result.machinesTerminated = m.terminated
    result.machinesDeferred = m.deferred
    result.machinesFailedToTerminate = m.failed
    result.errors.push(...m.errors)
  } catch (err) {
    console.error(
      `reconcileForTierChange: reconcileMachines threw for user ${args.userId}:`,
      err
    )
    if (result.errors.length < 50) {
      result.errors.push({
        kind: "machine",
        id: "<batch>",
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  try {
    const s = await reconcileSchedules(
      args.supabase,
      args.userId,
      maxSchedules,
      args.reason
    )
    result.schedulesPaused = s.paused
    result.schedulesAlreadyPaused = s.alreadyPaused
    result.errors.push(...s.errors)
  } catch (err) {
    console.error(
      `reconcileForTierChange: reconcileSchedules threw for user ${args.userId}:`,
      err
    )
    if (result.errors.length < 50) {
      result.errors.push({
        kind: "schedule",
        id: "<batch>",
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return result
}
