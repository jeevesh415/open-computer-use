"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { motion, AnimatePresence } from "motion/react"
import Link from "next/link"
import {
  MagnifyingGlass,
  ArrowUpRight,
  CircleNotch,
  Robot,
  Compass,
  X,
  Play,
  ArrowRight,
} from "@phosphor-icons/react"
import { cn } from "@/lib/utils"
import { LandingHeader } from "@/app/components/landing/landing-header"
import { LandingFooter } from "@/app/components/landing/landing-footer"
import { PostThumbnail } from "@/components/blog/post-thumbnail"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useTranslations } from "next-intl"

type DiscoverChat = {
  id: string
  title: string | null
  created_at: string | null
  updated_at: string | null
  model: string | null
  messageCount: number
  userMessage: string | null
  assistantPreview: string | null
}

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return ""
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diff = now - then
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

// Session canvas — immersive replay viewer with floating chrome
function SessionCanvas({
  chat,
  onClose,
}: {
  chat: DiscoverChat
  onClose: () => void
}) {
  const [iframeLoaded, setIframeLoaded] = useState(false)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handler)
    document.body.style.overflow = "hidden"
    return () => {
      window.removeEventListener("keydown", handler)
      document.body.style.overflow = ""
    }
  }, [onClose])

  const meta = relativeTime(chat.updated_at || chat.created_at)

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className="fixed inset-0 z-[100] flex items-center justify-center"
    >
      {/* Layered backdrop — deep blur + radial spotlight */}
      <div
        className="absolute inset-0 bg-background/90 backdrop-blur-2xl"
        onClick={onClose}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-70"
        aria-hidden
        style={{
          background:
            "radial-gradient(ellipse 55% 45% at 50% 50%, rgba(120,120,255,0.10), transparent 65%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04] mix-blend-overlay"
        aria-hidden
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.5) 1px, transparent 0)",
          backgroundSize: "22px 22px",
        }}
      />

      {/* Canvas */}
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 24 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 16 }}
        transition={{ type: "spring", damping: 30, stiffness: 280, mass: 0.9 }}
        className={cn(
          "relative z-10 flex flex-col overflow-hidden bg-card",
          // Mobile: edge-to-edge takeover. Desktop: floating card.
          "h-[100dvh] w-screen sm:h-[88vh] sm:w-[92vw] sm:max-w-[1180px]",
          "sm:rounded-[20px] sm:border sm:border-border/50",
          "sm:shadow-[0_0_0_1px_rgba(255,255,255,0.04)_inset,0_40px_120px_-20px_rgba(0,0,0,0.55),0_10px_40px_-12px_rgba(0,0,0,0.35)]"
        )}
      >
        {/* Decorative top accent line */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{
            background:
              "linear-gradient(90deg, transparent 0%, rgba(120,120,255,0.5) 20%, rgba(255,120,200,0.5) 50%, rgba(120,120,255,0.5) 80%, transparent 100%)",
          }}
        />

        {/* Top chrome */}
        <div
          className="flex items-center justify-between gap-3 flex-shrink-0 border-b border-border/40 bg-card/70 backdrop-blur-md px-4 sm:px-5"
          style={{ paddingTop: "max(env(safe-area-inset-top), 0px)" }}
        >
          <div className="flex items-center gap-2.5 min-w-0 h-12 sm:h-14">
            {/* Live status pulse */}
            <span className="relative flex h-2 w-2 flex-shrink-0" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            <span className="truncate text-xs sm:text-[13px] font-medium text-foreground/90">
              {chat.title || "Untitled session"}
            </span>
            <span className="hidden md:inline-flex items-center gap-1 rounded-md border border-border/40 bg-muted/40 px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground/70 flex-shrink-0">
              {chat.messageCount} steps
            </span>
          </div>

          <div className="flex items-center gap-1 flex-shrink-0">
            <kbd className="hidden md:inline-flex h-6 items-center rounded-md border border-border/40 bg-muted/30 px-1.5 font-mono text-[10px] text-muted-foreground/60">
              ESC
            </kbd>
            <button
              onClick={onClose}
              aria-label="Close session"
              className="ml-1 flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground/60 hover:text-foreground hover:bg-muted/60 transition-colors"
            >
              <X className="size-4" weight="bold" />
            </button>
          </div>
        </div>

        {/* Stage */}
        <div className="relative flex-1 bg-background">
          {!iframeLoaded && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
              <div className="relative flex h-10 w-10 items-center justify-center">
                <div className="absolute inset-0 rounded-full border border-border/40" />
                <CircleNotch className="size-4 text-muted-foreground/50 animate-spin" />
              </div>
              <span className="text-[11px] tracking-wide text-muted-foreground/50">
                Loading session…
              </span>
            </div>
          )}
          <iframe
            src={`/share/${chat.id}?embed=true&autoplay=true`}
            className={cn(
              "h-full w-full border-0 transition-opacity duration-500",
              iframeLoaded ? "opacity-100" : "opacity-0"
            )}
            onLoad={() => setIframeLoaded(true)}
            title={chat.title || "Session replay"}
          />

          {/* Subtle vignette to ground the iframe in the canvas */}
          <div
            className="pointer-events-none absolute inset-0"
            aria-hidden
            style={{
              boxShadow: "inset 0 0 60px rgba(0,0,0,0.18)",
            }}
          />
        </div>

        {/* Bottom CTA chrome */}
        <div
          className="flex items-center justify-between gap-3 flex-shrink-0 border-t border-border/40 bg-card/70 backdrop-blur-md px-4 sm:px-5 h-14 sm:h-16"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0px)" }}
        >
          <div className="flex items-center gap-2 min-w-0 text-[11px] text-muted-foreground/60">
            <span className="truncate tabular-nums">{meta}</span>
            <span className="text-muted-foreground/20">·</span>
            <span className="hidden sm:inline truncate">
              {chat.messageCount} steps
            </span>
          </div>

          <Button
            size="sm"
            className="group/cta h-9 flex-shrink-0 gap-2 rounded-xl px-3.5 text-xs sm:text-[13px]"
            asChild
          >
            <Link href="/auth">
              <span>Try this yourself</span>
              <ArrowRight
                className="size-3.5 transition-transform group-hover/cta:translate-x-0.5"
                weight="bold"
              />
            </Link>
          </Button>
        </div>
      </motion.div>
    </motion.div>
  )
}

