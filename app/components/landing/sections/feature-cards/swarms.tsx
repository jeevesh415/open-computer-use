"use client"

import { motion } from "framer-motion"
import { GitMerge } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * SwarmsVignette — single-column card vignette.
 *
 * Three horizontal bars representing 3 agents working simultaneously, each
 * filling at a different speed (lp-swarm-stagger-1/2/3 globals). When all 3
 * finish (visually staggered), a connection line + "AGGREGATE" indicator
 * appears below.
 *
 * The parent supplies the rounded card chrome, hairline border, sheen, and
 * mouse-tracking spotlight — this component returns ONLY vignette content.
 */
export function SwarmsVignette({ isMobile }: { isMobile: boolean }) {
  const AGENTS = [
    { id: "AGENT 01", anim: "lp-swarm-stagger-1", baseDelay: 0 },
    { id: "AGENT 02", anim: "lp-swarm-stagger-2", baseDelay: 0.15 },
    { id: "AGENT 03", anim: "lp-swarm-stagger-3", baseDelay: 0.3 },
  ] as const

  return (
    <>
      <div
        className={cn(
          "eyebrow text-[9px] uppercase tracking-[0.22em] text-muted-foreground/55 mb-3",
          "flex items-center gap-2"
        )}
      >
        <span className="tabular-nums text-foreground/40">06</span>
        <span className="h-px w-5 bg-border/60" aria-hidden />
        <span>PARALLEL</span>
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

        {/* agent rows */}
        <div className="relative z-10 flex h-full flex-col justify-center gap-3 px-4 sm:px-5">
          {AGENTS.map((a, i) => (
            <div key={a.id} className="flex items-center gap-2">
              {/* agent label + status dot */}
              <div className="flex w-[58px] flex-shrink-0 items-center gap-1.5">
                <motion.span
                  className="size-1 rounded-full bg-foreground/35"
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{
                    duration: 1.4,
                    delay: a.baseDelay,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                />
                <span className="font-mono text-[7.5px] uppercase tracking-[0.18em] text-foreground/45">
                  {a.id}
                </span>
              </div>

              {/* bar track */}
              <div className="relative flex-1">
                <div className="h-1.5 rounded-full bg-foreground/[0.04] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-foreground/30"
                    style={
                      isMobile
                        ? { width: "100%" }
                        : {
                            animation: `${a.anim} 3s ease-in-out infinite alternate`,
                            animationDelay: `${a.baseDelay}s`,
                          }
                    }
                  />
                </div>
              </div>

              {/* tiny progress percentage placeholder */}
              <span className="w-7 text-right font-mono text-[7.5px] tabular-nums text-foreground/35">
                {[85, 65, 40][i]}%
              </span>
            </div>
          ))}

          {/* aggregate connector */}
          <div className="relative mt-1">
            {/* vertical hairlines from each row converging to center */}
            <svg
              aria-hidden
              className="absolute inset-x-0 -top-3 h-3 w-full overflow-visible"
              viewBox="0 0 100 12"
              preserveAspectRatio="none"
            >
              <motion.path
                d="M 18 0 L 18 6 L 50 6 L 50 12 M 50 6 L 82 6 L 82 0 M 50 0 L 50 6"
                fill="none"
                stroke="currentColor"
                strokeWidth={0.4}
                strokeLinecap="round"
                className="text-foreground/20"
                initial={{ pathLength: 0, opacity: 0 }}
                whileInView={{ pathLength: 1, opacity: 1 }}
                viewport={{ once: true, amount: 0.4 }}
                transition={{
                  duration: 0.9,
                  delay: isMobile ? 0 : 1.1,
                  ease: [0.22, 1, 0.36, 1],
                }}
              />
            </svg>

            {/* aggregate pill */}
            <motion.div
              className="mx-auto inline-flex items-center gap-1.5 rounded-full border border-foreground/15 bg-background/80 px-2 py-[3px] font-mono text-[8px] uppercase tracking-[0.18em] text-foreground/65 backdrop-blur-sm"
              initial={{ opacity: 0, y: 4 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.4 }}
              transition={{
                duration: 0.5,
                delay: isMobile ? 0 : 1.6,
                ease: [0.22, 1, 0.36, 1],
              }}
              style={{ display: "flex", margin: "0 auto", width: "fit-content" }}
            >
              <GitMerge className="size-2.5 text-foreground/55" strokeWidth={1.8} />
              <span>AGGREGATE</span>
              <span className="text-foreground/30">·</span>
              <span className="text-foreground/45">3 / 3</span>
            </motion.div>
          </div>
        </div>
      </div>

      {/* stat strip */}
      <div className="mt-3 flex items-center gap-2.5 text-[9px] font-mono uppercase tracking-[0.18em] text-foreground/40">
        <span className="tabular-nums text-foreground/60">3× THROUGHPUT</span>
        <span className="ml-auto text-foreground/35">parallel</span>
      </div>
    </>
  )
}
