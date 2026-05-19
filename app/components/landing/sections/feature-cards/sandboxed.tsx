"use client"

import { motion } from "framer-motion"
import { Shield } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * SandboxedVignette — single-column card vignette.
 *
 * Three concentric rounded-square frames (each smaller, hairline border) fade
 * in from outside-in on viewport entry. The innermost frame shows a small
 * Shield "task". Continuously, a subtle pulse ripples FROM the innermost
 * OUTWARD, hitting each boundary in sequence.
 *
 * The parent supplies the rounded card chrome, hairline border, sheen, and
 * mouse-tracking spotlight — this component returns ONLY vignette content.
 */
export function SandboxedVignette({ isMobile }: { isMobile: boolean }) {
  // Frame sizes (px) from outermost to innermost
  const frames = [
    { size: 120, label: "VM" },
    { size: 84, label: "Container" },
    { size: 52, label: "Task" },
  ] as const

  return (
    <>
      <div
        className={cn(
          "eyebrow text-[9px] uppercase tracking-[0.22em] text-muted-foreground/55 mb-3",
          "flex items-center gap-2"
        )}
      >
        <span className="tabular-nums text-foreground/40">04</span>
        <span className="h-px w-5 bg-border/60" aria-hidden />
        <span>ISOLATION</span>
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

        {/* concentric chambers — centered */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="relative" style={{ width: 130, height: 130 }}>
            {frames.map((f, i) => {
              // Outer frames fade in first (delay = 0, 0.15, 0.3 from outside in).
              const isInnermost = i === frames.length - 1
              return (
                <motion.div
                  key={i}
                  className={cn(
                    "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg border",
                    isInnermost
                      ? "border-foreground/25 bg-background/70"
                      : i === 1
                        ? "border-foreground/15"
                        : "border-foreground/12 border-dashed"
                  )}
                  style={{ width: f.size, height: f.size }}
                  initial={{ opacity: 0, scale: 0.92 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true, amount: 0.4 }}
                  transition={{
                    duration: 0.55,
                    delay: isMobile ? 0 : i * 0.15,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                >
                  {/* tiny corner labels on outer frames */}
                  {!isInnermost && (
                    <span className="absolute -top-2 left-2 bg-background px-1 font-mono text-[7.5px] uppercase tracking-[0.18em] text-foreground/35">
                      {f.label}
                    </span>
                  )}
                </motion.div>
              )
            })}

            {/* innermost: shield icon as the protected "task" */}
            <motion.div
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex size-8 items-center justify-center rounded-md border border-foreground/20 bg-foreground/[0.04]"
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true, amount: 0.4 }}
              transition={{ duration: 0.4, delay: isMobile ? 0 : 0.5 }}
            >
              <Shield className="size-3.5 text-foreground/70" strokeWidth={1.6} />
            </motion.div>

            {/* outward ripple — emitted from the innermost, expanding past each boundary.
                We render 2 staggered rings so the loop never has dead air. */}
            {!isMobile && (
              <>
                <motion.div
                  aria-hidden
                  className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-foreground/25"
                  initial={{ width: 32, height: 32, opacity: 0 }}
                  animate={{
                    width: [32, 52, 84, 120],
                    height: [32, 52, 84, 120],
                    opacity: [0, 0.7, 0.45, 0],
                  }}
                  transition={{
                    duration: 3,
                    times: [0, 0.18, 0.55, 1],
                    repeat: Infinity,
                    ease: "easeOut",
                  }}
                />
                <motion.div
                  aria-hidden
                  className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-foreground/20"
                  initial={{ width: 32, height: 32, opacity: 0 }}
                  animate={{
                    width: [32, 52, 84, 120],
                    height: [32, 52, 84, 120],
                    opacity: [0, 0.5, 0.3, 0],
                  }}
                  transition={{
                    duration: 3,
                    delay: 1.5,
                    times: [0, 0.18, 0.55, 1],
                    repeat: Infinity,
                    ease: "easeOut",
                  }}
                />
              </>
            )}
          </div>
        </div>
      </div>

      {/* stat strip */}
      <div className="mt-3 flex items-center gap-2.5 text-[9px] font-mono uppercase tracking-[0.18em] text-foreground/40">
        <span className="tabular-nums text-foreground/60">3 LAYERS · ZERO LEAKS</span>
        <span className="ml-auto text-foreground/35">sandbox</span>
      </div>
    </>
  )
}
