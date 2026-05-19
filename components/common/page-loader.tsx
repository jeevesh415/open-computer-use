"use client"

import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { type ReactNode, useEffect, useState } from "react"
import { cn } from "@/lib/utils"

const EASE = [0.16, 1, 0.3, 1] as const
const DEFAULT_DURATION_MS = 2800

type PageLoaderProps = {
  title: string
  description: string
  children: ReactNode
  isLoading?: boolean
  duration?: number
  className?: string
}

/* ── Mobile detection ── */
function useIsMobile(breakpoint = 640) {
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`)
    setIsMobile(mq.matches)
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [breakpoint])
  return isMobile
}

export function PageLoader({
  title,
  description,
  children,
  isLoading = false,
  duration = DEFAULT_DURATION_MS,
  className,
}: PageLoaderProps) {
  const [show, setShow] = useState(true)
  const [mountedAt] = useState(() => Date.now())
  const reducedMotion = useReducedMotion()
  const isMobile = useIsMobile()

  useEffect(() => {
    if (reducedMotion) {
      setShow(false)
      return
    }
    if (isLoading) return
    const elapsed = Date.now() - mountedAt
    const remaining = Math.max(0, duration - elapsed)
    const t = setTimeout(() => setShow(false), remaining)
    return () => clearTimeout(t)
  }, [isLoading, mountedAt, duration, reducedMotion])

  if (reducedMotion) {
    return <div className={cn("relative h-full w-full", className)}>{children}</div>
  }

  return (
    <div className={cn("relative h-full w-full", className)}>
      {children}

      <AnimatePresence>
        {show && (
          <motion.div
            key="page-loader"
            exit={{ opacity: 0, transition: { duration: 0.25, ease: EASE } }}
            className="pointer-events-none fixed inset-0 z-[100] flex flex-col items-center justify-center bg-background"
          >
            {/* Ambient glow background — pure CSS, zero network requests.
                The chat homepage is the only surface that gets the floating
                thumbnails; loaders stay quiet. */}
            <LoaderAmbient />

            {/* Center text */}
            <motion.h1
              initial={{ opacity: 0, y: isMobile ? 12 : 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: isMobile ? 0.6 : 0.85,
                ease: EASE,
                delay: isMobile ? 0.1 : 0.05,
              }}
              className="relative z-10 px-8 text-center text-[clamp(28px,5.5vw,60px)] font-semibold tracking-[-0.03em] text-foreground text-shine"
            >
              {title}
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: isMobile ? 8 : 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: isMobile ? 0.5 : 0.75,
                ease: EASE,
                delay: isMobile ? 0.25 : 0.25,
              }}
              className="relative z-10 mt-3 max-w-md px-8 text-center text-sm sm:text-base leading-relaxed text-muted-foreground"
            >
              {description}
            </motion.p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Loader ambient background — pure CSS, zero network requests, GPU-accelerated
 * Three soft radial gradients that drift on independent orbits.
 * Uses CSS @keyframes with translateX/Y only (compositor-friendly).
 * ────────────────────────────────────────────────────────────────────────── */

function LoaderAmbient() {
  return (
    <div className="absolute inset-0 overflow-hidden">
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @keyframes pl-orb-1{
              0%,100%{transform:translate(0,0) scale(1)}
              33%{transform:translate(12px,-18px) scale(1.05)}
              66%{transform:translate(-8px,14px) scale(0.97)}
            }
            @keyframes pl-orb-2{
              0%,100%{transform:translate(0,0) scale(1)}
              40%{transform:translate(-16px,10px) scale(1.03)}
              70%{transform:translate(10px,-12px) scale(0.98)}
            }
            @keyframes pl-orb-3{
              0%,100%{transform:translate(0,0) scale(1)}
              50%{transform:translate(14px,16px) scale(1.04)}
            }
          `,
        }}
      />

      {/* Orb 1 — warm accent, top-left drift */}
      <div
        className="absolute -left-[20%] -top-[10%] h-[60vh] w-[60vh] rounded-full opacity-[0.08] dark:opacity-[0.06]"
        style={{
          background: "radial-gradient(circle, hsl(var(--foreground)) 0%, transparent 70%)",
          animation: "pl-orb-1 8s ease-in-out infinite",
          willChange: "transform",
        }}
      />

      {/* Orb 2 — cool accent, bottom-right drift */}
      <div
        className="absolute -bottom-[15%] -right-[15%] h-[55vh] w-[55vh] rounded-full opacity-[0.06] dark:opacity-[0.05]"
        style={{
          background: "radial-gradient(circle, hsl(var(--foreground)) 0%, transparent 70%)",
          animation: "pl-orb-2 10s ease-in-out infinite",
          animationDelay: "-3s",
          willChange: "transform",
        }}
      />

      {/* Orb 3 — center, very subtle */}
      <div
        className="absolute left-[20%] top-[30%] h-[45vh] w-[45vh] rounded-full opacity-[0.04] dark:opacity-[0.03]"
        style={{
          background: "radial-gradient(circle, hsl(var(--foreground)) 0%, transparent 65%)",
          animation: "pl-orb-3 12s ease-in-out infinite",
          animationDelay: "-5s",
          willChange: "transform",
        }}
      />

      {/* Soft vignette to blend edges */}
      <div
        className="absolute inset-0"
        style={{
          background: "radial-gradient(ellipse 80% 70% at 50% 50%, transparent 40%, var(--background) 85%)",
        }}
      />
    </div>
  )
}
