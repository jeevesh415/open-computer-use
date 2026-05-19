/**
 * Tests for the `purchasable` filter that hides decommissioned plans
 * from every customer-facing surface while preserving definitions so
 * they can be re-enabled with a single flag flip.
 *
 * Current state (as of 2026-05-16):
 *   LIVE  : starter ($19), unlimited ($249)
 *   HIDDEN: free, lite, plus, pro, enterprise
 *
 * What this file is testing is the contract — not the specific plans
 * that happen to be live today.  To re-enable a plan: flip its
 * `purchasable: true` in lib/pricing/tiers.ts AND add its DB tier name
 * to PURCHASABLE_DB_TIERS.  These tests will then auto-pick up the new
 * "live" tier and verify it surfaces in all the right places.
 *
 * Run: npx vitest run tests/purchasable-plans.test.ts
 */
import { describe, it, expect } from "vitest"
import {
  SUBSCRIPTION_TIERS,
  VISIBLE_TIERS,
  PURCHASABLE_TIERS,
  PURCHASABLE_TIER_IDS,
  PURCHASABLE_DB_TIERS,
  getTier,
  buildPricingSnapshot,
} from "@/lib/pricing/tiers"

// ─── 1. Source of truth — the canonical definitions are preserved ──────────

describe("purchasable filter — definitions preserved", () => {
  // Critical: hiding a plan must NEVER delete its definition.  Existing
  // subscribers on a hidden plan need their plan metadata (price, credits,
  // machine limits) to still resolve via getTier() so their /account
  // billing page renders correctly.

  it("all 7 marketing tiers remain in SUBSCRIPTION_TIERS regardless of purchasable flag", () => {
    const ids = SUBSCRIPTION_TIERS.map((t) => t.id).sort()
    expect(ids).toEqual([
      "enterprise", "free", "lite", "plus", "pro", "starter", "unlimited",
    ])
  })

  it("getTier still returns definitions for hidden plans (for existing-subscriber UI)", () => {
    expect(getTier("free")).toBeDefined()
    expect(getTier("lite")).toBeDefined()
    expect(getTier("plus")).toBeDefined()
    expect(getTier("pro")).toBeDefined()
    expect(getTier("enterprise")).toBeDefined()
    // Sanity — live plans also resolve.
    expect(getTier("starter")).toBeDefined()
    expect(getTier("unlimited")).toBeDefined()
  })

  it("hidden plans retain their original prices and credit allowances", () => {
    expect(getTier("lite")!.priceUSD).toBe(9)
    expect(getTier("lite")!.creditsPerMonth).toBe(100)
    expect(getTier("plus")!.priceUSD).toBe(50)
    expect(getTier("plus")!.creditsPerMonth).toBe(600)
    expect(getTier("pro")!.priceUSD).toBe(100)
    expect(getTier("pro")!.creditsPerMonth).toBe(1500)
  })
})

// ─── 2. Live set — current purchasable plans ───────────────────────────────

describe("purchasable filter — live set", () => {
  it("currently only starter and unlimited are purchasable", () => {
    expect(PURCHASABLE_TIER_IDS.size).toBe(2)
    expect(PURCHASABLE_TIER_IDS.has("starter")).toBe(true)
    expect(PURCHASABLE_TIER_IDS.has("unlimited")).toBe(true)
  })

  it("free / lite / plus / pro / enterprise are NOT purchasable", () => {
    expect(PURCHASABLE_TIER_IDS.has("free")).toBe(false)
    expect(PURCHASABLE_TIER_IDS.has("lite")).toBe(false)
    expect(PURCHASABLE_TIER_IDS.has("plus")).toBe(false)
    expect(PURCHASABLE_TIER_IDS.has("pro")).toBe(false)
    expect(PURCHASABLE_TIER_IDS.has("enterprise")).toBe(false)
  })

  it("PURCHASABLE_TIERS list matches the live tier ids", () => {
    expect(PURCHASABLE_TIERS.map((t) => t.id).sort()).toEqual(["starter", "unlimited"])
  })

  it("VISIBLE_TIERS (the marketing-grid set) only contains live plans", () => {
    // Both flags (visibleInPricingGrid && purchasable) must be true to
    // appear in VISIBLE_TIERS.  Anything decommissioned drops out here,
    // which auto-removes it from landing, /pricing, SEO offers, etc.
    expect(VISIBLE_TIERS.map((t) => t.id).sort()).toEqual(["starter", "unlimited"])
  })

  it("each purchasable tier has a Stripe price env var configured", () => {
    // Without an env var, checkout will return "Invalid subscription tier".
    for (const tier of PURCHASABLE_TIERS) {
      expect(tier.stripePriceEnvVar).toBeDefined()
    }
  })
})

