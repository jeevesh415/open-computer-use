"use client"

import { useEffect, useState, useRef, useCallback } from "react"
import { useUser } from "@/lib/user-store/provider"

interface Credits {
  balance: number
  total_purchased: number
  total_used: number
  last_purchase_at: string | null
  last_usage_at: string | null
  has_active_subscription?: boolean
  subscription_tier?: string | null
}

export function useCredits() {
  const { user } = useUser()
  const [credits, setCredits] = useState<Credits | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const autoRefillTriggered = useRef(false)

  const triggerAutoRefill = useCallback(async () => {
    if (autoRefillTriggered.current) return
    autoRefillTriggered.current = true

    try {
      const res = await fetch("/api/credits/auto-refill/execute", { method: "POST" })
      const data = await res.json()
      if (data.success) {
        // Refetch balance after successful auto-refill
        const balanceRes = await fetch("/api/credits/balance")
        if (balanceRes.ok) {
          const updated = await balanceRes.json()
          setCredits(updated)
        }
      }
    } catch (err) {
      console.error("Auto-refill trigger error:", err)
    } finally {
      // Allow re-trigger after 60 seconds
      setTimeout(() => { autoRefillTriggered.current = false }, 60_000)
    }
  }, [])

  const fetchCredits = async () => {
    if (!user) {
      setCredits(null)
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      const response = await fetch("/api/credits/balance")

      if (!response.ok) {
        throw new Error("Failed to fetch credits")
      }

      const data = await response.json()
      setCredits(data)
      setError(null)

      // Trigger auto-refill check if balance might be below user's threshold
      // Use 500 as gate (max configurable threshold) — server checks the real value
      if (data.balance < 500 && data.has_active_subscription) {
        triggerAutoRefill()
      }
    } catch (err) {
      console.error("Error fetching credits:", err)
      setError(err instanceof Error ? err.message : "Failed to fetch credits")
      setCredits(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchCredits()
  }, [user])

  return {
    credits,
    loading,
    error,
    refetch: fetchCredits,
  }
}