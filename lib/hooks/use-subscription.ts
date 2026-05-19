import { useState, useEffect } from "react"
import { useUser } from "@/lib/user-store/provider"
import {
  normalizeTier,
  isPaidTier,
  tierAtLeast,
  type UserTier,
} from "@/lib/tier"

interface UserSubscription {
  id: string
  status: string
  tier?: string
  current_period_end?: string
  cancel_at_period_end: boolean
  created_at?: string
}

const PAID_STATUSES = new Set(["active", "trialing", "past_due"])

/**
 * Reads /api/subscription/status and exposes canonical tier helpers.
 * Single tier helper module is lib/tier.ts.
 */
export function useSubscription() {
  const { user } = useUser()
  const [subscription, setSubscription] = useState<UserSubscription | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchSubscription = async () => {
    if (!user) {
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      setError(null)
      const response = await fetch("/api/subscription/status")
      if (response.ok) {
        const data = await response.json()
        setSubscription(data.subscription)
      } else {
        setError("Failed to fetch subscription")
      }
    } catch (error) {
      console.error("Error fetching subscription:", error)
      setError("Error fetching subscription")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchSubscription()
  }, [user])

  // Canonical tier — never returns a legacy alias.
  const tier: UserTier = normalizeTier(subscription?.tier)
  const isActiveSubscriber = !!subscription && PAID_STATUSES.has(subscription.status) && isPaidTier(tier)
  const isLiteTier = tier === "lite"
  const isStarterTier = tier === "starter"
  const isProfessionalTier = tier === "professional"
  const isEnterpriseTier = tier === "enterprise"
  const isPaid = isPaidTier(tier)
  // "Unlimited" historically meant Plus or Pro.  Keep semantics: ≥ professional.
  // (Now also includes the literal "unlimited" tier introduced in migration 017.)
  const isUnlimitedTier = tierAtLeast(tier, "professional")
  // Strict check for the literal "unlimited" subscription tier (Stripe plan).
  // Use this when you need to specifically detect the Unlimited plan, NOT the
  // legacy ">=professional" semantic above.
  const isUnlimitedPlan = tier === "unlimited"

  return {
    subscription,
    loading,
    error,
    tier,
    isActiveSubscriber,
    isLiteTier,
    isStarterTier,
    isProfessionalTier,
    isEnterpriseTier,
    isPaid,
    isUnlimitedTier,
    isUnlimitedPlan,
    refetch: fetchSubscription,
  }
}
