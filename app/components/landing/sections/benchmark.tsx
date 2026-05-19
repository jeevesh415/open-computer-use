"use client"

import { motion } from "framer-motion"
import { useEffect, useRef, useState } from "react"
import Image from "next/image"
import { useTheme } from "next-themes"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import { LandingSectionHeader, LandingSectionTopGlow } from "../section-shell"

type Entry = {
  name: string
  org: string
  score: number
  highlight?: boolean
}

const LEADERBOARD: Entry[] = [
  { name: "Coasty", org: "Ours", score: 82.0, highlight: true },
  { name: "Agent S3", org: "Simular · Opus 4.5 + GPT-5", score: 72.6 },
  { name: "Agent S3", org: "Simular · GPT-5", score: 69.9 },
  { name: "UiPath Screen Agent", org: "UiPath · Opus 4.5", score: 67.1 },
  { name: "Agent S3", org: "Simular · Opus 4.5", score: 66.0 },
  { name: "Kimi K2.5", org: "Moonshot AI", score: 63.3 },
  { name: "Claude Sonnet 4.5", org: "Anthropic", score: 62.9 },
  { name: "Seed-1.8", org: "ByteDance", score: 61.9 },
  { name: "Claude Sonnet 4.5", org: "Anthropic · 50 steps", score: 58.1 },
]

const LEADER_SCORE = 82.0
// Scale bar widths against an axis ceiling slightly above the leader so the
// "82" mark sits visibly inside the chart, not pinned to the right edge.
const AXIS_MAX = 90
const EASE = [0.22, 1, 0.36, 1] as const

// Cubic ease-out count-up driven by rAF — mirrors the StatCell pattern in
// hero-video-matrix.tsx but kept local so this section is fully self-contained.
function useCountUp(target: number, durationMs: number, start: boolean): number {
  const [val, setVal] = useState(0)
  useEffect(() => {
    if (!start) return
    if (target === 0) { setVal(0); return }
    const t0 = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / durationMs)
      const eased = 1 - Math.pow(1 - t, 3)
      setVal(target * eased)
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, durationMs, start])
  return val
}

function ScoreValue({
  score,
  start,
  isMobile,
  className,
}: {
  score: number
  start: boolean
  isMobile: boolean
  className?: string
}) {
  const animated = useCountUp(score, 1500, start && !isMobile)
  const display = isMobile ? score.toFixed(1) : animated.toFixed(1)
  return (
    <span className={cn("font-mono tabular-nums", className)}>
      {display}
      <span className="opacity-50">%</span>
    </span>
  )
}

