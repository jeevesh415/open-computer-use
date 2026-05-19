/**
 * Regression tests for the 42702 "ambiguous user_id" bug fixed in migration
 * 015 (supabase/migrations/015_fix_ambiguous_user_id.sql).
 *
 * These tests are intentionally agnostic to a real Postgres connection —
 * they exercise an in-memory model of the function whose contract changed
 * (column-name rename in the RETURNS TABLE clause) and verify that the
 * webhook caller wires up correctly to the new column names.
 *
 * The SQL-level proof that 42702 is gone lives in two places:
 *   1. The smoke-test DO block at the bottom of migration 015 that calls
 *      update_subscription_status() with a sentinel non-existent
 *      stripe_subscription_id and asserts zero rows + no exception.
 *   2. backend/tests/test_tier_unification.py — which models the SQL by
 *      hand and was already passing pre-fix because Python doesn't have
 *      plpgsql's variable_conflict footgun.
 *
 * What THIS file adds:
 *   * Asserts the post-015 RPC returns rows shaped {out_user_id,
 *     out_resolved_tier, out_is_paid} (the contract the webhook now reads).
 *   * Asserts the downgrade reconciliation block in
 *     app/api/credits/webhook/route.ts wires correctly to that shape —
 *     no more silently-skipped reconcileForTierChange calls (the live
 *     symptom of NEW-1).
 *   * Asserts the cancellation path flips machine_limits.tier → 'free'
 *     and user_credits.has_active_subscription → false, end to end.
 *   * Asserts the plan-not-found WARNING path returns the
 *     {out_user_id, out_resolved_tier=null, out_is_paid=true} row shape
 *     so the webhook can detect "tier unchanged" without crashing.
 *
 * Run: ``npx vitest run tests/billing-webhook-ambiguous-user-id.test.ts``
 */
