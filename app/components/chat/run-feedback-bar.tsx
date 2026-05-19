"use client"

import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { motion, AnimatePresence } from "motion/react"
import { useTranslations } from "next-intl"
import { useUser } from "@/lib/user-store/provider"
import { isSupabaseEnabled } from "@/lib/supabase/config"
import { ThumbsDown, ThumbsUp, Meh, Sparkles, ArrowUp, X } from "lucide-react"

// `labelKey` resolves under `chat.feedback.*` at render time.
const REACTIONS = [
  { icon: ThumbsDown, labelKey: "reactionBad", value: 1 },
  { icon: Meh, labelKey: "reactionOkay", value: 2 },
  { icon: ThumbsUp, labelKey: "reactionGood", value: 3 },
  { icon: Sparkles, labelKey: "reactionAmazing", value: 4 },
] as const

type FeedbackState = "idle" | "rated" | "commenting" | "nps" | "submitted"

interface RunFeedbackBarProps {
  chatId?: string | null
  swarmId?: string | null
  messageId?: string
  feedbackType?: "run" | "swarm"
  className?: string
}

export function RunFeedbackBar({
  chatId,
  swarmId,
  messageId,
  feedbackType = "run",
  className,
}: RunFeedbackBarProps) {
  const t = useTranslations("chat.feedback")
  const { user } = useUser()
  const [state, setState] = useState<FeedbackState>("idle")
  const [selectedRating, setSelectedRating] = useState<number | null>(null)
  const [comment, setComment] = useState("")
  const [creditsEarned, setCreditEarned] = useState(0)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showNps, setShowNps] = useState(false)
  const commentRef = useRef<HTMLInputElement>(null)
  const hasSubmittedRef = useRef(false)

  useEffect(() => {
    setShowNps(Math.random() < 0.1)
  }, [])

  if (!isSupabaseEnabled || !user?.id) return null

  const selectedReaction = REACTIONS.find((r) => r.value === selectedRating)

  const submitFeedback = async (payload: {
    rating?: number
    comment?: string
    npsScore?: number
    feedbackType?: string
  }) => {
    if (hasSubmittedRef.current && !payload.npsScore) return
    setIsSubmitting(true)
    try {
      const res = await fetch("/api/feedback/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId,
          swarmId,
          messageId,
          feedbackType: payload.feedbackType || feedbackType,
          ...payload,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        setCreditEarned((prev) => prev + (data.creditsAwarded || 0))
        if (!payload.npsScore) hasSubmittedRef.current = true
      }
    } catch {
      // best-effort
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleRating = async (value: number) => {
    setSelectedRating(value)
    setState("rated")
    await submitFeedback({ rating: value })
  }

  const handleCommentSubmit = async () => {
    if (!comment.trim()) return
    await submitFeedback({ rating: selectedRating || undefined, comment: comment.trim() })
    setState(showNps ? "nps" : "submitted")
  }

  const handleNpsSubmit = async (score: number) => {
    await submitFeedback({ npsScore: score, feedbackType: "nps" })
    setState("submitted")
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4, delay: 0.6 }}
      className={cn("w-full", className)}
    >
      <AnimatePresence mode="wait">
        {/* ── Idle ── */}
        {state === "idle" && (
          <motion.div
            key="idle"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="flex items-center gap-3"
          >
            <span className="text-[13px] text-muted-foreground select-none">
              {t(feedbackType === "swarm" ? "promptSwarm" : "promptRun")}
            </span>
            <div className="flex items-center gap-1">
              {REACTIONS.map((r) => {
                const Icon = r.icon
                return (
                  <button
                    key={r.value}
                    onClick={() => handleRating(r.value)}
                    disabled={isSubmitting}
                    className="group p-1.5 rounded-full transition-all duration-150 hover:bg-foreground/[0.06] hover:scale-110 active:scale-95 disabled:opacity-30"
                    title={t(r.labelKey)}
                    type="button"
                  >
                    <Icon className="size-4 text-muted-foreground transition-colors duration-150 group-hover:text-foreground" strokeWidth={1.75} />
                  </button>
                )
              })}
            </div>
          </motion.div>
        )}

        {/* ���─ Rated ── */}
        {state === "rated" && (
          <motion.div
            key="rated"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="flex items-center gap-2.5"
          >
            {selectedReaction && (() => {
              const Icon = selectedReaction.icon
              return (
                <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                  <Icon className="size-3.5" strokeWidth={1.75} />
                  {t(selectedReaction.labelKey)}
                </span>
              )
            })()}

            <span className="text-muted-foreground/25">·</span>

            <button
              onClick={() => {
                setState("commenting")
                setTimeout(() => commentRef.current?.focus(), 100)
              }}
              className="text-[13px] text-muted-foreground/60 hover:text-foreground transition-colors"
              type="button"
            >
              {t("tellUsMore")}
            </button>

            <button
              onClick={() => setState(showNps ? "nps" : "submitted")}
              className="ml-auto text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors"
              type="button"
            >
              <X className="size-3.5" strokeWidth={2} />
            </button>
          </motion.div>
        )}

        {/* ── Commenting ── */}
        {state === "commenting" && (
          <motion.div
            key="commenting"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="flex items-center gap-2"
          >
            <input
              ref={commentRef}
              type="text"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  handleCommentSubmit()
                }
              }}
              placeholder={t("commentPlaceholder")}
              className="flex-1 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground/40 outline-none"
              maxLength={500}
              disabled={isSubmitting}
            />
            <button
              onClick={handleCommentSubmit}
              disabled={!comment.trim() || isSubmitting}
              className={cn(
                "size-6 flex items-center justify-center rounded-full transition-all",
                comment.trim()
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground/30 cursor-not-allowed"
              )}
              type="button"
            >
              <ArrowUp className="size-3.5" strokeWidth={2.5} />
            </button>
          </motion.div>
        )}

        {/* ── NPS ── */}
        {state === "nps" && (
          <motion.div
            key="nps"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="space-y-2"
          >
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-muted-foreground select-none">
                {t("npsPrompt")}
              </span>
              <button
                onClick={() => setState("submitted")}
                className="text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors"
                type="button"
              >
                <X className="size-3.5" strokeWidth={2} />
              </button>
            </div>
            <div className="flex items-center gap-0.5">
              {Array.from({ length: 11 }, (_, i) => (
                <button
                  key={i}
                  onClick={() => handleNpsSubmit(i)}
                  disabled={isSubmitting}
                  className="flex-1 flex items-center justify-center h-7 rounded-md text-[12px] text-muted-foreground/60 hover:text-foreground hover:bg-foreground/[0.05] transition-all active:scale-90 disabled:opacity-30"
                  type="button"
                >
                  {i}
                </button>
              ))}
            </div>
            <div className="flex justify-between text-[11px] text-muted-foreground/40 px-0.5">
              <span>{t("npsNotLikely")}</span>
              <span>{t("npsVeryLikely")}</span>
            </div>
          </motion.div>
        )}

        {/* ── Submitted ── */}
        {state === "submitted" && (
          <motion.div
            key="submitted"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <span className="text-[13px] text-muted-foreground">
              {t("thanks")}
              {creditsEarned > 0 && <> · +{creditsEarned} {t("creditsLabel")}</>}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