function BenchmarkRow({
  entry,
  rank,
  inView,
  isMobile,
}: {
  entry: Entry
  rank: number
  inView: boolean
  isMobile: boolean
}) {
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  const widthPct = (entry.score / AXIS_MAX) * 100
  const delta = entry.score - LEADER_SCORE
  const rankLabel = String(rank).padStart(2, "0")
  // Coasty lands LAST as the punctuation moment.
  const animDelay = entry.highlight ? rank * 0.06 + 0.3 : rank * 0.06

  // ── MOBILE LAYOUT ────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div className={cn("flex flex-col gap-1.5", entry.highlight && "py-1")}>
        <div className="flex items-baseline justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-foreground/30">
              {rankLabel}
            </span>
            {entry.highlight && mounted && (
              <Image
                src={resolvedTheme === "dark" ? "/logo_light.svg" : "/logo_dark.svg"}
                alt="Coasty"
                width={14}
                height={14}
                className="h-3.5 w-3.5 shrink-0"
              />
            )}
            <span className={cn(
              "text-sm font-medium truncate",
              entry.highlight ? "text-foreground" : "text-foreground/85"
            )}>
              {entry.name}
            </span>
          </div>
          <ScoreValue
            score={entry.score}
            start
            isMobile
            className={cn(
              "text-sm shrink-0",
              entry.highlight ? "text-foreground font-semibold" : "text-foreground/75"
            )}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-foreground/35 truncate">
            {entry.org}
          </span>
        </div>
        <div className={cn(
          "relative w-full overflow-hidden rounded-[2px] bg-foreground/[0.04] dark:bg-foreground/[0.06]",
          entry.highlight ? "h-2.5 ring-1 ring-foreground/15" : "h-1.5"
        )}>
          <div
            className={cn(
              "absolute inset-y-0 left-0 rounded-[2px]",
              entry.highlight
                ? "bg-foreground/85 dark:bg-foreground/90"
                : "bg-foreground/30 dark:bg-foreground/35"
            )}
            style={{ width: `${widthPct}%` }}
          />
        </div>
      </div>
    )
  }

  // ── DESKTOP LAYOUT ───────────────────────────────────────────────────
  const barHeight = entry.highlight ? 36 : 24

  return (
    <motion.div
      initial={{ opacity: 0, x: -16 }}
      animate={inView ? { opacity: 1, x: 0 } : { opacity: 0, x: -16 }}
      transition={{ delay: animDelay, duration: 0.55, ease: EASE }}
      className={cn(
        "grid items-center gap-4",
        // [rank] [name+org] [bar] [delta] — pill column removed so the
        // bar gets the freed-up 88px + gap (≈104px) of horizontal room.
        // The framework/model distinction is no longer surfaced; the
        // hierarchy comes from the score and bar length alone.
        "grid-cols-[36px_minmax(180px,220px)_minmax(0,1fr)_92px]",
        // Narrow mode (parent has data-narrow): tighten the rank +
        // name + delta tracks so the bar stays as the dominant column
        // even when the wrapper compresses to ~720px.
        "group-data-[narrow]/feat:grid-cols-[28px_minmax(140px,180px)_minmax(0,1fr)_72px] group-data-[narrow]/feat:gap-3",
        entry.highlight ? "py-2" : "py-1"
      )}
    >
      {/* Rank */}
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-foreground/30 tabular-nums">
        {rankLabel}
      </div>

      {/* Name + org */}
      <div className="min-w-0">
        {entry.highlight && (
          <div className="font-mono text-[9px] uppercase tracking-[0.24em] text-foreground mb-0.5">
            01 · LEADER
          </div>
        )}
        <div className="flex items-center gap-2 min-w-0">
          {entry.highlight && mounted && (
            <Image
              src={resolvedTheme === "dark" ? "/logo_light.svg" : "/logo_dark.svg"}
              alt="Coasty"
              width={14}
              height={14}
              className="h-3.5 w-3.5 shrink-0 opacity-90"
            />
          )}
          <span className={cn(
            "truncate",
            entry.highlight
              ? "text-[15px] font-medium text-foreground"
              : "text-[14px] font-medium text-foreground/90"
          )}>
            {entry.name}
          </span>
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-foreground/40 truncate mt-0.5">
          {entry.org}
        </div>
      </div>

      {/* Bar */}
      <div className="relative w-full" style={{ height: barHeight }}>
        <div
          className={cn(
            "absolute inset-0 rounded-[3px]",
            "bg-foreground/[0.035] dark:bg-foreground/[0.05]",
            entry.highlight && "ring-1 ring-foreground/15 dark:ring-foreground/20"
          )}
        />
        <motion.div
          initial={{ width: 0 }}
          animate={inView ? { width: `${widthPct}%` } : { width: 0 }}
          transition={{ delay: animDelay + 0.05, duration: 0.7, ease: EASE }}
          className={cn(
            "absolute inset-y-0 left-0 rounded-[3px] overflow-hidden",
            entry.highlight
              ? "bg-foreground/[0.92] dark:bg-foreground/[0.95]"
              : "bg-foreground/30 dark:bg-foreground/35"
          )}
        >
          {entry.highlight && (
            // Single restrained signature: a slow diagonal sheen sweeping
            // through the leader bar. No multi-color gradients, no smoke.
            <div
              aria-hidden
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  "linear-gradient(115deg, transparent 30%, rgba(255,255,255,0.16) 50%, transparent 70%)",
                backgroundSize: "220% 100%",
                animation: "lp-bench-sweep 3.6s linear infinite",
              }}
            />
          )}
        </motion.div>

        {/* Value at end of bar */}
        <div
          className={cn(
            "absolute inset-y-0 flex items-center pointer-events-none",
            "left-0 pl-2"
          )}
          style={{ width: `${widthPct}%` }}
        >
          <div className="ml-auto flex items-center gap-2 pr-2.5">
            {entry.highlight && (
              <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-background/70">
                +{(LEADER_SCORE - LEADERBOARD[1].score).toFixed(1)} PTS
              </span>
            )}
            <ScoreValue
              score={entry.score}
              start={inView}
              isMobile={false}
              className={cn(
                entry.highlight
                  ? "text-[14px] font-semibold text-background"
                  : "text-[13px] font-medium text-foreground/90"
              )}
            />
          </div>
        </div>
      </div>

      {/* Delta vs leader (omitted for the leader itself) */}
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-foreground/30 tabular-nums text-right">
        {entry.highlight ? "" : `${delta.toFixed(1)} pts`}
      </div>
    </motion.div>
  )
}

