/**
 * Canonical pricing source for Coasty.
 *
 * Replaces three previously-duplicated zones:
 *   1. app/pricing/page.tsx                      (marketing tiers)
 *   2. app/components/landing/sections/pricing.tsx (landing tiers — exact copy)
 *   3. app/api/credits/checkout/route.ts          (boost packages, server-side)
 *
 * Consumed by:
 *   - the two pages above (replace local arrays with imports)
 *   - GET /api/pricing.json (machine-readable, agent-friendly endpoint)
 *   - the MCP server's get_pricing tool (mcp/src/tools/credits.ts)
 *   - JSON-LD Product/Offer emission on the pricing page
 *
 * Backend mirror: backend/app/services/api_key_service.py SUBSCRIPTION_TO_API_TIER
 * folds the marketing tier "lite" into the API tier "free" (lite has no API
 * quota — it's a UI/credit perk plan only). Schedule limits live in
 * backend/app/core/config.py SCHEDULE_LIMITS. Those are the source of truth
 * for backend enforcement; this module is the source of truth for prices,
 * names, and customer-facing descriptions.
 *
 * Stable API: bump SCHEMA_VERSION on any breaking shape change so consumers
 * (incl. third-party agents reading /api/pricing.json) can detect.
 */

export const SCHEMA_VERSION = "2026-05-05" as const;

// ─── Subscription tiers ────────────────────────────────────────────────────

/** Marketing tier id — appears in URLs, Stripe metadata, and customer-facing
 * copy. Distinct from `apiTier` because "lite" folds to "free" in the API
 * limits map. Add new tiers here, never elsewhere. */
export type SubscriptionTierId =
  | "free"
  | "lite"
  | "starter"
  | "plus"
  | "pro"
  | "unlimited"
  | "enterprise";

/** Backend / API enforcement tier — what `/v1/*` endpoints honor for rate
 * limits and per-tier features. */
export type ApiTier = "free" | "starter" | "professional" | "enterprise";

export interface SubscriptionTier {
  /** Marketing-facing id (free | lite | starter | plus | pro | enterprise) */
  id: SubscriptionTierId;
  /** Customer-facing display name */
  name: string;
  /** Monthly USD; null for "contact sales" / enterprise */
  priceUSD: number | null;
  /** Monthly credit allowance included in the plan */
  creditsPerMonth: number;
  /** Effective $/credit (for callers that want to display "best value") */
  pricePerCreditUSD: number | null;
  /** API rate-limit tier this maps to in the backend */
  apiTier: ApiTier;
  /** Concurrent active machines */
  machinesIncluded: number;
  /** Concurrent swarm agents */
  swarmAgentsLimit: number;
  /** Max simultaneous active schedules (mirror of backend SCHEDULE_LIMITS) */
  scheduleLimit: number;
  /** Whether this tier ever appears on the marketing pricing grid */
  visibleInPricingGrid: boolean;
  /** Whether the tier is the "popular / highlighted" callout */
  highlighted: boolean;
  /** Whether the tier is CURRENTLY live for purchase.  Toggle to false to
   * remove the tier from every customer-facing surface (landing, /pricing,
   * settings billing, SEO structured data, /api/pricing snapshot,
   * checkout-route validation) without deleting the tier definition — so
   * it can be re-enabled later by flipping back to true.
   *
   * Existing subscribers on a tier with purchasable=false KEEP their
   * subscription — the webhook, balance, and renewal flows still treat
   * the tier as valid.  Only NEW signups are blocked. */
  purchasable: boolean;
  /** Stripe price id env-var name (resolved server-side at checkout time) */
  stripePriceEnvVar?:
    | "STRIPE_PRICE_LITE"
    | "STRIPE_PRICE_STARTER"
    | "STRIPE_PRICE_PLUS"
    | "STRIPE_PRICE_PRO"
    | "STRIPE_PRICE_UNLIMITED";
  /** Stable, ISO-8601 last-update timestamp for cache invalidation */
  updatedAt: string;
}

const PRICING_UPDATED_AT = "2026-05-05T00:00:00.000Z";

/** Helper: $/credit, rounded to 4dp; null when free. */
const perCredit = (priceUSD: number | null, credits: number): number | null =>
  priceUSD === null || credits === 0
    ? null
    : Math.round((priceUSD / credits) * 10_000) / 10_000;

