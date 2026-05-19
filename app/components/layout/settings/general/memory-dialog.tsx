"use client"

/**
 * MemoryDialog — the sidebar's quick-edit popup for user memory.
 *
 * Design language: matches the sidebar's NavHoverContent pattern —
 * a stylised mini-UI demonstrating the feature on top, then the
 * functional surface below. The hero visual makes the popup feel
 * editorial like the rest of the app instead of a plain settings
 * sheet.
 *
 * What the visual demonstrates (the things the eye registers without
 * naming):
 *   · A "Memory" card on the left with hairline preference lines
 *     that type in sequentially — feels like notes being captured.
 *   · A travelling dot along a soft connection line — feels like the
 *     preferences are being read by the agent.
 *   · Three "applied" task chips on the right (chat / schedules /
 *     swarm) each with a green check that pops in — feels like the
 *     preferences are being honoured across every agent surface.
 *   · The whole sequence resolves in ~1.4s and rests; nothing loops
 *     forever to avoid visual noise once the user starts typing.
 *
 * Layout: capped at 88vh, flex column with a scrollable body region,
 * so the dialog never grows past the viewport on tiny laptop windows
 * or with a long memory string. The hero visual is shrink-0; the
 * editor body is the only scrollable region.
 */

import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { VisuallyHidden } from "@radix-ui/react-visually-hidden"
import { motion } from "framer-motion"
import Link from "next/link"
import { ArrowUpRight } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import { MemoryEditor } from "./memory-editor"

// ─── Hero visual ───────────────────────────────────────────────────────────


type DemoState = "playing" | "settled"

/**
 * MemoryDemoVisual — left card (preferences) → connection → right column
 * (applied contexts). All entrance animations use framer-motion so we
 * don't depend on the sidebar's CSS animation file.
 *
 * The visual replays whenever ``replayKey`` changes. We trigger that on
 * dialog open so users always see the demonstration, not just the
 * settled final frame.
 */
