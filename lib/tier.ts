/**
 * Canonical tier vocabulary and helpers.
 *
 * ALL frontend code that reads a user's tier should go through this module.
 * The single writer of tier state is the Stripe webhook (see
 * supabase/migrations/011_unify_tier_vocabulary.sql).
 *
 * Vocabulary: free | lite | starter | professional | enterprise
 * Display:    Free | Lite | Starter | Plus          | Pro
 */
import type { UserTier } from "@/types/machines.types"

export const TIERS = [
  "free",
  "lite",
  "starter",
  "professional",
  "unlimited",
  "enterprise",
] as const

export const TIER_RANK: Record<UserTier, number> = {
  free: 0,
  lite: 1,
  starter: 2,
  professional: 3,
  unlimited: 4,
  enterprise: 5,
}

export const TIER_DISPLAY_NAME: Record<UserTier, string> = {
  free: "Free",
  lite: "Lite",
  starter: "Starter",
  professional: "Plus",
  unlimited: "Unlimited",
  enterprise: "Pro",
}

/**
 * Per-tier schedule limits.  Mirrors backend SCHEDULE_LIMITS default
 * (backend/app/core/config.py) and task_scheduler.schedule_limits.
 */
export const SCHEDULE_LIMITS: Record<UserTier, number> = {
  free: 3,
  lite: 3,
  starter: 3,
  professional: 10,
  unlimited: 10,
  enterprise: 50,
}

// Legacy aliases that may still appear in stale UI state, persisted prefs,
// or environments that haven't run migration 011 yet.  Normalise on read.
const TIER_ALIASES: Record<string, UserTier> = {
  basic: "starter",
  pro: "professional",
  plus: "professional", // display-name alias
}

/**
 * Normalise an arbitrary tier-ish string into a canonical UserTier.
 * Returns "free" for null/undefined/unknown values.
 */
export function normalizeTier(t: string | null | undefined): UserTier {
  if (!t) return "free"
  const lower = t.toLowerCase().trim()
  if ((TIERS as readonly string[]).includes(lower)) return lower as UserTier
  if (lower in TIER_ALIASES) return TIER_ALIASES[lower]
  return "free"
}

/** True iff the tier indicates an active paid subscription. */
export function isPaidTier(t: string | null | undefined): boolean {
  return normalizeTier(t) !== "free"
}

/** True iff `a` is at least as high as `b`. */
export function tierAtLeast(a: string | null | undefined, b: UserTier): boolean {
  return TIER_RANK[normalizeTier(a)] >= TIER_RANK[b]
}

/** Schedule limit for a tier, with safe fallback to free's limit. */
export function getScheduleLimit(t: string | null | undefined): number {
  return SCHEDULE_LIMITS[normalizeTier(t)] ?? SCHEDULE_LIMITS.free
}

export type { UserTier }
