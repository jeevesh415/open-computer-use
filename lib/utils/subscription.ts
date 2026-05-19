/**
 * Utility functions for checking subscription status and user tiers.
 * Uses the canonical tier vocabulary from lib/tier.ts.
 */
import { normalizeTier, isPaidTier, type UserTier } from "@/lib/tier";

export interface UserSubscription {
  status: string;
  subscription_plans?: {
    tier: string;
  } | null;
}

// Status values that grant tier benefits.  past_due keeps benefits during
// Stripe's dunning window; trialing grants the trial tier.
const PAID_STATUSES = new Set(["active", "trialing", "past_due"]);

/**
 * Check if a user is on the free tier (no active paid subscription).
 */
export function isUserOnFreeTier(subscriptions?: UserSubscription[] | null): boolean {
  if (!subscriptions || subscriptions.length === 0) {
    return true;
  }
  return !subscriptions.some(sub =>
    PAID_STATUSES.has(sub.status) &&
    sub.subscription_plans?.tier &&
    isPaidTier(sub.subscription_plans.tier)
  );
}

/**
 * Get the user's current canonical subscription tier.  Returns one of
 * free | lite | starter | professional | enterprise.
 */
export function getUserTier(subscriptions?: UserSubscription[] | null): UserTier {
  if (!subscriptions || subscriptions.length === 0) {
    return "free";
  }
  const active = subscriptions.find(sub =>
    PAID_STATUSES.has(sub.status) &&
    sub.subscription_plans?.tier &&
    isPaidTier(sub.subscription_plans.tier)
  );
  return normalizeTier(active?.subscription_plans?.tier);
}

/**
 * Format time remaining until auto-deletion for display
 */
export function formatTimeRemaining(createdAt: string): {
  hours: number;
  minutes: number;
  isExpiringSoon: boolean;
  timeString: string;
} {
  const created = new Date(createdAt);
  const now = new Date();
  const twoHoursFromCreation = new Date(created.getTime() + 2 * 60 * 60 * 1000);
  const timeRemaining = twoHoursFromCreation.getTime() - now.getTime();

  if (timeRemaining <= 0) {
    return {
      hours: 0,
      minutes: 0,
      isExpiringSoon: true,
      timeString: "Expired"
    };
  }

  const hours = Math.floor(timeRemaining / (1000 * 60 * 60));
  const minutes = Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60));
  const isExpiringSoon = timeRemaining <= 30 * 60 * 1000; // 30 minutes

  let timeString = "";
  if (hours > 0) {
    timeString = `${hours}h ${minutes}m`;
  } else {
    timeString = `${minutes}m`;
  }

  return {
    hours,
    minutes,
    isExpiringSoon,
    timeString
  };
}