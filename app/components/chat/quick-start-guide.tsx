"use client"

import { useState, useEffect, useCallback } from "react"
import { motion, AnimatePresence } from "motion/react"
import Link from "next/link"
import { ChevronLeft, ChevronRight, X } from "lucide-react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { useGuideStore } from "@/lib/guide-store"
import { cn } from "@/lib/utils"

interface Slide {
  id: string
  eyebrow: string
  title: string
  description: string
  image: string
  imageAlt: string
  imageMode: "cover" | "contain"
  cta?: { text: string; href: string }
}

const slides: Slide[] = [
  {
    id: "welcome",
    eyebrow: "Welcome",
    title: "Meet Coasty",
    description: "An AI agent that controls a real computer to research, browse, type, and complete tasks for you — all from a chat.",
    image: "/demo-screenshot.png",
    imageAlt: "Coasty in action",
    imageMode: "cover",
  },
  {
    id: "desktop",
    eyebrow: "Desktop",
    title: "Native on Mac and Windows",
    description: "Run Coasty as a sleek floating overlay on your own machine. It drives your browser, types for you, and asks before sensitive actions.",
    image: "/demo-screenshot.png",
    imageAlt: "Coasty desktop app",
    imageMode: "cover",
    cta: { text: "Download for desktop", href: "/download" },
  },
  {
    id: "mobile",
    eyebrow: "Mobile",
    title: "Control it from anywhere",
    description: "Send a task from your phone, watch screenshots stream live, and approve actions on the go.",
    image: "/demo-screenshot-mobile.png",
    imageAlt: "Coasty on mobile",
    imageMode: "contain",
  },
  {
    id: "swarms",
    eyebrow: "Swarms",
    title: "Run many agents in parallel",
    description: "Spin up multiple agents to tackle big tasks at once. Each works independently, then results merge into one clean report.",
    image: "/demo-screenshot.png",
    imageAlt: "Coasty swarms",
    imageMode: "cover",
    cta: { text: "Try swarms", href: "/swarms" },
  },
]

export function QuickStartGuide() {
  const dismissed = useGuideStore((s) => s.dismissed)
  const hydrated = useGuideStore((s) => s.hydrated)
  const hydrate = useGuideStore((s) => s.hydrate)
  const toggle = useGuideStore((s) => s.toggle)
  const [active, setActive] = useState(0)

  useEffect(() => {
    hydrate()
  }, [hydrate])

  const open = hydrated && !dismissed
  const total = slides.length
  const slide = slides[active]
  const isLast = active === total - 1

  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      // Sync dismissed flag with dialog open state: dismissed === !open
      if (newOpen === dismissed) toggle()
      if (!newOpen) setActive(0)
    },
    [dismissed, toggle],
  )

  const goNext = () => {
    if (isLast) {
      handleOpenChange(false)
    } else {
      setActive((a) => Math.min(total - 1, a + 1))
    }
  }
  const goPrev = () => setActive((a) => Math.max(0, a - 1))

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        hasCloseButton={false}
        className="w-[calc(100%-2rem)] max-w-[640px] gap-0 overflow-hidden rounded-2xl border border-black/[0.08] bg-background p-0 shadow-2xl dark:border-white/[0.08] sm:max-w-[640px]"
      >
        <DialogTitle className="sr-only">{slide.title}</DialogTitle>

        {/* Close */}
        <button
          type="button"
          onClick={() => handleOpenChange(false)}
          aria-label="Close"
          className="absolute right-3 top-3 z-20 flex size-7 items-center justify-center rounded-full bg-foreground/[0.06] text-foreground/45 backdrop-blur-md transition-colors duration-200 hover:bg-foreground/[0.12] hover:text-foreground/80"
        >
          <X className="size-3.5" strokeWidth={2.5} />
        </button>

        {/* Image */}
        <div className="relative aspect-[16/10] w-full overflow-hidden border-b border-black/[0.06] bg-gradient-to-br from-neutral-50 to-neutral-100 dark:border-white/[0.06] dark:from-neutral-900 dark:to-neutral-950">
          <AnimatePresence mode="wait">
            <motion.div
              key={slide.id}
              initial={{ opacity: 0, scale: 1.015 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.985 }}
              transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
              className="absolute inset-0"
            >
              {slide.imageMode === "contain" ? (
                <div className="flex h-full w-full items-center justify-center p-6">
                  <img
                    src={slide.image}
                    alt={slide.imageAlt}
                    className="max-h-full max-w-full rounded-[2rem] object-contain ring-1 ring-black/[0.06] drop-shadow-[0_12px_28px_rgba(0,0,0,0.22)] dark:ring-white/[0.08]"
                  />
                </div>
              ) : (
                <img
                  src={slide.image}
                  alt={slide.imageAlt}
                  className="absolute inset-0 h-full w-full object-cover"
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Content */}
        <div className="flex min-h-[170px] flex-col px-7 pb-2 pt-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={slide.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
              className="flex flex-col gap-2"
            >
              <span className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-foreground/40">
                {slide.eyebrow}
              </span>
              <h2 className="text-[20px] font-semibold leading-tight tracking-[-0.015em] text-foreground">
                {slide.title}
              </h2>
              <p className="max-w-[44ch] text-[13.5px] leading-relaxed text-foreground/55">
                {slide.description}
              </p>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-7 pb-6 pt-4">
          {/* Dots */}
          <div className="flex items-center gap-1.5">
            {slides.map((s, i) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setActive(i)}
                aria-label={`Slide ${i + 1}`}
                className={cn(
                  "h-1.5 rounded-full transition-all duration-300 ease-out",
                  i === active
                    ? "w-5 bg-foreground/70"
                    : "w-1.5 bg-foreground/20 hover:bg-foreground/40",
                )}
              />
            ))}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1.5">
            {slide.cta && (
              <Link
                href={slide.cta.href}
                onClick={() => handleOpenChange(false)}
                className="rounded-full px-3 py-1.5 text-[12.5px] font-medium text-foreground/55 transition-colors duration-200 hover:text-foreground"
              >
                {slide.cta.text}
              </Link>
            )}
            {active > 0 && (
              <button
                type="button"
                onClick={goPrev}
                aria-label="Previous"
                className="flex size-8 items-center justify-center rounded-full text-foreground/45 transition-colors duration-200 hover:bg-foreground/[0.05] hover:text-foreground/80"
              >
                <ChevronLeft className="size-4" strokeWidth={2} />
              </button>
            )}
            <button
              type="button"
              onClick={goNext}
              className={cn(
                "flex h-8 items-center gap-1 rounded-full bg-foreground px-4 text-[12.5px] font-medium text-background transition-all duration-200",
                "hover:bg-foreground/85",
                "shadow-[0_1px_2px_rgba(0,0,0,0.08),0_4px_12px_-4px_rgba(0,0,0,0.18)]",
              )}
            >
              {isLast ? "Get started" : "Next"}
              {!isLast && <ChevronRight className="size-3.5" strokeWidth={2.5} />}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