export const SUBSCRIPTION_TIERS: readonly SubscriptionTier[] = [
  {
    id: "free",
    name: "Free",
    priceUSD: 0,
    creditsPerMonth: 0,
    pricePerCreditUSD: null,
    apiTier: "free",
    machinesIncluded: 0,
    swarmAgentsLimit: 0,
    scheduleLimit: 3,
    visibleInPricingGrid: true,
    highlighted: false,
    purchasable: false, // HIDDEN: signup default, never shown as a "for-sale" plan
    updatedAt: PRICING_UPDATED_AT,
  },
  {
    id: "lite",
    name: "Lite",
    priceUSD: 9,
    creditsPerMonth: 100,
    pricePerCreditUSD: perCredit(9, 100),
    apiTier: "free",
    machinesIncluded: 1,
    swarmAgentsLimit: 2,
    scheduleLimit: 3,
    visibleInPricingGrid: true,
    highlighted: false,
    purchasable: false, // HIDDEN — flip to true to re-list on landing/pricing/checkout
    stripePriceEnvVar: "STRIPE_PRICE_LITE",
    updatedAt: PRICING_UPDATED_AT,
  },
  {
    id: "starter",
    name: "Starter",
    priceUSD: 19,
    creditsPerMonth: 200,
    pricePerCreditUSD: perCredit(19, 200),
    apiTier: "starter",
    machinesIncluded: 1,
    swarmAgentsLimit: 3,
    scheduleLimit: 3,
    visibleInPricingGrid: true,
    highlighted: false,
    purchasable: true, // ✅ LIVE — entry-level paid plan
    stripePriceEnvVar: "STRIPE_PRICE_STARTER",
    updatedAt: PRICING_UPDATED_AT,
  },
  {
    id: "plus",
    name: "Plus",
    priceUSD: 50,
    creditsPerMonth: 600,
    pricePerCreditUSD: perCredit(50, 600),
    apiTier: "professional",
    machinesIncluded: 2,
    swarmAgentsLimit: 6,
    scheduleLimit: 10,
    visibleInPricingGrid: true,
    highlighted: true,
    purchasable: false, // HIDDEN — kept in code for future re-launch
    stripePriceEnvVar: "STRIPE_PRICE_PLUS",
    updatedAt: PRICING_UPDATED_AT,
  },
  {
    id: "pro",
    name: "Pro",
    priceUSD: 100,
    creditsPerMonth: 1500,
    pricePerCreditUSD: perCredit(100, 1500),
    apiTier: "professional",
    machinesIncluded: 3,
    swarmAgentsLimit: 9,
    scheduleLimit: 10,
    visibleInPricingGrid: true,
    highlighted: false,
    purchasable: false, // HIDDEN — kept in code for future re-launch
    stripePriceEnvVar: "STRIPE_PRICE_PRO",
    updatedAt: PRICING_UPDATED_AT,
  },
  {
    id: "unlimited",
    name: "Unlimited",
    priceUSD: 249,
    // Sentinel for "unlimited credits".  UI must render the literal string
    // "Unlimited" when tier === "unlimited" — never display this number.
    // Backend guard clauses (Phase 5) skip the deduct-credits RPC for this
    // tier so balance never actually drains.
    creditsPerMonth: 999_999_999,
    pricePerCreditUSD: null,
    apiTier: "professional",
    machinesIncluded: 2,
    // Unlimited gives unlimited CREDITS but only 1 concurrent agent — this
    // is the abuse-prevention valve.  With unlimited credits AND 6 parallel
    // agents, a user could burn massive compute in a single hour.  Capping
    // concurrency to 1 (enforced in app/api/swarm/route.ts too) keeps the
    // plan economics sane.
    swarmAgentsLimit: 1,
    scheduleLimit: 10,
    visibleInPricingGrid: true,
    highlighted: false,
    purchasable: true, // ✅ LIVE — flagship plan
    stripePriceEnvVar: "STRIPE_PRICE_UNLIMITED",
    updatedAt: PRICING_UPDATED_AT,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    priceUSD: null,
    creditsPerMonth: 0,
    pricePerCreditUSD: null,
    apiTier: "enterprise",
    machinesIncluded: 0,
    swarmAgentsLimit: 0,
    scheduleLimit: 50,
    visibleInPricingGrid: true,
    highlighted: false,
    purchasable: false, // contact-sales — not a self-serve purchase
    updatedAt: PRICING_UPDATED_AT,
  },
];

/** Marketing-tier id → API-tier id. Mirrors backend
 * api_key_service.SUBSCRIPTION_TO_API_TIER — keep in sync.
 *
 * "lite" folds to "free" because the Lite plan is a UI/credit-perk plan,
 * not an API-quota plan. This is intentional but easy to forget. */