export function BenchmarkSection({ isMobile }: { isMobile: boolean }) {
  const t = useTranslations()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [inView, setInView] = useState(false)

  // Gate animations on first viewport entry so the count-up + bar fills
  // sync with the cascade rather than firing pre-scroll.
  useEffect(() => {
    if (isMobile) { setInView(true); return }
    const el = containerRef.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setInView(true); obs.disconnect() } },
      { threshold: 0.15 }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [isMobile])

  // Leader position on the axis — drives the hairline + indicator label.
  const leaderPct = (LEADER_SCORE / AXIS_MAX) * 100

  return (
    <section
      id="benchmark"
      className="relative py-20 sm:py-24 lg:py-32 px-8 sm:px-10 lg:px-12"
    >
      {/* Local keyframe — defined here because lp-bench-sweep is unique to
          the leader bar and not part of the global landing-page keyframes. */}
      <style jsx global>{`
        @keyframes lp-bench-sweep {
          0% { background-position: 200% 0; }
          100% { background-position: -100% 0; }
        }
      `}</style>

      <LandingSectionTopGlow />
      <div className="max-w-5xl w-full mx-auto">
        <LandingSectionHeader
          title={t("benchmark.title")}
          subtitle={t("benchmark.subtitle")}
          isMobile={isMobile}
        />

        <motion.div
          ref={containerRef}
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0, margin: "0px 0px -80px 0px" }}
          transition={{ duration: 0.7, ease: EASE }}
          className={cn(
            "relative w-full mx-auto",
            "rounded-2xl border border-foreground/10",
            "bg-card/40 backdrop-blur-[2px]",
            "p-6 sm:p-10"
          )}
        >
          {/* Inner top sheen — hairline gradient at the very top */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/15 to-transparent"
          />
          {/* Bottom hairline echo */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-8 bottom-0 h-px bg-gradient-to-r from-transparent via-foreground/[0.06] to-transparent"
          />

          {/* ── AXIS RAIL (desktop only) ─────────────────────────────── */}
          {!isMobile && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={inView ? { opacity: 1 } : { opacity: 0 }}
              transition={{ duration: 0.4, ease: EASE }}
              // Reuse the same grid geometry as the row so the axis aligns
              // exactly with the bar column without hardcoded padding math.
              className={cn(
                "grid items-end gap-4 mb-8",
                "grid-cols-[36px_minmax(180px,220px)_minmax(0,1fr)_92px]",
                "group-data-[narrow]/feat:grid-cols-[28px_minmax(140px,180px)_minmax(0,1fr)_72px] group-data-[narrow]/feat:gap-3",
              )}
            >
              {/* spacers for rank, name */}
              <div /><div />
              <div className="relative h-9">
                {/* Base axis line */}
                <div className="absolute left-0 right-0 bottom-3 h-px bg-foreground/10" />

                {/* Leader tick (82) — triangular indicator + label above */}
                <div
                  className="absolute flex flex-col items-center"
                  style={{ left: `${leaderPct}%`, top: 0, transform: "translateX(-50%)" }}
                >
                  <span className="whitespace-nowrap font-mono text-[9px] uppercase tracking-[0.22em] text-foreground tabular-nums">
                    82% · COASTY
                  </span>
                  <div
                    className="mt-0.5 h-0 w-0"
                    style={{
                      borderLeft: "4px solid transparent",
                      borderRight: "4px solid transparent",
                      borderTop: "5px solid currentColor",
                      color: "var(--foreground, currentColor)",
                    }}
                  />
                </div>
              </div>
              <div />
            </motion.div>
          )}

          {/* ── BARS ─────────────────────────────────────────────────── */}
          <div className="relative">
            {/* Leader hairline — drops down through all rows at the 82% mark.
                Uses the same grid geometry as BenchmarkRow so it aligns
                exactly with the bar column on every row. */}
            {!isMobile && (
              <motion.div
                aria-hidden
                initial={{ opacity: 0, scaleY: 0 }}
                animate={inView ? { opacity: 1, scaleY: 1 } : { opacity: 0, scaleY: 0 }}
                transition={{ duration: 0.6, delay: 0.15, ease: EASE }}
                className={cn(
                  "pointer-events-none absolute inset-0 grid items-stretch gap-4 origin-top",
                  "grid-cols-[36px_minmax(180px,220px)_minmax(0,1fr)_92px]",
                  "group-data-[narrow]/feat:grid-cols-[28px_minmax(140px,180px)_minmax(0,1fr)_72px] group-data-[narrow]/feat:gap-3",
                )}
              >
                {/* spacers for rank, name */}
                <div /><div />
                <div className="relative">
                  <div
                    className="absolute top-0 bottom-0 w-px bg-gradient-to-b from-foreground/45 via-foreground/15 to-foreground/5"
                    style={{ left: `${leaderPct}%`, transform: "translateX(-0.5px)" }}
                  />
                </div>
                <div />
              </motion.div>
            )}

            <div className={cn(isMobile ? "space-y-4" : "space-y-0.5")}>
              {LEADERBOARD.map((entry, i) => (
                <BenchmarkRow
                  key={`${entry.name}-${i}`}
                  entry={entry}
                  rank={i + 1}
                  inView={inView}
                  isMobile={isMobile}
                />
              ))}
            </div>
          </div>

        </motion.div>
      </div>
    </section>
  )
}
