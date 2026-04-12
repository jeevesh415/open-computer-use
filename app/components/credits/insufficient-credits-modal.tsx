"use client"

import { useState, useEffect } from "react"
import { useAccountDialog } from "@/lib/account-dialog-store"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Crown, ArrowRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { useCredits } from "@/lib/hooks/use-credits"
import { trackPricingViewed } from "@/lib/posthog/analytics"
import { CoastyIcon } from "@/components/icons/coasty"

interface InsufficientCreditsModalProps {
  isOpen: boolean
  onClose: () => void
  currentBalance?: number
  requiredCredits?: number
  estimatedRuntime?: number
  errorMessage?: string
}

const creditPackages = [
  {
    id: "boost-small",
    name: "Boost",
    credits: 150,
    price: 19,
    displayCredits: 150,
    description: "Quick top-up",
  },
  {
    id: "boost-medium",
    name: "Power Boost",
    credits: 500,
    price: 49,
    displayCredits: 500,
    description: "Most popular",
    savings: "23% off",
    popular: true,
  },
  {
    id: "boost-large",
    name: "Ultra Boost",
    credits: 1200,
    price: 99,
    displayCredits: 1200,
    description: "Best value",
    savings: "35% off",
  },
]

export function InsufficientCreditsModal({
  isOpen,
  onClose,
  currentBalance = 0,
  requiredCredits = 10,
  estimatedRuntime = 0,
  errorMessage,
}: InsufficientCreditsModalProps) {
  const openAccountDialog = useAccountDialog((s) => s.open)
  const [isLoading, setIsLoading] = useState(false)
  const [hasSubscription, setHasSubscription] = useState(false)
  const { credits } = useCredits()

  useEffect(() => {
    // Check if user has active subscription
    const checkSubscription = async () => {
      try {
        const response = await fetch("/api/subscription/status")
        if (response.ok) {
          const data = await response.json()
          setHasSubscription(data.hasSubscription)
        }
      } catch (error) {
        console.error("Error checking subscription:", error)
      }
    }
    
    if (isOpen) {
      trackPricingViewed("insufficient_credits")
      checkSubscription()
    }
  }, [isOpen])

  const handlePurchase = async (packageId: string) => {
    setIsLoading(true)
    try {
      if (!hasSubscription) {
        // Redirect to billing section to subscribe first
        openAccountDialog("billing")
      } else {
        // Redirect to account page billing section with package pre-selected
        openAccountDialog("billing")
      }
      onClose()
    } catch (error) {
      console.error("Error initiating purchase:", error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSubscribe = () => {
    setIsLoading(true)
    openAccountDialog("billing")
    onClose()
  }

  const balanceCredits = currentBalance

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[400px] p-5 gap-0">
        <DialogHeader className="space-y-1.5 pb-4">
          <DialogTitle className="text-base font-semibold">
            {hasSubscription ? "Need more credits?" : "Unlock AI Features"}
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {hasSubscription
              ? "Top up your balance to continue."
              : "Subscribe to get started with AI features."
            }
          </DialogDescription>
        </DialogHeader>

        {/* Balance */}
        <div className="flex items-center justify-between rounded-lg border px-3 py-2.5 mb-4">
          <div className="flex items-center gap-2">
            <CoastyIcon className="h-4 w-4 text-primary" />
            <span className="text-sm text-muted-foreground">Balance</span>
          </div>
          <span className="text-sm font-semibold">
            {balanceCredits.toLocaleString()} credits remaining
          </span>
        </div>

        {!hasSubscription ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3.5">
              <div className="flex items-start gap-2.5">
                <Crown className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                <div className="space-y-2.5">
                  <p className="text-sm font-medium">Subscription Required</p>
                  <div className="space-y-1.5 text-xs text-muted-foreground">
                    <p>Starting at $19/month with 200 credits included</p>
                    <p>Purchase additional credits anytime</p>
                  </div>
                </div>
              </div>
            </div>

            <Button
              onClick={handleSubscribe}
              disabled={isLoading}
              className="w-full"
              size="sm"
            >
              View Plans
              <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {creditPackages.map((pkg) => (
              <button
                key={pkg.id}
                onClick={() => handlePurchase(pkg.id)}
                disabled={isLoading}
                className={cn(
                  "group relative flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left transition-all",
                  "hover:border-primary/40 hover:bg-accent/50",
                  pkg.popular && "border-primary/30 bg-primary/5",
                  isLoading && "opacity-50 cursor-not-allowed"
                )}
              >
                <div className="flex items-center gap-2.5">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted group-hover:bg-primary/10 transition-colors">
                    <CoastyIcon className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium">{pkg.displayCredits.toLocaleString()} credits</span>
                      {pkg.savings && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 bg-green-500/10 text-green-600 border-green-500/20">
                          {pkg.savings}
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">{pkg.description}</div>
                  </div>
                </div>

                <span className="text-sm font-semibold">${pkg.price}</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between pt-4 mt-4 border-t text-xs text-muted-foreground">
          <button
            onClick={() => { openAccountDialog("billing"); onClose() }}
            className="hover:text-foreground transition-colors"
          >
            View all options
          </button>
          <button
            onClick={onClose}
            className="hover:text-foreground transition-colors"
          >
            Maybe later
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}