export const SUBSCRIPTION_TO_API_TIER: Record<SubscriptionTierId, ApiTier> = {
  free: "free",
  lite: "free",
  starter: "starter",
  plus: "professional",
  pro: "professional",
  unlimited: "professional",
  enterprise: "enterprise",
};

// ─── Boost (one-off credit) packages ───────────────────────────────────────
//
// Convenience purchases. Higher $/credit than equivalent subscription tiers
// because they're one-off + don't carry the rate-limit benefits. Customers
// MUST have an active paid subscription to buy boosts (enforced server-side
// in app/api/credits/checkout/route.ts).

export type BoostPackageId = "boost-small" | "boost-medium" | "boost-large";

export interface BoostPackage {
  id: BoostPackageId;
  name: string;
  credits: number;
  priceUSD: number;
  pricePerCreditUSD: number;
  /** Required so checkout can refuse free/lite buyers */
  requiresPaidSubscription: true;
  updatedAt: string;
}

export const BOOST_PACKAGES: readonly BoostPackage[] = [
  {
    id: "boost-small",
    name: "Boost",
    credits: 150,
    priceUSD: 19,
    pricePerCreditUSD: perCredit(19, 150)!,
    requiresPaidSubscription: true,
    updatedAt: PRICING_UPDATED_AT,
  },
  {
    id: "boost-medium",
    name: "Power Boost",
    credits: 500,
    priceUSD: 49,
    pricePerCreditUSD: perCredit(49, 500)!,
    requiresPaidSubscription: true,
    updatedAt: PRICING_UPDATED_AT,
  },
  {
    id: "boost-large",
    name: "Ultra Boost",
    credits: 1200,
    priceUSD: 99,
    pricePerCreditUSD: perCredit(99, 1200)!,
    requiresPaidSubscription: true,
    updatedAt: PRICING_UPDATED_AT,
  },
];

// ─── Per-action / metered usage ────────────────────────────────────────────
//
// Mirrors backend/app/services/api_billing_service.py BASE_FEES + agent_billing.py
// CREDITS_PER_MINUTE. Surfaced here so customers and agents can budget without
// reverse-engineering. Backend remains authoritative for billing — this is a
// public spec, not a billing engine.

export interface MeteredRate {
  endpoint: string;
  /** Credits charged per call (integer) */
  creditsPerCall: number;
  description: string;
}

export const METERED_RATES: readonly MeteredRate[] = [
  { endpoint: "POST /v1/predict",         creditsPerCall: 5,  description: "Stateless predict — one screenshot → action" },
  { endpoint: "POST /v1/sessions",        creditsPerCall: 10, description: "Open a stateful CUA session" },
  { endpoint: "POST /v1/sessions/{id}/predict", creditsPerCall: 3, description: "Predict within an existing session" },
  { endpoint: "POST /v1/ground",          creditsPerCall: 2,  description: "Ground a UI element to (x, y)" },
  { endpoint: "POST /v1/ocr",             creditsPerCall: 1,  description: "OCR a screenshot" },
];

/** Long-running agent jobs (CUA orchestration via dashboard) bill per
 * minute, not per call. Mirrors agent_billing.py CREDITS_PER_MINUTE. */
export const CREDITS_PER_AGENT_MINUTE = 10;
export const MIN_CREDITS_TO_START_SESSION = 20;
export const MAX_AGENT_SESSION_HOURS = 6;

// ─── Lookups ───────────────────────────────────────────────────────────────

export const getTier = (id: SubscriptionTierId): SubscriptionTier | undefined =>
  SUBSCRIPTION_TIERS.find((t) => t.id === id);

export const getBoostPackage = (id: BoostPackageId): BoostPackage | undefined =>
  BOOST_PACKAGES.find((p) => p.id === id);

/** Tier objects shown on the public pricing grid AND currently live for
 * purchase.  Consumers (landing, /pricing, SEO offers, /api/pricing
 * snapshot) all read from this filter, so toggling `purchasable: false`
 * on a tier removes it from every customer-facing surface in one place. */
export const VISIBLE_TIERS: readonly SubscriptionTier[] = SUBSCRIPTION_TIERS.filter(
  (t) => t.visibleInPricingGrid && t.purchasable,
);

/** Explicit alias for the "live for purchase" set.  Functionally equal to
 * VISIBLE_TIERS today; named separately so call sites that care about the
 * purchasability semantic (rather than the marketing-grid semantic) read
 * cleanly.  If we ever introduce a tier that is `purchasable: false` but
 * still wants to appear in the grid (coming-soon teaser), update the
 * VISIBLE_TIERS filter to drop the `&& t.purchasable` clause and have
 * each surface choose which set it wants. */