// ─── 3. Checkout-side DB allowlist ─────────────────────────────────────────

describe("purchasable filter — checkout DB allowlist", () => {
  it("PURCHASABLE_DB_TIERS contains the DB-tier names for live plans", () => {
    // The DB stores subscription_plans.tier as one of:
    //   lite, starter, professional, enterprise, unlimited
    // For the current live set (starter + unlimited), both happen to
    // match their marketing ids 1:1.
    expect(PURCHASABLE_DB_TIERS.has("starter")).toBe(true)
    expect(PURCHASABLE_DB_TIERS.has("unlimited")).toBe(true)
    expect(PURCHASABLE_DB_TIERS.size).toBe(2)
  })

  it("hidden DB-tier names are NOT in the checkout allowlist", () => {
    expect(PURCHASABLE_DB_TIERS.has("lite")).toBe(false)
    // "professional" is the DB tier for marketing "plus"
    expect(PURCHASABLE_DB_TIERS.has("professional")).toBe(false)
    // "enterprise" is the DB tier for marketing "pro" + "enterprise"
    expect(PURCHASABLE_DB_TIERS.has("enterprise")).toBe(false)
  })

  it("marketing and DB allowlists agree on count", () => {
    // The marketing list has 2 entries; the DB list also has 2 — the
    // two stay in sync because starter and unlimited share names across
    // both vocabularies.  If we ever re-enable plus or pro, the DB list
    // gets 1 entry while the marketing list gets 2 (plus + pro both map
    // to "professional"); this assertion is documenting the current
    // simple case, not a general invariant.
    expect(PURCHASABLE_DB_TIERS.size).toBe(PURCHASABLE_TIER_IDS.size)
  })
})

// ─── 4. Public pricing snapshot (/api/pricing) ─────────────────────────────

describe("purchasable filter — public PricingSnapshot", () => {
  const snapshot = buildPricingSnapshot()

  it("snapshot only exposes live plans (no decommissioned-plan leak to MCP/agents)", () => {
    const ids = snapshot.subscriptions.map((s) => s.id).sort()
    expect(ids).toEqual(["starter", "unlimited"])
  })

  it("snapshot reflects exactly the PURCHASABLE_TIERS set", () => {
    expect(snapshot.subscriptions.length).toBe(PURCHASABLE_TIERS.length)
  })

  it("snapshot price + credits for live plans are correct", () => {
    const starter = snapshot.subscriptions.find((s) => s.id === "starter")
    expect(starter?.priceUSD).toBe(19)
    expect(starter?.creditsPerMonth).toBe(200)

    const unlimited = snapshot.subscriptions.find((s) => s.id === "unlimited")
    expect(unlimited?.priceUSD).toBe(249)
    expect(unlimited?.creditsPerMonth).toBe(999_999_999) // sentinel
  })
})

// ─── 5. Re-enable contract — what flipping a flag must do ──────────────────

describe("purchasable filter — re-enable contract", () => {
  // These tests document the behaviour a developer should expect when
  // they flip `purchasable: true` on a hidden tier.  Useful as a
  // checklist when relaunching a plan.

  it("the canonical SUBSCRIPTION_TIERS still has all 7 entries (full re-enable surface)", () => {
    expect(SUBSCRIPTION_TIERS.length).toBe(7)
  })

  it("every tier has a purchasable boolean (no undefined → silent breakage)", () => {
    for (const tier of SUBSCRIPTION_TIERS) {
      expect(typeof tier.purchasable).toBe("boolean")
    }
  })

  it("VISIBLE_TIERS is a filtered view, not a frozen copy", () => {
    // Sanity: VISIBLE_TIERS is derived from SUBSCRIPTION_TIERS at
    // module-load time.  Flipping purchasable on a tier at edit time
    // (in source) will cause VISIBLE_TIERS to pick up the change on
    // next build.  This isn't run-time mutable — by design.
    for (const t of VISIBLE_TIERS) {
      expect(t.purchasable).toBe(true)
      expect(t.visibleInPricingGrid).toBe(true)
    }
  })
})

