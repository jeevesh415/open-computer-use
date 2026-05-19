/**
 * Dedicated test suite for the "unlimited" subscription tier.
 *
 * Consolidates everything testable in TypeScript about the tier added in:
 *   - Supabase migration 017_add_unlimited_tier.sql
 *   - lib/pricing/tiers.ts (canonical data)
 *   - lib/tier.ts (vocabulary helpers)
 *   - types/machines.types.ts (UserTier + eligibility arrays)
 *
 * NOTE — Phase 5 Python guards are NOT covered here.
 *   The early-return guards in:
 *     backend/app/services/agent_billing.py     (charge_step)
 *     backend/app/services/api_billing_service.py (charge)
 *   live in pytest and will be added to backend/tests/test_agent_billing.py
 *   when Phase 5 ships.  Searching for those test names there:
 *     test_charge_step_skips_rpc_when_tier_is_unlimited
 *     test_api_billing_charge_returns_success_for_unlimited
 *
 * Run: npx vitest run tests/unlimited-tier.test.ts
 */
import { describe, it, expect } from "vitest"
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
import {
  SUBSCRIPTION_TIERS,
  SUBSCRIPTION_TO_API_TIER,
  VISIBLE_TIERS,
  getTier,
  buildPricingSnapshot,
} from "@/lib/pricing/tiers"
import {
  API_ELIGIBLE_TIERS,
  PERSISTENT_SWARM_TIERS,
} from "@/types/machines.types"

const SENTINEL = 999_999_999
const INT4_MAX = 2_147_483_647

// ─── 1. Canonical vocabulary ───────────────────────────────────────────────

describe("unlimited tier — canonical vocabulary", () => {
  it("appears in TIERS between professional and enterprise", () => {
    const idx = TIERS.indexOf("unlimited")
    expect(idx).toBeGreaterThanOrEqual(0)
    expect(idx).toBe(TIERS.indexOf("professional") + 1)
    expect(idx).toBe(TIERS.indexOf("enterprise") - 1)
  })

  it("has a TIER_RANK strictly between professional and enterprise", () => {
    expect(TIER_RANK.unlimited).toBeGreaterThan(TIER_RANK.professional)
    expect(TIER_RANK.unlimited).toBeLessThan(TIER_RANK.enterprise)
  })

  it("has the display name 'Unlimited' (kept as brand wordmark)", () => {
    expect(TIER_DISPLAY_NAME.unlimited).toBe("Unlimited")
  })

  it("normalizeTier accepts the canonical and case/whitespace variants", () => {
    expect(normalizeTier("unlimited")).toBe("unlimited")
    expect(normalizeTier("Unlimited")).toBe("unlimited")
    expect(normalizeTier("UNLIMITED")).toBe("unlimited")
    expect(normalizeTier(" Unlimited ")).toBe("unlimited")
  })

  it("isPaidTier returns true for unlimited", () => {
    expect(isPaidTier("unlimited")).toBe(true)
  })
})

// ─── 2. tierAtLeast ordering ───────────────────────────────────────────────

describe("unlimited tier — tierAtLeast ordering", () => {
  it("tierAtLeast('unlimited', 'professional') is true", () => {
    expect(tierAtLeast("unlimited", "professional")).toBe(true)
  })

  it("tierAtLeast('unlimited', 'starter') is true", () => {
    expect(tierAtLeast("unlimited", "starter")).toBe(true)
  })

  it("tierAtLeast('enterprise', 'unlimited') is true (sanity)", () => {
    expect(tierAtLeast("enterprise", "unlimited")).toBe(true)
  })

  it("tierAtLeast('unlimited', 'enterprise') is false (unlimited < enterprise rank)", () => {
    expect(tierAtLeast("unlimited", "enterprise")).toBe(false)
  })

  it("tierAtLeast('professional', 'unlimited') is false", () => {
    expect(tierAtLeast("professional", "unlimited")).toBe(false)
  })

  it("tierAtLeast('unlimited', 'unlimited') is true (reflexive)", () => {
    expect(tierAtLeast("unlimited", "unlimited")).toBe(true)
  })
})

// ─── 3. Resource limits ────────────────────────────────────────────────────

describe("unlimited tier — resource limits", () => {
  // Per Phase 4 design (revised): Unlimited mirrors Plus on machines + schedule
  // limit, but caps concurrent agents at 1 to prevent runaway compute on the
  // flat-rate plan.  See lib/pricing/tiers.ts comment + app/api/swarm/route.ts.

  it("schedule limit is 10 (matches Plus)", () => {
    expect(SCHEDULE_LIMITS.unlimited).toBe(10)
    expect(SCHEDULE_LIMITS.unlimited).toBe(SCHEDULE_LIMITS.professional)
  })

  it("getScheduleLimit returns 10 for unlimited", () => {
    expect(getScheduleLimit("unlimited")).toBe(10)
  })

  it("machinesIncluded matches Plus (2 always-on VMs)", () => {
    const u = getTier("unlimited")
    const plus = getTier("plus")
    expect(u!.machinesIncluded).toBe(plus!.machinesIncluded)
    expect(u!.machinesIncluded).toBe(2)
  })

  it("scheduleLimit matches Plus", () => {
    const u = getTier("unlimited")
    const plus = getTier("plus")
    expect(u!.scheduleLimit).toBe(plus!.scheduleLimit)
  })

  it("swarmAgentsLimit is capped at 1 — abuse-prevention valve", () => {
    // Critical: unlimited credits + unlimited concurrency would let a
    // single user burn 100k credits/hour at $0 marginal cost.  The 1-agent
    // cap is what makes the $249 flat rate sustainable.
    const u = getTier("unlimited")
    expect(u!.swarmAgentsLimit).toBe(1)
    // Distinct from Plus on purpose — Plus has 6 (parallel-execution
    // is part of what Plus sells), Unlimited does not.
    const plus = getTier("plus")
    expect(u!.swarmAgentsLimit).toBeLessThan(plus!.swarmAgentsLimit)
  })
})