function MemoryDemoVisual({ replayKey }: { replayKey: number }) {
  const t = useTranslations("memory")

  // Hairline preference rows on the left card. Width variation gives
  // the impression of real sentences without rendering actual text.
  const memoryLines: Array<{ w: string }> = [
    { w: "w-3/4" },
    { w: "w-full" },
    { w: "w-1/2" },
    { w: "w-2/3" },
  ]

  // Right-hand contexts that memory applies to. Labels are intentionally
  // micro — they exist for legibility, not as primary content. Localized
  // so the visual reads natively in every supported language.
  const contexts: Array<{ label: string }> = [
    { label: t("dialog.visualContextChat") },
    { label: t("dialog.visualContextSchedules") },
    { label: t("dialog.visualContextSwarm") },
  ]

  const [, setState] = useState<DemoState>("playing")
  useEffect(() => {
    // After the sequence completes, mark as settled so we know the
    // animation has finished. Currently unused beyond signalling but
    // useful if we ever want to add a hover-replay affordance.
    const t = setTimeout(() => setState("settled"), 1500)
    return () => clearTimeout(t)
  }, [replayKey])

  const ease = [0.22, 1, 0.36, 1] as const

  return (
    <div
      key={replayKey}
      className={cn(
        "relative w-full h-[128px] overflow-hidden",
        "bg-muted/30 dark:bg-foreground/[0.03]",
        "border-b border-border/30 dark:border-white/[0.05]",
      )}
      aria-hidden
    >
      {/* Soft top-edge highlight inside the visual area itself — keeps
          the popup feeling lit even when the dialog's own top-edge
          highlight is hidden by the visual. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/[0.06] to-transparent" />

      <div className="absolute inset-0 flex items-center gap-3 px-5">
        {/* ── LEFT: Memory note card ─────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, x: -6 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.35, ease, delay: 0 }}
          className={cn(
            "relative shrink-0 w-[168px]",
            "rounded-lg border border-foreground/15 dark:border-white/[0.08]",
            "bg-background/40 dark:bg-foreground/[0.04]",
            "px-2.5 py-2",
            // Subtle inner highlight — same trick as the dialog shell.
            "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]",
          )}
        >
          <div className="flex items-center gap-1.5 pb-1.5 mb-1.5 border-b border-foreground/10 dark:border-white/[0.05]">
            <span className="text-[7px] font-bold tracking-[0.12em] text-foreground/40 uppercase">
              {t("dialog.visualMemoryLabel")}
            </span>
            <span className="ml-auto flex items-center gap-1">
              <span className="h-[3px] w-[3px] rounded-full bg-emerald-500/70 shadow-[0_0_0_2px_rgba(0,0,0,0.03)]" />
              <span className="text-[6.5px] font-semibold tracking-[0.15em] text-emerald-500/70 uppercase">
                {t("dialog.visualSynced")}
              </span>
            </span>
          </div>
          <div className="space-y-1.5">
            {memoryLines.map((line, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{
                  duration: 0.25,
                  ease,
                  delay: 0.15 + i * 0.08,
                }}
                className="flex items-center gap-1.5"
              >
                <span className="h-[3px] w-[3px] rounded-full bg-foreground/30 shrink-0" />
                <span
                  className={cn(
                    "h-[2.5px] rounded-full bg-foreground/22 dark:bg-white/[0.18]",
                    line.w,
                  )}
                />
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* ── CENTER: connection line + travelling dot ──────────────── */}
        <div className="flex-1 relative h-px self-center">
          {/* Static base line — barely there, just defines the path. */}
          <div className="absolute inset-0 bg-foreground/10 dark:bg-white/[0.06]" />
          {/* Highlighted segment that draws across to show the
              connection forming. Resolves at ~0.7s. */}
          <motion.div
            initial={{ scaleX: 0, transformOrigin: "0% 50%" }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 0.55, ease, delay: 0.45 }}
            className="absolute inset-0 bg-gradient-to-r from-foreground/30 via-foreground/15 to-foreground/30 dark:from-white/[0.18] dark:via-white/[0.1] dark:to-white/[0.18]"
          />
          {/* Travelling dot — flows L→R after the line has drawn,
              indicating live preference flow into the agent contexts. */}
          <motion.div
            initial={{ left: "0%", opacity: 0 }}
            animate={{ left: "100%", opacity: [0, 1, 1, 0] }}
            transition={{
              duration: 0.9,
              ease,
              delay: 0.75,
              times: [0, 0.15, 0.85, 1],
            }}
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 h-[5px] w-[5px] rounded-full bg-foreground/55 dark:bg-white/[0.4] shadow-[0_0_6px_rgba(0,0,0,0.06)]"
          />
        </div>

        {/* ── RIGHT: applied contexts ───────────────────────────────── */}
        <div className="flex flex-col gap-1.5 shrink-0 w-[168px]">
          {contexts.map((ctx, i) => (
            <motion.div
              key={ctx.label}
              initial={{ opacity: 0, x: 6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{
                duration: 0.3,
                ease,
                delay: 0.85 + i * 0.12,
              }}
              className={cn(
                "flex items-center gap-1.5 px-2 py-[5px]",
                "rounded-md border border-foreground/10 dark:border-white/[0.05]",
                "bg-background/30 dark:bg-foreground/[0.025]",
              )}
            >
              {/* Pop-in check — small but reads as "applied". */}
              <motion.div
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{
                  duration: 0.3,
                  ease: [0.34, 1.56, 0.64, 1],
                  delay: 1.05 + i * 0.12,
                }}
                className="shrink-0 h-3 w-3 rounded-full bg-emerald-500/12 border border-emerald-500/45 flex items-center justify-center"
              >
                <svg
                  width="6"
                  height="6"
                  viewBox="0 0 10 10"
                  aria-hidden
                >
                  <path
                    d="M2 5.5L4 7.5L8 3"
                    stroke="currentColor"
                    strokeWidth="2"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-emerald-500/85"
                  />
                </svg>
              </motion.div>
              <span className="text-[8px] font-semibold tracking-[0.06em] text-foreground/55 uppercase">
                {ctx.label}
              </span>
              {/* Trailing hairline bar suggests "details" without showing them. */}
              <span className="ml-auto h-[2.5px] w-5 rounded-full bg-foreground/12 dark:bg-white/[0.08]" />
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Dialog shell ──────────────────────────────────────────────────────────

export function MemoryDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
}) {
  const t = useTranslations("memory")
  // Replay the visual every time the dialog opens — feels alive on
  // every revisit instead of greeting users with a settled frame.
  const [replayKey, setReplayKey] = useState<number>(0)
  useEffect(() => {
    if (open) setReplayKey((k) => k + 1)
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          // 500px feels like a focused popup, not a settings sheet.
          "max-w-[500px] sm:max-w-[500px] p-0 gap-0",
          // Cap at 88vh so the dialog never overflows the viewport
          // even on short laptop windows; body region scrolls instead.
          "max-h-[88vh]",
          // Flex column: hero visual + header stay pinned at the top,
          // editor body scrolls underneath.
          "flex flex-col overflow-hidden",
          "rounded-2xl border border-border/40 dark:border-white/[0.06]",
          "bg-popover shadow-2xl",
        )}
      >
        {/* Screen-reader-only title/description so we can compose our
            own custom header without losing Radix accessibility. */}
        <VisuallyHidden>
          <DialogTitle>{t("dialog.title")}</DialogTitle>
          <DialogDescription>{t("dialog.description")}</DialogDescription>
        </VisuallyHidden>

        {/* ─── Hero visual ─────────────────────────────────────────── */}
        <div className="shrink-0">
          <MemoryDemoVisual replayKey={replayKey} />
        </div>

        {/* ─── Header ──────────────────────────────────────────────── */}
        <div className="shrink-0 px-5 pt-4 pb-3 pr-12">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-[15px] font-medium tracking-tight text-foreground">
              {t("dialog.title")}
            </h2>
            <Link
              href="/account?section=memory"
              onClick={() => onOpenChange(false)}
              className={cn(
                "group inline-flex items-center gap-1 shrink-0",
                "text-[10.5px] text-muted-foreground/55 hover:text-foreground/80",
                "transition-colors",
              )}
            >
              {t("dialog.openFull")}
              <ArrowUpRight
                className="h-3 w-3 transition-transform group-hover:translate-x-[1px] group-hover:-translate-y-[1px]"
                strokeWidth={2}
              />
            </Link>
          </div>
          <p className="text-[12px] text-muted-foreground/55 mt-1 leading-snug">
            {t("dialog.description")}
          </p>
        </div>

        {/* ─── Body — scrollable region with the shared editor ─────── */}
        <div className="flex-1 overflow-y-auto px-5 pb-5 min-h-0">
          <MemoryEditor compact autoFocus />
        </div>
      </DialogContent>
    </Dialog>
  )
}
