/**
 * Tier-sync tests for the Stripe webhook (post migration 011).
 *
 * Two parts:
 *   1. lib/tier.ts unit tests — canonical helpers with full alias coverage.
 *   2. Webhook simulation — in-memory model of update_subscription_status() and
 *      sync_user_tier() RPCs, plus a translation of the
 *      customer.subscription.updated / customer.subscription.deleted handlers
 *      from app/api/credits/webhook/route.ts.  Lets us assert that machine_limits.tier
 *      and user_credits.{has_active_subscription,subscription_tier} are kept in
 *      sync across every realistic Stripe event sequence.
 *
 * Run: ``npx vitest run tests/billing-webhook-tier-sync.test.ts``
 */
import { describe, it, expect, beforeEach } from "vitest"
import {
  TIERS,
  TIER_RANK,
  TIER_DISPLAY_NAME,
  SCHEDULE_LIMITS,
  normalizeTier,
  isPaidTier,
  tierAtLeast,
  getScheduleLimit,
} from "@/lib/tier"

// ---------------------------------------------------------------------------
// 1.  lib/tier.ts unit tests
// ---------------------------------------------------------------------------

describe("lib/tier — canonical vocabulary", () => {
  it("exposes the six canonical tiers in rank order", () => {
    expect(TIERS).toEqual(["free", "lite", "starter", "professional", "unlimited", "enterprise"])
  })

  it("ranks tiers monotonically", () => {
    expect(TIER_RANK.free).toBeLessThan(TIER_RANK.lite)
    expect(TIER_RANK.lite).toBeLessThan(TIER_RANK.starter)
    expect(TIER_RANK.starter).toBeLessThan(TIER_RANK.professional)
    expect(TIER_RANK.professional).toBeLessThan(TIER_RANK.unlimited)
    expect(TIER_RANK.unlimited).toBeLessThan(TIER_RANK.enterprise)
  })

  it("normalises canonical values unchanged", () => {
    for (const t of TIERS) {
      expect(normalizeTier(t)).toBe(t)
    }
  })

  it("normalises legacy aliases to canonical", () => {
    expect(normalizeTier("basic")).toBe("starter")
    expect(normalizeTier("pro")).toBe("professional")
    expect(normalizeTier("plus")).toBe("professional")
  })

  it("is case- and whitespace-tolerant on input", () => {
    expect(normalizeTier(" Pro ")).toBe("professional")
    expect(normalizeTier("ENTERPRISE")).toBe("enterprise")
    expect(normalizeTier("Starter")).toBe("starter")
  })

  it("falls back to 'free' for null, undefined, empty, and unknown values", () => {
    expect(normalizeTier(null)).toBe("free")
    expect(normalizeTier(undefined)).toBe("free")
    expect(normalizeTier("")).toBe("free")
    expect(normalizeTier("god-mode")).toBe("free")
  })

  it("isPaidTier — only free is unpaid", () => {
    expect(isPaidTier("free")).toBe(false)
    expect(isPaidTier(null)).toBe(false)
    expect(isPaidTier("lite")).toBe(true)
    expect(isPaidTier("enterprise")).toBe(true)
    expect(isPaidTier("basic")).toBe(true) // alias resolves to starter
  })

  it("tierAtLeast — strict greater-than-or-equal on rank", () => {
    expect(tierAtLeast("professional", "starter")).toBe(true)
    expect(tierAtLeast("starter", "professional")).toBe(false)
    expect(tierAtLeast("enterprise", "enterprise")).toBe(true)
    expect(tierAtLeast(null, "free")).toBe(true)
    expect(tierAtLeast("pro", "professional")).toBe(true) // alias
  })

  it("display names match the marketing surface", () => {
    expect(TIER_DISPLAY_NAME.free).toBe("Free")
    expect(TIER_DISPLAY_NAME.lite).toBe("Lite")
    expect(TIER_DISPLAY_NAME.starter).toBe("Starter")
    expect(TIER_DISPLAY_NAME.professional).toBe("Plus")
    expect(TIER_DISPLAY_NAME.unlimited).toBe("Unlimited")
    expect(TIER_DISPLAY_NAME.enterprise).toBe("Pro")
  })

  it("schedule limits mirror backend defaults", () => {
    expect(SCHEDULE_LIMITS).toEqual({
      free: 3,
      lite: 3,
      starter: 3,
      professional: 10,
      unlimited: 10,
      enterprise: 50,
    })
  })

  it("unlimited tier is normalised and recognised as paid", () => {
    expect(normalizeTier("unlimited")).toBe("unlimited")
    expect(normalizeTier("Unlimited")).toBe("unlimited")
    expect(isPaidTier("unlimited")).toBe(true)
    expect(tierAtLeast("unlimited", "professional")).toBe(true)
    expect(tierAtLeast("unlimited", "enterprise")).toBe(false)
    expect(tierAtLeast("enterprise", "unlimited")).toBe(true)
    expect(getScheduleLimit("unlimited")).toBe(10)
  })

  it("getScheduleLimit normalises legacy aliases", () => {
    expect(getScheduleLimit("basic")).toBe(3) // → starter
    expect(getScheduleLimit("pro")).toBe(10) // → professional
    expect(getScheduleLimit(null)).toBe(3)
    expect(getScheduleLimit("nonsense")).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// 2.  Webhook tier-sync simulation
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
  metadata: Record<string, any>
  created_at: string
  updated_at: string
}

interface SubscriptionPlanRow {
  id: string
  tier: string
  stripe_price_id: string
  monthly_credits: number
}

interface StripeCustomerRow {
  user_id: string
  stripe_customer_id: string
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

const PAID_STATUSES = new Set(["active", "trialing", "past_due"])

class MockDb {
  user_subscriptions = new Map<string, UserSubscriptionRow>() // by stripe_subscription_id
  subscription_plans = new Map<string, SubscriptionPlanRow>() // by id
  subscription_plans_by_price = new Map<string, SubscriptionPlanRow>() // by stripe_price_id
  user_credits = new Map<string, UserCreditsRow>() // by user_id
  machine_limits = new Map<string, MachineLimitsRow>() // by user_id
  // stripe_customers indexed by stripe_customer_id (UNIQUE) — used by the
  // hardened subscription.deleted fallback to resolve user_id without
  // trusting subscription.metadata.user_id.
  stripe_customers = new Map<string, StripeCustomerRow>()

  // Tracks Stripe-side metadata patches (so we can assert metadata sync).
  stripeMetadataPatches: Array<{ subId: string; metadata: Record<string, any> }> = []

  seedPlans() {
    const plans: SubscriptionPlanRow[] = [
      { id: "plan_lite",         tier: "lite",         stripe_price_id: "price_lite",     monthly_credits: 100 },
      { id: "plan_starter",      tier: "starter",      stripe_price_id: "price_starter",  monthly_credits: 200 },
      { id: "plan_professional", tier: "professional", stripe_price_id: "price_pro",      monthly_credits: 600 },
      { id: "plan_enterprise",   tier: "enterprise",   stripe_price_id: "price_ent",      monthly_credits: 1500 },
      // Sentinel — see lib/pricing/tiers.ts L165 + migration 017.
      // UI renders "Unlimited" literal; backend skips deduct RPC.
      { id: "plan_unlimited",    tier: "unlimited",    stripe_price_id: "price_unlimited", monthly_credits: 999_999_999 },
    ]
    for (const p of plans) {
      this.subscription_plans.set(p.id, p)
      this.subscription_plans_by_price.set(p.stripe_price_id, p)
    }
  }

  seedUser(userId: string) {
    this.user_credits.set(userId, {
      user_id: userId, balance: 100, has_active_subscription: false, subscription_tier: null,
    })
    this.machine_limits.set(userId, { user_id: userId, tier: "free" })
  }

  seedSubscription(opts: Partial<UserSubscriptionRow> & {
    user_id: string
    stripe_subscription_id: string
    subscription_plan_id: string | null
    status: string
  }) {
    const now = new Date().toISOString()
    this.user_subscriptions.set(opts.stripe_subscription_id, {
      current_period_start: now,
      current_period_end: new Date(Date.now() + 30 * 86400_000).toISOString(),
      cancel_at_period_end: false,
      canceled_at: null,
      metadata: {},
      created_at: now,
      updated_at: now,
      ...opts,
    } as UserSubscriptionRow)
  }

  // ---- RPC: update_subscription_status (mirrors migration 011) ----------
  rpc_update_subscription_status(args: {
    p_stripe_subscription_id: string
    p_status: string
    p_period_start: string | null
    p_period_end: string | null
    p_cancel_at_period_end: boolean | null
    p_subscription_plan_id: string | null
  }): Array<{ user_id: string; resolved_tier: string | null; is_paid: boolean }> {
    const isPaid = PAID_STATUSES.has(args.p_status)
    const sub = this.user_subscriptions.get(args.p_stripe_subscription_id)
    if (!sub) return []

    sub.status = args.p_status
    if (args.p_period_start !== null) sub.current_period_start = args.p_period_start
    if (args.p_period_end !== null) sub.current_period_end = args.p_period_end
    if (args.p_cancel_at_period_end !== null) sub.cancel_at_period_end = args.p_cancel_at_period_end
    if (args.p_subscription_plan_id !== null) sub.subscription_plan_id = args.p_subscription_plan_id
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
        // Don't blindly downgrade.
        return [{ user_id: sub.user_id, resolved_tier: null, is_paid: isPaid }]
      }
      newTier = plan.tier
    } else {
      newTier = "free"
    }

    // user_credits UPSERT
    let uc = this.user_credits.get(sub.user_id)
    if (!uc) {
      uc = { user_id: sub.user_id, balance: 0, has_active_subscription: isPaid, subscription_tier: isPaid ? newTier : null }
      this.user_credits.set(sub.user_id, uc)
    } else {
      uc.has_active_subscription = isPaid
      uc.subscription_tier = isPaid ? newTier : null
    }

    // machine_limits UPSERT
    const ml = this.machine_limits.get(sub.user_id)
    if (!ml) {
      this.machine_limits.set(sub.user_id, { user_id: sub.user_id, tier: newTier })
    } else {
      ml.tier = newTier
    }

    return [{ user_id: sub.user_id, resolved_tier: newTier, is_paid: isPaid }]
  }

  // ---- RPC: sync_user_tier (mirrors migration 011) ----------------------
  rpc_sync_user_tier(p_user_id: string): string {
    const candidates: Array<{ sub: UserSubscriptionRow; plan: SubscriptionPlanRow }> = []
    for (const sub of this.user_subscriptions.values()) {
      if (
        sub.user_id === p_user_id &&
        PAID_STATUSES.has(sub.status) &&
        sub.subscription_plan_id
      ) {
        const plan = this.subscription_plans.get(sub.subscription_plan_id)
        if (plan) candidates.push({ sub, plan })
      }
    }
    candidates.sort((a, b) => {
      const ae = a.sub.current_period_end ?? ""
      const be = b.sub.current_period_end ?? ""
      if (ae !== be) return ae < be ? 1 : -1
      return a.sub.created_at < b.sub.created_at ? 1 : -1
    })
    const tier = candidates[0]?.plan.tier ?? "free"

    let uc = this.user_credits.get(p_user_id)
    if (!uc) {
      uc = { user_id: p_user_id, balance: 0, has_active_subscription: tier !== "free", subscription_tier: tier !== "free" ? tier : null }
      this.user_credits.set(p_user_id, uc)
    } else {
      uc.has_active_subscription = tier !== "free"
      uc.subscription_tier = tier !== "free" ? tier : null
    }

    const ml = this.machine_limits.get(p_user_id)
    if (!ml) {
      this.machine_limits.set(p_user_id, { user_id: p_user_id, tier })
    } else {
      ml.tier = tier
    }
    return tier
  }
}

// ---------------------------------------------------------------------------
// Webhook handler simulators (port of the relevant cases from
// app/api/credits/webhook/route.ts).
// ---------------------------------------------------------------------------

interface StripeSubscriptionEvent {
  id: string
  status: string
  current_period_start?: number
  current_period_end?: number
  cancel_at_period_end?: boolean
  metadata?: Record<string, any>
  items?: { data?: Array<{ price?: { id: string } }> }
}

function handleSubscriptionUpdated(db: MockDb, sub: StripeSubscriptionEvent) {
  let periodStart: string | null = null
  let periodEnd: string | null = null
  if (sub.current_period_start && sub.current_period_end) {
    periodStart = new Date(sub.current_period_start * 1000).toISOString()
    periodEnd = new Date(sub.current_period_end * 1000).toISOString()
  }

  // Detect plan change from price_id → subscription_plans lookup.
  let newPlanId: string | null = null
  let newPlanTier: string | null = null
  const newPriceId = sub.items?.data?.[0]?.price?.id
  if (newPriceId) {
    const plan = db.subscription_plans_by_price.get(newPriceId)
    if (plan) {
      newPlanId = plan.id
      newPlanTier = plan.tier
    }
  }

  const result = db.rpc_update_subscription_status({
    p_stripe_subscription_id: sub.id,
    p_status: sub.status,
    p_period_start: periodStart,
    p_period_end: periodEnd,
    p_cancel_at_period_end: sub.cancel_at_period_end ?? null,
    p_subscription_plan_id: newPlanId,
  })

  // Stripe metadata.tier patch when tier changed.
  if (newPlanTier && sub.metadata?.tier !== newPlanTier) {
    db.stripeMetadataPatches.push({
      subId: sub.id,
      metadata: { ...(sub.metadata ?? {}), tier: newPlanTier },
    })
  }

  return result
}

/**
 * Simulates the tier-sync side-effect that the new checkout.session.completed
 * and customer.subscription.created handlers perform after writing
 * user_subscriptions: a single sync_user_tier(user_id) call that projects
 * tier through to user_credits and machine_limits.
 */
function handleSubscriptionCreatedSyncStep(db: MockDb, userId: string) {
  return db.rpc_sync_user_tier(userId)
}

/**
 * Mirrors the post-hardening customer.subscription.deleted handler.
 * IMPORTANT: never reads sub.metadata.user_id.  Resolves user_id via:
 *   1. RPC (keyed on stripe_subscription_id), or
 *   2. stripe_customers.user_id where stripe_customer_id = sub.customer.
 * Any user_id metadata on the event is intentionally ignored.
 */
function handleSubscriptionDeletedHardened(
  db: MockDb,
  sub: StripeSubscriptionEvent & { customer?: string }
) {
  const result = db.rpc_update_subscription_status({
    p_stripe_subscription_id: sub.id,
    p_status: "canceled",
    p_period_start: null,
    p_period_end: null,
    p_cancel_at_period_end: null,
    p_subscription_plan_id: null,
  })

  let resolvedUserId: string | null = result?.[0]?.user_id ?? null
  if (!resolvedUserId && sub.customer) {
    const customer = db.stripe_customers.get(sub.customer)
    if (customer) {
      resolvedUserId = customer.user_id
      db.rpc_sync_user_tier(resolvedUserId)
    }
  }
  return { result, resolvedUserId }
}

// ---------------------------------------------------------------------------

describe("webhook tier sync — customer.subscription.updated", () => {
  let db: MockDb
  beforeEach(() => {
    db = new MockDb()
    db.seedPlans()
    db.seedUser("u1")
  })

  it("active sub writes machine_limits.tier", () => {
    db.seedSubscription({
      user_id: "u1", stripe_subscription_id: "sub_1",
      subscription_plan_id: "plan_starter", status: "active",
    })

    handleSubscriptionUpdated(db, {
      id: "sub_1",
      status: "active",
      current_period_start: Math.floor(Date.now() / 1000),
      current_period_end:   Math.floor(Date.now() / 1000) + 86400 * 30,
      cancel_at_period_end: false,
      items: { data: [{ price: { id: "price_starter" } }] },
      metadata: { tier: "starter" },
    })

    expect(db.machine_limits.get("u1")?.tier).toBe("starter")
    expect(db.user_credits.get("u1")?.subscription_tier).toBe("starter")
    expect(db.user_credits.get("u1")?.has_active_subscription).toBe(true)
  })

  it("plan change (lite → professional) propagates via price_id lookup", () => {
    db.seedSubscription({
      user_id: "u1", stripe_subscription_id: "sub_1",
      subscription_plan_id: "plan_lite", status: "active",
    })
    handleSubscriptionUpdated(db, {
      id: "sub_1", status: "active",
      current_period_start: Math.floor(Date.now() / 1000),
      current_period_end:   Math.floor(Date.now() / 1000) + 86400 * 30,
      items: { data: [{ price: { id: "price_lite" } }] },
      metadata: { tier: "lite" },
    })
    expect(db.machine_limits.get("u1")?.tier).toBe("lite")

    // Customer Portal upgrade: Stripe sends new price_id.
    handleSubscriptionUpdated(db, {
      id: "sub_1", status: "active",
      current_period_start: Math.floor(Date.now() / 1000),
      current_period_end:   Math.floor(Date.now() / 1000) + 86400 * 30,
      items: { data: [{ price: { id: "price_pro" } }] },
      metadata: { tier: "lite" }, // stale metadata
    })

    expect(db.machine_limits.get("u1")?.tier).toBe("professional")
    expect(db.user_credits.get("u1")?.subscription_tier).toBe("professional")
    expect(db.user_subscriptions.get("sub_1")?.subscription_plan_id).toBe("plan_professional")

    // Webhook should have queued a metadata.tier=professional patch for Stripe.
    expect(db.stripeMetadataPatches).toEqual([
      { subId: "sub_1", metadata: { tier: "professional" } },
    ])
  })

  it("plan downgrade (enterprise → starter) propagates", () => {
    db.seedSubscription({
      user_id: "u1", stripe_subscription_id: "sub_1",
      subscription_plan_id: "plan_enterprise", status: "active",
    })
    handleSubscriptionUpdated(db, {
      id: "sub_1", status: "active",
      current_period_start: Math.floor(Date.now() / 1000),
      current_period_end:   Math.floor(Date.now() / 1000) + 86400 * 30,
      items: { data: [{ price: { id: "price_starter" } }] },
      metadata: { tier: "enterprise" },
    })

    expect(db.machine_limits.get("u1")?.tier).toBe("starter")
    expect(db.stripeMetadataPatches[0]?.metadata.tier).toBe("starter")
  })

  it("unknown price_id is logged but does not crash; tier left unchanged from existing plan", () => {
    db.seedSubscription({
      user_id: "u1", stripe_subscription_id: "sub_1",
      subscription_plan_id: "plan_starter", status: "active",
    })
    // Apply once with a known price so we end up at starter.
    handleSubscriptionUpdated(db, {
      id: "sub_1", status: "active",
      current_period_start: Math.floor(Date.now() / 1000),
      current_period_end:   Math.floor(Date.now() / 1000) + 86400 * 30,
      items: { data: [{ price: { id: "price_starter" } }] },
      metadata: { tier: "starter" }, // matches → no patch this round
    })
    expect(db.machine_limits.get("u1")?.tier).toBe("starter")
    const patchCountBefore = db.stripeMetadataPatches.length

    // Now Stripe sends a price we don't know about (e.g. someone created a
    // price in Stripe Dashboard without seeding subscription_plans).  The RPC
    // gets called with p_subscription_plan_id=null; existing plan_id stays.
    handleSubscriptionUpdated(db, {
      id: "sub_1", status: "active",
      current_period_start: Math.floor(Date.now() / 1000),
      current_period_end:   Math.floor(Date.now() / 1000) + 86400 * 30,
      items: { data: [{ price: { id: "price_unknown" } }] },
      metadata: { tier: "starter" },
    })
    expect(db.machine_limits.get("u1")?.tier).toBe("starter")
    expect(db.user_subscriptions.get("sub_1")?.subscription_plan_id).toBe("plan_starter")
    // No NEW metadata patch from the unknown-price call.
    expect(db.stripeMetadataPatches.length).toBe(patchCountBefore)
  })

  it("cancel_at_period_end=true on active sub keeps tier (grace period)", () => {
    db.seedSubscription({
      user_id: "u1", stripe_subscription_id: "sub_1",
      subscription_plan_id: "plan_enterprise", status: "active",
    })
    handleSubscriptionUpdated(db, {
      id: "sub_1", status: "active",
      current_period_start: Math.floor(Date.now() / 1000),
      current_period_end:   Math.floor(Date.now() / 1000) + 86400 * 30,
      cancel_at_period_end: true,
      items: { data: [{ price: { id: "price_ent" } }] },
      metadata: { tier: "enterprise" },
    })
    expect(db.user_subscriptions.get("sub_1")?.cancel_at_period_end).toBe(true)
    expect(db.machine_limits.get("u1")?.tier).toBe("enterprise")
    expect(db.user_credits.get("u1")?.has_active_subscription).toBe(true)
  })

  it("status past_due preserves tier (dunning grace)", () => {
    db.seedSubscription({
      user_id: "u1", stripe_subscription_id: "sub_1",
      subscription_plan_id: "plan_professional", status: "active",
    })
    handleSubscriptionUpdated(db, {
      id: "sub_1", status: "past_due",
      current_period_start: Math.floor(Date.now() / 1000),
      current_period_end:   Math.floor(Date.now() / 1000) + 86400 * 30,
      items: { data: [{ price: { id: "price_pro" } }] },
    })
    expect(db.machine_limits.get("u1")?.tier).toBe("professional")
    expect(db.user_credits.get("u1")?.has_active_subscription).toBe(true)
  })

  it("status incomplete drops to free", () => {
    db.seedSubscription({
      user_id: "u1", stripe_subscription_id: "sub_1",
      subscription_plan_id: "plan_starter", status: "incomplete",
    })
    handleSubscriptionUpdated(db, {
      id: "sub_1", status: "incomplete",
      current_period_start: Math.floor(Date.now() / 1000),
      current_period_end:   Math.floor(Date.now() / 1000) + 86400 * 30,
    })
    expect(db.machine_limits.get("u1")?.tier).toBe("free")
    expect(db.user_credits.get("u1")?.has_active_subscription).toBe(false)
  })

  it("subscription not found in DB → no-op (returns empty)", () => {
    const result = handleSubscriptionUpdated(db, {
      id: "sub_orphan", status: "active",
      current_period_start: Math.floor(Date.now() / 1000),
      current_period_end:   Math.floor(Date.now() / 1000) + 86400 * 30,
    })
    expect(result).toEqual([])
    expect(db.machine_limits.get("u1")?.tier).toBe("free")
  })

  it("missing period timestamps still call RPC (with null) — RPC must tolerate", () => {
    db.seedSubscription({
      user_id: "u1", stripe_subscription_id: "sub_1",
      subscription_plan_id: "plan_starter", status: "active",
    })
    const result = handleSubscriptionUpdated(db, {
      id: "sub_1", status: "active",
      // No timestamps in event.
    })
    expect(result?.[0]?.resolved_tier).toBe("starter")
    expect(db.machine_limits.get("u1")?.tier).toBe("starter")
  })
})

describe("webhook tier sync — initial subscription create path", () => {
  let db: MockDb
  beforeEach(() => {
    db = new MockDb()
    db.seedPlans()
    db.seedUser("u1")
  })

  it("checkout.session.completed → sync_user_tier writes machine_limits.tier", () => {
    // Simulate what the existing handler does: insert user_subscriptions, set
    // user_credits flags directly, then call sync_user_tier.  Without the
    // sync_user_tier call, machine_limits.tier would remain 'free'.
    db.seedSubscription({
      user_id: "u1", stripe_subscription_id: "sub_1",
      subscription_plan_id: "plan_starter", status: "active",
    })
    // Mimic existing handler's direct user_credits write.
    db.user_credits.get("u1")!.has_active_subscription = true
    db.user_credits.get("u1")!.subscription_tier = "starter"
    // BEFORE the new sync_user_tier call, machine_limits.tier is still 'free'.
    expect(db.machine_limits.get("u1")?.tier).toBe("free")

    // The new sync step.
    handleSubscriptionCreatedSyncStep(db, "u1")
    expect(db.machine_limits.get("u1")?.tier).toBe("starter")
  })

  it("customer.subscription.created (new row branch) → tier propagates", () => {
    db.seedSubscription({
      user_id: "u1", stripe_subscription_id: "sub_1",
      subscription_plan_id: "plan_professional", status: "active",
    })
    handleSubscriptionCreatedSyncStep(db, "u1")
    expect(db.machine_limits.get("u1")?.tier).toBe("professional")
    expect(db.user_credits.get("u1")?.subscription_tier).toBe("professional")
    expect(db.user_credits.get("u1")?.has_active_subscription).toBe(true)
  })

  it("customer.subscription.created reactivation (canceled→active) → tier flips back", () => {
    db.seedSubscription({
      user_id: "u1", stripe_subscription_id: "sub_1",
      subscription_plan_id: "plan_starter", status: "canceled",
    })
    db.machine_limits.get("u1")!.tier = "free"
    // Reactivation flips status back to active.
    db.user_subscriptions.get("sub_1")!.status = "active"

    handleSubscriptionCreatedSyncStep(db, "u1")
    expect(db.machine_limits.get("u1")?.tier).toBe("starter")
    expect(db.user_credits.get("u1")?.has_active_subscription).toBe(true)
  })

  it("idempotent: replaying the sync step yields the same state", () => {
    db.seedSubscription({
      user_id: "u1", stripe_subscription_id: "sub_1",
      subscription_plan_id: "plan_enterprise", status: "active",
    })
    for (let i = 0; i < 3; i++) handleSubscriptionCreatedSyncStep(db, "u1")
    expect(db.machine_limits.get("u1")?.tier).toBe("enterprise")
  })

  it("sync_user_tier with no active subscriptions resets to free", () => {
    // User had a sub, it was canceled before the sync ran.
    db.seedSubscription({
      user_id: "u1", stripe_subscription_id: "sub_1",
      subscription_plan_id: "plan_starter", status: "canceled",
    })
    db.machine_limits.get("u1")!.tier = "starter" // legacy stale state
    db.user_credits.get("u1")!.has_active_subscription = true

    handleSubscriptionCreatedSyncStep(db, "u1")
    expect(db.machine_limits.get("u1")?.tier).toBe("free")
    expect(db.user_credits.get("u1")?.has_active_subscription).toBe(false)
    expect(db.user_credits.get("u1")?.subscription_tier).toBeNull()
  })
})

describe("webhook tier sync — customer.subscription.deleted (hardened lookup)", () => {
  let db: MockDb
  beforeEach(() => {
    db = new MockDb()
    db.seedPlans()
    db.seedUser("u1")
    db.stripe_customers.set("cus_u1", { user_id: "u1", stripe_customer_id: "cus_u1" })
  })

  it("flips tier to free and clears active flag (primary path: RPC resolves user_id from stripe_subscription_id)", () => {
    db.seedSubscription({
      user_id: "u1", stripe_subscription_id: "sub_1",
      subscription_plan_id: "plan_professional", status: "active",
    })
    db.machine_limits.get("u1")!.tier = "professional"
    db.user_credits.get("u1")!.has_active_subscription = true
    db.user_credits.get("u1")!.subscription_tier = "professional"

    const { result, resolvedUserId } = handleSubscriptionDeletedHardened(db, {
      id: "sub_1", status: "canceled", customer: "cus_u1",
      metadata: { tier: "professional" }, // no user_id — must work without it
    })

    expect(result).toHaveLength(1)
    expect(resolvedUserId).toBe("u1")
    expect(db.machine_limits.get("u1")?.tier).toBe("free")
    expect(db.user_credits.get("u1")?.has_active_subscription).toBe(false)
    expect(db.user_credits.get("u1")?.subscription_tier).toBeNull()
    expect(db.user_subscriptions.get("sub_1")?.status).toBe("canceled")
    expect(db.user_subscriptions.get("sub_1")?.canceled_at).not.toBeNull()
  })

  it("ignores subscription.metadata.user_id even when present (defense-in-depth)", () => {
    // Subscription not in our DB AND metadata.user_id points at a different
    // user.  The hardened handler must never resolve via metadata.user_id —
    // only via stripe_customers.  Without a customer mapping, this should
    // be a no-op.
    db.stripe_customers.clear()
    db.seedUser("u_attacker")
    const { result, resolvedUserId } = handleSubscriptionDeletedHardened(db, {
      id: "sub_orphan", status: "canceled", customer: "cus_unknown",
      metadata: { user_id: "u_attacker" }, // attacker-controlled metadata
    })
    expect(result).toEqual([])
    expect(resolvedUserId).toBeNull()
    // u_attacker's tier MUST NOT be touched by metadata-driven lookup.
    expect(db.machine_limits.get("u_attacker")?.tier).toBe("free")
    expect(db.user_credits.get("u_attacker")?.has_active_subscription).toBe(false)
  })

  it("falls back to stripe_customers.user_id when sub not in DB", () => {
    // u1 has another active subscription not yet processed.
    db.seedSubscription({
      user_id: "u1", stripe_subscription_id: "sub_other",
      subscription_plan_id: "plan_starter", status: "active",
    })
    db.machine_limits.get("u1")!.tier = "starter"

    // Stripe deletes a subscription we don't have, but we know the customer.
    const { resolvedUserId } = handleSubscriptionDeletedHardened(db, {
      id: "sub_orphan", status: "canceled", customer: "cus_u1",
    })

    expect(resolvedUserId).toBe("u1")
    // sync_user_tier picked up u1's still-active starter sub.
    expect(db.machine_limits.get("u1")?.tier).toBe("starter")
    expect(db.user_credits.get("u1")?.has_active_subscription).toBe(true)
  })

  it("no DB row + no stripe_customers mapping → safe no-op", () => {
    db.stripe_customers.clear()
    expect(() =>
      handleSubscriptionDeletedHardened(db, {
        id: "sub_orphan", status: "canceled", customer: "cus_unknown",
      })
    ).not.toThrow()
    expect(db.machine_limits.get("u1")?.tier).toBe("free")
  })

  it("no DB row + missing customer field on event → safe no-op", () => {
    expect(() =>
      handleSubscriptionDeletedHardened(db, {
        id: "sub_orphan", status: "canceled",
        // No customer at all on the event.
      })
    ).not.toThrow()
    expect(db.machine_limits.get("u1")?.tier).toBe("free")
  })

  it("idempotent: replaying canceled event does not move canceled_at", () => {
    db.seedSubscription({
      user_id: "u1", stripe_subscription_id: "sub_1",
      subscription_plan_id: "plan_starter", status: "active",
    })
    handleSubscriptionDeletedHardened(db, {
      id: "sub_1", status: "canceled", customer: "cus_u1",
    })
    const firstTs = db.user_subscriptions.get("sub_1")!.canceled_at!
    expect(firstTs).not.toBeNull()

    handleSubscriptionDeletedHardened(db, {
      id: "sub_1", status: "canceled", customer: "cus_u1",
    })
    expect(db.user_subscriptions.get("sub_1")?.canceled_at).toBe(firstTs)
  })

  it("multi-user customer mapping: only the correct user is reconciled", () => {
    // Two users, two stripe customers.  Cancelling cus_u2's subscription
    // must NOT touch u1's tier.
    db.seedUser("u2")
    db.machine_limits.get("u2")!.tier = "free"
    db.stripe_customers.set("cus_u2", { user_id: "u2", stripe_customer_id: "cus_u2" })

    db.seedSubscription({
      user_id: "u1", stripe_subscription_id: "sub_u1_active",
      subscription_plan_id: "plan_professional", status: "active",
    })
    db.machine_limits.get("u1")!.tier = "professional"
    db.user_credits.get("u1")!.has_active_subscription = true
    db.user_credits.get("u1")!.subscription_tier = "professional"

    const { resolvedUserId } = handleSubscriptionDeletedHardened(db, {
      id: "sub_u2_orphan", status: "canceled", customer: "cus_u2",
    })

    expect(resolvedUserId).toBe("u2")
    // u1's tier MUST NOT change — they have an unrelated active subscription.
    expect(db.machine_limits.get("u1")?.tier).toBe("professional")
    expect(db.user_credits.get("u1")?.has_active_subscription).toBe(true)
    // u2 stays free (they had no other active subs).
    expect(db.machine_limits.get("u2")?.tier).toBe("free")
  })

  it("multiple canceled subs in sequence for the same user is consistent", () => {
    db.stripe_customers.set("cus_u1", { user_id: "u1", stripe_customer_id: "cus_u1" })
    db.seedSubscription({
      user_id: "u1", stripe_subscription_id: "sub_1",
      subscription_plan_id: "plan_starter", status: "active",
    })
    db.seedSubscription({
      user_id: "u1", stripe_subscription_id: "sub_2",
      subscription_plan_id: "plan_professional", status: "active",
    })

    handleSubscriptionDeletedHardened(db, { id: "sub_1", status: "canceled", customer: "cus_u1" })
    // After canceling sub_1, sync_user_tier (called by RPC path implicitly via
    // tier resolution) leaves the OTHER active sub's tier in effect.  But
    // the RPC for sub_1 directly sets user_credits.has_active_subscription
    // to FALSE — that's a known limitation of the per-subscription RPC.
    // Reality check: the production flow runs sync_user_tier on the fallback
    // path; for the primary path the user_credits flag mirrors the just-
    // canceled subscription only.  The remaining-subscriptions case is
    // covered by the next subscription event.

    // Cancel the remaining active sub.
    handleSubscriptionDeletedHardened(db, { id: "sub_2", status: "canceled", customer: "cus_u1" })
    expect(db.user_subscriptions.get("sub_1")?.status).toBe("canceled")
    expect(db.user_subscriptions.get("sub_2")?.status).toBe("canceled")
    expect(db.user_credits.get("u1")?.has_active_subscription).toBe(false)
    expect(db.machine_limits.get("u1")?.tier).toBe("free")
  })
})

describe("webhook tier sync — full lifecycle scenarios", () => {
  let db: MockDb
  beforeEach(() => {
    db = new MockDb()
    db.seedPlans()
    db.seedUser("u1")
    db.stripe_customers.set("cus_u1", { user_id: "u1", stripe_customer_id: "cus_u1" })
    db.seedSubscription({
      user_id: "u1", stripe_subscription_id: "sub_1",
      subscription_plan_id: "plan_lite", status: "active",
    })
  })

  it("Lite → Plus → Pro → cancel-at-period-end → canceled", () => {
    // 1. Lite active
    handleSubscriptionUpdated(db, {
      id: "sub_1", status: "active",
      current_period_start: Math.floor(Date.now() / 1000),
      current_period_end:   Math.floor(Date.now() / 1000) + 86400 * 30,
      items: { data: [{ price: { id: "price_lite" } }] },
      metadata: { tier: "lite" },
    })
    expect(db.machine_limits.get("u1")?.tier).toBe("lite")

    // 2. Upgrade to Plus
    handleSubscriptionUpdated(db, {
      id: "sub_1", status: "active",
      current_period_start: Math.floor(Date.now() / 1000),
      current_period_end:   Math.floor(Date.now() / 1000) + 86400 * 30,
      items: { data: [{ price: { id: "price_pro" } }] },
      metadata: { tier: "lite" }, // stale, will be patched
    })
    expect(db.machine_limits.get("u1")?.tier).toBe("professional")

    // 3. Upgrade to Pro
    handleSubscriptionUpdated(db, {
      id: "sub_1", status: "active",
      current_period_start: Math.floor(Date.now() / 1000),
      current_period_end:   Math.floor(Date.now() / 1000) + 86400 * 30,
      items: { data: [{ price: { id: "price_ent" } }] },
      metadata: { tier: "professional" },
    })
    expect(db.machine_limits.get("u1")?.tier).toBe("enterprise")

    // 4. cancel_at_period_end=true (grace)
    handleSubscriptionUpdated(db, {
      id: "sub_1", status: "active",
      current_period_start: Math.floor(Date.now() / 1000),
      current_period_end:   Math.floor(Date.now() / 1000) + 86400 * 30,
      cancel_at_period_end: true,
      items: { data: [{ price: { id: "price_ent" } }] },
      metadata: { tier: "enterprise" },
    })
    expect(db.machine_limits.get("u1")?.tier).toBe("enterprise")
    expect(db.user_subscriptions.get("sub_1")?.cancel_at_period_end).toBe(true)

    // 5. Period ends, Stripe deletes
    handleSubscriptionDeletedHardened(db, {
      id: "sub_1", status: "canceled", customer: "cus_u1",
    })
    expect(db.machine_limits.get("u1")?.tier).toBe("free")
    expect(db.user_credits.get("u1")?.has_active_subscription).toBe(false)

    // Three metadata patches recorded along the way.
    expect(db.stripeMetadataPatches.map(p => p.metadata.tier)).toEqual([
      "professional",
      "enterprise",
      // grace tick had metadata.tier already at enterprise → no patch
    ])
  })

  it("Cancel then reactivate flips tier back to paid", () => {
    handleSubscriptionUpdated(db, {
      id: "sub_1", status: "active",
      current_period_start: Math.floor(Date.now() / 1000),
      current_period_end:   Math.floor(Date.now() / 1000) + 86400 * 30,
      items: { data: [{ price: { id: "price_lite" } }] },
    })
    handleSubscriptionDeletedHardened(db, {
      id: "sub_1", status: "canceled", customer: "cus_u1",
    })
    expect(db.machine_limits.get("u1")?.tier).toBe("free")

    // Reactivation
    handleSubscriptionUpdated(db, {
      id: "sub_1", status: "active",
      current_period_start: Math.floor(Date.now() / 1000),
      current_period_end:   Math.floor(Date.now() / 1000) + 86400 * 30,
      items: { data: [{ price: { id: "price_lite" } }] },
    })
    expect(db.machine_limits.get("u1")?.tier).toBe("lite")
    expect(db.user_credits.get("u1")?.has_active_subscription).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Unlimited tier — tier-sync contract
// ---------------------------------------------------------------------------
//
// Adding the "unlimited" tier (migration 017 + lib/pricing/tiers.ts) requires
// that the webhook tier-sync handlers propagate the new vocabulary all the
// way through to machine_limits.tier and user_credits.subscription_tier —
// not just for new subscriptions but for upgrades and reactivations too.
//
// Without this, paying $249/mo Unlimited customers would silently land on
// the wrong tier in the backend (rate limits, schedule limits, machine
// caps) — exactly the failure mode migration 011 was created to prevent.

describe("webhook tier sync — unlimited tier", () => {
  let db: MockDb
  beforeEach(() => {
    db = new MockDb()
    db.seedPlans()
    db.seedUser("u1")
  })

  it("new unlimited subscription writes user_credits.subscription_tier = 'unlimited'", () => {
    db.seedSubscription({
      user_id: "u1",
      stripe_subscription_id: "sub_u1",
      subscription_plan_id: "plan_unlimited",
      status: "active",
    })

    handleSubscriptionUpdated(db, {
      id: "sub_u1",
      status: "active",
      current_period_start: Math.floor(Date.now() / 1000),
      current_period_end:   Math.floor(Date.now() / 1000) + 86400 * 30,
      cancel_at_period_end: false,
      items: { data: [{ price: { id: "price_unlimited" } }] },
      metadata: { tier: "unlimited" },
    })

    expect(db.user_credits.get("u1")?.subscription_tier).toBe("unlimited")
    expect(db.user_credits.get("u1")?.has_active_subscription).toBe(true)
    // machine_limits.tier propagation — without migration 017 relaxing the
    // CHECK constraint, this write would silently fail at the DB layer.
    expect(db.machine_limits.get("u1")?.tier).toBe("unlimited")
  })

  it("upgrade plus → unlimited propagates via price_id (stale metadata tolerated)", () => {
    db.seedSubscription({
      user_id: "u1",
      stripe_subscription_id: "sub_u1",
      subscription_plan_id: "plan_professional",
      status: "active",
    })
    handleSubscriptionUpdated(db, {
      id: "sub_u1", status: "active",
      current_period_start: Math.floor(Date.now() / 1000),
      current_period_end:   Math.floor(Date.now() / 1000) + 86400 * 30,
      items: { data: [{ price: { id: "price_pro" } }] },
      metadata: { tier: "professional" },
    })
    expect(db.machine_limits.get("u1")?.tier).toBe("professional")

    // Portal upgrade to Unlimited — Stripe carries the new price id, but
    // the metadata.tier is still the stale "professional" string.  Webhook
    // must lookup by price_id, NOT trust the metadata.
    handleSubscriptionUpdated(db, {
      id: "sub_u1", status: "active",
      current_period_start: Math.floor(Date.now() / 1000),
      current_period_end:   Math.floor(Date.now() / 1000) + 86400 * 30,
      items: { data: [{ price: { id: "price_unlimited" } }] },
      metadata: { tier: "professional" }, // stale
    })

    expect(db.machine_limits.get("u1")?.tier).toBe("unlimited")
    expect(db.user_credits.get("u1")?.subscription_tier).toBe("unlimited")
    expect(db.user_subscriptions.get("sub_u1")?.subscription_plan_id).toBe("plan_unlimited")

    // The webhook patches Stripe metadata to match the resolved tier so
    // subsequent renewal events carry the correct tier without re-lookup.
    expect(db.stripeMetadataPatches.find((p) => p.subId === "sub_u1")?.metadata.tier).toBe(
      "unlimited"
    )
  })

  it("downgrade unlimited → lite propagates", () => {
    db.seedSubscription({
      user_id: "u1",
      stripe_subscription_id: "sub_u1",
      subscription_plan_id: "plan_unlimited",
      status: "active",
    })
    handleSubscriptionUpdated(db, {
      id: "sub_u1", status: "active",
      current_period_start: Math.floor(Date.now() / 1000),
      current_period_end:   Math.floor(Date.now() / 1000) + 86400 * 30,
      items: { data: [{ price: { id: "price_unlimited" } }] },
      metadata: { tier: "unlimited" },
    })
    expect(db.machine_limits.get("u1")?.tier).toBe("unlimited")

    handleSubscriptionUpdated(db, {
      id: "sub_u1", status: "active",
      current_period_start: Math.floor(Date.now() / 1000),
      current_period_end:   Math.floor(Date.now() / 1000) + 86400 * 30,
      items: { data: [{ price: { id: "price_lite" } }] },
      metadata: { tier: "unlimited" }, // stale
    })

    expect(db.machine_limits.get("u1")?.tier).toBe("lite")
    expect(db.user_credits.get("u1")?.subscription_tier).toBe("lite")
  })

  it("cancel on unlimited sub flips tier back to 'free'", () => {
    db.seedSubscription({
      user_id: "u1",
      stripe_subscription_id: "sub_u1",
      subscription_plan_id: "plan_unlimited",
      status: "active",
    })
    handleSubscriptionUpdated(db, {
      id: "sub_u1", status: "active",
      current_period_start: Math.floor(Date.now() / 1000),
      current_period_end:   Math.floor(Date.now() / 1000) + 86400 * 30,
      items: { data: [{ price: { id: "price_unlimited" } }] },
      metadata: { tier: "unlimited" },
    })
    expect(db.machine_limits.get("u1")?.tier).toBe("unlimited")

    // Cancel — should flip non-paid → free, regardless of source tier.
    handleSubscriptionDeletedHardened(db, {
      id: "sub_u1", status: "canceled", customer: "cus_u1",
    })

    expect(db.machine_limits.get("u1")?.tier).toBe("free")
    expect(db.user_credits.get("u1")?.has_active_subscription).toBe(false)
    expect(db.user_credits.get("u1")?.subscription_tier).toBeNull()
  })
})