export const PURCHASABLE_TIERS: readonly SubscriptionTier[] = SUBSCRIPTION_TIERS.filter(
  (t) => t.purchasable,
);

/** Marketing tier ids (free | lite | starter | plus | pro | unlimited |
 * enterprise) that are currently live for purchase. */
export const PURCHASABLE_TIER_IDS: ReadonlySet<SubscriptionTierId> = new Set(
  PURCHASABLE_TIERS.map((t) => t.id),
);

/** DB tier names (subscription_plans.tier column values) currently live
 * for purchase.  Used by the checkout route to reject requests for
 * decommissioned plans.
 *
 * The set must be maintained MANUALLY in sync with PURCHASABLE_TIERS
 * because the DB tier vocabulary differs from marketing ids in a few
 * places (the historical billing-section maps marketing "plus" →
 * DB "professional" and marketing "pro" → DB "enterprise"; "starter"
 * and "unlimited" match cleanly).  When re-enabling a marketing tier,
 * add its DB-equivalent name here too. */
export const PURCHASABLE_DB_TIERS: ReadonlySet<string> = new Set([
  "starter",
  "unlimited",
]);

// ─── Public agent-facing snapshot ──────────────────────────────────────────
//
// Shape returned by GET /api/pricing.json and the MCP get_pricing tool.
// Stable across releases; bump SCHEMA_VERSION on breaking changes.

export interface PricingSnapshot {
  schemaVersion: typeof SCHEMA_VERSION;
  updatedAt: string;
  currency: "USD";
  subscriptions: ReadonlyArray<{
    id: SubscriptionTierId;
    name: string;
    priceUSD: number | null;
    creditsPerMonth: number;
    pricePerCreditUSD: number | null;
    apiTier: ApiTier;
    machinesIncluded: number;
    swarmAgentsLimit: number;
    scheduleLimit: number;
    highlighted: boolean;
  }>;
  boostPackages: ReadonlyArray<{
    id: BoostPackageId;
    name: string;
    credits: number;
    priceUSD: number;
    pricePerCreditUSD: number;
    requiresPaidSubscription: true;
  }>;
  meteredRates: ReadonlyArray<MeteredRate>;
  agentMinuteRate: {
    creditsPerMinute: number;
    minCreditsToStart: number;
    maxSessionHours: number;
  };
  /** Documented warning surface — discourages naive customers from
   * picking boosts when a tier upgrade would be cheaper. */
  notes: string[];
}

export function buildPricingSnapshot(): PricingSnapshot {
  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: PRICING_UPDATED_AT,
    currency: "USD",
    subscriptions: VISIBLE_TIERS.map((t) => ({
      id: t.id,
      name: t.name,
      priceUSD: t.priceUSD,
      creditsPerMonth: t.creditsPerMonth,
      pricePerCreditUSD: t.pricePerCreditUSD,
      apiTier: t.apiTier,
      machinesIncluded: t.machinesIncluded,
      swarmAgentsLimit: t.swarmAgentsLimit,
      scheduleLimit: t.scheduleLimit,
      highlighted: t.highlighted,
    })),
    boostPackages: BOOST_PACKAGES.map((p) => ({
      id: p.id,
      name: p.name,
      credits: p.credits,
      priceUSD: p.priceUSD,
      pricePerCreditUSD: p.pricePerCreditUSD,
      requiresPaidSubscription: p.requiresPaidSubscription,
    })),
    meteredRates: METERED_RATES,
    agentMinuteRate: {
      creditsPerMinute: CREDITS_PER_AGENT_MINUTE,
      minCreditsToStart: MIN_CREDITS_TO_START_SESSION,
      maxSessionHours: MAX_AGENT_SESSION_HOURS,
    },
    notes: [
      "All prices in USD. Subscriptions billed monthly via Stripe.",
      "Boost packages require an active paid subscription (Lite or higher).",
      "The 'lite' marketing tier maps to the 'free' API rate-limit tier — Lite buys credits + 1 machine, not API throughput.",
      "Long-running agent jobs are charged at " +
        CREDITS_PER_AGENT_MINUTE +
        " credits/minute with a minimum of " +
        MIN_CREDITS_TO_START_SESSION +
        " credits to start.",
      "Per-call rates apply to the public /v1/* API. Dashboard-orchestrated CUA runs use the per-minute rate.",
    ],
  };
}
