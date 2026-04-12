"use client"

import { useState, useEffect, useCallback } from "react"
import { motion, AnimatePresence } from "motion/react"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer"
import { useBreakpoint } from "@/app/hooks/use-breakpoint"
import { cn } from "@/lib/utils"
import {
  ANNOUNCEMENTS,
  useAnnouncementsStore,
  type AnnouncementTag,
} from "@/lib/announcements-store"
import {
  Flame,
  ArrowUpCircle,
  Bug,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
} from "lucide-react"
import Image from "next/image"
import Link from "next/link"

// ── Tag config ──────────────────────────────────────────────────────
const TAG_CONFIG: Record<AnnouncementTag, { label: string; icon: React.ComponentType<any> }> = {
  new: { label: "New", icon: Flame },
  improvement: { label: "Improved", icon: ArrowUpCircle },
  fix: { label: "Fixed", icon: Bug },
  update: { label: "Update", icon: ArrowUpCircle },
}

// ── Date formatter ──────────────────────────────────────────────────
function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00")
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))

  if (days === 0) return "Today"
  if (days === 1) return "Yesterday"
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

// ── Carousel content ────────────────────────────────────────────────

function AnnouncementsCarousel({ onClose }: { onClose?: () => void }) {
  const { readIds, hydrated } = useAnnouncementsStore()
  const [current, setCurrent] = useState(0)
  const total = ANNOUNCEMENTS.length
  const item = ANNOUNCEMENTS[current]
  const tag = TAG_CONFIG[item.tag]
  const TagIcon = tag.icon
  const showNav = total > 1

  const prev = useCallback(() => setCurrent((c) => (c - 1 + total) % total), [total])
  const next = useCallback(() => setCurrent((c) => (c + 1) % total), [total])

  // Keyboard nav
  useEffect(() => {
    if (!showNav) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") prev()
      if (e.key === "ArrowRight") next()
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [prev, next, showNav])

  return (
    <div className="flex flex-col select-none">
      {/* ── Hero visual ── */}
      <div className="relative overflow-hidden" style={{ height: 240 }}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={item.id}
            className={cn("absolute inset-0 bg-gradient-to-br", item.gradient.bg)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
          >
            {/* Smoke orbs */}
            <div className={cn("absolute w-44 h-44 rounded-full blur-3xl -top-12 -left-12", item.gradient.orb1)} />
            <div className={cn("absolute w-36 h-36 rounded-full blur-3xl top-6 -right-6", item.gradient.orb2)} />
            <div className={cn("absolute w-28 h-28 rounded-full blur-2xl -bottom-8 left-1/3", item.gradient.orb3)} />

            {/* Noise grain */}
            <div className="absolute inset-0 opacity-[0.035]" style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")`,
            }} />

            {/* Screenshot image — floats with shadow */}
            {item.image && (
              <motion.div
                className="relative z-10 flex items-end justify-center w-full h-full px-6 pt-8 pb-0"
                initial={{ y: 24, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.15, duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
              >
                <div className="relative w-full max-w-[320px] max-h-[180px] rounded-t-xl overflow-hidden shadow-2xl ring-1 ring-white/[0.08]">
                  <Image
                    src={item.image}
                    alt={item.title}
                    width={640}
                    height={400}
                    className="w-full h-full object-cover object-top"
                    priority
                  />
                  {/* Bottom fade so image bleeds into content */}
                  <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/50 to-transparent" />
                </div>
              </motion.div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Top vignette for close button */}
        <div className="absolute inset-x-0 top-0 h-14 bg-gradient-to-b from-black/25 to-transparent z-20 pointer-events-none" />
      </div>

      {/* ── Content ── */}
      <div className="px-5 pt-4 pb-3">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={item.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
          >
            {/* Tag + date row */}
            <div className="flex items-center gap-2 mb-2.5">
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-wider">
                <TagIcon className="size-3" />
                {tag.label}
              </span>
              <span className="text-[11px] text-muted-foreground/30">{formatDate(item.date)}</span>
              {hydrated && !readIds.has(item.id) && (
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 ml-auto" />
              )}
            </div>

            {/* Title */}
            <h3 className="text-[18px] font-semibold text-foreground tracking-tight leading-tight mb-1.5">
              {item.title}
            </h3>

            {/* Description */}
            <p className="text-[13px] text-muted-foreground/60 leading-relaxed">
              {item.description}
            </p>

            {/* CTA */}
            {item.link && (
              <Link
                href={item.link}
                onClick={() => onClose?.()}
                className="inline-flex items-center gap-1.5 mt-3 text-[13px] font-medium text-foreground/70 hover:text-foreground transition-colors duration-200 group/link"
              >
                {item.linkLabel || "Learn more"}
                <ArrowRight className="size-3.5 transition-transform duration-200 group-hover/link:translate-x-0.5" />
              </Link>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ── Navigation (only when multiple posts) ── */}
      {showNav && (
        <div className="flex items-center justify-between px-5 pb-4 pt-1">
          <div className="flex items-center gap-1.5">
            {ANNOUNCEMENTS.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setCurrent(i)}
                className={cn(
                  "rounded-full transition-all duration-300",
                  i === current
                    ? "w-5 h-1.5 bg-foreground/40"
                    : "w-1.5 h-1.5 bg-foreground/10 hover:bg-foreground/20",
                )}
              />
            ))}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={prev}
              className="flex items-center justify-center size-7 rounded-full text-muted-foreground/40 hover:text-foreground hover:bg-foreground/[0.06] transition-all duration-200"
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              type="button"
              onClick={next}
              className="flex items-center justify-center size-7 rounded-full text-muted-foreground/40 hover:text-foreground hover:bg-foreground/[0.06] transition-all duration-200"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
      )}

      {/* Bottom padding when no nav */}
      {!showNav && <div className="h-3" />}
    </div>
  )
}

// ── Main dialog ─────────────────────────────────────────────────────
interface AnnouncementsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AnnouncementsDialog({ open, onOpenChange }: AnnouncementsDialogProps) {
  const isMobile = useBreakpoint(768)
  const markAllRead = useAnnouncementsStore((s) => s.markAllRead)
  const unreadCount = useAnnouncementsStore((s) => s.unreadCount)

  useEffect(() => {
    if (open && unreadCount > 0) {
      const t = setTimeout(() => markAllRead(), 2000)
      return () => clearTimeout(t)
    }
  }, [open, unreadCount, markAllRead])

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="bg-background border-border">
          <DrawerTitle className="sr-only">What&apos;s New</DrawerTitle>
          <DrawerDescription className="sr-only">Latest updates</DrawerDescription>
          <AnnouncementsCarousel onClose={() => onOpenChange(false)} />
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hasCloseButton
        className={cn(
          "gap-0 overflow-hidden rounded-2xl p-0 shadow-2xl sm:max-w-[400px]",
          "border-border/40 dark:border-white/[0.06]",
          "bg-background",
          "[&>button:last-child]:z-30",
          "[&>button:last-child]:bg-black/20 dark:[&>button:last-child]:bg-white/10",
          "[&>button:last-child]:backdrop-blur-sm",
          "[&>button:last-child]:rounded-full [&>button:last-child]:p-1",
          "[&>button:last-child]:top-3 [&>button:last-child]:right-3",
          "[&>button:last-child]:text-white/70 [&>button:last-child]:hover:text-white",
          "[&>button:last-child]:hover:bg-black/30 dark:[&>button:last-child]:hover:bg-white/20",
          "[&>button:last-child]:transition-all [&>button:last-child]:border-0",
        )}
      >
        <DialogTitle className="sr-only">What&apos;s New</DialogTitle>
        <DialogDescription className="sr-only">Latest updates</DialogDescription>
        <AnnouncementsCarousel onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}
