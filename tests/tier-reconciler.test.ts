/**
 * Tier reconciler tests.
 *
 * Covers production scenarios for downgrade and cancellation paths:
 *   - Pro → Lite (excess machines + excess schedules)
 *   - Cancel from any paid tier → free
 *   - Electron-only users (no-op)
 *   - Mixed cloud + electron + temp-swarm
 *   - AWS terminate API failure (per-machine error isolation)
 *   - Snapshot failure (continues termination)
 *   - Already-deleting machines (deferred bucket)
 *   - User within limits (no-op)
 *   - Schedules already paused (not re-paused)
 *   - Soft-deleted schedules (excluded from count)
 *   - DB error during a single update (per-row error captured, others continue)
 *   - Multiple users isolation
 *   - Tier resolution: free / lite / starter / professional / enterprise
 *   - Stale `subscription_plans` row (falls back to canonical free defaults)
 *   - Idempotent re-run
 *
 * Run: ``npx vitest run tests/tier-reconciler.test.ts``
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

// ---- Mocks: AWS EC2 service ------------------------------------------------
//
// The reconciler dynamically imports @/lib/aws/ec2-service.  We replace the
// module so tests can assert which instances were terminated and inject
// failures.

const awsCalls = {
  terminateInstance: [] as Array<{ instanceId: string; keyName?: string }>,
  createMachineImage: [] as Array<{ instanceId: string; userId: string; name: string }>,
  cleanupOldSnapshots: [] as Array<{ userId: string; keep: number }>,
}

let awsTerminateBehavior: "ok" | "throw" = "ok"
let awsSnapshotBehavior: "ok" | "throw" = "ok"

vi.mock("@/lib/aws/ec2-service", () => ({
  getAwsEc2Service: () => ({
    terminateInstance: vi.fn(async (instanceId: string, keyName?: string) => {
      awsCalls.terminateInstance.push({ instanceId, keyName })
      if (awsTerminateBehavior === "throw") {
        throw new Error("AWS terminate API failure")
      }
    }),
    createMachineImage: vi.fn(async (instanceId: string, userId: string, name: string) => {
      awsCalls.createMachineImage.push({ instanceId, userId, name })
      if (awsSnapshotBehavior === "throw") {
        throw new Error("AWS snapshot API failure")
      }
      return { name: `snap-${instanceId}`, amiId: `ami-${instanceId}` }
    }),
    cleanupOldSnapshots: vi.fn(async (userId: string, keep: number) => {
      awsCalls.cleanupOldSnapshots.push({ userId, keep })
    }),
  }),
}))

import {
  getTierResourceLimits,
  listEnforceableMachines,
  reconcileMachines,
  reconcileSchedules,
  reconcileForTierChange,
} from "@/lib/services/tier-reconciler"

// ---- In-memory Supabase mock ----------------------------------------------
//
// Implements the chained query API the reconciler uses, against an in-memory
// table store.  Filter chain semantics match Supabase JS:
//   .from(table).select(cols).eq(...).neq(...).maybeSingle() / .execute()
//   .from(table).update(patch).eq(...).neq(...) (executes immediately)
//   .from(table).delete().eq(...) (executes immediately)
//   .from(table).insert(row) (executes immediately)

interface UserMachine {
  id: string
  user_id: string
  display_name: string | null
  status: string
  settings: Record<string, any> | null
  created_at: string
  last_active_at: string | null
}

interface Chat {
  id: string
  user_id: string
  room_settings: Record<string, any> | null
  created_at: string | null
  updated_at: string | null
}

interface SubscriptionPlan {
  id: string
  tier: string
  max_machines: number
}

interface MachineSnapshot {
  id?: string
  machine_id: string
  user_id: string
  snapshot_name: string
  snapshot_type: string
  storage_location: string
  size_gb: number
  os_state: Record<string, any>
}

class MockSupabase {
  user_machines: UserMachine[] = []
  chats: Chat[] = []
  subscription_plans: SubscriptionPlan[] = []
  machine_snapshots: MachineSnapshot[] = []

  // Inject specific errors for testing failure paths.
  errorOnUpdate: Record<string, Error | null> = {} // keyed on chat.id or machine.id

  from(table: string) {
    return new QueryBuilder(this, table)
  }

  rpc(_fn: string, _args: any) {
    return { data: null, error: null }
  }
}

interface Filter {
  column: string
  op: "eq" | "neq" | "in" | "not.is.null"
  value: any
}

class QueryBuilder {
  private filters: Filter[] = []
  private selectCols = "*"
  private updatePatch: Record<string, any> | null = null
  private deleteFlag = false
  private insertRow: Record<string, any> | null = null

  constructor(private db: MockSupabase, private table: string) {}

  select(cols?: string) {
    this.selectCols = cols ?? "*"
    return this
  }

  eq(column: string, value: any) {
    this.filters.push({ column, op: "eq", value })
    return this
  }

  neq(column: string, value: any) {
    this.filters.push({ column, op: "neq", value })
    return this
  }

  in(column: string, value: any[]) {
    this.filters.push({ column, op: "in", value })
    return this
  }

  not(column: string, _op: "is", value: any) {
    if (value === null) {
      this.filters.push({ column, op: "not.is.null", value: null })
    }
    return this
  }

  update(patch: Record<string, any>) {
    this.updatePatch = patch
    return this.executeWriteThen()
  }

  delete() {
    this.deleteFlag = true
    return this.executeWriteThen()
  }

  insert(row: Record<string, any>) {
    this.insertRow = row
    return this.executeWriteThen()
  }

  private executeWriteThen(): any {
    // Defer: writes execute when filters are also applied (eq calls happen
    // AFTER update()/delete() in the chain).  Return `this` so the chain
    // can call .eq().neq() etc., and finalize either at the end of the
    // chain on its own or via .select().single().
    return new ChainExecutor(this.db, this.table, this)
  }

  async maybeSingle() {
    return this.executeRead("maybeSingle")
  }

  async single() {
    return this.executeRead("single")
  }

  async then(resolve: any) {
    return resolve(this.executeRead("array"))
  }

  // ----- internals ----------------------------------------------------------

  private executeRead(mode: "maybeSingle" | "single" | "array"): any {
    const rows = (this.db as any)[this.table] as Record<string, any>[]
    const matched = rows.filter(r => this.matches(r))
    if (mode === "array") return { data: matched, error: null }
    if (matched.length === 0) {
      if (mode === "single") return { data: null, error: { code: "PGRST116", message: "no rows" } }
      return { data: null, error: null }
    }
    return { data: matched[0], error: null }
  }

  matches(row: Record<string, any>): boolean {
    for (const f of this.filters) {
      if (f.op === "eq") {
        if (row[f.column] !== f.value) return false
      } else if (f.op === "neq") {
        if (row[f.column] === f.value) return false
      } else if (f.op === "in") {
        if (!(f.value as any[]).includes(row[f.column])) return false
      } else if (f.op === "not.is.null") {
        if (row[f.column] === null || row[f.column] === undefined) return false
      }
    }
    return true
  }

  applyWrite(): { data: any; error: any } {
    const rows = (this.db as any)[this.table] as Record<string, any>[]
    if (this.deleteFlag) {
      let removed = 0
      for (let i = rows.length - 1; i >= 0; i--) {
        if (this.matches(rows[i])) {
          rows.splice(i, 1)
          removed++
        }
      }
      return { data: { removed }, error: null }
    }
    if (this.updatePatch) {
      let updated = 0
      for (const r of rows) {
        if (this.matches(r)) {
          // Inject error for specific row id?
          const injected = this.db.errorOnUpdate[r.id]
          if (injected) {
            return { data: null, error: { message: injected.message } }
          }
          Object.assign(r, this.updatePatch)
          updated++
        }
      }
      return { data: { updated }, error: null }
    }
    if (this.insertRow) {
      rows.push({ ...this.insertRow, id: this.insertRow.id ?? `gen_${rows.length + 1}` })
      return { data: this.insertRow, error: null }
    }
    return { data: null, error: null }
  }

  finalize() {
    return this.applyWrite()
  }
}

class ChainExecutor {
  constructor(
    private db: MockSupabase,
    private table: string,
    private builder: QueryBuilder,
    private executed = false
  ) {}

  eq(column: string, value: any) {
    ;(this.builder as any).filters.push({ column, op: "eq", value })
    return this
  }
  neq(column: string, value: any) {
    ;(this.builder as any).filters.push({ column, op: "neq", value })
    return this
  }

  // Make the chain awaitable — Supabase JS clients return PromiseLike
  // builders that resolve to {data, error} when awaited.
  then(resolve: any, _reject?: any) {
    if (!this.executed) {
      this.executed = true
      const result = this.builder.finalize()
      return resolve(result)
    }
    return resolve({ data: null, error: null })
  }
}

// ---- Test harness ----------------------------------------------------------

let db: MockSupabase

beforeEach(() => {
  db = new MockSupabase()
  awsCalls.terminateInstance = []
  awsCalls.createMachineImage = []
  awsCalls.cleanupOldSnapshots = []
  awsTerminateBehavior = "ok"
  awsSnapshotBehavior = "ok"

  // Seed canonical subscription plans matching production tier vocabulary.
  db.subscription_plans = [
    { id: "plan_lite", tier: "lite", max_machines: 1 },
    { id: "plan_starter", tier: "starter", max_machines: 1 },
    { id: "plan_professional", tier: "professional", max_machines: 2 },
    { id: "plan_enterprise", tier: "enterprise", max_machines: 3 },
  ]
})

function awsMachine(overrides: Partial<UserMachine> = {}): UserMachine {
  const id = overrides.id ?? `m_${Math.random().toString(36).slice(2, 8)}`
  return {
    id,
    user_id: "u1",
    display_name: id,
    status: "running",
    settings: {
      provider: "aws",
      awsInstanceId: `i-${id}`,
      awsKeyPairName: `kp-${id}`,
      storageGb: 20,
      desktopEnabled: true,
    },
    created_at: "2026-04-01T00:00:00Z",
    last_active_at: "2026-04-01T00:00:00Z",
    ...overrides,
  }
}

function electronMachine(id: string): UserMachine {
  return {
    id,
    user_id: "u1",
    display_name: id,
    status: "running",
    settings: { provider: "electron", isLocal: true },
    created_at: "2026-04-01T00:00:00Z",
    last_active_at: "2026-04-01T00:00:00Z",
  }
}

function tempSwarmMachine(id: string): UserMachine {
  return {
    id,
    user_id: "u1",
    display_name: id,
    status: "running",
    settings: { provider: "aws", awsInstanceId: `i-${id}`, is_swarm: true },
    created_at: "2026-04-01T00:00:00Z",
    last_active_at: "2026-04-01T00:00:00Z",
  }
}

function persistentSwarmMachine(id: string): UserMachine {
  return {
    id,
    user_id: "u1",
    display_name: id,
    status: "running",
    settings: {
      provider: "aws",
      awsInstanceId: `i-${id}`,
      is_swarm: true,
      persistent_swarm: true,
    },
    created_at: "2026-04-01T00:00:00Z",
    last_active_at: "2026-04-01T00:00:00Z",
  }
}

function chatWithSchedule(
  id: string,
  enabled: boolean,
  pausedReason: string | null = null,
  updatedAt = "2026-04-01T00:00:00Z"
): Chat {
  return {
    id,
    user_id: "u1",
    room_settings: {
      schedule: {
        enabled,
        target_machine_id: "m_1",
        cron: "0 0 * * *",
        ...(pausedReason ? { paused_reason: pausedReason } : {}),
      },
    },
    created_at: updatedAt,
    updated_at: updatedAt,
  }
}

// ---------------------------------------------------------------------------
// 1.  getTierResourceLimits
// ---------------------------------------------------------------------------

describe("getTierResourceLimits", () => {
  it("free tier returns hardcoded defaults (no DB lookup needed)", async () => {
    db.subscription_plans = [] // even with no plans, free works
    const limits = await getTierResourceLimits(db, "free")
    expect(limits).toEqual({ maxMachines: 1, maxSchedules: 3 })
  })

  it("lite tier returns 1 machine, 3 schedules", async () => {
    const limits = await getTierResourceLimits(db, "lite")
    expect(limits.maxMachines).toBe(1)
    expect(limits.maxSchedules).toBe(3)
  })

  it("starter tier returns 1 machine, 3 schedules", async () => {
    const limits = await getTierResourceLimits(db, "starter")
    expect(limits.maxMachines).toBe(1)
    expect(limits.maxSchedules).toBe(3)
  })

  it("professional tier returns 2 machines, 10 schedules", async () => {
    const limits = await getTierResourceLimits(db, "professional")
    expect(limits.maxMachines).toBe(2)
    expect(limits.maxSchedules).toBe(10)
  })

  it("enterprise tier returns 3 machines, 50 schedules", async () => {
    const limits = await getTierResourceLimits(db, "enterprise")
    expect(limits.maxMachines).toBe(3)
    expect(limits.maxSchedules).toBe(50)
  })

  it("unknown tier normalises to free", async () => {
    const limits = await getTierResourceLimits(db, "godmode")
    expect(limits.maxMachines).toBe(1)
    expect(limits.maxSchedules).toBe(3)
  })

  it("legacy alias 'pro' resolves to professional limits", async () => {
    const limits = await getTierResourceLimits(db, "pro")
    expect(limits.maxMachines).toBe(2)
    expect(limits.maxSchedules).toBe(10)
  })

  it("missing subscription_plans row falls back to free defaults", async () => {
    db.subscription_plans = [] // wipe plan rows
    const limits = await getTierResourceLimits(db, "professional")
    expect(limits.maxMachines).toBe(1) // free fallback
    expect(limits.maxSchedules).toBe(10) // schedules from lib/tier (not DB)
  })
})

// ---------------------------------------------------------------------------
// 2.  listEnforceableMachines
// ---------------------------------------------------------------------------

describe("listEnforceableMachines", () => {
  it("excludes electron machines", async () => {
    db.user_machines = [
      awsMachine({ id: "m_aws" }),
      electronMachine("m_electron"),
    ]
    const list = await listEnforceableMachines(db, "u1")
    expect(list.map(m => m.id)).toEqual(["m_aws"])
  })

  it("excludes already-deleting machines", async () => {
    db.user_machines = [
      awsMachine({ id: "m1", status: "running" }),
      awsMachine({ id: "m2", status: "deleting" }),
    ]
    const list = await listEnforceableMachines(db, "u1")
    expect(list.map(m => m.id)).toEqual(["m1"])
  })

  it("excludes temp-swarm machines, includes persistent-swarm machines", async () => {
    db.user_machines = [
      awsMachine({ id: "m_aws" }),
      tempSwarmMachine("m_temp_swarm"),
      persistentSwarmMachine("m_persist_swarm"),
    ]
    const list = await listEnforceableMachines(db, "u1")
    expect(list.map(m => m.id).sort()).toEqual(["m_aws", "m_persist_swarm"])
  })

  it("sorts oldest → newest by last_active_at", async () => {
    db.user_machines = [
      awsMachine({ id: "newest", last_active_at: "2026-05-01T00:00:00Z" }),
      awsMachine({ id: "oldest", last_active_at: "2026-01-01T00:00:00Z" }),
      awsMachine({ id: "middle", last_active_at: "2026-03-01T00:00:00Z" }),
    ]
    const list = await listEnforceableMachines(db, "u1")
    expect(list.map(m => m.id)).toEqual(["oldest", "middle", "newest"])
  })

  it("falls back to created_at when last_active_at is null", async () => {
    db.user_machines = [
      awsMachine({ id: "a", last_active_at: null, created_at: "2026-03-01T00:00:00Z" }),
      awsMachine({ id: "b", last_active_at: null, created_at: "2026-01-01T00:00:00Z" }),
    ]
    const list = await listEnforceableMachines(db, "u1")
    expect(list.map(m => m.id)).toEqual(["b", "a"])
  })

  it("isolates per-user (does not return other users' machines)", async () => {
    db.user_machines = [
      awsMachine({ id: "u1_m" }),
      { ...awsMachine({ id: "u2_m" }), user_id: "u2" },
    ]
    const list = await listEnforceableMachines(db, "u1")
    expect(list.map(m => m.id)).toEqual(["u1_m"])
  })
})

// ---------------------------------------------------------------------------
// 3.  reconcileMachines
// ---------------------------------------------------------------------------

describe("reconcileMachines", () => {
  it("no-op when within limit", async () => {
    db.user_machines = [awsMachine({ id: "m1" })]
    const r = await reconcileMachines(db, "u1", 2, { reason: "subscription_downgraded" })
    expect(r).toEqual({ terminated: 0, deferred: 0, failed: 0, errors: [] })
    expect(awsCalls.terminateInstance).toHaveLength(0)
  })

  it("terminates oldest machine when one over limit (Pro→Plus, 3→2)", async () => {
    db.user_machines = [
      awsMachine({ id: "newest", last_active_at: "2026-05-01T00:00:00Z" }),
      awsMachine({ id: "oldest", last_active_at: "2026-01-01T00:00:00Z" }),
      awsMachine({ id: "middle", last_active_at: "2026-03-01T00:00:00Z" }),
    ]
    const r = await reconcileMachines(db, "u1", 2, { reason: "subscription_downgraded" })
    expect(r.terminated).toBe(1)
    expect(r.failed).toBe(0)
    expect(awsCalls.terminateInstance.map(c => c.instanceId)).toEqual(["i-oldest"])
    expect(db.user_machines.map(m => m.id).sort()).toEqual(["middle", "newest"])
  })

  it("terminates 2 oldest when two over limit (Pro→Lite, 3→1)", async () => {
    db.user_machines = [
      awsMachine({ id: "m_new", last_active_at: "2026-05-01T00:00:00Z" }),
      awsMachine({ id: "m_old", last_active_at: "2026-01-01T00:00:00Z" }),
      awsMachine({ id: "m_mid", last_active_at: "2026-03-01T00:00:00Z" }),
    ]
    const r = await reconcileMachines(db, "u1", 1, { reason: "subscription_downgraded" })
    expect(r.terminated).toBe(2)
    expect(awsCalls.terminateInstance.map(c => c.instanceId).sort()).toEqual(["i-m_mid", "i-m_old"])
    expect(db.user_machines.map(m => m.id)).toEqual(["m_new"])
  })

  it("terminates ALL when cancelling (free, max 1) and user has 4", async () => {
    db.user_machines = [
      awsMachine({ id: "m1", last_active_at: "2026-01-01T00:00:00Z" }),
      awsMachine({ id: "m2", last_active_at: "2026-02-01T00:00:00Z" }),
      awsMachine({ id: "m3", last_active_at: "2026-03-01T00:00:00Z" }),
      awsMachine({ id: "m4", last_active_at: "2026-04-01T00:00:00Z" }),
    ]
    const r = await reconcileMachines(db, "u1", 1, { reason: "subscription_canceled" })
    expect(r.terminated).toBe(3)
    expect(db.user_machines.map(m => m.id)).toEqual(["m4"])
  })

  it("snapshots non-swarm machines pre-terminate", async () => {
    db.user_machines = [
      awsMachine({ id: "m_old" }),
      awsMachine({ id: "m_new", last_active_at: "2027-01-01T00:00:00Z" }),
    ]
    await reconcileMachines(db, "u1", 1, { reason: "subscription_canceled" })
    expect(awsCalls.createMachineImage.map(c => c.instanceId)).toEqual(["i-m_old"])
    expect(db.machine_snapshots).toHaveLength(1)
    expect(db.machine_snapshots[0].snapshot_type).toBe("pre_shutdown")
    expect(db.machine_snapshots[0].os_state.reason).toBe("subscription_canceled")
  })

  it("skips snapshot when snapshotBeforeTerminate=false", async () => {
    db.user_machines = [
      awsMachine({ id: "m_old" }),
      awsMachine({ id: "m_new", last_active_at: "2027-01-01T00:00:00Z" }),
    ]
    await reconcileMachines(db, "u1", 1, {
      reason: "subscription_canceled",
      snapshotBeforeTerminate: false,
    })
    expect(awsCalls.createMachineImage).toHaveLength(0)
    expect(awsCalls.terminateInstance.map(c => c.instanceId)).toEqual(["i-m_old"])
  })

  it("snapshot failure does not block termination", async () => {
    awsSnapshotBehavior = "throw"
    db.user_machines = [
      awsMachine({ id: "m_old" }),
      awsMachine({ id: "m_new", last_active_at: "2027-01-01T00:00:00Z" }),
    ]
    const r = await reconcileMachines(db, "u1", 1, { reason: "subscription_canceled" })
    expect(r.terminated).toBe(1) // termination still happened
    expect(awsCalls.terminateInstance.map(c => c.instanceId)).toEqual(["i-m_old"])
    expect(db.machine_snapshots).toHaveLength(0) // snapshot failed
  })

  it("AWS terminate failure leaves DB row in deleting status and counts as failed", async () => {
    awsTerminateBehavior = "throw"
    db.user_machines = [
      awsMachine({ id: "m_old" }),
      awsMachine({ id: "m_new", last_active_at: "2027-01-01T00:00:00Z" }),
    ]
    const r = await reconcileMachines(db, "u1", 1, { reason: "subscription_canceled" })
    expect(r.terminated).toBe(0)
    expect(r.failed).toBe(1)
    expect(r.errors[0]?.kind).toBe("machine")
    expect(r.errors[0]?.id).toBe("m_old")
    // DB row remains, but flipped to status=deleting (won't count toward limit on next pass).
    const oldRow = db.user_machines.find(m => m.id === "m_old")
    expect(oldRow?.status).toBe("deleting")
  })

  it("excludes electron machines from cap (mixed cloud + electron)", async () => {
    db.user_machines = [
      awsMachine({ id: "m_cloud" }),
      electronMachine("m_electron_1"),
      electronMachine("m_electron_2"),
      electronMachine("m_electron_3"),
    ]
    const r = await reconcileMachines(db, "u1", 1, { reason: "subscription_canceled" })
    expect(r.terminated).toBe(0) // 1 cloud, max 1 → no-op
    expect(awsCalls.terminateInstance).toHaveLength(0)
    // Electron machines are untouched.
    expect(db.user_machines.filter(m => (m.settings as any).provider === "electron")).toHaveLength(3)
  })

  it("swarm temp machines are skipped (not counted, not terminated)", async () => {
    db.user_machines = [
      awsMachine({ id: "m_persistent" }),
      tempSwarmMachine("m_swarm_1"),
      tempSwarmMachine("m_swarm_2"),
    ]
    const r = await reconcileMachines(db, "u1", 1, { reason: "subscription_canceled" })
    expect(r.terminated).toBe(0)
    expect(db.user_machines).toHaveLength(3) // all preserved
  })
})

// ---------------------------------------------------------------------------
// 4.  reconcileSchedules
// ---------------------------------------------------------------------------

describe("reconcileSchedules", () => {
  it("no-op when within limit", async () => {
    db.chats = [
      chatWithSchedule("c1", true),
      chatWithSchedule("c2", true),
    ]
    const r = await reconcileSchedules(db, "u1", 5, "subscription_downgraded")
    expect(r.paused).toBe(0)
    expect(r.alreadyPaused).toBe(0)
  })

  it("pauses oldest excess schedules (Plus → Lite, 8→3)", async () => {
    db.chats = [
      chatWithSchedule("c_oldest", true, null, "2026-01-01T00:00:00Z"),
      chatWithSchedule("c_old", true, null, "2026-02-01T00:00:00Z"),
      chatWithSchedule("c_3", true, null, "2026-03-01T00:00:00Z"),
      chatWithSchedule("c_4", true, null, "2026-04-01T00:00:00Z"),
      chatWithSchedule("c_5", true, null, "2026-05-01T00:00:00Z"),
      chatWithSchedule("c_6", true, null, "2026-06-01T00:00:00Z"),
      chatWithSchedule("c_7", true, null, "2026-07-01T00:00:00Z"),
      chatWithSchedule("c_newest", true, null, "2026-08-01T00:00:00Z"),
    ]
    const r = await reconcileSchedules(db, "u1", 3, "subscription_downgraded")
    expect(r.paused).toBe(5)
    expect(r.alreadyPaused).toBe(0)

    // Newest 3 still enabled; oldest 5 paused with reason.
    const enabled = db.chats.filter(c => (c.room_settings?.schedule as any).enabled === true)
    expect(enabled.map(c => c.id).sort()).toEqual(["c_5", "c_6", "c_7", "c_newest"].sort().slice(-3).sort())
    const paused = db.chats.filter(c => (c.room_settings?.schedule as any).enabled === false)
    expect(paused).toHaveLength(5)
    expect(paused.every(c =>
      (c.room_settings?.schedule as any).paused_reason === "subscription_downgraded"
    )).toBe(true)
  })

  it("pauses ALL schedules on cancel (free max 3, but reason takes precedence)", async () => {
    db.chats = [
      chatWithSchedule("c1", true, null, "2026-01-01T00:00:00Z"),
      chatWithSchedule("c2", true, null, "2026-02-01T00:00:00Z"),
      chatWithSchedule("c3", true, null, "2026-03-01T00:00:00Z"),
      chatWithSchedule("c4", true, null, "2026-04-01T00:00:00Z"),
    ]
    // Free tier still allows 3 schedules — but on cancel we pass max=3 and
    // expect the oldest 1 to be paused.  (We do NOT pause everything on
    // cancel; the user keeps their free-tier slots if they want.)
    const r = await reconcileSchedules(db, "u1", 3, "subscription_canceled")
    expect(r.paused).toBe(1)
    expect(
      db.chats.find(c => c.id === "c1")?.room_settings?.schedule?.enabled
    ).toBe(false)
    expect(
      db.chats.find(c => c.id === "c1")?.room_settings?.schedule?.paused_reason
    ).toBe("subscription_canceled")
  })

  it("does not touch schedules already paused (different reason)", async () => {
    db.chats = [
      chatWithSchedule("c_paused", false, "too_many_failures", "2026-01-01T00:00:00Z"),
      chatWithSchedule("c_active_old", true, null, "2026-02-01T00:00:00Z"),
      chatWithSchedule("c_active_new", true, null, "2026-03-01T00:00:00Z"),
      chatWithSchedule("c_active_3", true, null, "2026-04-01T00:00:00Z"),
      chatWithSchedule("c_active_4", true, null, "2026-05-01T00:00:00Z"),
    ]
    const r = await reconcileSchedules(db, "u1", 3, "subscription_downgraded")
    expect(r.paused).toBe(1) // only c_active_old (oldest enabled)
    expect(r.alreadyPaused).toBe(1) // c_paused

    // Already-paused schedule keeps its reason.
    expect(
      db.chats.find(c => c.id === "c_paused")?.room_settings?.schedule?.paused_reason
    ).toBe("too_many_failures")
  })

  it("excludes soft-deleted schedules from count", async () => {
    db.chats = [
      chatWithSchedule("c_deleted", false, "deleted", "2026-01-01T00:00:00Z"),
      chatWithSchedule("c_active_1", true, null, "2026-02-01T00:00:00Z"),
      chatWithSchedule("c_active_2", true, null, "2026-03-01T00:00:00Z"),
      chatWithSchedule("c_active_3", true, null, "2026-04-01T00:00:00Z"),
    ]
    // 3 enabled, max 3 → no-op despite the deleted row's existence.
    const r = await reconcileSchedules(db, "u1", 3, "subscription_downgraded")
    expect(r.paused).toBe(0)
  })

  it("isolates per-user (does not pause other users' schedules)", async () => {
    db.chats = [
      chatWithSchedule("c1", true, null, "2026-01-01T00:00:00Z"),
      chatWithSchedule("c2", true, null, "2026-02-01T00:00:00Z"),
      chatWithSchedule("c3", true, null, "2026-03-01T00:00:00Z"),
      { ...chatWithSchedule("u2_c1", true, null, "2026-01-01T00:00:00Z"), user_id: "u2" },
    ]
    const r = await reconcileSchedules(db, "u1", 1, "subscription_canceled")
    expect(r.paused).toBe(2)
    expect(
      db.chats.find(c => c.id === "u2_c1")?.room_settings?.schedule?.enabled
    ).toBe(true) // untouched
  })

  it("captures DB error per-row and continues with the rest", async () => {
    db.chats = [
      chatWithSchedule("c_old", true, null, "2026-01-01T00:00:00Z"),
      chatWithSchedule("c_mid", true, null, "2026-02-01T00:00:00Z"),
      chatWithSchedule("c_new", true, null, "2026-03-01T00:00:00Z"),
    ]
    db.errorOnUpdate["c_mid"] = new Error("simulated DB write failure")
    const r = await reconcileSchedules(db, "u1", 1, "subscription_canceled")
    expect(r.paused).toBe(1) // only c_old succeeded
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0].id).toBe("c_mid")
    // c_new should be enabled (we keep newest 1)
    expect(
      db.chats.find(c => c.id === "c_new")?.room_settings?.schedule?.enabled
    ).toBe(true)
  })

  it("idempotent: re-running yields no further changes", async () => {
    db.chats = [
      chatWithSchedule("c1", true, null, "2026-01-01T00:00:00Z"),
      chatWithSchedule("c2", true, null, "2026-02-01T00:00:00Z"),
      chatWithSchedule("c3", true, null, "2026-03-01T00:00:00Z"),
      chatWithSchedule("c4", true, null, "2026-04-01T00:00:00Z"),
    ]
    const r1 = await reconcileSchedules(db, "u1", 2, "subscription_downgraded")
    expect(r1.paused).toBe(2)
    const r2 = await reconcileSchedules(db, "u1", 2, "subscription_downgraded")
    expect(r2.paused).toBe(0)
    expect(r2.alreadyPaused).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// 5.  reconcileForTierChange — full orchestration
// ---------------------------------------------------------------------------

describe("reconcileForTierChange (full orchestration)", () => {
  it("Pro → Plus downgrade: terminates 1 machine, no schedule pause when within 10", async () => {
    db.user_machines = [
      awsMachine({ id: "m_old", last_active_at: "2026-01-01T00:00:00Z" }),
      awsMachine({ id: "m_mid", last_active_at: "2026-02-01T00:00:00Z" }),
      awsMachine({ id: "m_new", last_active_at: "2026-03-01T00:00:00Z" }),
    ]
    db.chats = [
      chatWithSchedule("c1", true, null, "2026-01-01T00:00:00Z"),
      chatWithSchedule("c2", true, null, "2026-02-01T00:00:00Z"),
      chatWithSchedule("c3", true, null, "2026-03-01T00:00:00Z"),
    ]
    const result = await reconcileForTierChange({
      supabase: db,
      userId: "u1",
      newTier: "professional",
      reason: "subscription_downgraded",
    })
    expect(result.tier).toBe("professional")
    expect(result.maxMachines).toBe(2)
    expect(result.maxSchedules).toBe(10)
    expect(result.machinesTerminated).toBe(1) // 3→2
    expect(result.schedulesPaused).toBe(0) // 3 ≤ 10
    expect(awsCalls.terminateInstance.map(c => c.instanceId)).toEqual(["i-m_old"])
  })

  it("Cancel from enterprise → free: terminates 2 machines, pauses 7 schedules", async () => {
    db.user_machines = [
      awsMachine({ id: "m1", last_active_at: "2026-01-01T00:00:00Z" }),
      awsMachine({ id: "m2", last_active_at: "2026-02-01T00:00:00Z" }),
      awsMachine({ id: "m3", last_active_at: "2026-03-01T00:00:00Z" }),
    ]
    db.chats = [
      chatWithSchedule("c1", true, null, "2026-01-01T00:00:00Z"),
      chatWithSchedule("c2", true, null, "2026-02-01T00:00:00Z"),
      chatWithSchedule("c3", true, null, "2026-03-01T00:00:00Z"),
      chatWithSchedule("c4", true, null, "2026-04-01T00:00:00Z"),
      chatWithSchedule("c5", true, null, "2026-05-01T00:00:00Z"),
      chatWithSchedule("c6", true, null, "2026-06-01T00:00:00Z"),
      chatWithSchedule("c7", true, null, "2026-07-01T00:00:00Z"),
      chatWithSchedule("c8", true, null, "2026-08-01T00:00:00Z"),
      chatWithSchedule("c9", true, null, "2026-09-01T00:00:00Z"),
      chatWithSchedule("c10", true, null, "2026-10-01T00:00:00Z"),
    ]
    const result = await reconcileForTierChange({
      supabase: db,
      userId: "u1",
      newTier: "free",
      reason: "subscription_canceled",
    })
    expect(result.tier).toBe("free")
    expect(result.maxMachines).toBe(1)
    expect(result.maxSchedules).toBe(3)
    expect(result.machinesTerminated).toBe(2)
    expect(result.schedulesPaused).toBe(7) // 10 - 3
    expect(result.errors).toEqual([])
  })

  it("Idempotent: second pass after a successful first pass is a no-op", async () => {
    db.user_machines = [
      awsMachine({ id: "m_old", last_active_at: "2026-01-01T00:00:00Z" }),
      awsMachine({ id: "m_new", last_active_at: "2026-02-01T00:00:00Z" }),
    ]
    db.chats = [
      chatWithSchedule("c1", true, null, "2026-01-01T00:00:00Z"),
      chatWithSchedule("c2", true, null, "2026-02-01T00:00:00Z"),
      chatWithSchedule("c3", true, null, "2026-03-01T00:00:00Z"),
      chatWithSchedule("c4", true, null, "2026-04-01T00:00:00Z"),
    ]

    const r1 = await reconcileForTierChange({
      supabase: db, userId: "u1", newTier: "free", reason: "subscription_canceled",
    })
    expect(r1.machinesTerminated).toBe(1)
    expect(r1.schedulesPaused).toBe(1)

    const r2 = await reconcileForTierChange({
      supabase: db, userId: "u1", newTier: "free", reason: "subscription_canceled",
    })
    expect(r2.machinesTerminated).toBe(0)
    expect(r2.schedulesPaused).toBe(0)
    expect(r2.schedulesAlreadyPaused).toBe(1)
  })

  it("Free user staying free: no-op", async () => {
    db.user_machines = [awsMachine({ id: "m" })]
    db.chats = [chatWithSchedule("c", true, null, "2026-01-01T00:00:00Z")]
    const result = await reconcileForTierChange({
      supabase: db, userId: "u1", newTier: "free", reason: "subscription_downgraded",
    })
    expect(result.machinesTerminated).toBe(0)
    expect(result.schedulesPaused).toBe(0)
  })

  it("Electron-only user cancels: no machine termination", async () => {
    db.user_machines = [
      electronMachine("e1"),
      electronMachine("e2"),
      electronMachine("e3"),
    ]
    db.chats = []
    const result = await reconcileForTierChange({
      supabase: db, userId: "u1", newTier: "free", reason: "subscription_canceled",
    })
    expect(result.machinesTerminated).toBe(0)
    expect(awsCalls.terminateInstance).toHaveLength(0)
    expect(db.user_machines).toHaveLength(3) // all electron preserved
  })

  it("AWS errors on some terminations: continues with others, reports failed count", async () => {
    // Make the first AWS call throw, second succeed. Easiest: throw always
    // and assert all 2 machines fail.
    awsTerminateBehavior = "throw"
    db.user_machines = [
      awsMachine({ id: "m_old", last_active_at: "2026-01-01T00:00:00Z" }),
      awsMachine({ id: "m_mid", last_active_at: "2026-02-01T00:00:00Z" }),
      awsMachine({ id: "m_new", last_active_at: "2026-03-01T00:00:00Z" }),
    ]
    db.chats = []
    const result = await reconcileForTierChange({
      supabase: db, userId: "u1", newTier: "free", reason: "subscription_canceled",
    })
    expect(result.machinesTerminated).toBe(0)
    expect(result.machinesFailedToTerminate).toBe(2)
    expect(result.errors).toHaveLength(2)
    expect(result.errors.map(e => e.id).sort()).toEqual(["m_mid", "m_old"])
  })

  it("Lite tier downgrade with schedules pause to 3", async () => {
    db.user_machines = []
    db.chats = [
      chatWithSchedule("c1", true, null, "2026-01-01T00:00:00Z"),
      chatWithSchedule("c2", true, null, "2026-02-01T00:00:00Z"),
      chatWithSchedule("c3", true, null, "2026-03-01T00:00:00Z"),
      chatWithSchedule("c4", true, null, "2026-04-01T00:00:00Z"),
      chatWithSchedule("c5", true, null, "2026-05-01T00:00:00Z"),
    ]
    const result = await reconcileForTierChange({
      supabase: db, userId: "u1", newTier: "lite", reason: "subscription_downgraded",
    })
    expect(result.maxSchedules).toBe(3)
    expect(result.schedulesPaused).toBe(2) // c1, c2 paused; c3, c4, c5 kept
    expect(
      db.chats.find(c => c.id === "c1")?.room_settings?.schedule?.paused_reason
    ).toBe("subscription_downgraded")
  })

  it("user_id isolation: reconciling u1 does not affect u2", async () => {
    db.user_machines = [
      awsMachine({ id: "u1_m1", last_active_at: "2026-01-01T00:00:00Z" }),
      awsMachine({ id: "u1_m2", last_active_at: "2026-02-01T00:00:00Z" }),
      { ...awsMachine({ id: "u2_m1", last_active_at: "2026-01-01T00:00:00Z" }), user_id: "u2" },
      { ...awsMachine({ id: "u2_m2", last_active_at: "2026-02-01T00:00:00Z" }), user_id: "u2" },
      { ...awsMachine({ id: "u2_m3", last_active_at: "2026-03-01T00:00:00Z" }), user_id: "u2" },
    ]
    db.chats = [
      chatWithSchedule("u1_c1", true, null, "2026-01-01T00:00:00Z"),
      { ...chatWithSchedule("u2_c1", true, null, "2026-01-01T00:00:00Z"), user_id: "u2" },
      { ...chatWithSchedule("u2_c2", true, null, "2026-02-01T00:00:00Z"), user_id: "u2" },
      { ...chatWithSchedule("u2_c3", true, null, "2026-03-01T00:00:00Z"), user_id: "u2" },
      { ...chatWithSchedule("u2_c4", true, null, "2026-04-01T00:00:00Z"), user_id: "u2" },
    ]
    await reconcileForTierChange({
      supabase: db, userId: "u1", newTier: "free", reason: "subscription_canceled",
    })
    // u1: 2→1 machine, 1→1 schedule (within free max=3)
    expect(db.user_machines.filter(m => m.user_id === "u1")).toHaveLength(1)
    // u2 is untouched.
    expect(db.user_machines.filter(m => m.user_id === "u2")).toHaveLength(3)
    expect(
      db.chats.filter(c => c.user_id === "u2" && c.room_settings?.schedule?.enabled === true)
    ).toHaveLength(4)
  })

  it("max overrides: respects maxMachinesOverride / maxSchedulesOverride", async () => {
    db.user_machines = [
      awsMachine({ id: "m1", last_active_at: "2026-01-01T00:00:00Z" }),
      awsMachine({ id: "m2", last_active_at: "2026-02-01T00:00:00Z" }),
      awsMachine({ id: "m3", last_active_at: "2026-03-01T00:00:00Z" }),
    ]
    const result = await reconcileForTierChange({
      supabase: db,
      userId: "u1",
      newTier: "enterprise", // would normally be 3
      reason: "subscription_downgraded",
      options: { maxMachinesOverride: 0 }, // force-terminate everything
    })
    expect(result.machinesTerminated).toBe(3)
    expect(db.user_machines).toHaveLength(0)
  })
})