// ─── 6. Checkout-route validation contract ─────────────────────────────────
//
// Mirrors the exact branch in app/api/subscription/checkout/route.ts that
// blocks decommissioned tiers.  Tests the LOGIC (not the route) so we
// don't need to spin up Stripe + Supabase + Next.js mocks just to assert
// "this tier is rejected".

describe("purchasable filter — checkout validation logic", () => {
  // Mirrors line ~67 in app/api/subscription/checkout/route.ts:
  //   if (!PURCHASABLE_DB_TIERS.has(tier)) return 400
  function validateTierForCheckout(tier: string | undefined | null): {
    ok: boolean
    error?: string
  } {
    if (!tier) return { ok: false, error: "Invalid subscription tier" }
    if (!PURCHASABLE_DB_TIERS.has(tier)) {
      return { ok: false, error: "This plan is no longer available for new subscriptions." }
    }
    return { ok: true }
  }

  it("accepts live tiers", () => {
    expect(validateTierForCheckout("starter").ok).toBe(true)
    expect(validateTierForCheckout("unlimited").ok).toBe(true)
  })

  it("rejects decommissioned DB tiers with a clear error", () => {
    const lite = validateTierForCheckout("lite")
    expect(lite.ok).toBe(false)
    expect(lite.error).toMatch(/no longer available/i)

    const professional = validateTierForCheckout("professional") // marketing "plus"
    expect(professional.ok).toBe(false)

    const enterprise = validateTierForCheckout("enterprise") // marketing "pro" + "enterprise"
    expect(enterprise.ok).toBe(false)
  })

  it("rejects missing / null / empty tier values", () => {
    expect(validateTierForCheckout(undefined).ok).toBe(false)
    expect(validateTierForCheckout(null).ok).toBe(false)
    expect(validateTierForCheckout("").ok).toBe(false)
  })

  it("rejects unknown / typo-d / hostile tier values", () => {
    expect(validateTierForCheckout("god-mode").ok).toBe(false)
    expect(validateTierForCheckout("STARTER").ok).toBe(false) // case-sensitive on purpose
    expect(validateTierForCheckout(" starter").ok).toBe(false) // no whitespace tolerance
    expect(validateTierForCheckout("starter; DROP TABLE").ok).toBe(false)
  })
})

// ─── 7. Sanity invariants — guard against regressions ─────────────────────

describe("purchasable filter — invariants", () => {
  it("no live plan has stripePriceEnvVar that resolves to an empty string", () => {
    // If STRIPE_PRICE_<TIER> isn't set, checkout will silently 400 with
    // "Invalid subscription tier".  At test time we don't have env vars,
    // but we can assert the metadata is wired.
    for (const tier of PURCHASABLE_TIERS) {
      // Just verify the env-var name is one of the known constants.
      expect([
        "STRIPE_PRICE_LITE",
        "STRIPE_PRICE_STARTER",
        "STRIPE_PRICE_PLUS",
        "STRIPE_PRICE_PRO",
        "STRIPE_PRICE_UNLIMITED",
      ]).toContain(tier.stripePriceEnvVar)
    }
  })

  it("Plus's 'highlighted' flag is decoupled from purchasable", () => {
    // Plus is currently hidden, but its `highlighted: true` marketing
    // status is preserved so re-enabling Plus restores the Most Popular
    // badge automatically.
    const plus = getTier("plus")!
    expect(plus.highlighted).toBe(true)
    expect(plus.purchasable).toBe(false)
  })

  it("Unlimited remains the flagship (purchasable + not highlighted, distinct badge)", () => {
    const unlimited = getTier("unlimited")!
    expect(unlimited.purchasable).toBe(true)
    // Unlimited uses the amber "Best Value" badge (rendered in
    // component code) rather than the foreground "highlighted" treatment.
    expect(unlimited.highlighted).toBe(false)
  })

  it("Free tier is hidden — signups continue to grant 100 free credits via the DB trigger, but Free isn't shown as a 'plan' to buy", () => {
    const free = getTier("free")!
    expect(free.purchasable).toBe(false)
    // Definition preserved (100 free credits at signup is granted by the
    // initialize_user_credits Postgres trigger, not by lib/pricing).
  })
})