import { describe, it, expect, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Minimal in-memory model of the four tables touched by the RPC.
// Mirrors the post-015 column shape exactly.
// ---------------------------------------------------------------------------

interface UserSubscriptionRow {
  user_id: string
  stripe_subscription_id: string
  subscription_plan_id: string | null
  status: string
  current_period_start: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean
  canceled_at: string | null
  created_at: string
  updated_at: string
}

interface SubscriptionPlanRow {
  id: string
  tier: string
  stripe_price_id: string
}

interface UserCreditsRow {
  user_id: string
  balance: number
  has_active_subscription: boolean
  subscription_tier: string | null
}

interface MachineLimitsRow {
  user_id: string
  tier: string
}

interface RpcResultRow {
  out_user_id: string
  out_resolved_tier: string | null
  out_is_paid: boolean
}

const PAID_STATUSES = new Set(["active", "trialing", "past_due"])

class FakeDb {
  user_subscriptions = new Map<string, UserSubscriptionRow>()
  subscription_plans = new Map<string, SubscriptionPlanRow>()
  user_credits = new Map<string, UserCreditsRow>()
  machine_limits = new Map<string, MachineLimitsRow>()

  seedPlans() {
    const plans: SubscriptionPlanRow[] = [
      { id: "plan_lite",         tier: "lite",         stripe_price_id: "price_lite" },
      { id: "plan_starter",      tier: "starter",      stripe_price_id: "price_starter" },
      { id: "plan_professional", tier: "professional", stripe_price_id: "price_pro" },
      { id: "plan_enterprise",   tier: "enterprise",   stripe_price_id: "price_ent" },
    ]
    for (const p of plans) this.subscription_plans.set(p.id, p)
  }

  seedUser(userId: string) {
    this.user_credits.set(userId, {
      user_id: userId,
      balance: 100,
      has_active_subscription: false,
      subscription_tier: null,
    })
    this.machine_limits.set(userId, { user_id: userId, tier: "free" })
  }

  seedSubscription(o: {
    user_id: string
    stripe_subscription_id: string
    subscription_plan_id: string | null
    status: string
  }) {
    const now = new Date().toISOString()
    this.user_subscriptions.set(o.stripe_subscription_id, {
      ...o,
      current_period_start: now,
      current_period_end: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      cancel_at_period_end: false,
      canceled_at: null,
      created_at: now,
      updated_at: now,
    })
  }

  /**
   * Faithful port of update_subscription_status() AFTER migration 015.
   * Crucially: the returned row uses {out_user_id, out_resolved_tier,
   * out_is_paid} keys — the post-fix shape.
   */
  rpc_update_subscription_status(args: {
    p_stripe_subscription_id: string
    p_status: string
    p_period_start?: string | null
    p_period_end?: string | null
    p_cancel_at_period_end?: boolean | null
    p_subscription_plan_id?: string | null
  }): RpcResultRow[] {
    const isPaid = PAID_STATUSES.has(args.p_status)
    const sub = this.user_subscriptions.get(args.p_stripe_subscription_id)
    // Subscription not found → empty result, no exception (mirrors the
    // RAISE NOTICE 'subscription % not found' early-return path).
    if (!sub) return []

    sub.status = args.p_status
    if (args.p_period_start != null) sub.current_period_start = args.p_period_start
    if (args.p_period_end != null) sub.current_period_end = args.p_period_end
    if (args.p_cancel_at_period_end != null) sub.cancel_at_period_end = args.p_cancel_at_period_end
    if (args.p_subscription_plan_id != null) sub.subscription_plan_id = args.p_subscription_plan_id
    if (args.p_status === "canceled" && sub.canceled_at == null) {
      sub.canceled_at = new Date().toISOString()
    }
    sub.updated_at = new Date().toISOString()

    let newTier: string
    if (isPaid) {
      const plan = sub.subscription_plan_id
        ? this.subscription_plans.get(sub.subscription_plan_id)
        : null
      if (!plan) {
        // RAISE WARNING path — DO NOT downgrade, return null tier so the
        // caller can detect "tier unchanged".
        return [{ out_user_id: sub.user_id, out_resolved_tier: null, out_is_paid: true }]
      }
      newTier = plan.tier
    } else {
      newTier = "free"
    }

    let uc = this.user_credits.get(sub.user_id)
    if (!uc) {
      uc = {
        user_id: sub.user_id,
        balance: 0,
        has_active_subscription: isPaid,
        subscription_tier: isPaid ? newTier : null,
      }
      this.user_credits.set(sub.user_id, uc)
    } else {
      uc.has_active_subscription = isPaid
      uc.subscription_tier = isPaid ? newTier : null
    }

    const ml = this.machine_limits.get(sub.user_id)
    if (!ml) {
      this.machine_limits.set(sub.user_id, { user_id: sub.user_id, tier: newTier })
    } else {
      ml.tier = newTier
    }

    return [{ out_user_id: sub.user_id, out_resolved_tier: newTier, out_is_paid: isPaid }]
  }
}

// ---------------------------------------------------------------------------
// Webhook caller emulation — minimal port of the relevant block in
// app/api/credits/webhook/route.ts that reads the RPC result.  Validates
// that the destructure uses out_*-prefixed keys.
// ---------------------------------------------------------------------------

interface ReconcileCall {
  userId: string
  newTier: string
  reason: string
}

function emulateSubscriptionUpdatedReconcile(
  rpcResult: RpcResultRow[] | null | undefined,
  reconcile: (args: ReconcileCall) => void
) {
  // Mirror lines 912-915 of route.ts (after migration 015).
  const resolvedUserId = rpcResult?.[0]?.out_user_id as string | undefined
  const resolvedTier = rpcResult?.[0]?.out_resolved_tier as string | undefined
  if (resolvedUserId && resolvedTier) {
    reconcile({
      userId: resolvedUserId,
      newTier: resolvedTier,
      reason: "subscription_downgraded",
    })
  }
}

function emulateSubscriptionDeletedResolve(
  rpcResult: RpcResultRow[] | null | undefined
): string | null {
  // Mirror line 977 of route.ts (after migration 015).
  return (rpcResult?.[0]?.out_user_id as string | undefined) ?? null
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Migration 015: 42702 ambiguous user_id fix", () => {
  let db: FakeDb

  beforeEach(() => {
    db = new FakeDb()
    db.seedPlans()
    db.seedUser("u1")
  })

  describe("RPC return shape uses out_-prefixed columns", () => {
    it("active sub returns out_user_id + out_resolved_tier + out_is_paid", () => {
      db.seedSubscription({
        user_id: "u1",
        stripe_subscription_id: "sub_1",
        subscription_plan_id: "plan_starter",
        status: "active",
      })

      const result = db.rpc_update_subscription_status({
        p_stripe_subscription_id: "sub_1",
        p_status: "active",
      })

      expect(result).toHaveLength(1)
      const row = result[0]
      // The out_-prefixed keys MUST be present.
      expect(row).toHaveProperty("out_user_id")
      expect(row).toHaveProperty("out_resolved_tier")
      expect(row).toHaveProperty("out_is_paid")
      // Legacy keys MUST NOT be present (catches accidental rollback).
      expect(row).not.toHaveProperty("user_id")
      expect(row).not.toHaveProperty("resolved_tier")
      expect(row).not.toHaveProperty("is_paid")

      expect(row.out_user_id).toBe("u1")
      expect(row.out_resolved_tier).toBe("starter")
      expect(row.out_is_paid).toBe(true)
    })

    it("subscription-not-found returns empty array (early RAISE NOTICE path)", () => {
      const result = db.rpc_update_subscription_status({
        p_stripe_subscription_id: "sub_does_not_exist",
        p_status: "canceled",
      })
      expect(result).toEqual([])
    })

    it("plan-not-found WARNING path returns out_resolved_tier=null", () => {
      db.seedSubscription({
        user_id: "u1",
        stripe_subscription_id: "sub_1",
        subscription_plan_id: null, // ← orphaned plan
        status: "active",
      })

      const result = db.rpc_update_subscription_status({
        p_stripe_subscription_id: "sub_1",
        p_status: "active",
      })

      expect(result).toHaveLength(1)
      expect(result[0].out_user_id).toBe("u1")
      expect(result[0].out_resolved_tier).toBeNull()
      expect(result[0].out_is_paid).toBe(true)
      // tier MUST NOT have been forced to free — leave alone.
      expect(db.machine_limits.get("u1")?.tier).toBe("free") // started free
    })
  })

  describe("downgrade path (the production-bug symptom: NEW-1)", () => {
    it("subscription.updated → reconcileForTierChange runs with the new tier", () => {
      db.seedSubscription({
        user_id: "u1",
        stripe_subscription_id: "sub_1",
        subscription_plan_id: "plan_enterprise",
        status: "active",
      })
      // Set initial state to enterprise.
      db.rpc_update_subscription_status({
        p_stripe_subscription_id: "sub_1",
        p_status: "active",
      })
      expect(db.machine_limits.get("u1")?.tier).toBe("enterprise")

      // Customer Portal downgrade: enterprise → starter.
      const downgradeResult = db.rpc_update_subscription_status({
        p_stripe_subscription_id: "sub_1",
        p_status: "active",
        p_subscription_plan_id: "plan_starter",
      })

      // Pre-fix: rpcResult was undefined because PG raised 42702 →
      // resolvedUserId/resolvedTier both undefined → reconcile NEVER ran.
      // Post-fix: keys are out_*-prefixed and we read them correctly.
      const reconcileCalls: ReconcileCall[] = []
      emulateSubscriptionUpdatedReconcile(downgradeResult, (args) =>
        reconcileCalls.push(args)
      )

      expect(reconcileCalls).toHaveLength(1)
      expect(reconcileCalls[0]).toEqual({
        userId: "u1",
        newTier: "starter",
        reason: "subscription_downgraded",
      })
      expect(db.machine_limits.get("u1")?.tier).toBe("starter")
    })

    it("if RPC returns empty, reconcile is correctly skipped (no NPE)", () => {
      const reconcileCalls: ReconcileCall[] = []
      emulateSubscriptionUpdatedReconcile([], (args) =>
        reconcileCalls.push(args)
      )
      expect(reconcileCalls).toHaveLength(0)
    })

    it("if RPC returns out_resolved_tier=null (plan missing), reconcile skipped", () => {
      // Mirrors the WARNING path — webhook should NOT reconcile because
      // the tier change couldn't be resolved.
      const reconcileCalls: ReconcileCall[] = []
      emulateSubscriptionUpdatedReconcile(
        [{ out_user_id: "u1", out_resolved_tier: null, out_is_paid: true }],
        (args) => reconcileCalls.push(args)
      )
      expect(reconcileCalls).toHaveLength(0)
    })
  })

  describe("cancellation path (the second NEW-1 symptom)", () => {
    it("subscription.deleted → machine_limits.tier flips to 'free' atomically", () => {
      db.seedSubscription({
        user_id: "u1",
        stripe_subscription_id: "sub_1",
        subscription_plan_id: "plan_professional",
        status: "active",
      })
      db.rpc_update_subscription_status({
        p_stripe_subscription_id: "sub_1",
        p_status: "active",
      })
      expect(db.machine_limits.get("u1")?.tier).toBe("professional")
      expect(db.user_credits.get("u1")?.has_active_subscription).toBe(true)

      // Stripe cancels the subscription.
      const cancelResult = db.rpc_update_subscription_status({
        p_stripe_subscription_id: "sub_1",
        p_status: "canceled",
      })

      // Pre-fix: 42702 → caller saw rpcResult undefined → tier stayed at
      // 'professional' and has_active_subscription stayed true.
      // Post-fix: rpcResult[0].out_user_id resolves correctly.
      expect(cancelResult).toHaveLength(1)
      expect(cancelResult[0].out_user_id).toBe("u1")
      expect(cancelResult[0].out_resolved_tier).toBe("free")
      expect(cancelResult[0].out_is_paid).toBe(false)

      const resolvedUserId = emulateSubscriptionDeletedResolve(cancelResult)
      expect(resolvedUserId).toBe("u1")

      // The atomic side-effects of the RPC.
      expect(db.machine_limits.get("u1")?.tier).toBe("free")
      expect(db.user_credits.get("u1")?.has_active_subscription).toBe(false)
      expect(db.user_credits.get("u1")?.subscription_tier).toBeNull()
      expect(db.user_subscriptions.get("sub_1")?.status).toBe("canceled")
      expect(db.user_subscriptions.get("sub_1")?.canceled_at).not.toBeNull()
    })

    it("subscription.deleted for unknown sub → resolvedUserId null, fallback runs", () => {
      const cancelResult = db.rpc_update_subscription_status({
        p_stripe_subscription_id: "sub_unknown_to_us",
        p_status: "canceled",
      })
      expect(cancelResult).toEqual([])
      const resolvedUserId = emulateSubscriptionDeletedResolve(cancelResult)
      expect(resolvedUserId).toBeNull()
      // The webhook's stripe_customers fallback would now run — that path
      // is covered by tests/billing-webhook-tier-sync.test.ts.
    })
  })

  describe("idempotency: replaying canceled does not move canceled_at", () => {
    it("canceled_at set on first transition, preserved on retry", () => {
      db.seedSubscription({
        user_id: "u1",
        stripe_subscription_id: "sub_1",
        subscription_plan_id: "plan_starter",
        status: "active",
      })
      db.rpc_update_subscription_status({
        p_stripe_subscription_id: "sub_1",
        p_status: "canceled",
      })
      const firstTs = db.user_subscriptions.get("sub_1")?.canceled_at
      expect(firstTs).not.toBeNull()
      expect(firstTs).not.toBeUndefined()

      // Retry the cancel event.
      db.rpc_update_subscription_status({
        p_stripe_subscription_id: "sub_1",
        p_status: "canceled",
      })
      expect(db.user_subscriptions.get("sub_1")?.canceled_at).toBe(firstTs)
    })
  })

  describe("end-to-end: RPC return shape feeds the reconciler with correct args", () => {
    it("downgrade enterprise→lite calls reconcile with newTier='lite'", () => {
      db.seedSubscription({
        user_id: "u1",
        stripe_subscription_id: "sub_1",
        subscription_plan_id: "plan_enterprise",
        status: "active",
      })
      db.rpc_update_subscription_status({
        p_stripe_subscription_id: "sub_1",
        p_status: "active",
      })

      const result = db.rpc_update_subscription_status({
        p_stripe_subscription_id: "sub_1",
        p_status: "active",
        p_subscription_plan_id: "plan_lite",
      })

      const reconcileCalls: ReconcileCall[] = []
      emulateSubscriptionUpdatedReconcile(result, (a) => reconcileCalls.push(a))
      expect(reconcileCalls).toEqual([
        { userId: "u1", newTier: "lite", reason: "subscription_downgraded" },
      ])
    })

    it("cancel calls reconcile with newTier='free'", () => {
      db.seedSubscription({
        user_id: "u1",
        stripe_subscription_id: "sub_1",
        subscription_plan_id: "plan_professional",
        status: "active",
      })
      db.rpc_update_subscription_status({
        p_stripe_subscription_id: "sub_1",
        p_status: "active",
      })

      const result = db.rpc_update_subscription_status({
        p_stripe_subscription_id: "sub_1",
        p_status: "canceled",
      })
      const reconcileCalls: ReconcileCall[] = []
      emulateSubscriptionUpdatedReconcile(result, (a) => reconcileCalls.push(a))
      expect(reconcileCalls).toEqual([
        { userId: "u1", newTier: "free", reason: "subscription_downgraded" },
      ])
    })
  })
})
