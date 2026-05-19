"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  ChatTeardropText,
  Clock,
  MagnifyingGlass,
  ArrowClockwise,
  Trash,
  CheckSquare,
  Square,
  Laptop,
  X,
  ShareNetwork,
  Globe,
  Lock,
  Copy,
  Check,
  CheckCircle,
  CaretDown,
  CaretRight,
  CaretUp,
  CaretLeft,
  Camera,
  User,
  MagnifyingGlassPlus,
  MagnifyingGlassMinus,
  ArrowCounterClockwise,
  ArrowsOutCardinal,
  ArrowRight,
  TwitterLogo,
  LinkedinLogo,
  WhatsappLogo,
  FacebookLogo,
  TelegramLogo,
  RedditLogo,
  BookOpen,
} from "@phosphor-icons/react"
import Link from "next/link"
import { AnimatePresence, motion } from "motion/react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"
import { useChats } from "@/lib/chat-store/chats/provider"
import type { Chats } from "@/lib/chat-store/types"
import { AgentIconFilled } from "@/components/icons/agent"
import { APP_DOMAIN } from "@/lib/config"
// Note: messages are now fetched via the /api/chats/[chatId]/messages
// server route (so encrypted frontendScreenshot values get decrypted
// server-side) — direct Supabase client access is no longer needed here.
import { PageLoader } from "@/components/common/page-loader"
import { useTranslations } from "next-intl"

const EASE = [0.22, 1, 0.36, 1] as const

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatMessage {
  id: number
  role: "system" | "user" | "assistant" | "data"
  content: string | null
  created_at: string | null
  model: string | null
  experimental_attachments: any[] | null
  parts: any[] | null
}

interface ExtractedStep {
  toolName: string
  args: any
  result: any
  screenshot: string | null
  status: "success" | "error" | "pending"
}

function toDataUri(raw: string): string | null {
  const clean = raw.trim()
  if (!clean) return null
  if (clean.startsWith("data:image/")) return clean
  if (clean.startsWith("/9j/")) return `data:image/jpeg;base64,${clean}`
  if (clean.startsWith("iVBOR")) return `data:image/png;base64,${clean}`
  return `data:image/jpeg;base64,${clean}`
}

