"use client"

import { motion } from "framer-motion"
import { Trophy } from "lucide-react"
import { CoastyIcon } from "@/components/icons/coasty"
import { cn } from "@/lib/utils"

/**
 * BenchmarkVignette — hero card vignette (spans 2 cols).
 *
 * Animated bar chart with podium feel. 4 bars build sequentially with
 * i*0.15 stagger:
 *   - Coasty 82% (signature: gradient sweep, tiny CoastyIcon, "01" badge)
 *   - Agent S3 73%
 *   - GPT-5 68%
 *   - GPT-4o 54%
 *
 * At top: a small "OSWORLD · #1" eyebrow with a Trophy icon.
 *
 * The parent supplies the rounded card chrome, hairline border, sheen, and
 * mouse-tracking spotlight — this component returns ONLY vignette content.
 */
export function BenchmarkVignette({ isMobile }: { isMobile: boolean }) {
  const ROWS: { name: string; pct: number; leader?: boolean }[] = [
    { name: "Coasty", pct: 82, leader: true },
    { name: "Agent S3", pct: 73 },
    { name: "GPT-5", pct: 68 },
    { name: "GPT-4o", pct: 54 },
  ]

  // Width baseline — leader sits a bit shy of the right edge so its score has room.
  const AXIS_MAX = 92

  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.22em] text-muted-foreground/55">
          <span className="tabular-nums text-foreground/40">05</span>
          <span className="h-px w-5 bg-border/60" aria-hidden />
          <span>LEADERSHIP</span>
        </span>
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-foreground/12 bg-foreground/[0.025] px-2 py-[3px] font-mono text-[8.5px] uppercase tracking-[0.18em] text-foreground/55">
          <Trophy className="size-2.5 text-foreground/65" strokeWidth={1.8} />
          <span>OSWORLD</span>
          <span className="text-foreground/25">·</span>
          <span className="text-foreground/75">#1</span>
        </span>
      </div>

      <div
        className={cn(
          "relative w-full overflow-hidden rounded-xl border border-foreground/[0.06] bg-foreground/[0.012]",
          isMobile ? "h-[180px]" : "h-[210px]"
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

        {/* axis ticks @ 25/50/75% — subtle vertical hairlines */}
        <div className="absolute inset-y-3 inset-x-3 pointer-events-none">
          {[0.25, 0.5, 0.75].map(t => (
            <span
              key={t}
              aria-hidden
              className="absolute inset-y-0 w-px bg-foreground/[0.04]"
              style={{ left: `${t * (AXIS_MAX / 100) * 100}%` }}
            />
          ))}
        </div>

        {/* bars */}
        <div className="relative z-10 flex h-full flex-col justify-center gap-2.5 px-4 sm:px-5">
          {ROWS.map((r, i) => {
            const widthPct = (r.pct / AXIS_MAX) * 100
            return (
              <div key={r.name} className="flex items-center gap-2.5">
                {/* leading rank+name column */}
                <div className="flex w-[88px] flex-shrink-0 items-center gap-1.5">
                  {r.leader ? (
                    <span className="inline-flex h-4 w-5 items-center justify-center rounded-sm bg-foreground text-[8px] font-mono font-bold tracking-tight text-background">
                      01
                    </span>
                  ) : (
                    <span className="inline-flex h-4 w-5 items-center justify-center font-mono text-[8.5px] tabular-nums text-foreground/30">
                      0{i + 1}
                    </span>
                  )}
                  <span
                    className={cn(
                      "flex items-center gap-1 truncate text-[10px] font-medium",
                      r.leader ? "text-foreground" : "text-foreground/55"
                    )}
                  >
                    {r.leader && <CoastyIcon className="size-2.5 text-foreground" />}
                    {r.name}
                  </span>
                </div>

                {/* bar track */}
                <div className="relative flex-1">
                  <div
                    className={cn(
                      "h-2 rounded-full overflow-hidden",
                      r.leader
                        ? "bg-foreground/[0.04] ring-1 ring-foreground/10"
                        : "bg-foreground/[0.04]"
                    )}
                  >
                    <motion.div
                      className={cn(
                        "h-full rounded-full",
                        r.leader
                          ? "bg-gradient-to-r from-foreground/85 via-foreground/65 to-foreground/85 bg-[length:200%_100%]"
                          : "bg-foreground/22"
                      )}
                      initial={{ width: 0 }}
                      whileInView={{ width: `${widthPct}%` }}
                      viewport={{ once: true, amount: 0.3 }}
                      transition={{
                        duration: isMobile ? 0 : 1.1,
                        delay: isMobile ? 0 : i * 0.15,
                        ease: [0.22, 1, 0.36, 1],
                      }}
                      style={
                        r.leader && !isMobile
                          ? { animation: "lp-bench-bar-sweep 3.2s ease-in-out infinite" }
                          : undefined
                      }
                    />
                  </div>
                </div>

                {/* score */}
                <motion.span
                  className={cn(
                    "w-9 text-right font-mono text-[10px] tabular-nums",
                    r.leader ? "text-foreground" : "text-foreground/45"
                  )}
                  initial={{ opacity: 0 }}
                  whileInView={{ opacity: 1 }}
                  viewport={{ once: true, amount: 0.3 }}
                  transition={{
                    duration: 0.4,
                    delay: isMobile ? 0 : i * 0.15 + 0.5,
                  }}
                >
                  {r.pct.toFixed(1)}
                </motion.span>
              </div>
            )
          })}
        </div>

        {/* bottom-right axis cap */}
        <div className="absolute bottom-2 right-3 font-mono text-[7.5px] uppercase tracking-[0.18em] text-foreground/25">
          % SUCCESS · OSWORLD
        </div>
      </div>

      {/* stat strip */}
      <div className="mt-3 flex items-center gap-2.5 text-[9px] font-mono uppercase tracking-[0.18em] text-foreground/40">
        <span className="inline-block size-1 rounded-full bg-foreground/50" />
        <span className="tabular-nums text-foreground/60">+9.4 PTS OVER #2</span>
        <span className="ml-auto text-foreground/35">verified</span>
      </div>

      {/* gradient sweep keyframe — scoped to this component via plain <style> tag */}
      <style>{`
        @keyframes lp-bench-bar-sweep {
          0%   { background-position: 200% 50%; }
          100% { background-position: -100% 50%; }
        }
      `}</style>
    </>
  )
}