// ─── 4. API tier mapping ───────────────────────────────────────────────────

describe("unlimited tier — API rate-limit mapping", () => {
  it("maps to the 'professional' API tier (same as Plus/Pro)", () => {
    expect(SUBSCRIPTION_TO_API_TIER.unlimited).toBe("professional")
  })

  it("is in API_ELIGIBLE_TIERS so /v1/* endpoints accept it", () => {
    expect(API_ELIGIBLE_TIERS).toContain("unlimited")
  })

  it("is in PERSISTENT_SWARM_TIERS so persistent swarms unlock", () => {
    expect(PERSISTENT_SWARM_TIERS).toContain("unlimited")
  })
})

// ─── 5. Pricing data + sentinel safety ─────────────────────────────────────

describe("unlimited tier — pricing data + sentinel safety", () => {
  const unlimited = SUBSCRIPTION_TIERS.find((t) => t.id === "unlimited")

  it("exists in SUBSCRIPTION_TIERS", () => {
    expect(unlimited).toBeDefined()
  })

  it("price is $249", () => {
    expect(unlimited!.priceUSD).toBe(249)
  })

  it("creditsPerMonth is the sentinel (999_999_999)", () => {
    expect(unlimited!.creditsPerMonth).toBe(SENTINEL)
  })

  it("pricePerCreditUSD is null (don't show $/credit for unlimited)", () => {
    expect(unlimited!.pricePerCreditUSD).toBeNull()
  })

  it("sentinel + 100 free credits fits in Postgres int4", () => {
    // user_credits.balance is integer (int4, max 2_147_483_647).  The
    // webhook adds the sentinel on top of the 100 free credits granted
    // at signup; the sum must not overflow.
    expect(SENTINEL + 100).toBeLessThan(INT4_MAX)
  })

  it("stripePriceEnvVar is STRIPE_PRICE_UNLIMITED", () => {
    expect(unlimited!.stripePriceEnvVar).toBe("STRIPE_PRICE_UNLIMITED")
  })

  it("appears in the visible pricing grid", () => {
    expect(VISIBLE_TIERS.map((t) => t.id)).toContain("unlimited")
  })
})

// ─── 6. Public pricing snapshot (/api/pricing) ─────────────────────────────

describe("unlimited tier — public PricingSnapshot", () => {
  const snapshot = buildPricingSnapshot()
  const unlimitedSub = snapshot.subscriptions.find((s) => s.id === "unlimited")

  it("appears in the snapshot subscriptions array", () => {
    expect(unlimitedSub).toBeDefined()
  })

  it("exposes the sentinel creditsPerMonth verbatim", () => {
    // Intentional — the snapshot is consumed by MCP / agents who need to
    // know the raw number to budget against.  The UI layer is responsible
    // for rendering "Unlimited" instead of the literal, NOT this snapshot.
    expect(unlimitedSub!.creditsPerMonth).toBe(SENTINEL)
  })

  it("apiTier is 'professional' (mirrors backend rate-limit mapping)", () => {
    expect(unlimitedSub!.apiTier).toBe("professional")
  })

  it("pricePerCreditUSD is null in snapshot too", () => {
    expect(unlimitedSub!.pricePerCreditUSD).toBeNull()
  })
})

// ─── 7. UI display safety — never expose the sentinel as a digit string ────

describe("unlimited tier — UI must not leak the sentinel", () => {
  // These guard against the most common refactor regression: someone
  // calling toLocaleString() on the raw number without checking the tier.
  // The tests don't render React — instead they encode the contract that
  // any code rendering credits for an unlimited user must branch on tier.

  it("the sentinel converted to locale string would be human-hostile", () => {
    // Document why we branch on tier instead of formatting the number.
    const formatted = SENTINEL.toLocaleString("en-US")
    expect(formatted).toBe("999,999,999")
    // If you ever see "999,999,999 credits/mo" in the UI, it means an
    // unlimited-tier check was missed at that render site.
  })

  it("getTier('unlimited').name is human-readable for direct display", () => {
    expect(getTier("unlimited")!.name).toBe("Unlimited")
  })
})

// ─── 8. Cross-cut invariants ───────────────────────────────────────────────

describe("unlimited tier — cross-cut invariants", () => {
  it("SUBSCRIPTION_TIERS, TIERS, TIER_RANK, TIER_DISPLAY_NAME all agree", () => {
    // The various sources of tier truth must list the same vocabulary.
    expect(SUBSCRIPTION_TIERS.some((t) => t.id === "unlimited")).toBe(true)
    expect(TIERS).toContain("unlimited")
    expect("unlimited" in TIER_RANK).toBe(true)
    expect("unlimited" in TIER_DISPLAY_NAME).toBe(true)
    expect("unlimited" in SCHEDULE_LIMITS).toBe(true)
    expect("unlimited" in SUBSCRIPTION_TO_API_TIER).toBe(true)
  })

  it("Plus stays the 'highlighted' tier (marketing's volume seller)", () => {
    // Documented Phase 6 decision: Plus keeps "Most Popular", Unlimited
    // gets a distinct "Best Value" treatment without competing.
    const plus = getTier("plus")
    const unlimited = getTier("unlimited")
    expect(plus!.highlighted).toBe(true)
    expect(unlimited!.highlighted).toBe(false)
  })
})