export default function DiscoverPage() {
  const [chats, setChats] = useState<DiscoverChat[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState("")
  const [activeSession, setActiveSession] = useState<DiscoverChat | null>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const t = useTranslations("discover")

  const fetchChats = useCallback(async (pageNum: number, append = false) => {
    if (pageNum === 0) setIsLoading(true)
    else setIsLoadingMore(true)

    try {
      const res = await fetch(`/api/discover?page=${pageNum}&limit=24`)
      if (!res.ok) throw new Error("Failed to fetch")
      const data = await res.json()
      setChats((prev) => append ? [...prev, ...data.chats] : data.chats)
      setHasMore(data.hasMore)
      setTotal(data.total)
      setPage(pageNum)
    } catch {
      // silent fail
    } finally {
      setIsLoading(false)
      setIsLoadingMore(false)
    }
  }, [])

  useEffect(() => { fetchChats(0) }, [fetchChats])

  // Infinite scroll observer
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoadingMore) {
          fetchChats(page + 1, true)
        }
      },
      { threshold: 0.1 }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, isLoadingMore, page, fetchChats])

  // Client-side search filter
  const filtered = search.trim()
    ? chats.filter((c) => {
        const q = search.toLowerCase()
        return (
          c.title?.toLowerCase().includes(q) ||
          c.userMessage?.toLowerCase().includes(q) ||
          c.assistantPreview?.toLowerCase().includes(q)
        )
      })
    : chats

  return (
    <div className="min-h-screen bg-background relative">

      <LandingHeader />

      <main className="relative pt-28 sm:pt-32 pb-20">
        {/* Hero */}
        <div className="max-w-5xl mx-auto px-6 sm:px-10 text-center mb-12 sm:mb-16">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="flex items-center justify-center gap-2.5 mb-4">
              <Compass className="size-5 text-muted-foreground/60" weight="duotone" />
              <span className="text-muted-foreground/60 font-medium uppercase tracking-[0.15em] text-xs">
                {t("badge")}
              </span>
            </div>
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-foreground mb-3">
              {t("title")}
            </h1>
            <p className="text-muted-foreground text-sm sm:text-base max-w-md mx-auto leading-relaxed">
              {t("subtitle")}
            </p>
            {total > 0 && (
              <p className="text-muted-foreground/40 text-xs mt-3 tabular-nums">
                {t("sessionCount", { count: total.toLocaleString() })}
              </p>
            )}
          </motion.div>
        </div>

        {/* Search */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          className="max-w-xl mx-auto px-6 sm:px-10 mb-10 sm:mb-14"
        >
          <div className="relative">
            <MagnifyingGlass className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground/40 pointer-events-none" />
            <Input
              type="text"
              placeholder={t("searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 h-10 rounded-xl border-border/30 bg-card/50 backdrop-blur-sm text-sm placeholder:text-muted-foreground/30 focus-visible:ring-1 focus-visible:ring-border/50"
            />
          </div>
        </motion.div>

        {/* Card grid */}
        <div className="max-w-7xl mx-auto px-6 sm:px-10">
          {isLoading ? (
            <div className="flex items-center justify-center py-32">
              <CircleNotch className="size-5 text-muted-foreground/40 animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center py-32 text-center"
            >
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border/30 bg-card/40 mb-4">
                <Robot className="size-6 text-muted-foreground/30" weight="duotone" />
              </div>
              <p className="text-sm text-muted-foreground/60 mb-1">
                {search ? t("noResultsTitle") : t("emptyTitle")}
              </p>
              <p className="text-xs text-muted-foreground/30">
                {search
                  ? t("noResultsSubtitle")
                  : t("emptySubtitle")}
              </p>
            </motion.div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
              {filtered.map((chat, i) => (
                /* Pure-CSS entrance — see globals.css `.public-card-enter`.
                   <motion.div> wrapping the inner <button> caused a mobile
                   double-tap bug (motion's gesture system swallows the
                   first pointerdown to disambiguate tap vs drag). The
                   delay is capped at 400ms so late items don't lag in. */
                <div
                  key={chat.id}
                  className="public-card-enter"
                  style={{
                    ["--card-i" as string]: Math.min(i, 10),
                    ["--card-stagger-ms" as string]: "40ms",
                  }}
                >
                  <button
                    onClick={() => setActiveSession(chat)}
                    className="group block h-full w-full text-left"
                  >
                    <div className="h-full rounded-xl overflow-hidden border border-border/30 bg-card hover:border-border/60 transition-colors duration-300 flex flex-col">
                      {/* Thumbnail */}
                      <div className="relative">
                        <PostThumbnail postId={chat.id} />
                        {/* Play overlay on hover */}
                        <div className="absolute inset-0 flex items-center justify-center bg-background/0 group-hover:bg-background/50 transition-colors duration-300">
                          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border/50 bg-card/80 backdrop-blur-sm opacity-0 group-hover:opacity-100 scale-90 group-hover:scale-100 transition-all duration-300">
                            <Play className="size-4 text-foreground/70 ml-0.5" weight="fill" />
                          </div>
                        </div>
                      </div>

                      {/* Card body */}
                      <div className="flex flex-col flex-1 p-5 sm:p-6">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-[10px] text-muted-foreground/30 tabular-nums">
                            {relativeTime(chat.updated_at || chat.created_at)}
                          </span>
                          <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/20 group-hover:text-foreground/50 transition-all duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                        </div>

                        {/* Title */}
                        {chat.title && (
                          <h3 className="font-semibold text-foreground group-hover:text-foreground/70 transition-colors duration-200 mb-2 line-clamp-2 leading-snug">
                            {chat.title}
                          </h3>
                        )}

                        {/* Footer */}
                        <div className="flex items-center gap-3 text-xs text-muted-foreground/40 mt-auto pt-4 border-t border-border/20">
                          <span>{t("steps", { count: chat.messageCount })}</span>
                          <span className="text-muted-foreground/15">|</span>
                          <span className="group-hover:text-muted-foreground/60 transition-colors">{t("watchSession")}</span>
                        </div>
                      </div>
                    </div>
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Infinite scroll sentinel */}
          <div ref={sentinelRef} className="h-4" />

          {/* Loading more indicator */}
          <AnimatePresence>
            {isLoadingMore && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center justify-center py-8"
              >
                <CircleNotch className="size-4 text-muted-foreground/30 animate-spin" />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      <LandingFooter />

      {/* Session replay canvas */}
      <AnimatePresence>
        {activeSession && (
          <SessionCanvas
            chat={activeSession}
            onClose={() => setActiveSession(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
