"use client"

import { AnimatePresence, motion } from "motion/react"
import { type ReactNode, useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import { FloatingThumbnails } from "@/app/components/chat/floating-thumbnails"

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

  useEffect(() => {
    if (isLoading) return
    const elapsed = Date.now() - mountedAt
    const remaining = Math.max(0, duration - elapsed)
    const t = setTimeout(() => setShow(false), remaining)
    return () => clearTimeout(t)
  }, [isLoading, mountedAt, duration])

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
            {/* Floating thumbnails — boosted visibility */}
            <div className="absolute inset-0 opacity-[1.4]">
              <FloatingThumbnails visible />
            </div>

            {/* Center text */}
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.85, ease: EASE, delay: 0.05 }}
              className="relative z-10 px-8 text-center text-[clamp(36px,5.5vw,60px)] font-semibold tracking-[-0.03em] text-foreground text-shine"
            >
              {title}
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.75, ease: EASE, delay: 0.25 }}
              className="relative z-10 mt-3 max-w-md px-8 text-center text-base leading-relaxed text-muted-foreground"
            >
              {description}
            </motion.p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
