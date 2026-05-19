"use client"

import { motion } from "framer-motion"
import { Check, X, MousePointer2, RotateCw } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * SelfCorrectingVignette — hero card vignette (spans 2 cols).
 *
 * Continuously animates a 4-stage retry loop: click → error → retry → success.
 * A small cursor sweeps across the stages, the error flashes a subtle red pulse,
 * and the success node pops a check on each completed cycle. Below: a hardcoded
 * "RECOVERED 3,142 TIMES" Geist Mono caps stat strip.
 *
 * The parent supplies the rounded card chrome, hairline border, sheen, and
 * mouse-tracking spotlight — this component returns ONLY vignette content.
 */
export function SelfCorrectingVignette({ isMobile }: { isMobile: boolean }) {
  return (
    <>
      <div
        className={cn(
          "eyebrow text-[9px] uppercase tracking-[0.22em] text-muted-foreground/55 mb-3",
          "flex items-center gap-2"
        )}
      >
        <span className="tabular-nums text-foreground/40">01</span>
        <span className="h-px w-5 bg-border/60" aria-hidden />
        <span>RESILIENCE</span>
      </div>

      <div
        className={cn(
          "relative w-full overflow-hidden rounded-xl border border-foreground/[0.06] bg-foreground/[0.012]",
          isMobile ? "h-[140px]" : "h-[180px]"
        )}
      >
        {/* hairline grid backdrop — premium scaffold */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.35] pointer-events-none"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(127,127,127,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(127,127,127,0.06) 1px, transparent 1px)",
            backgroundSize: "20px 20px",
          }}
        />

        {/* connecting hairline track between the 4 nodes */}
        <div
          aria-hidden
          className="absolute left-[8%] right-[8%] top-1/2 h-px bg-gradient-to-r from-transparent via-foreground/12 to-transparent"
        />

        {/* nodes */}
        <div className="relative h-full flex items-center justify-between px-[6%]">
          {/* CLICK */}
          <Stage label="CLICK" delay={0}>
            <MousePointer2 className="size-3 text-foreground/55" strokeWidth={1.5} />
          </Stage>

          {/* ERROR */}
          <Stage label="ERROR" delay={1.0} tone="error">
            <X className="size-3 text-foreground/45" strokeWidth={1.8} />
          </Stage>

          {/* RETRY */}
          <Stage label="RETRY" delay={2.0} spin>
            <RotateCw className="size-3 text-foreground/55" strokeWidth={1.5} />
          </Stage>

          {/* SUCCESS */}
          <Stage label="SUCCESS" delay={3.0} tone="success">
            <Check className="size-3 text-foreground/65" strokeWidth={2} />
          </Stage>
        </div>

        {/* sweeping cursor — moves through the stages on a 4s loop */}
        {!isMobile && (
          <motion.div
            aria-hidden
            className="absolute top-1/2 -translate-y-1/2 pointer-events-none"
            initial={{ left: "8%", opacity: 0 }}
            animate={{
              left: ["8%", "8%", "36%", "36%", "64%", "64%", "92%", "92%", "8%"],
              opacity: [0, 1, 1, 1, 1, 1, 1, 0, 0],
            }}
            transition={{
              duration: 4,
              times: [0, 0.05, 0.25, 0.3, 0.5, 0.55, 0.78, 0.85, 1],
              ease: "linear",
              repeat: Infinity,
            }}
          >
            <div className="relative -translate-x-1/2 -translate-y-2">
              <MousePointer2
                className="size-3 text-foreground/85 drop-shadow-[0_1px_2px_rgba(0,0,0,0.25)]"
                strokeWidth={1.6}
                fill="currentColor"
              />
            </div>
          </motion.div>
        )}
      </div>

      {/* stat strip */}
      <div
        className={cn(
          "mt-3 flex items-center gap-2.5 text-[9px] font-mono uppercase tracking-[0.18em] text-foreground/40"
        )}
      >
        <span className="inline-block size-1 rounded-full bg-emerald-500/60 animate-pulse" />
        <span className="tabular-nums text-foreground/60">RECOVERED 3,142 TIMES</span>
        <span className="ml-auto text-foreground/25">·</span>
        <span className="text-foreground/35">live</span>
      </div>
    </>
  )
}

function Stage({
  label,
  delay,
  tone,
  spin,
  children,
}: {
  label: string
  delay: number
  tone?: "error" | "success"
  spin?: boolean
  children: React.ReactNode
}) {
  // Pulse window: each stage is "active" for ~0.8s of the 4s cycle.
  // delay = the stage's start offset within the cycle.
  return (
    <div className="relative flex flex-col items-center gap-1.5">
      <motion.div
        className={cn(
          "relative flex size-7 items-center justify-center rounded-md border bg-background/80 backdrop-blur-sm",
          tone === "error"
            ? "border-rose-500/25"
            : tone === "success"
              ? "border-emerald-500/25"
              : "border-foreground/12"
        )}
        animate={{
          scale: [1, 1, 1.12, 1, 1],
          borderColor:
            tone === "error"
              ? [
                  "rgba(244,63,94,0.18)",
                  "rgba(244,63,94,0.18)",
                  "rgba(244,63,94,0.55)",
                  "rgba(244,63,94,0.18)",
                  "rgba(244,63,94,0.18)",
                ]
              : tone === "success"
                ? [
                    "rgba(16,185,129,0.18)",
                    "rgba(16,185,129,0.18)",
                    "rgba(16,185,129,0.55)",
                    "rgba(16,185,129,0.18)",
                    "rgba(16,185,129,0.18)",
                  ]
                : [
                    "rgba(127,127,127,0.12)",
                    "rgba(127,127,127,0.12)",
                    "rgba(127,127,127,0.35)",
                    "rgba(127,127,127,0.12)",
                    "rgba(127,127,127,0.12)",
                  ],
        }}
        transition={{
          duration: 4,
          delay,
          repeat: Infinity,
          repeatDelay: 0,
          times: [0, 0.22, 0.27, 0.32, 1],
          ease: "easeInOut",
        }}
      >
        {/* pulse ring on activation */}
        <motion.span
          aria-hidden
          className={cn(
            "absolute inset-0 rounded-md",
            tone === "error"
              ? "ring-1 ring-rose-500/30"
              : tone === "success"
                ? "ring-1 ring-emerald-500/30"
                : "ring-1 ring-foreground/15"
          )}
          animate={{ scale: [1, 1, 1.6, 1.6], opacity: [0, 0, 0.7, 0] }}
          transition={{
            duration: 4,
            delay,
            repeat: Infinity,
            times: [0, 0.22, 0.32, 0.42],
            ease: "easeOut",
          }}
        />
        <motion.div
          animate={spin ? { rotate: [0, 0, 360, 360, 360] } : undefined}
          transition={
            spin
              ? {
                  duration: 4,
                  delay,
                  repeat: Infinity,
                  times: [0, 0.2, 0.32, 0.5, 1],
                  ease: "easeInOut",
                }
              : undefined
          }
        >
          {children}
        </motion.div>
      </motion.div>
      <span className="text-[8px] font-mono uppercase tracking-[0.15em] text-foreground/30">
        {label}
      </span>
    </div>
  )
}
