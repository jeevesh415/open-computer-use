"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { motion, AnimatePresence } from "motion/react"
import Link from "next/link"
import { useTheme } from "next-themes"
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
import { GuideLines } from "@/app/components/landing/guide-lines"
import Beams from "@/components/Beams"
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

// Raised canvas — full-screen overlay with embedded session replay
function SessionCanvas({
  chatId,
  title,
  onClose,
}: {
  chatId: string
  title: string | null
  onClose: () => void
}) {
  const [iframeLoaded, setIframeLoaded] = useState(false)

  // Close on Escape
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

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      className="fixed inset-0 z-[100] flex items-center justify-center"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-background/80 backdrop-blur-xl"
        onClick={onClose}
      />

      {/* Canvas */}
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 w-[95vw] h-[90vh] max-w-6xl rounded-2xl border border-border/30 bg-background shadow-[0_0_0_1px_rgba(0,0,0,0.02),0_8px_40px_-12px_rgba(0,0,0,0.15),0_30px_80px_-20px_rgba(0,0,0,0.12)] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.03),0_8px_40px_-12px_rgba(0,0,0,0.4),0_30px_80px_-20px_rgba(0,0,0,0.35)] overflow-hidden flex flex-col"
      >
        {/* Top bar */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border/20 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center gap-1.5">
              <div className="h-2.5 w-2.5 rounded-full bg-muted-foreground/15" />
              <div className="h-2.5 w-2.5 rounded-full bg-muted-foreground/15" />
              <div className="h-2.5 w-2.5 rounded-full bg-muted-foreground/15" />
            </div>
            {title && (
              <span className="text-xs text-muted-foreground/50 truncate max-w-sm">
                {title}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="h-7 rounded-lg px-3 text-xs gap-1.5"
              asChild
            >
              <Link href="/auth">
                Try it
                <ArrowRight className="size-3" weight="bold" />
              </Link>
            </Button>
            <button
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground/40 hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              <X className="size-3.5" weight="bold" />
            </button>
          </div>
        </div>

        {/* Session replay iframe */}
        <div className="flex-1 relative">
          {!iframeLoaded && (
            <div className="absolute inset-0 flex items-center justify-center">
              <CircleNotch className="size-5 text-muted-foreground/30 animate-spin" />
            </div>
          )}
          <iframe
            src={`/share/${chatId}?embed=true&autoplay=true`}
            className={cn(
              "w-full h-full border-0 transition-opacity duration-300",
              iframeLoaded ? "opacity-100" : "opacity-0"
            )}
            onLoad={() => setIframeLoaded(true)}
            title={title || "Session replay"}
          />
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
  const [mounted, setMounted] = useState(false)
  const [activeSession, setActiveSession] = useState<DiscoverChat | null>(null)
  const { resolvedTheme } = useTheme()
  const sentinelRef = useRef<HTMLDivElement>(null)
  const t = useTranslations("discover")

  useEffect(() => { setMounted(true) }, [])

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
      <GuideLines />

      {/* Beams background */}
      <div
        className={cn(
          "fixed inset-0 z-0 pointer-events-none",
          mounted && resolvedTheme !== "dark" && "invert"
        )}
        aria-hidden="true"
      >
        <div className="mx-auto h-full max-w-7xl px-4 sm:px-6 relative">
          <div className="absolute inset-y-0 left-4 sm:left-6 right-4 sm:right-6 overflow-hidden [mask-image:radial-gradient(ellipse_100%_90%_at_50%_45%,black_0%,black_40%,transparent_85%)]">
            <Beams
              beamWidth={3}
              beamHeight={30}
              beamNumber={20}
              lightColor="#ffffff"
              speed={2}
              noiseIntensity={1.75}
              scale={0.2}
              rotation={30}
            />
          </div>
        </div>
      </div>

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
                <motion.div
                  key={chat.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: 0.45,
                    delay: Math.min(i * 0.04, 0.4),
                    ease: [0.22, 1, 0.36, 1],
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
                </motion.div>
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
            chatId={activeSession.id}
            title={activeSession.title}
            onClose={() => setActiveSession(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
