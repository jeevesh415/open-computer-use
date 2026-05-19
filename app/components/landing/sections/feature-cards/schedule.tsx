"use client"

import { motion } from "framer-motion"
import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"

/**
 * ScheduleVignette — single-column card vignette.
 *
 * A clean clock face with 12 hairline hour ticks. Hour & minute hands rotate
 * smoothly between three scheduled times: 9:00 → 14:00 → 23:00, looping every
 * ~9s. Below the clock, three dot indicators light up sequentially to signal
 * scheduled jobs running.
 *
 * The parent supplies the rounded card chrome, hairline border, sheen, and
 * mouse-tracking spotlight — this component returns ONLY vignette content.
 */
export function ScheduleVignette({ isMobile }: { isMobile: boolean }) {
  // Three scheduled times, in (hour, minute) form for the analog clock.
  const TIMES = [
    { h: 9, m: 0, label: "09:00" },
    { h: 14, m: 0, label: "14:00" },
    { h: 23, m: 0, label: "23:00" },
  ] as const

  const [activeIdx, setActiveIdx] = useState(0)

  useEffect(() => {
    if (isMobile) return
    const id = window.setInterval(() => {
      setActiveIdx(i => (i + 1) % TIMES.length)
    }, 3000)
    return () => window.clearInterval(id)
  }, [isMobile, TIMES.length])

  const active = TIMES[activeIdx]

  // Convert h/m to degrees. Clock hands point UP at 0deg, so add no offset
  // (rotate origin = bottom of the hand element, anchored at center).
  // Hour hand: 360deg / 12h = 30deg per hour, plus 0.5deg per minute.
  // Minute hand: 360deg / 60m = 6deg per minute.
  const hourDeg = ((active.h % 12) * 30 + active.m * 0.5)
  const minuteDeg = active.m * 6

  return (
    <>
      <div
        className={cn(
          "eyebrow text-[9px] uppercase tracking-[0.22em] text-muted-foreground/55 mb-3",
          "flex items-center gap-2"
        )}
      >
        <span className="tabular-nums text-foreground/40">03</span>
        <span className="h-px w-5 bg-border/60" aria-hidden />
        <span>AUTOMATION</span>
      </div>

      <div
        className={cn(
          "relative w-full overflow-hidden rounded-xl border border-foreground/[0.06] bg-foreground/[0.012]",
          isMobile ? "h-[180px]" : "h-[200px]"
        )}
      >
        {/* faint grid backdrop */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.3] pointer-events-none"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(127,127,127,0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(127,127,127,0.05) 1px, transparent 1px)",
            backgroundSize: "18px 18px",
          }}
        />

        {/* center: clock + label */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
          <div className="relative" style={{ width: 92, height: 92 }}>
            {/* outer dial */}
            <div className="absolute inset-0 rounded-full border border-foreground/15" />
            <div className="absolute inset-[6px] rounded-full border border-foreground/[0.05]" />

            {/* 12 hour ticks */}
            {Array.from({ length: 12 }).map((_, i) => {
              const angle = i * 30
              const isCardinal = i % 3 === 0
              return (
                <div
                  key={i}
                  className="absolute left-1/2 top-1/2 origin-top"
                  style={{
                    transform: `translate(-50%, -46px) rotate(${angle}deg) translateY(0)`,
                  }}
                >
                  <span
                    className={cn(
                      "block bg-foreground/15",
                      isCardinal ? "w-px h-2" : "w-px h-1"
                    )}
                  />
                </div>
              )
            })}

            {/* hour hand */}
            <motion.div
              className="absolute left-1/2 top-1/2 -translate-x-1/2 origin-bottom bg-foreground/65"
              style={{ width: 1.5, height: 22, marginTop: -22 }}
              animate={{ rotate: hourDeg }}
              transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            />
            {/* minute hand */}
            <motion.div
              className="absolute left-1/2 top-1/2 -translate-x-1/2 origin-bottom bg-foreground/45"
              style={{ width: 1, height: 32, marginTop: -32 }}
              animate={{ rotate: minuteDeg }}
              transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            />
            {/* center pin */}
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 size-1.5 rounded-full bg-foreground/70" />

            {/* sweeping minute halo to signal "active" */}
            <motion.div
              aria-hidden
              className="absolute inset-0 rounded-full"
              animate={{
                boxShadow: [
                  "0 0 0 0px rgba(16,185,129,0)",
                  "0 0 0 2px rgba(16,185,129,0.12)",
                  "0 0 0 0px rgba(16,185,129,0)",
                ],
              }}
              transition={{ duration: 1.2, ease: "easeOut", repeat: Infinity, repeatDelay: 1.6 }}
            />
          </div>

          {/* current time label */}
          <motion.div
            key={active.label}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="font-mono text-[10px] tabular-nums tracking-[0.16em] text-foreground/65"
          >
            {active.label}
          </motion.div>
        </div>
      </div>

      {/* job indicators */}
      <div className="mt-3 flex items-center gap-2.5 text-[9px] font-mono uppercase tracking-[0.18em] text-foreground/40">
        {TIMES.map((t, i) => (
          <span key={t.label} className="inline-flex items-center gap-1">
            <motion.span
              className="size-1.5 rounded-full"
              animate={{
                backgroundColor:
                  activeIdx === i
                    ? "rgba(16,185,129,0.75)"
                    : "rgba(127,127,127,0.25)",
                scale: activeIdx === i ? [1, 1.4, 1] : 1,
              }}
              transition={{ duration: 0.6 }}
            />
            <span
              className={cn(
                "tabular-nums",
                activeIdx === i ? "text-foreground/65" : "text-foreground/30"
              )}
            >
              {t.label}
            </span>
          </span>
        ))}
        <span className="ml-auto text-foreground/30">cron</span>
      </div>
    </>
  )
}
