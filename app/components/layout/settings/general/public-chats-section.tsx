"use client"

import { useChats } from "@/lib/chat-store/chats/provider"
import { useUser } from "@/lib/user-store/provider"
import { createClient } from "@/lib/supabase/client"
import { useEffect, useState, useCallback } from "react"
import {
  Globe,
  Copy,
  ExternalLink,
  Loader2,
  Check,
  Search,
  Lock,
  RefreshCw,
} from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/toast"
import { cn } from "@/lib/utils"
import Link from "next/link"
import type { Chats } from "@/lib/chat-store/types"

type PublicChatRow = {
  id: string
  title: string | null
  created_at: string | null
  updated_at: string | null
  public: boolean | null
}

const fadeUp = (delay: number) => ({
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.35, delay, ease: [0.22, 1, 0.36, 1] as const },
})

const SHARE_BASE = "https://coasty.ai/share/"

export function PublicChatsSection() {
  const { updateChat } = useChats()
  const { user } = useUser()
  const [allPublic, setAllPublic] = useState<PublicChatRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [bulkRunning, setBulkRunning] = useState(false)

  const fetchPublicChats = useCallback(async () => {
    if (!user?.id) return
    setIsLoading(true)
    setFetchError(null)
    try {
      const supabase = createClient()
      if (!supabase) throw new Error("Supabase not configured")
      const { data, error } = await supabase
        .from("chats")
        .select("id, title, created_at, updated_at, public")
        .eq("user_id", user.id)
        .eq("public", true)
        .order("updated_at", { ascending: false })

      if (error) throw error
      setAllPublic((data as PublicChatRow[]) || [])
    } catch (err) {
      console.error("Failed to load public chats:", err)
      setFetchError(err instanceof Error ? err.message : "Failed to load")
    } finally {
      setIsLoading(false)
    }
  }, [user?.id])

  useEffect(() => {
    fetchPublicChats()
  }, [fetchPublicChats])

  const publicChats = allPublic.filter((c) =>
    search.trim()
      ? (c.title || "").toLowerCase().includes(search.toLowerCase())
      : true
  )

  const handleCopy = async (id: string) => {
    try {
      await navigator.clipboard.writeText(`${SHARE_BASE}${id}`)
      setCopiedId(id)
      setTimeout(
        () => setCopiedId((curr) => (curr === id ? null : curr)),
        1500
      )
    } catch {
      toast({ title: "Failed to copy link", status: "error" })
    }
  }

  const persistPrivate = async (id: string) => {
    const supabase = createClient()
    if (!supabase) throw new Error("Supabase not configured")
    const { error } = await supabase
      .from("chats")
      .update({ public: false, updated_at: new Date().toISOString() })
      .eq("id", id)
    if (error) throw error
    // Best-effort sync of the in-memory chats list used by the sidebar.
    // It's paginated so the chat may not be present — ignore failures.
    try {
      await updateChat(id, { public: false } as Partial<Chats>)
    } catch {
      /* sidebar list may not contain this chat — fine */
    }
  }

  const handleMakePrivate = async (chat: PublicChatRow) => {
    setPendingId(chat.id)
    try {
      await persistPrivate(chat.id)
      setAllPublic((prev) => prev.filter((c) => c.id !== chat.id))
      toast({ title: `"${chat.title || "Chat"}" is now private`, status: "success" })
    } catch {
      toast({ title: "Failed to update visibility", status: "error" })
    } finally {
      setPendingId((curr) => (curr === chat.id ? null : curr))
    }
  }

  const handleMakeAllPrivate = async () => {
    if (allPublic.length === 0 || bulkRunning) return
    const ok = window.confirm(
      `Make all ${allPublic.length} public chat${allPublic.length === 1 ? "" : "s"} private? Existing share links will stop working.`
    )
    if (!ok) return

    setBulkRunning(true)
    const succeeded: string[] = []
    let failed = 0
    for (const c of allPublic) {
      try {
        await persistPrivate(c.id)
        succeeded.push(c.id)
      } catch {
        failed++
      }
    }
    setAllPublic((prev) => prev.filter((c) => !succeeded.includes(c.id)))
    setBulkRunning(false)
    toast({
      title:
        failed === 0
          ? "All chats made private"
          : `Made ${succeeded.length} private, ${failed} failed`,
      status: failed === 0 ? "success" : "error",
    })
  }

  return (
    <div className="space-y-8">
      {/* ─── Header card ─────────────────────────────────────────── */}
      <motion.div {...fadeUp(0)}>
        <div className="rounded-xl border border-border/30 bg-card/20 p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center shrink-0">
                <Globe className="h-5 w-5 text-foreground/40" strokeWidth={1.75} />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">Public Chats</h3>
                <p className="text-xs text-muted-foreground/50 mt-0.5">
                  {allPublic.length === 0
                    ? "Anyone with a share link can view chats listed here"
                    : `${allPublic.length} chat${allPublic.length === 1 ? "" : "s"} accessible via share link`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={fetchPublicChats}
                disabled={isLoading}
                title="Refresh"
                className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground/50 hover:text-foreground hover:bg-foreground/[0.05] transition-colors disabled:opacity-40"
              >
                <RefreshCw
                  className={cn("h-3.5 w-3.5", isLoading && "animate-spin")}
                />
              </button>
              {allPublic.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleMakeAllPrivate}
                  disabled={bulkRunning}
                  className="rounded-lg text-xs gap-1.5"
                >
                  {bulkRunning ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Lock className="h-3 w-3" />
                  )}
                  Make all private
                </Button>
              )}
            </div>
          </div>
        </div>
      </motion.div>

      {/* ─── Search ──────────────────────────────────────────────── */}
      {allPublic.length > 4 && (
        <motion.div {...fadeUp(0.05)} className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/30" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search public chats..."
            className="w-full h-9 pl-9 pr-3 rounded-lg bg-foreground/[0.03] border border-border/30 text-[13px] placeholder:text-muted-foreground/30 focus:outline-none focus:border-foreground/15 focus:ring-1 focus:ring-foreground/[0.06] transition-colors"
          />
        </motion.div>
      )}

      {/* ─── Fetch error ─────────────────────────────────────────── */}
      {fetchError && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/[0.04] px-3 py-2 text-[12px] text-red-500/80">
          Couldn&apos;t load public chats: {fetchError}
        </div>
      )}

      {/* ─── List / Empty / Loading ──────────────────────────────── */}
      <motion.div {...fadeUp(0.1)}>
        {isLoading && allPublic.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground/30" />
          </div>
        ) : publicChats.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/30 bg-card/10 py-14 px-4 text-center">
            <div className="mx-auto h-12 w-12 rounded-xl bg-foreground/[0.03] flex items-center justify-center mb-4">
              <Globe className="h-5 w-5 text-muted-foreground/30" />
            </div>
            <p className="text-sm font-medium text-foreground/50 mb-1">
              {search ? "No matching public chats" : "No public chats yet"}
            </p>
            <p className="text-[13px] text-muted-foreground/40 max-w-[260px] mx-auto leading-relaxed">
              {search
                ? "Try a different search term"
                : "Open any chat and use Share to make it accessible via a public link."}
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-border/30 bg-card/20 divide-y divide-border/20 overflow-hidden">
            <AnimatePresence initial={false}>
              {publicChats.map((chat) => {
                const url = `${SHARE_BASE}${chat.id}`
                const isCopied = copiedId === chat.id
                const isPending = pendingId === chat.id
                const dateLabel = chat.updated_at
                  ? new Date(chat.updated_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })
                  : null

                return (
                  <motion.div
                    key={chat.id}
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="group flex items-center gap-3 px-4 py-3 hover:bg-foreground/[0.02] transition-colors"
                  >
                    {/* Live status dot */}
                    <span className="relative flex h-2 w-2 shrink-0">
                      <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500/50 animate-ping" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500/70" />
                    </span>

                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium truncate text-foreground/90">
                        {chat.title || "Untitled chat"}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[11px] text-muted-foreground/40 truncate">
                          {url}
                        </span>
                        {dateLabel && (
                          <>
                            <span className="text-[11px] text-muted-foreground/20">
                              ·
                            </span>
                            <span className="text-[11px] text-muted-foreground/40 shrink-0">
                              {dateLabel}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0 opacity-70 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleCopy(chat.id)}
                        title="Copy share link"
                        className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground/50 hover:text-foreground hover:bg-foreground/[0.05] transition-colors"
                      >
                        {isCopied ? (
                          <Check className="h-3.5 w-3.5 text-emerald-500" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                      <Link
                        href={`/share/${chat.id}`}
                        target="_blank"
                        title="Open shared chat in new tab"
                        className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground/50 hover:text-foreground hover:bg-foreground/[0.05] transition-colors"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Link>
                      <button
                        onClick={() => !isPending && handleMakePrivate(chat)}
                        disabled={isPending}
                        title="Make this chat private"
                        className={cn(
                          "ml-1 inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11px] font-medium",
                          "border border-border/40 text-muted-foreground/70",
                          "hover:text-foreground hover:bg-foreground/[0.04] hover:border-border/60",
                          "transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        )}
                      >
                        {isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <>
                            <Lock className="h-3 w-3" />
                            Make private
                          </>
                        )}
                      </button>
                    </div>
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </div>
        )}
      </motion.div>

      {/* ─── Footer hint ─────────────────────────────────────────── */}
      {allPublic.length > 0 && (
        <motion.p
          {...fadeUp(0.15)}
          className="text-[11px] text-muted-foreground/40 leading-relaxed"
        >
          Making a chat private will immediately invalidate its share link. Anyone
          who opens the link afterwards will see a not-found page.
        </motion.p>
      )}
    </div>
  )
}
