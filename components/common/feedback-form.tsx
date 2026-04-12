"use client"

import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/toast"
import { isSupabaseEnabled } from "@/lib/supabase/config"
import {
  SealCheck,
  Spinner,
  ThumbsDown,
  Minus,
  ThumbsUp,
  Lightning,
  Coins,
  PaperPlaneTilt,
} from "@phosphor-icons/react"
import { AnimatePresence, motion } from "motion/react"
import { useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"

const TRANSITION_CONTENT = {
  ease: "easeOut" as const,
  duration: 0.2,
}

const REACTIONS = [
  {
    icon: ThumbsDown,
    labelKey: "ratings.bad" as const,
    value: 1,
    color: "text-red-500",
    bg: "bg-red-500/10 hover:bg-red-500/20 dark:bg-red-500/15",
    bgActive: "bg-red-500/15 ring-2 ring-red-500/25",
    border: "border-red-500/20",
  },
  {
    icon: Minus,
    labelKey: "ratings.okay" as const,
    value: 2,
    color: "text-amber-500",
    bg: "bg-amber-500/10 hover:bg-amber-500/20 dark:bg-amber-500/15",
    bgActive: "bg-amber-500/15 ring-2 ring-amber-500/25",
    border: "border-amber-500/20",
  },
  {
    icon: ThumbsUp,
    labelKey: "ratings.good" as const,
    value: 3,
    color: "text-emerald-500",
    bg: "bg-emerald-500/10 hover:bg-emerald-500/20 dark:bg-emerald-500/15",
    bgActive: "bg-emerald-500/15 ring-2 ring-emerald-500/25",
    border: "border-emerald-500/20",
  },
  {
    icon: Lightning,
    labelKey: "ratings.amazing" as const,
    value: 4,
    color: "text-blue-500",
    bg: "bg-blue-500/10 hover:bg-blue-500/20 dark:bg-blue-500/15",
    bgActive: "bg-blue-500/15 ring-2 ring-blue-500/25",
    border: "border-blue-500/20",
  },
] as const

type FeedbackFormProps = {
  authUserId?: string
  onClose: () => void
}

export function FeedbackForm({ authUserId, onClose }: FeedbackFormProps) {
  const t = useTranslations("feedbackForm")
  const [status, setStatus] = useState<
    "idle" | "submitting" | "success" | "error"
  >("idle")
  const [feedback, setFeedback] = useState("")
  const [selectedRating, setSelectedRating] = useState<number | null>(null)
  const [creditsEarned, setCreditsEarned] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  if (!isSupabaseEnabled) {
    return null
  }

  const handleClose = () => {
    setFeedback("")
    setSelectedRating(null)
    setStatus("idle")
    setCreditsEarned(0)
    onClose()
  }

  const handleRating = (value: number) => {
    setSelectedRating(value)
    setTimeout(() => textareaRef.current?.focus(), 100)
  }

  const selectedReaction = REACTIONS.find((r) => r.value === selectedRating)

  // Predicted credits
  const predictedCredits =
    (selectedRating ? 1 : 0) + (feedback.trim() ? 5 : 0)

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!authUserId) {
      toast({ title: t("loginRequired"), status: "error" })
      return
    }
    if (!selectedRating && !feedback.trim()) return

    setStatus("submitting")

    try {
      const res = await fetch("/api/feedback/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rating: selectedRating || undefined,
          comment: feedback.trim() || undefined,
          feedbackType: "run",
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        if (data.alreadySubmitted) {
          toast({ title: t("alreadySubmitted"), status: "info" })
        } else {
          toast({ title: `Error submitting feedback: ${data.error}`, status: "error" })
          setStatus("error")
          return
        }
      }

      setCreditsEarned(data.creditsAwarded || 0)
      setStatus("success")
      setTimeout(() => handleClose(), 2500)
    } catch (error) {
      toast({ title: `Error submitting feedback: ${error}`, status: "error" })
      setStatus("error")
    }
  }

  return (
    <div className="h-[280px] w-full">
      <AnimatePresence mode="popLayout">
        {status === "success" ? (
          <motion.div
            key="success"
            className="flex h-[280px] w-full flex-col items-center justify-center gap-2"
            initial={{ opacity: 0, y: -10, filter: "blur(2px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: 10, filter: "blur(2px)" }}
            transition={TRANSITION_CONTENT}
          >
            <div className="flex items-center justify-center size-12 rounded-full bg-emerald-500/10 mb-1">
              <SealCheck className="size-6 text-emerald-500" weight="fill" />
            </div>
            <p className="text-foreground text-center text-sm font-semibold">
              {t("thankYou")}
            </p>
            {creditsEarned > 0 && (
              <motion.div
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3, type: "spring", bounce: 0.35 }}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5",
                  "bg-emerald-500/10 border border-emerald-500/15"
                )}
              >
                <Coins className="size-4 text-emerald-500" weight="fill" />
                <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                  {t("creditsEarned", { credits: creditsEarned })}
                </span>
              </motion.div>
            )}
            <p className="text-muted-foreground/60 text-xs mt-0.5">
              {t("helpImprove")}
            </p>
          </motion.div>
        ) : (
          <motion.form
            key="form"
            className="flex h-full flex-col"
            onSubmit={handleSubmit}
            initial={{ opacity: 0, y: -10, filter: "blur(2px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: 10, filter: "blur(2px)" }}
            transition={TRANSITION_CONTENT}
          >
            {/* Rating section */}
            <div className="px-4 pt-4 pb-3">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] font-medium text-muted-foreground/70 uppercase tracking-wider select-none">
                  {t("howsExperience")}
                </span>
                {selectedRating && (
                  <motion.span
                    initial={{ opacity: 0, x: 8 }}
                    animate={{ opacity: 1, x: 0 }}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5",
                      "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                      "text-[10px] font-semibold border border-emerald-500/15"
                    )}
                  >
                    <Coins className="size-3" weight="fill" />
                    {t("plusOne")}
                  </motion.span>
                )}
              </div>
              <div className="grid grid-cols-4 gap-2">
                {REACTIONS.map((r) => {
                  const Icon = r.icon
                  const isSelected = selectedRating === r.value
                  return (
                    <button
                      key={r.value}
                      type="button"
                      onClick={() => handleRating(r.value)}
                      className={cn(
                        "flex flex-col items-center gap-1.5 rounded-xl py-2.5 px-2",
                        "transition-all duration-200 ease-out border",
                        isSelected
                          ? cn(r.bgActive, r.border)
                          : cn(r.bg, "border-transparent"),
                        "hover:scale-[1.03] active:scale-[0.97]"
                      )}
                      title={t(r.labelKey)}
                    >
                      <Icon
                        className={cn("size-5", r.color)}
                        weight={isSelected ? "fill" : "duotone"}
                      />
                      <span className={cn(
                        "text-[10px] font-medium",
                        isSelected ? r.color : "text-muted-foreground/60"
                      )}>
                        {t(r.labelKey)}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Divider */}
            <div className="px-4">
              <div className="h-px bg-border/40" />
            </div>

            {/* Comment section */}
            <div className="flex-1 px-4 pt-3 pb-1 flex flex-col min-h-0">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-medium text-muted-foreground/70 uppercase tracking-wider select-none">
                  {t("tellMore")}
                </span>
                {feedback.trim() && (
                  <motion.span
                    initial={{ opacity: 0, x: 8 }}
                    animate={{ opacity: 1, x: 0 }}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5",
                      "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                      "text-[10px] font-semibold border border-emerald-500/15"
                    )}
                  >
                    <Coins className="size-3" weight="fill" />
                    {t("plusFive")}
                  </motion.span>
                )}
              </div>
              <textarea
                ref={textareaRef}
                className={cn(
                  "flex-1 w-full resize-none rounded-xl px-3 py-2.5 text-sm outline-hidden",
                  "border border-border/40 bg-muted/20 text-foreground",
                  "placeholder:text-muted-foreground/35",
                  "focus:border-primary/25 focus:ring-1 focus:ring-primary/10",
                  "transition-all"
                )}
                placeholder={t("placeholder")}
                onChange={(e) => setFeedback(e.target.value)}
                value={feedback}
                disabled={status === "submitting"}
              />
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-4 pt-2 pb-3">
              <button
                type="button"
                onClick={handleClose}
                className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                disabled={status === "submitting"}
              >
                {t("cancel")}
              </button>
              <Button
                type="submit"
                size="sm"
                aria-label="Submit feedback"
                className="rounded-lg gap-2 px-4"
                disabled={status === "submitting" || (!selectedRating && !feedback.trim())}
              >
                <AnimatePresence mode="popLayout">
                  {status === "submitting" ? (
                    <motion.span
                      key="submitting"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={TRANSITION_CONTENT}
                      className="inline-flex items-center gap-2"
                    >
                      <Spinner className="size-3.5 animate-spin" />
                      {t("sending")}
                    </motion.span>
                  ) : (
                    <motion.span
                      key="send"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={TRANSITION_CONTENT}
                      className="inline-flex items-center gap-1.5"
                    >
                      <PaperPlaneTilt className="size-3.5" weight="fill" />
                      {t("send")}
                      {predictedCredits > 0 && (
                        <span className="inline-flex items-center gap-0.5 ml-0.5 text-emerald-300 dark:text-emerald-400 text-[10px] font-semibold">
                          +{predictedCredits}
                          <Coins className="size-3" weight="fill" />
                        </span>
                      )}
                    </motion.span>
                  )}
                </AnimatePresence>
              </Button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  )
}
