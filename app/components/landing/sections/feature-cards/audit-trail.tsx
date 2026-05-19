"use client"

import { motion } from "framer-motion"
import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"

/**
 * AuditTrailVignette — tall card vignette (1 col, spans 2 rows).
 *
 * A fan-stack of 5 screenshot cards that begin tightly stacked at slight
 * angles. On hover, the cards fan outward — each translates+rotates further
 * apart so all become visible. Above the stack, a "TIMESTAMP · 14:32:NN"
 * Geist Mono caps pill ticks the seconds in real time.
 *
 * The parent supplies the rounded card chrome, hairline border, sheen, and
 * mouse-tracking spotlight — this component returns ONLY vignette content.
 */
export function AuditTrailVignette({ isMobile }: { isMobile: boolean }) {
  const [seconds, setSeconds] = useState(32)
  const [hovered, setHovered] = useState(false)

  // Tick the seconds in the timestamp pill every 1s — gives the audit trail
  // a "live" feel even when the user isn't interacting.
  useEffect(() => {
    if (isMobile) return
    const id = window.setInterval(() => {
      setSeconds(s => (s + 1) % 60)
    }, 1000)
    return () => window.clearInterval(id)
  }, [isMobile])

  // 5 cards. Tighter stack baseline; bigger fan when hovered.
  const cards = [0, 1, 2, 3, 4]

  return (
    <>
      <div
        className={cn(
          "eyebrow text-[9px] uppercase tracking-[0.22em] text-muted-foreground/55 mb-3",
          "flex items-center gap-2"
        )}
      >
        <span className="tabular-nums text-foreground/40">02</span>
        <span className="h-px w-5 bg-border/60" aria-hidden />
        <span>TRANSPARENCY</span>
      </div>

      {/* timestamp pill */}
      <div className="mb-3 flex items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border border-foreground/10 bg-foreground/[0.025]",
            "px-2 py-[3px] font-mono text-[8.5px] uppercase tracking-[0.16em] text-foreground/55"
          )}
        >
          <span className="size-1 rounded-full bg-emerald-500/70 animate-pulse" />
          <span>TIMESTAMP</span>
          <span className="text-foreground/25">·</span>
          <span className="tabular-nums text-foreground/70">
            14:32:{String(seconds).padStart(2, "0")}
          </span>
        </span>
      </div>

      {/* fan-stack */}
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className={cn(
          "relative w-full overflow-hidden rounded-xl border border-foreground/[0.06] bg-foreground/[0.012]",
          // tall vignette to fill the 2-row slot
          isMobile ? "h-[260px]" : "h-[340px]"
        )}
      >
        {/* faint hairline grid backdrop */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.3] pointer-events-none"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(127,127,127,0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(127,127,127,0.05) 1px, transparent 1px)",
            backgroundSize: "18px 18px",
          }}
        />

        {/* stacked cards container — centered */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="relative" style={{ width: 168, height: 200 }}>
            {cards.map(i => {
              // Stacked baseline: tight, with ±2deg alternating rotation, 8px offset.
              const baseRot = (i - 2) * 2 // -4, -2, 0, 2, 4 deg
              const baseX = (i - 2) * 8 // -16, -8, 0, 8, 16 px
              const baseY = (i - 2) * 4

              // Fan: spread further apart, exaggerate rotation.
              const fanRot = (i - 2) * 6
              const fanX = (i - 2) * 38
              const fanY = Math.abs(i - 2) * -6

              const isHover = hovered && !isMobile

              return (
                <motion.div
                  key={i}
                  className={cn(
                    "absolute left-1/2 top-1/2 rounded-md border border-foreground/12 bg-background/90 shadow-[0_2px_8px_rgba(0,0,0,0.06)] backdrop-blur-sm",
                    "dark:bg-background/70 dark:shadow-[0_2px_8px_rgba(0,0,0,0.3)]"
                  )}
                  style={{ width: 130, height: 88, marginLeft: -65, marginTop: -44, zIndex: i + 1 }}
                  initial={{ x: baseX, y: baseY, rotate: baseRot, opacity: 0 }}
                  animate={{
                    x: isHover ? fanX : baseX,
                    y: isHover ? fanY : baseY,
                    rotate: isHover ? fanRot : baseRot,
                    opacity: 1,
                  }}
                  transition={{
                    duration: 0.55,
                    ease: [0.22, 1, 0.36, 1],
                    delay: hovered ? i * 0.04 : (4 - i) * 0.04,
                  }}
                >
                  {/* card chrome */}
                  <div className="flex h-full flex-col gap-1.5 p-2">
                    {/* tiny header w/ traffic dots */}
                    <div className="flex items-center gap-1">
                      <span className="size-[4px] rounded-full bg-foreground/15" />
                      <span className="size-[4px] rounded-full bg-foreground/15" />
                      <span className="size-[4px] rounded-full bg-foreground/15" />
                      <span className="ml-auto text-[6px] font-mono text-foreground/25 tabular-nums">
                        {String(i + 1).padStart(2, "0")}/05
                      </span>
                    </div>
                    {/* hairline divider */}
                    <span className="h-px w-full bg-foreground/8" />
                    {/* content bars */}
                    <div className="flex flex-1 flex-col justify-center gap-1.5">
                      <div className="h-[3px] w-[78%] rounded-full bg-foreground/12" />
                      <div className="h-[3px] w-[55%] rounded-full bg-foreground/10" />
                      <div className="h-[3px] w-[68%] rounded-full bg-foreground/10" />
                    </div>
                  </div>
                </motion.div>
              )
            })}
          </div>
        </div>

        {/* hover affordance hint — tiny mono caps at bottom, fades on hover */}
        <motion.div
          className="absolute inset-x-0 bottom-2 flex justify-center pointer-events-none"
          animate={{ opacity: hovered ? 0 : 1 }}
          transition={{ duration: 0.3 }}
        >
          <span className="font-mono text-[7.5px] uppercase tracking-[0.2em] text-foreground/30">
            {isMobile ? "5 SCREENSHOTS · TAP TO INSPECT" : "HOVER TO FAN OUT"}
          </span>
        </motion.div>
      </div>

      {/* stat strip */}
      <div className="mt-3 flex items-center gap-2.5 text-[9px] font-mono uppercase tracking-[0.18em] text-foreground/40">
        <span className="tabular-nums text-foreground/60">EVERY STEP RECORDED</span>
        <span className="ml-auto text-foreground/25">·</span>
        <span className="text-foreground/35">replay</span>
      </div>
    </>
  )
}