function extractStepsFromParts(parts: any[] | null): ExtractedStep[] {
  if (!parts || !Array.isArray(parts)) return []
  const steps: ExtractedStep[] = []
  for (const part of parts) {
    if (part.type === "tool-invocation" && part.toolInvocation) {
      const inv = part.toolInvocation
      let screenshot: string | null = null
      const rawScreenshot = inv.frontendScreenshot || inv.result?.frontendScreenshot
      if (rawScreenshot) {
        screenshot = toDataUri(rawScreenshot)
      }
      steps.push({
        toolName: inv.toolName || "action",
        args: inv.args,
        result: inv.result,
        screenshot,
        status: inv.state === "result" ? "success" : inv.state === "call" ? "pending" : "pending",
      })
    }
  }
  return steps
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function HistoryContent() {
  const tLoader = useTranslations("pageLoaders.history")
  const { chats, isLoading, isLoadingMore, hasMore, loadMore, refresh, deleteChat, updateChat } = useChats()
  const [search, setSearch] = useState("")
  const [refreshing, setRefreshing] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  // Infinite scroll
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoadingMore) {
          loadMore()
        }
      },
      { threshold: 0.1 }
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, isLoadingMore, loadMore])

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    await refresh()
    setRefreshing(false)
  }, [refresh])

  const handleToggle = useCallback((chatId: string) => {
    setExpandedId((prev) => (prev === chatId ? null : chatId))
  }, [])

  // Filter chats by search
  const filteredChats = useMemo(() => {
    if (!search.trim()) return chats
    const q = search.toLowerCase()
    return chats.filter(
      (c) =>
        (c.title || "").toLowerCase().includes(q) ||
        (c.last_message_preview || "").toLowerCase().includes(q)
    )
  }, [chats, search])

  // Group by date
  const groupedChats = useMemo(() => {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const weekAgo = today - 7 * 24 * 60 * 60 * 1000
    const monthAgo = today - 30 * 24 * 60 * 60 * 1000

    const groups: { name: string; chats: Chats[] }[] = []

    const todayChats = filteredChats.filter((c) => {
      if (!c.updated_at) return true
      return new Date(c.updated_at).getTime() >= today
    })
    const weekChats = filteredChats.filter((c) => {
      if (!c.updated_at) return false
      const t = new Date(c.updated_at).getTime()
      return t >= weekAgo && t < today
    })
    const monthChats = filteredChats.filter((c) => {
      if (!c.updated_at) return false
      const t = new Date(c.updated_at).getTime()
      return t >= monthAgo && t < weekAgo
    })
    const olderChats = filteredChats.filter((c) => {
      if (!c.updated_at) return false
      return new Date(c.updated_at).getTime() < monthAgo
    })

    if (todayChats.length > 0) groups.push({ name: "Today", chats: todayChats })
    if (weekChats.length > 0) groups.push({ name: "Last 7 days", chats: weekChats })
    if (monthChats.length > 0) groups.push({ name: "Last 30 days", chats: monthChats })
    if (olderChats.length > 0) groups.push({ name: "Older", chats: olderChats })

    return groups
  }, [filteredChats])

  // Selection
  const isSelecting = selectedIds.size > 0

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(filteredChats.map((c) => c.id)))
  }, [filteredChats])

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const handleBulkDelete = useCallback(async () => {
    if (selectedIds.size === 0) return
    setDeleting(true)
    const ids = Array.from(selectedIds)
    for (const id of ids) {
      await deleteChat(id)
    }
    setSelectedIds(new Set())
    setDeleting(false)
  }, [selectedIds, deleteChat])

  return (
    <PageLoader
      isLoading={isLoading}
      title={tLoader("title")}
      description={tLoader("description")}
    >
    <div className="h-full overflow-y-auto overflow-x-hidden scrollbar-invisible relative">
      {/* Ambient background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div
          className="absolute -top-[30%] -right-[15%] h-[60%] w-[50%] rounded-full opacity-[0.02] dark:opacity-[0.04] blur-[120px]"
          style={{ background: "radial-gradient(circle, currentColor, transparent 70%)" }}
        />
        <div
          className="absolute -bottom-[20%] -left-[10%] h-[50%] w-[40%] rounded-full opacity-[0.015] dark:opacity-[0.035] blur-[100px]"
          style={{ background: "radial-gradient(circle, currentColor, transparent 70%)" }}
        />
        <div
          className="absolute inset-0 opacity-[0.012] dark:opacity-[0.025]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(128,128,128,.3) 1px, transparent 1px), linear-gradient(90deg, rgba(128,128,128,.3) 1px, transparent 1px)",
            backgroundSize: "80px 80px",
          }}
        />
      </div>

      <div className="container mx-auto p-4 sm:p-6 lg:p-8 max-w-7xl space-y-6 relative z-10">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: EASE }}
          className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4"
        >
          <div>
            <h1 className="text-2xl sm:text-3xl font-medium tracking-tight flex items-center gap-2.5">
              Task History
              {chats.length > 0 && (
                <span className="text-sm font-normal text-muted-foreground ml-1">
                  ({chats.length}{hasMore ? "+" : ""})
                </span>
              )}
            </h1>
            <div className="flex items-center gap-3 mt-1.5">
              <p className="text-muted-foreground text-sm">
                Browse and manage your past tasks
              </p>
              <Link
                href="/guide?tab=chat-tasks"
                className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-foreground/[0.05] px-2.5 py-1 text-xs font-medium text-foreground/70 hover:text-foreground hover:border-border hover:bg-foreground/[0.08] transition-all"
              >
                <BookOpen size={14} weight="duotone" />
                Guide
              </Link>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isSelecting && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex items-center gap-2"
              >
                <span className="text-xs text-muted-foreground">
                  {selectedIds.size} selected
                </span>
                <button
                  onClick={handleBulkDelete}
                  disabled={deleting}
                  className={cn(
                    "h-9 px-3 flex items-center gap-1.5 rounded-xl border border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400 text-xs font-medium transition-all duration-200",
                    "hover:bg-red-500/15 active:scale-95",
                    "disabled:opacity-50 disabled:cursor-not-allowed"
                  )}
                >
                  <Trash className="size-3.5" weight="bold" />
                  Delete
                </button>
                <button
                  onClick={clearSelection}
                  className="h-9 w-9 flex items-center justify-center rounded-xl border border-border/40 bg-background/60 text-muted-foreground transition-all duration-200 hover:text-foreground hover:bg-background/90"
                >
                  <X className="size-4" weight="bold" />
                </button>
              </motion.div>
            )}
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className={cn(
                "h-9 w-9 flex items-center justify-center rounded-xl border border-border/40 bg-background/60 backdrop-blur-sm text-muted-foreground transition-all duration-200 shadow-sm",
                "hover:text-foreground hover:bg-background/90 hover:border-border/60 hover:shadow-md",
                "active:scale-95",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
              title="Refresh"
            >
              <ArrowClockwise
                className={cn("size-4", refreshing && "animate-spin")}
                weight="bold"
              />
            </button>
          </div>
        </motion.div>

        {/* Search + Select All */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.05, ease: EASE }}
          className="flex items-center gap-2"
        >
          <div className="relative flex-1">
            <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground/60" />
            <input
              type="text"
              placeholder="Search chats..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={cn(
                "w-full h-10 pl-9 pr-4 rounded-xl border border-border/40 bg-background/60 backdrop-blur-sm text-sm",
                "placeholder:text-muted-foreground/50",
                "focus:outline-none focus:ring-1 focus:ring-ring focus:border-border/60",
                "transition-all duration-200"
              )}
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground transition-colors"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          {filteredChats.length > 0 && (
            <button
              onClick={isSelecting ? clearSelection : selectAll}
              className={cn(
                "h-10 px-3.5 flex items-center gap-1.5 rounded-xl border text-xs font-medium transition-all duration-200",
                isSelecting
                  ? "border-foreground/20 bg-foreground/5 text-foreground"
                  : "border-border/40 bg-background/60 text-muted-foreground hover:text-foreground hover:bg-background/90"
              )}
            >
              {isSelecting ? (
                <CheckSquare className="size-3.5" weight="fill" />
              ) : (
                <Square className="size-3.5" />
              )}
              <span className="hidden sm:inline">{isSelecting ? "Deselect" : "Select"}</span>
            </button>
          )}
        </motion.div>

        {/* Empty state */}
        {chats.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1, ease: EASE }}
            className="relative rounded-2xl border border-border/30 bg-card/30 backdrop-blur-sm overflow-hidden"
          >
            <div className="pointer-events-none absolute -top-20 -left-20 h-72 w-72 rounded-full bg-foreground/[0.02] blur-3xl" />
            <div className="pointer-events-none absolute -bottom-20 -right-20 h-72 w-72 rounded-full bg-foreground/[0.015] blur-3xl" />

            <div className="relative flex flex-col items-center px-6 py-16 text-center">
              <div className="mb-10 flex items-center gap-2">
                {[ChatTeardropText, Clock, MagnifyingGlass].map((Icon, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: 0.2 + i * 0.06, ease: EASE }}
                    className="flex h-10 w-10 items-center justify-center rounded-xl border border-border/40 bg-background/60 text-muted-foreground/70"
                  >
                    <Icon className="h-[18px] w-[18px]" weight={i === 0 ? "fill" : "regular"} />
                  </motion.div>
                ))}
              </div>

              <h2 className="text-2xl font-medium tracking-tight mb-2.5">No tasks yet</h2>
              <p className="text-sm text-muted-foreground max-w-sm mx-auto leading-relaxed mb-8">
                Start a new task to get going. Your task history will appear here.
              </p>

              <button
                onClick={() => router.push("/")}
                className="px-5 py-2.5 rounded-xl bg-foreground text-background text-sm font-medium hover:bg-foreground/90 transition-all duration-200 active:scale-95"
              >
                Start a new task
              </button>
            </div>
          </motion.div>
        ) : filteredChats.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <div className="border border-border/30 bg-card/30 backdrop-blur-sm rounded-2xl">
              <div className="flex flex-col items-center justify-center py-14">
                <MagnifyingGlass className="h-10 w-10 text-muted-foreground/40 mb-4" weight="duotone" />
                <h3 className="text-base font-medium mb-1.5">No matching chats</h3>
                <p className="text-sm text-muted-foreground">
                  Try a different search term.
                </p>
              </div>
            </div>
          </motion.div>
        ) : (
          /* Grouped chat cards */
          <div className="space-y-6">
            {groupedChats.map((group, gi) => (
              <motion.div
                key={group.name}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: 0.05 + gi * 0.04, ease: EASE }}
              >
                <h3 className="text-xs font-medium text-muted-foreground/60 uppercase tracking-wider mb-3 px-1">
                  {group.name}
                </h3>
                <div className="space-y-3">
                  {group.chats.map((chat, i) => (
                    <motion.div
                      key={chat.id}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.35, delay: 0.05 + i * 0.04, ease: EASE }}
                    >
                      <ChatCard
                        chat={chat}
                        isExpanded={expandedId === chat.id}
                        onToggle={() => handleToggle(chat.id)}
                        isSelected={selectedIds.has(chat.id)}
                        isSelecting={isSelecting}
                        onSelect={() => toggleSelect(chat.id)}
                        onUpdateChat={updateChat}
                      />
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            ))}

            {/* Sentinel for infinite scroll */}
            <div ref={sentinelRef} className="h-1" />
            {isLoadingMore && (
              <div className="space-y-3 pb-4">
                {[...Array(3)].map((_, i) => (
                  <div
                    key={i}
                    className="rounded-xl border border-border/20 bg-card/30 animate-pulse h-[72px]"
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
    </PageLoader>
  )
}

// ---------------------------------------------------------------------------
// Chat card (swarm-run style)
// ---------------------------------------------------------------------------

function ChatCard({
  chat,
  isExpanded,
  onToggle,
  isSelected,
  isSelecting,
  onSelect,
  onUpdateChat,
}: {
  chat: Chats
  isExpanded: boolean
  onToggle: () => void
  isSelected: boolean
  isSelecting: boolean
  onSelect: () => void
  onUpdateChat: (id: string, updates: Partial<Chats>) => Promise<void>
}) {
  const router = useRouter()
  const createdAt = new Date(chat.created_at || "")
  const updatedAt = chat.updated_at ? new Date(chat.updated_at) : createdAt
  const duration = updatedAt.getTime() - createdAt.getTime()

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [messagesFetched, setMessagesFetched] = useState(false)

  const [shareOpen, setShareOpen] = useState(false)
  const [isPublic, setIsPublic] = useState(chat.public ?? false)
  const [shareLoading, setShareLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [titleCopied, setTitleCopied] = useState(false)

  const copyTitle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard.writeText(chat.title || "Untitled Project")
    setTitleCopied(true)
    setTimeout(() => setTitleCopied(false), 2000)
  }, [chat.title])
  const shareUrl = `${APP_DOMAIN}/share/${chat.id}`

  const hasMessages = chat.last_message_preview != null

  // Fetch messages on first expand. Routed through the server endpoint
  // (rather than direct Supabase) so encrypted `frontendScreenshot` values
  // get decrypted server-side before reaching the browser — the
  // ENCRYPTION_KEY must never ship to the client.
  useEffect(() => {
    if (isExpanded && !messagesFetched) {
      setMessagesLoading(true)
      let cancelled = false
      ;(async () => {
        try {
          const res = await fetch(`/api/chats/${chat.id}/messages`, {
            cache: "no-store",
            credentials: "include",
          })
          if (!res.ok || cancelled) return
          const { messages: rows } = (await res.json()) as {
            messages: ChatMessage[]
          }
          if (!cancelled) setMessages(rows || [])
        } catch (e) {
          if (!cancelled) console.warn("history-content messages fetch failed:", e)
        } finally {
          if (!cancelled) {
            setMessagesFetched(true)
            setMessagesLoading(false)
          }
        }
      })()
      return () => {
        cancelled = true
      }
    }
  }, [isExpanded, messagesFetched, chat.id])

  const toggleVisibility = useCallback(async () => {
    setShareLoading(true)
    try {
      const csrf = document.cookie
        .split("; ")
        .find((c) => c.startsWith("csrf_token="))
        ?.split("=")[1]
      const res = await fetch(`/api/chats/${chat.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrf || "",
        },
        body: JSON.stringify({ public: !isPublic }),
      })
      if (res.ok) {
        setIsPublic(!isPublic)
        onUpdateChat(chat.id, { public: !isPublic })
      }
    } catch {}
    setShareLoading(false)
  }, [isPublic, chat.id, onUpdateChat])

  const copyLink = useCallback(() => {
    navigator.clipboard.writeText(shareUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [shareUrl])

  const roomSettings = useMemo(() => {
    let rs = chat.room_settings as any
    if (typeof rs === "string") {
      try { rs = JSON.parse(rs) } catch { rs = {} }
    }
    return rs || {}
  }, [chat.room_settings])

  const isDesktopChat = roomSettings?.source === "electron"
  const machineName = roomSettings?.machine_name || null
  const hasSchedule = roomSettings?.schedule?.enabled === true

  // Message stats
  const visibleMessages = useMemo(
    () => messages.filter((m) => m.role === "user" || m.role === "assistant"),
    [messages]
  )
  const userCount = useMemo(() => messages.filter((m) => m.role === "user").length, [messages])
  const assistantCount = useMemo(() => messages.filter((m) => m.role === "assistant").length, [messages])

  // Extract screenshots per message
  const messageScreenshots = useMemo(() => {
    const map: Record<number, { url: string; name: string }[]> = {}
    for (const msg of messages) {
      if (msg.experimental_attachments && Array.isArray(msg.experimental_attachments)) {
        const imgs: { url: string; name: string }[] = []
        for (const att of msg.experimental_attachments) {
          if (att.contentType?.startsWith("image/") || att.url?.match(/\.(png|jpg|jpeg|gif|webp)/i)) {
            imgs.push({ url: att.url, name: att.name || "Screenshot" })
          }
        }
        if (imgs.length > 0) map[msg.id] = imgs
      }
    }
    return map
  }, [messages])

  const totalScreenshots = useMemo(
    () => Object.values(messageScreenshots).reduce((sum, imgs) => sum + imgs.length, 0),
    [messageScreenshots]
  )

  return (
    <div
      className={cn(
        "group relative rounded-xl transition-all duration-300",
        "border bg-card/50 backdrop-blur-sm",
        "overflow-hidden",
        isSelected
          ? "border-foreground/20 bg-foreground/[0.03] shadow-sm"
          : isExpanded
            ? "border-border/50 bg-card/80 shadow-lg shadow-foreground/[0.02]"
            : "border-border/30 hover:bg-card/80 hover:border-border/50 hover:shadow-lg hover:shadow-foreground/[0.02]"
      )}
    >
      {/* Subtle top line */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/[0.08] to-transparent" />

      {/* Header — matches swarm card: caret + text, no icon */}
      <div className="flex items-start justify-between gap-4 w-full text-left px-5 py-4">
        <button
          onClick={isSelecting ? onSelect : onToggle}
          className="flex items-start gap-3 flex-1 min-w-0 text-left"
        >
          <div className="mt-1 text-muted-foreground/60">
            {isSelecting ? (
              isSelected ? (
                <CheckSquare className="size-4 text-foreground" weight="fill" />
              ) : (
                <Square className="size-4 text-muted-foreground/40" />
              )
            ) : isExpanded ? (
              <CaretDown className="size-3.5" weight="bold" />
            ) : (
              <CaretRight className="size-3.5" weight="bold" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <p className={cn("text-sm font-medium leading-snug mb-2", !isExpanded && "line-clamp-1")}>
              {chat.title || "Untitled Project"}
              {isDesktopChat && (
                <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-medium text-blue-500 dark:text-blue-400 ml-2 align-middle">
                  <Laptop size={10} weight="fill" />
                </span>
              )}
              {hasSchedule && (
                <span className="inline-flex shrink-0 items-center rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-500 dark:text-emerald-400 ml-1.5 align-middle">
                  <AgentIconFilled className="h-2.5 w-2.5" />
                </span>
              )}
            </p>
            <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
              <span className="flex items-center gap-1">
                <Clock className="size-3" />
                {formatDate(createdAt)}
              </span>
              {machineName && (
                <span className="flex items-center gap-1">
                  <Laptop className="size-3" />
                  {machineName}
                </span>
              )}
              {duration > 60000 && <span>{formatDuration(duration)}</span>}
            </div>
          </div>
        </button>

        {/* Status + Share */}
        <div className="flex items-center gap-2 shrink-0">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full",
              hasMessages
                ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
                : "text-muted-foreground bg-foreground/[0.05]"
            )}
          >
            {hasMessages ? (
              <>
                <CheckCircle className="size-3" weight="fill" />
                Completed
              </>
            ) : (
              <>
                <ChatTeardropText className="size-3" />
                New
              </>
            )}
          </span>

          <button
            onClick={copyTitle}
            className={cn(
              "inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border text-xs font-medium transition-all duration-200",
              titleCopied
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
                : "border-border/40 bg-background/60 text-muted-foreground hover:text-foreground hover:bg-background/90"
            )}
            title="Copy title"
          >
            {titleCopied ? <Check className="size-3.5" weight="bold" /> : <Copy className="size-3.5" />}
            <span className="hidden sm:inline">{titleCopied ? "Copied" : "Copy"}</span>
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation()
              router.push(`/c/${chat.id}`)
            }}
            className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-border/40 bg-background/60 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-background/90 transition-all duration-200"
            title="Open conversation"
          >
            <ArrowRight className="size-3.5" weight="bold" />
            <span className="hidden sm:inline">Open</span>
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation()
              setShareOpen(true)
            }}
            className={cn(
              "inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border text-xs font-medium transition-all duration-200",
              isPublic
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/15"
                : "border-border/40 bg-background/60 text-muted-foreground hover:text-foreground hover:bg-background/90"
            )}
            title={isPublic ? "Shared publicly" : "Share this chat"}
          >
            <ShareNetwork className="size-3.5" weight={isPublic ? "fill" : "regular"} />
            <span className="hidden sm:inline">{isPublic ? "Shared" : "Share"}</span>
          </button>
        </div>
      </div>

      {/* Expandable detail */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="border-t border-border/30">
              {messagesLoading ? (
                <div className="flex items-center justify-center py-10">
                  <div className="flex flex-col items-center gap-2">
                    <div className="relative h-6 w-6">
                      <div className="absolute inset-0 rounded-full border-2 border-muted" />
                      <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-foreground animate-spin" />
                    </div>
                    <span className="text-xs text-muted-foreground">Loading messages...</span>
                  </div>
                </div>
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center py-10 text-center">
                  <ChatTeardropText className="size-6 text-muted-foreground/30 mb-2" />
                  <p className="text-xs text-muted-foreground">No messages yet</p>
                </div>
              ) : (
                <ChatTree
                  messages={visibleMessages}
                  messageScreenshots={messageScreenshots}
                  userCount={userCount}
                  assistantCount={assistantCount}
                  totalScreenshots={totalScreenshots}
                  chatTitle={chat.title || "Untitled Project"}
                  chatId={chat.id}
                />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Share modal */}
      {shareOpen && <ShareModal
        chatId={chat.id}
        isPublic={isPublic}
        shareLoading={shareLoading}
        copied={copied}
        shareUrl={shareUrl}
        onToggleVisibility={toggleVisibility}
        onCopyLink={copyLink}
        onClose={() => setShareOpen(false)}
      />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ChatTree — two-column graph (User | Assistant) like SwarmTree
// ---------------------------------------------------------------------------

const TREE_MIN_ZOOM = 0.2
const TREE_MAX_ZOOM = 2
const TREE_ZOOM_STEP = 0.15

// Conversation turn — a user message paired with its assistant response
interface ConversationTurn {
  user: ChatMessage | null
  assistant: ChatMessage | null
  assistantSteps: ExtractedStep[]
}

function buildConversationTurns(messages: ChatMessage[]): ConversationTurn[] {
  const turns: ConversationTurn[] = []
  let currentTurn: ConversationTurn = { user: null, assistant: null, assistantSteps: [] }

  for (const msg of messages) {
    if (msg.role === "user") {
      // If we already have a user in the current turn, push it and start new
      if (currentTurn.user || currentTurn.assistant) {
        turns.push(currentTurn)
        currentTurn = { user: null, assistant: null, assistantSteps: [] }
      }
      currentTurn.user = msg
    } else if (msg.role === "assistant") {
      // If we already have an assistant, push turn and start new with just this assistant
      if (currentTurn.assistant) {
        turns.push(currentTurn)
        currentTurn = { user: null, assistant: null, assistantSteps: [] }
      }
      currentTurn.assistant = msg
      currentTurn.assistantSteps = extractStepsFromParts(msg.parts)
    }
  }

  // Push last turn if it has anything
  if (currentTurn.user || currentTurn.assistant) {
    turns.push(currentTurn)
  }

  return turns
}

function ChatTree({
  messages,
  messageScreenshots,
  userCount,
  assistantCount,
  totalScreenshots,
  chatTitle,
  chatId,
}: {
  messages: ChatMessage[]
  messageScreenshots: Record<number, { url: string; name: string }[]>
  userCount: number
  assistantCount: number
  totalScreenshots: number
  chatTitle: string
  chatId: string
}) {
  const router = useRouter()
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const isPanning = useRef(false)
  const panStart = useRef({ x: 0, y: 0 })
  const panOrigin = useRef({ x: 0, y: 0 })
  const lastPinchDist = useRef<number | null>(null)
  const [isMobile, setIsMobile] = useState(false)

  const turns = useMemo(() => buildConversationTurns(messages), [messages])

  const totalSteps = useMemo(
    () => turns.reduce((sum, t) => sum + t.assistantSteps.length, 0),
    [turns]
  )
  const stepScreenshotCount = useMemo(
    () => turns.reduce((sum, t) => sum + t.assistantSteps.filter((s) => s.screenshot).length, 0),
    [turns]
  )

  // Responsive content width — narrower on mobile for vertical stacking
  const contentW = isMobile ? 300 : 520

  // Auto-fit on mount + detect mobile
  useEffect(() => {
    if (!containerRef.current) return
    const containerW = containerRef.current.clientWidth
    const mobile = containerW < 500
    setIsMobile(mobile)
    const w = mobile ? 300 : 520
    const fit = Math.min(1, (containerW - 24) / w)
    const clamped = Math.max(TREE_MIN_ZOOM, Math.min(TREE_MAX_ZOOM, fit))
    setZoom(clamped)
    const scaledW = w * clamped
    setPan({ x: Math.max(0, (containerW - scaledW) / 2), y: 0 })
  }, [])

  // Attach non-passive wheel listener so preventDefault() actually stops page scroll
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const rect = el.getBoundingClientRect()
      const cursorX = e.clientX - rect.left
      const cursorY = e.clientY - rect.top
      setZoom((prev) => {
        const dir = e.deltaY < 0 ? 1 : -1
        const next = Math.max(TREE_MIN_ZOOM, Math.min(TREE_MAX_ZOOM, prev + dir * TREE_ZOOM_STEP))
        const ratio = next / prev
        setPan((p) => ({
          x: cursorX - ratio * (cursorX - p.x),
          y: cursorY - ratio * (cursorY - p.y),
        }))
        return next
      })
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [])

  // Pinch-to-zoom + touch pan
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault()
        const dx = e.touches[0].clientX - e.touches[1].clientX
        const dy = e.touches[0].clientY - e.touches[1].clientY
        lastPinchDist.current = Math.hypot(dx, dy)
      }
    }
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && lastPinchDist.current !== null) {
        e.preventDefault()
        const dx = e.touches[0].clientX - e.touches[1].clientX
        const dy = e.touches[0].clientY - e.touches[1].clientY
        const dist = Math.hypot(dx, dy)
        const delta = dist - lastPinchDist.current
        lastPinchDist.current = dist
        const rect = el.getBoundingClientRect()
        const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left
        const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top
        setZoom((prev) => {
          const next = Math.max(TREE_MIN_ZOOM, Math.min(TREE_MAX_ZOOM, prev + delta * 0.005))
          const ratio = next / prev
          setPan((p) => ({
            x: cx - ratio * (cx - p.x),
            y: cy - ratio * (cy - p.y),
          }))
          return next
        })
      }
    }
    const onTouchEnd = () => {
      lastPinchDist.current = null
    }
    el.addEventListener("touchstart", onTouchStart, { passive: false })
    el.addEventListener("touchmove", onTouchMove, { passive: false })
    el.addEventListener("touchend", onTouchEnd)
    return () => {
      el.removeEventListener("touchstart", onTouchStart)
      el.removeEventListener("touchmove", onTouchMove)
      el.removeEventListener("touchend", onTouchEnd)
    }
  }, [])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    const target = e.target as HTMLElement
    if (target.closest("button, a, input, [data-no-pan]")) return
    isPanning.current = true
    panStart.current = { x: e.clientX, y: e.clientY }
    panOrigin.current = { ...pan }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }, [pan])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isPanning.current) return
    setPan({
      x: panOrigin.current.x + (e.clientX - panStart.current.x),
      y: panOrigin.current.y + (e.clientY - panStart.current.y),
    })
  }, [])

  const handlePointerUp = useCallback(() => {
    isPanning.current = false
  }, [])

  const PAN_STEP = 60
  const panUp = useCallback(() => setPan((p) => ({ ...p, y: p.y + PAN_STEP })), [])
  const panDown = useCallback(() => setPan((p) => ({ ...p, y: p.y - PAN_STEP })), [])
  const panLeft = useCallback(() => setPan((p) => ({ ...p, x: p.x + PAN_STEP })), [])
  const panRight = useCallback(() => setPan((p) => ({ ...p, x: p.x - PAN_STEP })), [])
  const zoomIn = useCallback(() => setZoom((z) => Math.min(TREE_MAX_ZOOM, z + TREE_ZOOM_STEP)), [])
  const zoomOut = useCallback(() => setZoom((z) => Math.max(TREE_MIN_ZOOM, z - TREE_ZOOM_STEP)), [])
  const resetView = useCallback(() => {
    if (!containerRef.current) return
    const containerW = containerRef.current.clientWidth
    const w = containerW < 500 ? 300 : 520
    const fit = Math.min(1, (containerW - 24) / w)
    const clamped = Math.max(TREE_MIN_ZOOM, Math.min(TREE_MAX_ZOOM, fit))
    setZoom(clamped)
    const scaledW = w * clamped
    setPan({ x: Math.max(0, (containerW - scaledW) / 2), y: 0 })
  }, [])

  const zoomPercent = Math.round(zoom * 100)
  // Height: mobile vertical stacking needs more space per turn
  const turnHeight = isMobile ? 160 : 110
  const treeHeight = Math.min(800, Math.max(320, turns.length * turnHeight + 160))

  return (
    <div className="relative rounded-b-xl" style={{ height: treeHeight }}>
      {/* Dotted background */}
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-b-xl">
        <div
          className="absolute inset-0 opacity-[0.35] dark:opacity-[0.18]"
          style={{
            backgroundImage: "radial-gradient(circle, currentColor 0.5px, transparent 0.5px)",
            backgroundSize: "20px 20px",
          }}
        />
        <div className="absolute -top-10 -right-10 h-48 w-48 rounded-full bg-blue-500/[0.03] dark:bg-blue-400/[0.04] blur-3xl" />
        <div className="absolute -bottom-10 -left-10 h-40 w-40 rounded-full bg-teal-500/[0.03] dark:bg-teal-400/[0.04] blur-3xl" />
      </div>

      {/* Zoom controls */}
      <div className="absolute top-3 right-3 z-[10] flex items-center gap-1">
        <span className="text-[10px] tabular-nums text-muted-foreground/50 mr-1 select-none">{zoomPercent}%</span>
        {[
          { icon: MagnifyingGlassPlus, fn: zoomIn, title: "Zoom in" },
          { icon: MagnifyingGlassMinus, fn: zoomOut, title: "Zoom out" },
          { icon: ArrowCounterClockwise, fn: resetView, title: "Fit to view" },
        ].map(({ icon: Icon, fn, title }) => (
          <button
            key={title}
            onClick={fn}
            className="h-7 w-7 flex items-center justify-center rounded-lg border border-border/40 bg-background/90 backdrop-blur-sm text-muted-foreground hover:text-foreground hover:bg-background transition-colors shadow-sm"
            title={title}
          >
            <Icon className="size-3.5" />
          </button>
        ))}
      </div>

      {/* D-pad navigation — mobile only */}
      {isMobile && (
        <div className="absolute bottom-12 left-3 z-[10] flex flex-col items-center gap-0.5">
          <button
            onClick={panUp}
            className="h-7 w-7 flex items-center justify-center rounded-lg border border-border/40 bg-background/90 backdrop-blur-sm text-muted-foreground active:bg-background shadow-sm"
            title="Pan up"
          >
            <CaretUp className="size-3.5" weight="bold" />
          </button>
          <div className="flex items-center gap-0.5">
            <button
              onClick={panLeft}
              className="h-7 w-7 flex items-center justify-center rounded-lg border border-border/40 bg-background/90 backdrop-blur-sm text-muted-foreground active:bg-background shadow-sm"
              title="Pan left"
            >
              <CaretLeft className="size-3.5" weight="bold" />
            </button>
            <button
              onClick={resetView}
              className="h-7 w-7 flex items-center justify-center rounded-lg border border-border/40 bg-background/90 backdrop-blur-sm text-muted-foreground active:bg-background shadow-sm"
              title="Reset view"
            >
              <ArrowCounterClockwise className="size-3" />
            </button>
            <button
              onClick={panRight}
              className="h-7 w-7 flex items-center justify-center rounded-lg border border-border/40 bg-background/90 backdrop-blur-sm text-muted-foreground active:bg-background shadow-sm"
              title="Pan right"
            >
              <CaretRight className="size-3.5" weight="bold" />
            </button>
          </div>
          <button
            onClick={panDown}
            className="h-7 w-7 flex items-center justify-center rounded-lg border border-border/40 bg-background/90 backdrop-blur-sm text-muted-foreground active:bg-background shadow-sm"
            title="Pan down"
          >
            <CaretDown className="size-3.5" weight="bold" />
          </button>
        </div>
      )}

      {/* Hint */}
      <div className="absolute bottom-2.5 left-3 z-[10] flex items-center gap-1.5 text-[10px] text-muted-foreground/35 select-none pointer-events-none">
        <ArrowsOutCardinal className="size-3" />
        <span>{isMobile ? "Pinch to zoom" : "Drag to pan · Scroll to zoom"}</span>
      </div>

      {/* Open chat */}
      <div className="absolute bottom-3 right-3 z-[10]">
        <button
          onClick={() => router.push(`/c/${chatId}`)}
          className="px-4 py-2 rounded-xl border border-border/40 bg-background/90 backdrop-blur-sm text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-background transition-all shadow-sm flex items-center gap-1.5"
        >
          Open conversation
          <ArrowRight className="size-3.5" weight="bold" />
        </button>
      </div>

      {/* Pan/zoom viewport */}
      <div
        ref={containerRef}
        className="relative z-[1] overflow-hidden h-full select-none rounded-b-xl"
        style={{
          cursor: isPanning.current
            ? `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'%3E%3Cpath fill='%23000' stroke='%23fff' stroke-width='.5' d='M5 5.5a1 1 0 0 1 2 0V7h1V5.5a1 1 0 1 1 2 0V7h.5a1 1 0 0 1 2 0v3.5a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 2 0v1.5h.5V5.5a1 1 0 0 1 .5-.87z'/%3E%3C/svg%3E") 8 8, grabbing`
            : `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'%3E%3Cpath fill='%23000' stroke='%23fff' stroke-width='.5' d='M5 4a1 1 0 0 1 2 0v4a1 1 0 0 1-2 0V4zm3-.5a1 1 0 0 0-1 1V5h2V4.5a1 1 0 0 0-1-1zM10 5v.5h.5a1 1 0 0 1 2 0v3a1 1 0 0 1 0 .5v1.5a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 2 0v1.5h.5V4a1 1 0 0 1 2 0v1h.5z'/%3E%3C/svg%3E") 8 8, grab`,
          touchAction: "none",
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div
          ref={contentRef}
          className="origin-top-left will-change-transform"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transition: isPanning.current ? "none" : "transform 0.15s ease-out",
          }}
        >
          <div className="px-6 py-6" style={{ width: contentW }}>
            {/* Root node */}
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: EASE }}
              className="flex justify-center mb-4"
            >
              <div className="relative max-w-sm px-5 py-3 rounded-xl border border-border/40 bg-background/90 backdrop-blur-sm text-center shadow-sm">
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/20 to-transparent" />
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground/60 mb-1 font-medium">Conversation</p>
                <p className="text-sm leading-snug line-clamp-2">{chatTitle}</p>
                <div className="flex items-center justify-center gap-3 mt-2 text-[10px] text-muted-foreground/50">
                  <span className="flex items-center gap-1"><span className="size-1.5 rounded-full bg-blue-500" />{userCount} message{userCount !== 1 ? "s" : ""}</span>
                  <span className="flex items-center gap-1"><span className="size-1.5 rounded-full bg-teal-500" />{totalSteps > 0 ? `${totalSteps} step${totalSteps !== 1 ? "s" : ""}` : `${assistantCount} response${assistantCount !== 1 ? "s" : ""}`}</span>
                  {(totalScreenshots > 0 || stepScreenshotCount > 0) && <span className="flex items-center gap-1"><Camera className="size-2.5" />{totalScreenshots + stepScreenshotCount}</span>}
                </div>
              </div>
            </motion.div>

            {/* Conversation turns — alternating user ↔ assistant rows */}
            <div className="flex flex-col items-center gap-0">
              {turns.map((turn, ti) => (
                <motion.div
                  key={ti}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, delay: 0.1 + ti * 0.05, ease: EASE }}
                  className="w-full"
                >
                  {/* Vertical connector from root/previous turn */}
                  <div className="flex justify-center">
                    <div
                      className="w-px h-6"
                      style={{ backgroundImage: "repeating-linear-gradient(to bottom, hsl(var(--border) / 0.4) 0px, hsl(var(--border) / 0.4) 4px, transparent 4px, transparent 8px)" }}
                    />
                  </div>

                  {/* Turn row: horizontal on desktop, vertical on mobile */}
                  {isMobile ? (
                    <div className="flex flex-col items-center gap-0 w-full">
                      {/* User */}
                      <div className="w-full">
                        {turn.user ? (
                          <TurnUserNode
                            msg={turn.user}
                            screenshots={messageScreenshots[turn.user.id] || []}
                            index={ti}
                          />
                        ) : (
                          <div className="w-full rounded-lg border border-dashed border-border/30 bg-background/50 px-3 py-2 text-center">
                            <span className="text-[10px] text-muted-foreground/40 italic">No prompt</span>
                          </div>
                        )}
                      </div>
                      {/* Down connector */}
                      <div className="flex flex-col items-center py-1">
                        <div
                          className="w-px h-4"
                          style={{ backgroundImage: "repeating-linear-gradient(to bottom, hsl(var(--border) / 0.4) 0px, hsl(var(--border) / 0.4) 3px, transparent 3px, transparent 6px)" }}
                        />
                        <ArrowRight className="size-2.5 text-muted-foreground/40 rotate-90" weight="bold" />
                      </div>
                      {/* Assistant */}
                      <div className="w-full">
                        {turn.assistant ? (
                          turn.assistantSteps.length > 0 ? (
                            <TurnAssistantSteps steps={turn.assistantSteps} index={ti} />
                          ) : (
                            <TurnAssistantNode
                              msg={turn.assistant}
                              screenshots={messageScreenshots[turn.assistant.id] || []}
                              index={ti}
                            />
                          )
                        ) : (
                          <div className="w-full rounded-lg border border-dashed border-border/30 bg-background/50 px-3 py-2 text-center">
                            <span className="text-[10px] text-muted-foreground/40 italic">Pending...</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-[1fr_32px_1fr] items-start gap-0">
                      {/* User side */}
                      <div className="flex flex-col items-center">
                        {turn.user ? (
                          <TurnUserNode
                            msg={turn.user}
                            screenshots={messageScreenshots[turn.user.id] || []}
                            index={ti}
                          />
                        ) : (
                          <div className="w-full rounded-lg border border-dashed border-border/30 bg-background/50 px-3 py-2 text-center">
                            <span className="text-[10px] text-muted-foreground/40 italic">No prompt</span>
                          </div>
                        )}
                      </div>

                      {/* Horizontal connector arrow */}
                      <div className="flex items-center justify-center pt-3">
                        <div className="relative w-full flex items-center">
                          <div
                            className="flex-1 h-px"
                            style={{ backgroundImage: "repeating-linear-gradient(to right, hsl(var(--border) / 0.4) 0px, hsl(var(--border) / 0.4) 4px, transparent 4px, transparent 8px)" }}
                          />
                          <ArrowRight className="size-3 text-muted-foreground/40 shrink-0 -ml-0.5" weight="bold" />
                        </div>
                      </div>

                      {/* Assistant side */}
                      <div className="flex flex-col items-center">
                        {turn.assistant ? (
                          turn.assistantSteps.length > 0 ? (
                            <TurnAssistantSteps steps={turn.assistantSteps} index={ti} />
                          ) : (
                            <TurnAssistantNode
                              msg={turn.assistant}
                              screenshots={messageScreenshots[turn.assistant.id] || []}
                              index={ti}
                            />
                          )
                        ) : (
                          <div className="w-full rounded-lg border border-dashed border-border/30 bg-background/50 px-3 py-2 text-center">
                            <span className="text-[10px] text-muted-foreground/40 italic">Pending...</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Turn node components — compact cards for the alternating flow
// ---------------------------------------------------------------------------

function TurnUserNode({
  msg,
  screenshots,
  index,
}: {
  msg: ChatMessage
  screenshots: { url: string; name: string }[]
  index: number
}) {
  const preview = useMemo(() => {
    const content = msg.content || ""
    let cleaned = content
      .replace(/\[TASK_PLAN_START\][\s\S]*?\[TASK_PLAN_END\]/g, "")
      .replace(/\[REASONING_START\][\s\S]*?\[REASONING_END\]/g, "")
      .replace(/\[THINKING_START\][\s\S]*?\[THINKING_END\]/g, "")
      .replace(/```[\s\S]*?```/g, "[code]")
      .replace(/`[^`]+`/g, "[code]")
      .replace(/[#*_~\[\]()]/g, "")
      .replace(/\s+/g, " ")
      .trim()
    if (cleaned.length > 120) cleaned = cleaned.substring(0, 120).trim() + "..."
    return cleaned
  }, [msg.content])

  return (
    <div className="w-full rounded-lg border border-blue-500/25 bg-blue-50/60 dark:bg-blue-950/20 px-3 py-2 shadow-sm backdrop-blur-sm">
      <div className="flex items-center gap-1.5 mb-1">
        <User className="size-3 text-blue-500" weight="fill" />
        <span className="text-[10px] font-medium text-blue-600 dark:text-blue-400">You</span>
        {msg.created_at && (
          <span className="text-[9px] text-muted-foreground/40 ml-auto">{formatTime(new Date(msg.created_at))}</span>
        )}
      </div>
      {preview && (
        <p className="text-[11px] leading-relaxed text-foreground/80 line-clamp-2">{preview}</p>
      )}
      {screenshots.length > 0 && (
        <div className="flex gap-1 mt-1.5 overflow-x-auto scrollbar-invisible">
          {screenshots.slice(0, 2).map((img, j) => (
            <ScreenshotThumb key={j} src={img.url} alt={img.name} />
          ))}
          {screenshots.length > 2 && (
            <span className="shrink-0 flex items-center justify-center h-14 w-8 rounded border border-border/20 bg-foreground/[0.02] text-[9px] text-muted-foreground/50">
              +{screenshots.length - 2}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function TurnAssistantNode({
  msg,
  screenshots,
  index,
}: {
  msg: ChatMessage
  screenshots: { url: string; name: string }[]
  index: number
}) {
  const preview = useMemo(() => {
    const content = msg.content || ""
    let cleaned = content
      .replace(/\[TASK_PLAN_START\][\s\S]*?\[TASK_PLAN_END\]/g, "")
      .replace(/\[REASONING_START\][\s\S]*?\[REASONING_END\]/g, "")
      .replace(/\[THINKING_START\][\s\S]*?\[THINKING_END\]/g, "")
      .replace(/<cua-section\s+[^>]*>/g, "")
      .replace(/<\/cua-section>/g, "")
      .replace(/\[TASK_STATUS:[^:]+:[^\]]+\]/g, "")
      .replace(/\[TASK_SUMMARY:[^:]+:[^\]]+\]/g, "")
      .replace(/```[\s\S]*?```/g, "[code]")
      .replace(/`[^`]+`/g, "[code]")
      .replace(/[#*_~\[\]()]/g, "")
      .replace(/\s+/g, " ")
      .trim()
    if (cleaned.length > 120) cleaned = cleaned.substring(0, 120).trim() + "..."
    return cleaned
  }, [msg.content])

  return (
    <div className="w-full rounded-lg border border-teal-500/25 bg-teal-50/60 dark:bg-teal-950/20 px-3 py-2 shadow-sm backdrop-blur-sm">
      <div className="flex items-center gap-1.5 mb-1">
        <AgentIconFilled className="size-3 text-teal-500" />
        <span className="text-[10px] font-medium text-teal-600 dark:text-teal-400">Coasty</span>
        {msg.created_at && (
          <span className="text-[9px] text-muted-foreground/40 ml-auto">{formatTime(new Date(msg.created_at))}</span>
        )}
      </div>
      {preview && (
        <p className="text-[11px] leading-relaxed text-foreground/80 line-clamp-2">{preview}</p>
      )}
      {screenshots.length > 0 && (
        <div className="flex gap-1 mt-1.5 overflow-x-auto scrollbar-invisible">
          {screenshots.slice(0, 2).map((img, j) => (
            <ScreenshotThumb key={j} src={img.url} alt={img.name} />
          ))}
          {screenshots.length > 2 && (
            <span className="shrink-0 flex items-center justify-center h-14 w-8 rounded border border-border/20 bg-foreground/[0.02] text-[9px] text-muted-foreground/50">
              +{screenshots.length - 2}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function TurnAssistantSteps({
  steps,
  index,
}: {
  steps: ExtractedStep[]
  index: number
}) {
  return (
    <div className="w-full rounded-lg border border-teal-500/25 bg-teal-50/60 dark:bg-teal-950/20 px-3 py-2 shadow-sm backdrop-blur-sm">
      <div className="flex items-center gap-1.5 mb-1.5">
        <AgentIconFilled className="size-3 text-teal-500" />
        <span className="text-[10px] font-medium text-teal-600 dark:text-teal-400">Coasty</span>
        <span className="text-[9px] text-muted-foreground/40 ml-auto">{steps.length} step{steps.length !== 1 ? "s" : ""}</span>
      </div>
      {/* Each step as its own row: badge + screenshot */}
      <div className="flex flex-col gap-1.5">
        {steps.map((step, i) => {
          const label = step.toolName
            .replace(/_/g, " ")
            .replace(/([a-z])([A-Z])/g, "$1 $2")
            .replace(/^./, (c) => c.toUpperCase())
          return (
            <div key={i}>
              <span
                className={cn(
                  "inline-flex items-center gap-0.5 text-[9px] leading-none px-1.5 py-0.5 rounded-full font-medium",
                  step.status === "error"
                    ? "text-red-500/80 bg-red-500/8"
                    : step.status === "success"
                      ? "text-emerald-600/80 dark:text-emerald-400/70 bg-emerald-500/8"
                      : "text-muted-foreground/60 bg-muted-foreground/8"
                )}
              >
                <CheckCircle className="size-2" weight="fill" />
                {label}
              </span>
              {step.screenshot && (
                <div className="mt-1">
                  <ScreenshotThumb src={step.screenshot} alt={label} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Share modal
// ---------------------------------------------------------------------------

function ShareModal({
  chatId,
  isPublic,
  shareLoading,
  copied,
  shareUrl,
  onToggleVisibility,
  onCopyLink,
  onClose,
}: {
  chatId: string
  isPublic: boolean
  shareLoading: boolean
  copied: boolean
  shareUrl: string
  onToggleVisibility: () => void
  onCopyLink: () => void
  onClose: () => void
}) {
  const socialText = `Check out my AI conversation on @coasty_ai:`
  const socialTextPlain = `Check out my AI conversation on Coasty: ${shareUrl}`

  const socials = [
    {
      icon: TwitterLogo,
      label: "X",
      color: "hover:bg-sky-500/10 hover:text-sky-600 dark:hover:text-sky-400 hover:border-sky-500/30",
      url: `https://twitter.com/intent/tweet?text=${encodeURIComponent(socialText)}&url=${encodeURIComponent(shareUrl)}`,
    },
    {
      icon: LinkedinLogo,
      label: "LinkedIn",
      color: "hover:bg-blue-600/10 hover:text-blue-600 dark:hover:text-blue-400 hover:border-blue-600/30",
      url: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`,
    },
    {
      icon: FacebookLogo,
      label: "Facebook",
      color: "hover:bg-blue-500/10 hover:text-blue-500 dark:hover:text-blue-400 hover:border-blue-500/30",
      url: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`,
    },
    {
      icon: WhatsappLogo,
      label: "WhatsApp",
      color: "hover:bg-green-500/10 hover:text-green-600 dark:hover:text-green-400 hover:border-green-500/30",
      url: `https://wa.me/?text=${encodeURIComponent(socialTextPlain)}`,
    },
    {
      icon: TelegramLogo,
      label: "Telegram",
      color: "hover:bg-sky-400/10 hover:text-sky-500 dark:hover:text-sky-400 hover:border-sky-400/30",
      url: `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(socialText)}`,
    },
    {
      icon: RedditLogo,
      label: "Reddit",
      color: "hover:bg-orange-500/10 hover:text-orange-500 dark:hover:text-orange-400 hover:border-orange-500/30",
      url: `https://reddit.com/submit?url=${encodeURIComponent(shareUrl)}&title=${encodeURIComponent(socialText)}`,
    },
  ]

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
      />
      <div
        className="relative z-[101] w-[400px] max-w-[calc(100vw-2rem)] rounded-2xl border border-border/50 bg-card shadow-2xl shadow-black/20"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div className="flex items-center gap-2.5">
            <div
              className={cn(
                "h-8 w-8 rounded-lg flex items-center justify-center",
                isPublic ? "bg-emerald-500/10" : "bg-amber-500/10"
              )}
            >
              {isPublic ? (
                <Globe className="size-4 text-emerald-500" weight="fill" />
              ) : (
                <Lock className="size-4 text-amber-500" weight="fill" />
              )}
            </div>
            <div>
              <h3 className="text-sm font-medium">
                {isPublic ? "This chat is live!" : "Share this chat"}
              </h3>
              <p className="text-[11px] text-muted-foreground/70">
                {isPublic
                  ? "Anyone with the link can view the conversation"
                  : "Make it public to get a shareable link"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="px-5 pb-4">
          <div className="flex items-center justify-between rounded-xl bg-muted/40 px-3.5 py-3">
            <p className="text-xs font-medium">{isPublic ? "Public" : "Private"}</p>
            <button
              onClick={onToggleVisibility}
              disabled={shareLoading}
              className={cn(
                "relative h-6 w-11 rounded-full transition-colors duration-200 shrink-0",
                isPublic ? "bg-emerald-500" : "bg-muted-foreground/20"
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200",
                  isPublic && "translate-x-5"
                )}
              />
            </button>
          </div>
        </div>

        {isPublic && (
          <div className="px-5 pb-5 space-y-3">
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0 rounded-lg border border-border/40 bg-background/50 px-3 py-2">
                <p className="text-xs text-muted-foreground truncate font-mono">{shareUrl}</p>
              </div>
              <button
                onClick={onCopyLink}
                className={cn(
                  "h-9 px-3 flex items-center justify-center gap-1.5 rounded-lg border text-xs font-medium transition-all duration-200 shrink-0",
                  copied
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
                    : "border-border/40 bg-background/60 text-muted-foreground hover:text-foreground hover:bg-background/90"
                )}
              >
                {copied ? (
                  <><Check className="size-3.5" weight="bold" />Copied</>
                ) : (
                  <><Copy className="size-3.5" />Copy</>
                )}
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {socials.map(({ icon: Icon, label, color, url }) => (
                <a
                  key={label}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    "h-9 flex items-center justify-center gap-1.5 rounded-lg border border-border/40 bg-background/60 text-muted-foreground text-xs font-medium transition-all duration-200",
                    color
                  )}
                >
                  <Icon className="size-3.5" weight="fill" />
                  {label}
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}

// ---------------------------------------------------------------------------
// Screenshot components (matching swarm-tree style)
// ---------------------------------------------------------------------------

function ScreenshotThumb({ src, alt }: { src: string; alt: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <motion.button
        type="button"
        className="shrink-0 cursor-pointer focus:outline-none transition-transform duration-150 hover:scale-[1.03]"
        whileTap={{ scale: 0.97 }}
        onClick={() => setOpen(true)}
      >
        <div className="h-14 rounded-md overflow-hidden ring-1 ring-border/25 hover:ring-border/50 transition-all">
          <img src={src} alt={alt} className="h-full w-auto object-cover" draggable={false} loading="lazy" />
        </div>
      </motion.button>
      <AnimatePresence>
        {open && <ScreenshotLightbox src={src} onClose={() => setOpen(false)} />}
      </AnimatePresence>
    </>
  )
}

function ScreenshotLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm cursor-zoom-out"
      onClick={onClose}
    >
      <motion.img
        src={src}
        alt="Screenshot"
        initial={{ scale: 0.92 }}
        animate={{ scale: 1 }}
        exit={{ scale: 0.95 }}
        transition={{ type: "spring", stiffness: 400, damping: 25 }}
        className="max-w-[90vw] max-h-[90vh] rounded-lg object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </motion.div>,
    document.body
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return "Just now"
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainSec = seconds % 60
  if (minutes < 60) return `${minutes}m ${remainSec}s`
  const hours = Math.floor(minutes / 60)
  const remainMin = minutes % 60
  return `${hours}h ${remainMin}m`
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
}
