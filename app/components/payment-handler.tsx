"use client"

import { useEffect } from "react"
import { useTranslations } from "next-intl"
import { useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { useCredits } from "@/lib/hooks/use-credits"
import { trackPaymentCompleted, trackPaymentCanceled } from "@/lib/posthog/analytics"

export function PaymentHandler() {
  const t = useTranslations("paymentHandler")
  const searchParams = useSearchParams()
  const { refetch: refetchCredits } = useCredits()

  useEffect(() => {
    const success = searchParams.get("payment_success")
    const canceled = searchParams.get("payment_canceled")

    if (success === "true") {
      // Payment successful
      trackPaymentCompleted("unknown", 0, "credits")
      toast.success(t("success"), {
        duration: 5000,
      })
      
      // Refetch credits to update the balance
      refetchCredits()
      
      // Clear the URL params after a short delay
      setTimeout(() => {
        const url = new URL(window.location.href)
        url.searchParams.delete("payment_success")
        url.searchParams.delete("session_id")
        window.history.replaceState({}, "", url.pathname)
      }, 1000)
      
    } else if (canceled === "true") {
      // Payment canceled
      trackPaymentCanceled()
      toast.error(t("canceled"), {
        duration: 5000,
      })
      
      // Clear the URL params
      setTimeout(() => {
        const url = new URL(window.location.href)
        url.searchParams.delete("payment_canceled")
        window.history.replaceState({}, "", url.pathname)
      }, 1000)
    }
  }, [searchParams, refetchCredits])

  return null
}