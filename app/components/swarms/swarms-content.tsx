"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  GitFork,
  CheckCircle,
  XCircle,
  Warning,
  Clock,
  CaretDown,
  CaretRight,
  Terminal,
  Robot,
  Monitor,
  CircleNotch,
  ArrowClockwise,
  ShareNetwork,
  Globe,
  Lock,
  Copy,
  Check,
  X,
  TwitterLogo,
  LinkedinLogo,
  WhatsappLogo,
  FacebookLogo,
  TelegramLogo,
  RedditLogo,
  BookOpen,
  DownloadSimple,
  FilePdf,
  Stop,
  Pause,
  Play,
} from "@phosphor-icons/react"
import Link from "next/link"
import { AnimatePresence, motion } from "motion/react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"
import { Markdown } from "@/components/prompt-kit/markdown"
import { APP_DOMAIN } from "@/lib/config"
import { EXPORT_SANS_STACK, EXPORT_MONO_STACK } from "@/lib/fonts"
import { SwarmTree, type SwarmEvent } from "./swarm-tree"
import { PageLoader } from "@/components/common/page-loader"
import { useTranslations } from "next-intl"

const EASE = [0.22, 1, 0.36, 1] as const

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SwarmRun {
  id: string
  swarm_id: string
  prompt: string
  machine_count: number
  status: "creating" | "running" | "paused" | "completed" | "failed" | "cancelled"
  model: string | null
  max_steps: number | null
  result_summary: string | null
  public: boolean
  persistent: boolean
  created_at: string
  completed_at: string | null
}


// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SwarmsContent() {
  const tLoader = useTranslations("pageLoaders.swarms")
  const [swarms, setSwarms] = useState<SwarmRun[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const autoExpandedRef = useRef(false)
  const router = useRouter()

  const fetchSwarms = useCallback(async () => {
    try {
      const res = await fetch("/api/swarms")
      if (res.ok) {
        const data = await res.json()
        setSwarms(data.swarms || [])
        return data.swarms || []
      }
    } catch (e) {
      console.error("Failed to fetch swarms:", e)
    }
    return null
  }, [])

  // Initial fetch
  useEffect(() => {
    fetchSwarms().then((list) => {
      setLoading(false)
      // Auto-expand the first running/creating swarm
      if (list && !autoExpandedRef.current) {
        const active = list.find((s: SwarmRun) => s.status === "running" || s.status === "creating" || s.status === "paused")
        if (active) {
          setExpandedId(active.swarm_id)
          autoExpandedRef.current = true
        }
      }
    })
  }, [fetchSwarms])

  // Poll swarm list every 5s while any swarm is active
  const hasActiveSwarm = useMemo(
    () => swarms.some((s) => s.status === "running" || s.status === "creating" || s.status === "paused"),
    [swarms]
  )

  useEffect(() => {
    if (!hasActiveSwarm) return
    const interval = setInterval(() => {
      fetchSwarms()
    }, 5000)
    return () => clearInterval(interval)
  }, [hasActiveSwarm, fetchSwarms])

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    await fetchSwarms()
    setRefreshing(false)
  }, [fetchSwarms])

  const handleToggle = useCallback((swarmId: string) => {
    setExpandedId((prev) => (prev === swarmId ? null : swarmId))
  }, [])

  const statusFilters = useMemo(() => {
    const counts: Record<string, number> = { all: swarms.length }
    for (const s of swarms) {
      counts[s.status] = (counts[s.status] || 0) + 1
    }
    return [
      { id: "all", label: "All", count: counts.all },
      { id: "completed", label: "Completed", count: counts.completed || 0 },
      { id: "running", label: "Running", count: counts.running || 0 },
      { id: "paused", label: "Paused", count: counts.paused || 0 },
      { id: "failed", label: "Failed", count: counts.failed || 0 },
    ].filter((f) => f.id === "all" || f.count > 0)
  }, [swarms])

  const filteredSwarms = useMemo(
    () => statusFilter === "all" ? swarms : swarms.filter((s) => s.status === statusFilter),
    [swarms, statusFilter]
  )

  return (
    <PageLoader
      isLoading={loading}
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
              Swarm Runs
              {swarms.length > 0 && (
                <span className="text-sm font-normal text-muted-foreground ml-1">
                  ({swarms.length})
                </span>
              )}
            </h1>
            <div className="flex items-center gap-3 mt-1.5">
              <p className="text-muted-foreground text-sm">
                View parallel task executions across multiple machines
              </p>
              <Link
                href="/guide?tab=swarm-mode"
                className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-foreground/[0.05] px-2.5 py-1 text-xs font-medium text-foreground/70 hover:text-foreground hover:border-border hover:bg-foreground/[0.08] transition-all"
              >
                <BookOpen size={14} weight="duotone" />
                Guide
              </Link>
            </div>
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className={cn(
              "h-9 w-9 flex items-center justify-center rounded-xl border border-border/40 bg-background/60 backdrop-blur-sm text-muted-foreground transition-all duration-200 shadow-sm",
              "hover:text-foreground hover:bg-background/90 hover:border-border/60 hover:shadow-md",
              "active:scale-95",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
            title="Refresh swarm runs"
          >
            <ArrowClockwise
              className={cn("size-4", refreshing && "animate-spin")}
              weight="bold"
            />
          </button>
        </motion.div>

        {/* Filters */}
        {swarms.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.05, ease: EASE }}
            className="flex flex-wrap gap-1.5"
          >
            {statusFilters.map((filter) => (
              <button
                key={filter.id}
                onClick={() => setStatusFilter(filter.id)}
                className={cn(
                  "px-3.5 py-1.5 rounded-lg text-sm transition-all duration-200",
                  statusFilter === filter.id
                    ? "bg-foreground text-background font-medium shadow-sm"
                    : "bg-transparent hover:bg-foreground/[0.05] text-muted-foreground hover:text-foreground"
                )}
              >
                <span className="flex items-center gap-2">
                  {filter.label}
                  {filter.count > 0 && (
                    <span
                      className={cn(
                        "text-[11px] tabular-nums px-1.5 py-0.5 rounded-full",
                        statusFilter === filter.id
                          ? "bg-background/20"
                          : "bg-foreground/[0.06]"
                      )}
                    >
                      {filter.count}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </motion.div>
        )}

        {/* Empty state */}
        {swarms.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1, ease: EASE }}
            className="relative rounded-2xl border border-border/30 bg-card/30 backdrop-blur-sm overflow-hidden"
          >
            <div className="pointer-events-none absolute -top-20 -left-20 h-72 w-72 rounded-full bg-foreground/[0.02] blur-3xl" />
            <div className="pointer-events-none absolute -bottom-20 -right-20 h-72 w-72 rounded-full bg-foreground/[0.015] blur-3xl" />

            <div className="relative flex flex-col items-center px-4 sm:px-6 py-10 sm:py-16 text-center">
              <div className="mb-8 sm:mb-10 flex items-center gap-2">
                {[GitFork, Monitor, Robot].map((Icon, i) => (
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

              <h2 className="text-xl sm:text-2xl font-medium tracking-tight mb-2.5">No swarm runs yet</h2>
              <p className="text-xs sm:text-sm text-muted-foreground max-w-sm mx-auto leading-relaxed mb-8 sm:mb-12">
                Use the lightning bolt toggle in chat to execute tasks across multiple machines in parallel.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-3 w-full max-w-2xl mb-8 sm:mb-12">
                {[
                  {
                    icon: GitFork,
                    title: "Parallel Execution",
                    desc: "Run the same task on multiple machines simultaneously",
                  },
                  {
                    icon: Robot,
                    title: "Auto Cleanup",
                    desc: "Temporary machines are deleted after every run",
                  },
                  {
                    icon: Monitor,
                    title: "Full Logs",
                    desc: "Screenshots, tool calls, and step-by-step history",
                  },
                ].map(({ icon: Icon, title, desc }, i) => (
                  <motion.div
                    key={title}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.4 + i * 0.08, ease: EASE }}
                    className="rounded-xl border border-border/30 bg-background/30 backdrop-blur-sm px-4 py-4 text-left"
                  >
                    <div className="mb-2.5 flex h-8 w-8 items-center justify-center rounded-lg bg-foreground/[0.04]">
                      <Icon className="h-4 w-4 text-foreground/60" />
                    </div>
                    <p className="text-sm font-medium mb-1">{title}</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>
        ) : filteredSwarms.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <div className="border border-border/30 bg-card/30 backdrop-blur-sm rounded-2xl">
              <div className="flex flex-col items-center justify-center py-14">
                <GitFork className="h-10 w-10 text-muted-foreground/40 mb-4" weight="duotone" />
                <h3 className="text-base font-medium mb-1.5">
                  No {statusFilter !== "all" ? statusFilter : ""} runs
                </h3>
                <p className="text-sm text-muted-foreground">
                  {statusFilter === "all"
                    ? "No swarm runs found."
                    : `No runs are currently ${statusFilter}.`}
                </p>
              </div>
            </div>
          </motion.div>
        ) : (
          /* Swarm cards list */
          <div className="space-y-3">
            {filteredSwarms.map((swarm, i) => (
              <motion.div
                key={swarm.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: 0.05 + i * 0.04, ease: EASE }}
              >
                <SwarmRunCard
                  swarm={swarm}
                  isExpanded={expandedId === swarm.swarm_id}
                  onToggle={() => handleToggle(swarm.swarm_id)}
                  onRefresh={fetchSwarms}
                />
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
    </PageLoader>
  )
}

// ---------------------------------------------------------------------------
// Swarm card
// ---------------------------------------------------------------------------

function SwarmRunCard({
  swarm,
  isExpanded,
  onToggle,
  onRefresh,
}: {
  swarm: SwarmRun
  isExpanded: boolean
  onToggle: () => void
  onRefresh: () => void
}) {
  const [events, setEvents] = useState<SwarmEvent[]>([])
  const [eventsLoading, setEventsLoading] = useState(false)
  const [eventsFetched, setEventsFetched] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [isPublic, setIsPublic] = useState(swarm.public ?? false)
  const [shareLoading, setShareLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [promptCopied, setPromptCopied] = useState(false)

  const copyPrompt = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard.writeText(swarm.prompt)
    setPromptCopied(true)
    setTimeout(() => setPromptCopied(false), 2000)
  }, [swarm.prompt])

  const isActive = swarm.status === "running" || swarm.status === "creating" || swarm.status === "paused"

  const handleStop = useCallback(async () => {
    setStopping(true)
    try {
      await fetch(`/api/swarm/${swarm.swarm_id}/stop`, { method: "POST" })
    } catch {
      // best-effort
    }
    setStopping(false)
    // Refresh list to pick up the "cancelled" status from the DB
    onRefresh()
  }, [swarm.swarm_id, onRefresh])

  const [pausing, setPausing] = useState(false)
  const [resuming, setResuming] = useState(false)

  const handlePause = useCallback(async () => {
    setPausing(true)
    try {
      await fetch(`/api/swarm/${swarm.swarm_id}/pause`, { method: "POST" })
    } catch {}
    setPausing(false)
    onRefresh()
  }, [swarm.swarm_id, onRefresh])

  const handleResume = useCallback(async () => {
    setResuming(true)
    try {
      await fetch(`/api/swarm/${swarm.swarm_id}/resume`, { method: "POST" })
    } catch {}
    setResuming(false)
    onRefresh()
  }, [swarm.swarm_id, onRefresh])
  const shareUrl = `${APP_DOMAIN}/share/swarm/${swarm.swarm_id}`

  const toggleVisibility = useCallback(async () => {
    setShareLoading(true)
    try {
      const csrf = document.cookie
        .split("; ")
        .find((c) => c.startsWith("csrf_token="))
        ?.split("=")[1]
      const res = await fetch(`/api/swarms/${swarm.swarm_id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrf || "",
        },
        body: JSON.stringify({ public: !isPublic }),
      })
      if (res.ok) {
        setIsPublic(!isPublic)
      }
    } catch {}
    setShareLoading(false)
  }, [isPublic, swarm.swarm_id])

  const copyLink = useCallback(() => {
    navigator.clipboard.writeText(shareUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [shareUrl])

  // Fetch events on first expand
  useEffect(() => {
    if (isExpanded && !eventsFetched) {
      setEventsLoading(true)
      fetch(`/api/swarms/${swarm.swarm_id}`)
        .then((res) => res.json())
        .then((data) => {
          setEvents(data.events || [])
          setEventsFetched(true)
        })
        .catch(() => {})
        .finally(() => setEventsLoading(false))
    }
  }, [isExpanded, eventsFetched, swarm.swarm_id])

  // Live-poll events every 3s while expanded AND swarm is active
  useEffect(() => {
    if (!isExpanded || !isActive || !eventsFetched) return
    const poll = setInterval(() => {
      fetch(`/api/swarms/${swarm.swarm_id}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.events) setEvents(data.events)
        })
        .catch(() => {})
    }, 3000)
    return () => clearInterval(poll)
  }, [isExpanded, isActive, eventsFetched, swarm.swarm_id])

  const statusMeta = STATUS_META[swarm.status] || STATUS_META.creating
  const createdAt = new Date(swarm.created_at)
  const duration = swarm.completed_at
    ? formatDuration(new Date(swarm.completed_at).getTime() - createdAt.getTime())
    : null

  return (
    <div
      className={cn(
        "group relative rounded-xl transition-all duration-300",
        "border bg-card/50 backdrop-blur-sm",
        "overflow-hidden",
        isExpanded
          ? "border-border/50 bg-card/80 shadow-lg shadow-foreground/[0.02]"
          : "border-border/30 hover:bg-card/80 hover:border-border/50 hover:shadow-lg hover:shadow-foreground/[0.02]"
      )}
    >
      {/* Subtle top line */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/[0.08] to-transparent" />

      {/* Header */}
      <div className="w-full text-left px-3 sm:px-5 py-3 sm:py-4">
        <div className="flex items-start gap-2 sm:gap-3">
          <button
            onClick={onToggle}
            className="mt-1 text-muted-foreground/60 shrink-0"
          >
            {isExpanded ? (
              <CaretDown className="size-3.5" weight="bold" />
            ) : (
              <CaretRight className="size-3.5" weight="bold" />
            )}
          </button>

          <div className="flex-1 min-w-0">
            {/* Prompt + status row */}
            <div className="flex items-start justify-between gap-2 sm:gap-3">
              <button onClick={onToggle} className="flex-1 min-w-0 text-left">
                <p className={cn("text-sm font-medium leading-snug", isExpanded ? "" : "line-clamp-1")}>{swarm.prompt}</p>
              </button>

              {/* Status + Share */}
              <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                {isActive && swarm.status !== "paused" && (
                  <span className="hidden sm:inline-flex items-center gap-1.5 text-[10px] font-medium text-blue-600 dark:text-blue-400">
                    <span className="relative flex size-1.5">
                      <span className="absolute inline-flex size-full animate-ping rounded-full bg-blue-500 opacity-75" />
                      <span className="relative inline-flex size-1.5 rounded-full bg-blue-500" />
                    </span>
                    Live
                  </span>
                )}
                <span
                  className={cn(
                    "inline-flex items-center gap-1 sm:gap-1.5 text-[10px] sm:text-[11px] font-medium px-1.5 sm:px-2.5 py-0.5 sm:py-1 rounded-full whitespace-nowrap",
                    statusMeta.color
                  )}
                >
                  {statusMeta.icon}
                  <span className="hidden xs:inline sm:inline">{statusMeta.label}</span>
                </span>
                {swarm.persistent && (
                  <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-1.5 py-0.5">
                    Persistent
                  </span>
                )}

                {/* Pause button — shown when running */}
                {swarm.status === "running" && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handlePause()
                    }}
                    disabled={pausing}
                    className={cn(
                      "inline-flex items-center justify-center gap-1 h-7 sm:h-8 px-2 sm:px-2.5 rounded-lg border text-xs font-medium transition-all duration-200",
                      "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 hover:border-amber-500/40",
                      "disabled:opacity-50 disabled:cursor-not-allowed"
                    )}
                    title="Pause this swarm"
                  >
                    {pausing ? (
                      <CircleNotch className="size-3 animate-spin" />
                    ) : (
                      <Pause className="size-3" weight="fill" />
                    )}
                    <span className="hidden sm:inline">{pausing ? "Pausing" : "Pause"}</span>
                  </button>
                )}
                {/* Resume button — shown when paused */}
                {swarm.status === "paused" && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleResume()
                    }}
                    disabled={resuming}
                    className={cn(
                      "inline-flex items-center justify-center gap-1 h-7 sm:h-8 px-2 sm:px-2.5 rounded-lg border text-xs font-medium transition-all duration-200",
                      "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 hover:border-emerald-500/40",
                      "disabled:opacity-50 disabled:cursor-not-allowed"
                    )}
                    title="Resume this swarm"
                  >
                    {resuming ? (
                      <CircleNotch className="size-3 animate-spin" />
                    ) : (
                      <Play className="size-3" weight="fill" />
                    )}
                    <span className="hidden sm:inline">{resuming ? "Resuming" : "Resume"}</span>
                  </button>
                )}
                {/* Stop button — shown when active */}
                {isActive && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleStop()
                    }}
                    disabled={stopping}
                    className={cn(
                      "inline-flex items-center justify-center gap-1 h-7 sm:h-8 px-2 sm:px-2.5 rounded-lg border text-xs font-medium transition-all duration-200",
                      "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20 hover:border-red-500/40",
                      "disabled:opacity-50 disabled:cursor-not-allowed"
                    )}
                    title="Stop this swarm"
                  >
                    {stopping ? (
                      <CircleNotch className="size-3 animate-spin" />
                    ) : (
                      <Stop className="size-3" weight="fill" />
                    )}
                    <span className="hidden sm:inline">{stopping ? "Stopping" : "Stop"}</span>
                  </button>
                )}

                <button
                  onClick={copyPrompt}
                  className={cn(
                    "inline-flex items-center justify-center gap-1.5 h-7 sm:h-8 w-7 sm:w-auto sm:px-2.5 rounded-lg border text-xs font-medium transition-all duration-200",
                    promptCopied
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
                      : "border-border/40 bg-background/60 text-muted-foreground hover:text-foreground hover:bg-background/90"
                  )}
                  title={promptCopied ? "Copied!" : "Copy prompt"}
                >
                  {promptCopied ? <Check className="size-3.5" weight="bold" /> : <Copy className="size-3.5" />}
                  <span className="hidden sm:inline">{promptCopied ? "Copied" : "Copy"}</span>
                </button>

                <SharePopover
                  swarm={swarm}
                  isPublic={isPublic}
                  shareLoading={shareLoading}
                  copied={copied}
                  shareUrl={shareUrl}
                  onToggleVisibility={toggleVisibility}
                  onCopyLink={copyLink}
                  shareOpen={shareOpen}
                  onShareOpenChange={setShareOpen}
                />
              </div>
            </div>

            {/* Metadata row */}
            <button onClick={onToggle} className="w-full text-left">
              <div className="flex items-center gap-2 sm:gap-3 text-[11px] sm:text-xs text-muted-foreground flex-wrap mt-1.5">
                <span className="flex items-center gap-1">
                  <Clock className="size-3" />
                  {formatDate(createdAt)}
                </span>
                <span className="flex items-center gap-1">
                  <Monitor className="size-3" />
                  {swarm.machine_count} machine{swarm.machine_count !== 1 ? "s" : ""}
                </span>
                {isActive && swarm.status !== "paused" && (
                  <span className="sm:hidden inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 font-medium">
                    <span className="relative flex size-1.5">
                      <span className="absolute inline-flex size-full animate-ping rounded-full bg-blue-500 opacity-75" />
                      <span className="relative inline-flex size-1.5 rounded-full bg-blue-500" />
                    </span>
                    Live
                  </span>
                )}
                {duration && <span>{duration}</span>}
                {swarm.model && (
                  <span className="truncate max-w-[100px] sm:max-w-[120px] opacity-60">{swarm.model}</span>
                )}
              </div>
            </button>
          </div>
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
              {eventsLoading ? (
                <div className="flex items-center justify-center py-10">
                  <div className="flex flex-col items-center gap-2">
                    <div className="relative h-6 w-6">
                      <div className="absolute inset-0 rounded-full border-2 border-muted" />
                      <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-foreground animate-spin" />
                    </div>
                    <span className="text-xs text-muted-foreground">Loading logs...</span>
                  </div>
                </div>
              ) : events.length === 0 ? (
                <div className="flex flex-col items-center py-10 text-center">
                  <Terminal className="size-6 text-muted-foreground/30 mb-2" />
                  <p className="text-xs text-muted-foreground">No event logs recorded</p>
                </div>
              ) : (
                <>
                  <SwarmTree
                    events={events}
                    machineCount={swarm.machine_count}
                    prompt={swarm.prompt}
                    status={swarm.status}
                    className="rounded-b-xl"
                    containerClassName="rounded-b-xl"
                    height={Math.min(600, Math.max(260, swarm.machine_count * 60 + 200))}
                  />
                  {swarm.result_summary && swarm.status === "completed" && (
                    <SwarmRunSummary summary={swarm.result_summary} />
                  )}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Share button + centered modal dialog
// ---------------------------------------------------------------------------

function SharePopover({
  swarm,
  isPublic,
  shareLoading,
  copied,
  shareUrl,
  onToggleVisibility,
  onCopyLink,
  shareOpen,
  onShareOpenChange,
}: {
  swarm: SwarmRun
  isPublic: boolean
  shareLoading: boolean
  copied: boolean
  shareUrl: string
  onToggleVisibility: () => void
  onCopyLink: () => void
  shareOpen: boolean
  onShareOpenChange: (open: boolean) => void
}) {
  const socialText = `I just ran ${swarm.machine_count} AI agents in parallel on @coasty_ai — one prompt, ${swarm.machine_count} machines, fully autonomous. Check out the full execution tree:`
  const socialTextPlain = `I just ran ${swarm.machine_count} AI agents in parallel on Coasty — one prompt, ${swarm.machine_count} machines, fully autonomous. Check out the full execution tree: ${shareUrl}`

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

  return (
    <>
      <button
        onClick={(e) => {
          e.stopPropagation()
          onShareOpenChange(!shareOpen)
        }}
        className={cn(
          "inline-flex items-center justify-center gap-1.5 h-7 sm:h-8 w-7 sm:w-auto sm:px-2.5 rounded-lg border text-xs font-medium transition-all duration-200",
          isPublic
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/15"
            : "border-border/40 bg-background/60 text-muted-foreground hover:text-foreground hover:bg-background/90"
        )}
        title={isPublic ? "Shared publicly" : "Share this swarm"}
      >
        <ShareNetwork className="size-3.5" weight={isPublic ? "fill" : "regular"} />
        <span className="hidden sm:inline">{isPublic ? "Shared" : "Share"}</span>
      </button>

      {shareOpen &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center">
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={(e) => {
                e.stopPropagation()
                onShareOpenChange(false)
              }}
            />

            {/* Modal */}
            <div
              className="relative z-[101] w-[400px] max-w-[calc(100vw-2rem)] rounded-2xl border border-border/50 bg-card shadow-2xl shadow-black/20"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 sm:px-5 pt-4 sm:pt-5 pb-3">
                <div className="flex items-center gap-2.5">
                  <div
                    className={cn(
                      "h-8 w-8 rounded-lg flex items-center justify-center shrink-0",
                      isPublic ? "bg-emerald-500/10" : "bg-amber-500/10"
                    )}
                  >
                    {isPublic ? (
                      <Globe className="size-4 text-emerald-500" weight="fill" />
                    ) : (
                      <Lock className="size-4 text-amber-500" weight="fill" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-medium">
                      {isPublic ? "This swarm is live!" : "Share this swarm"}
                    </h3>
                    <p className="text-[11px] text-muted-foreground/70 truncate">
                      {isPublic
                        ? "Anyone with the link can view"
                        : "Make it public to get a shareable link"}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => onShareOpenChange(false)}
                  className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors shrink-0"
                >
                  <X className="size-4" />
                </button>
              </div>

              {/* Toggle */}
              <div className="px-4 sm:px-5 pb-4">
                <div className="flex items-center justify-between rounded-xl bg-muted/40 px-3.5 py-3">
                  <p className="text-xs font-medium">
                    {isPublic ? "Public" : "Private"}
                  </p>
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

              {/* Link + socials — only when public */}
              {isPublic && (
                <div className="px-4 sm:px-5 pb-4 sm:pb-5 space-y-3">
                  {/* Copy link */}
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0 rounded-lg border border-border/40 bg-background/50 px-2.5 sm:px-3 py-2">
                      <p className="text-[11px] sm:text-xs text-muted-foreground truncate font-mono">
                        {shareUrl}
                      </p>
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
                        <>
                          <Check className="size-3.5" weight="bold" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="size-3.5" />
                          Copy
                        </>
                      )}
                    </button>
                  </div>

                  {/* Social grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
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
        )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Swarm run summary — markdown + download
// ---------------------------------------------------------------------------

function SwarmRunSummary({ summary }: { summary: string }) {
  const handleDownloadMd = useCallback(() => {
    const blob = new Blob([summary], { type: "text/markdown;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `swarm-summary-${new Date().toISOString().slice(0, 10)}.md`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [summary])

  const handleDownloadPdf = useCallback(() => {
    const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    const time = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
    const win = window.open("", "_blank")
    if (!win) return
    win.document.write(`
      <html><head><title>Swarm Report - Coasty</title>
      <style>
        @page { margin: 0; size: A4; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: ${EXPORT_SANS_STACK}; max-width: 100%; margin: 0; padding: 0; color: #1d1d1f; font-size: 13px; line-height: 1.7; -webkit-font-smoothing: antialiased; }

        /* ── Header ── */
        .cover { padding: 48px 56px 0 56px; }
        .cover-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
        .cover-brand { display: flex; align-items: center; gap: 10px; }
        .logo-mark { width: 28px; height: 28px; border-radius: 50%; overflow: hidden; flex-shrink: 0; }
        .logo-text { font-size: 14px; font-weight: 500; color: #86868b; letter-spacing: -0.2px; }
        .logo-text b { color: #1d1d1f; font-weight: 600; }
        .cover-meta { font-size: 11px; color: #aeaeb2; text-align: right; }
        .cover-title { font-size: 26px; font-weight: 700; letter-spacing: -0.6px; color: #1d1d1f; line-height: 1.2; margin-bottom: 4px; }
        .cover-divider { height: 1px; background: linear-gradient(90deg, #e5e5ea 0%, transparent 100%); margin-top: 16px; }

        /* ── Content ── */
        .content { padding: 20px 56px 40px 56px; }
        h2 { font-size: 18px; font-weight: 600; margin-top: 32px; margin-bottom: 8px; color: #1d1d1f; letter-spacing: -0.3px; padding-bottom: 6px; border-bottom: 1px solid #f2f2f7; }
        h2:first-child { margin-top: 0; }
        h3 { font-size: 14px; font-weight: 600; margin-top: 22px; margin-bottom: 4px; color: #3a3a3c; letter-spacing: -0.1px; }
        p { margin: 8px 0; color: #3a3a3c; }
        code { background: #f5f5f7; padding: 2px 7px; border-radius: 5px; font-size: 11.5px; font-family: ${EXPORT_MONO_STACK}; color: #1d1d1f; }
        blockquote { border-left: 3px solid #f97316; margin: 16px 0; padding: 10px 20px; color: #6e6e73; font-size: 12.5px; background: #fffbf5; border-radius: 0 8px 8px 0; }
        ul { padding-left: 20px; margin: 8px 0; }
        li { margin: 5px 0; color: #3a3a3c; }
        li::marker { color: #c7c7cc; }
        strong { color: #1d1d1f; font-weight: 600; }
        hr { border: none; height: 1px; background: #e5e5ea; margin: 24px 0; }

        /* ── Footer ── */
        .footer { margin-top: 48px; padding: 20px 56px 36px 56px; border-top: 1px solid #e5e5ea; display: flex; align-items: center; justify-content: space-between; }
        .footer-left { display: flex; align-items: center; gap: 8px; }
        .footer-dot { width: 14px; height: 14px; border-radius: 50%; overflow: hidden; flex-shrink: 0; }
        .footer-text { font-size: 10.5px; color: #aeaeb2; font-weight: 400; letter-spacing: 0.3px; }
        .footer-text a { color: #f97316; text-decoration: none; font-weight: 500; }
        .footer-right { font-size: 10px; color: #c7c7cc; letter-spacing: 0.5px; text-transform: uppercase; font-weight: 500; }

        @media print {
          body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
          h2 { break-after: avoid; }
          h3 { break-after: avoid; }
          blockquote { break-inside: avoid; }
        }
      </style></head><body>

      <div class="cover">
        <div class="cover-top">
          <div class="cover-brand">
            <div class="logo-mark"><svg width="28" height="28" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="lg" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" style="stop-color:rgba(0,0,0,0);stop-opacity:0"/><stop offset="30%" style="stop-color:rgba(0,0,0,0.1);stop-opacity:1"/><stop offset="50%" style="stop-color:rgba(0,0,0,0.3);stop-opacity:1"/><stop offset="70%" style="stop-color:rgba(0,0,0,0.6);stop-opacity:1"/><stop offset="100%" style="stop-color:rgba(0,0,0,1);stop-opacity:1"/></linearGradient></defs><circle cx="100" cy="100" r="100" fill="url(#lg)"/></svg></div>
            <div class="logo-text"><b>coasty</b>.ai</div>
          </div>
          <div class="cover-meta">${date}</div>
        </div>
        <div class="cover-title">Swarm Report</div>
        <div class="cover-divider"></div>
      </div>

      <div class="content">
      ${summary.replace(/^## (.*$)/gm, "<h2>$1</h2>")
        .replace(/^### (.*$)/gm, "<h3>$1</h3>")
        .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
        .replace(/`(.*?)`/g, "<code>$1</code>")
        .replace(/^- (.*$)/gm, "<li>$1</li>")
        .replace(/(<li>[\s\S]*<\/li>)/g, "<ul>$1</ul>")
        .replace(/^> (.*$)/gm, "<blockquote>$1</blockquote>")
        .replace(/\n\n/g, "<br/><br/>")
      }
      </div>

      <div class="footer">
        <div class="footer-left">
          <div class="footer-dot"><svg width="14" height="14" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="lg2" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" style="stop-color:rgba(0,0,0,0);stop-opacity:0"/><stop offset="30%" style="stop-color:rgba(0,0,0,0.1);stop-opacity:1"/><stop offset="50%" style="stop-color:rgba(0,0,0,0.3);stop-opacity:1"/><stop offset="70%" style="stop-color:rgba(0,0,0,0.6);stop-opacity:1"/><stop offset="100%" style="stop-color:rgba(0,0,0,1);stop-opacity:1"/></linearGradient></defs><circle cx="100" cy="100" r="100" fill="url(#lg2)"/></svg></div>
          <div class="footer-text">Generated by <a href="https://coasty.ai">coasty.ai</a></div>
        </div>
        <div class="footer-right">AI Swarm Intelligence</div>
      </div>

      </body></html>
    `)
    win.document.close()
    win.print()
  }, [summary])

  return (
    <div className="border-t border-border/20 bg-muted/20">
      <div className="flex items-center justify-between px-4 sm:px-5 pt-4 pb-2">
        <p className="text-sm font-semibold text-orange-500 dark:text-orange-400 uppercase tracking-widest">
          Summary
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={handleDownloadMd}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground/70 hover:text-foreground/80 bg-muted/60 hover:bg-muted rounded-full px-3 py-1.5 transition-colors"
            title="Download as markdown"
          >
            <DownloadSimple className="size-3.5" />
            Markdown
          </button>
          <button
            onClick={handleDownloadPdf}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground/70 hover:text-foreground/80 bg-muted/60 hover:bg-muted rounded-full px-3 py-1.5 transition-colors"
            title="Download as PDF"
          >
            <FilePdf className="size-3.5" />
            PDF
          </button>
        </div>
      </div>
      <div className="px-4 sm:px-5 pb-4">
        <div className="prose prose-sm dark:prose-invert max-w-none text-xs leading-relaxed text-foreground/70 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-foreground/90 [&_h2]:mt-3 [&_h2]:mb-1.5 [&_h3]:text-xs [&_h3]:font-semibold [&_h3]:text-foreground/80 [&_h3]:mt-2 [&_h3]:mb-1 [&_p]:my-1 [&_ul]:my-1 [&_ul]:pl-4 [&_li]:my-0.5 [&_blockquote]:my-1.5 [&_blockquote]:border-border/30 [&_blockquote]:text-muted-foreground [&_blockquote]:bg-muted/30 [&_blockquote]:rounded-md [&_blockquote]:px-3 [&_blockquote]:py-1.5 [&_code]:text-[11px] [&_code]:bg-muted/50 [&_code]:text-foreground/60 [&_strong]:text-foreground/90">
          <Markdown>{summary}</Markdown>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

const STATUS_META: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  creating: {
    icon: <CircleNotch className="size-3 animate-spin" />,
    label: "Creating",
    color: "text-blue-600 dark:text-blue-400 bg-blue-500/10",
  },
  running: {
    icon: <CircleNotch className="size-3 animate-spin" />,
    label: "Running",
    color: "text-blue-600 dark:text-blue-400 bg-blue-500/10",
  },
  paused: {
    icon: <Pause className="size-3" weight="fill" />,
    label: "Paused",
    color: "text-amber-600 dark:text-amber-400 bg-amber-500/10",
  },
  completed: {
    icon: <CheckCircle className="size-3" weight="fill" />,
    label: "Completed",
    color: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10",
  },
  failed: {
    icon: <XCircle className="size-3" weight="fill" />,
    label: "Failed",
    color: "text-red-600 dark:text-red-400 bg-red-500/10",
  },
  cancelled: {
    icon: <Warning className="size-3" weight="fill" />,
    label: "Cancelled",
    color: "text-amber-600 dark:text-amber-400 bg-amber-500/10",
  },
}

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
