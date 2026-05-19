"use client"

import { useCallback, useEffect, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { GitFork, CircleNotch, ArrowRight } from "@phosphor-icons/react"
import { SwarmTree, type SwarmEvent } from "@/app/components/swarms/swarm-tree"
import Link from "next/link"

export interface ActiveSwarm {
  swarm_id: string
  prompt: string
  machine_count: number
  status: string
  model: string | null
  created_at: string
}

interface ActiveSwarmBannerProps {
  /** When true, renders in fullscreen layout matching SwarmPanel */
  fullscreen?: boolean
  /** Called when an active swarm is detected (or cleared) */
  onSwarmDetected?: (swarm: ActiveSwarm | null) => void
}

export function ActiveSwarmBanner({ fullscreen, onSwarmDetected }: ActiveSwarmBannerProps = {}) {
  const [swarm, setSwarm] = useState<ActiveSwarm | null>(null)
  const [events, setEvents] = useState<SwarmEvent[]>([])
  const [loading, setLoading] = useState(true)

  // Merge incoming events with the in-memory array by id so unchanged rows
  // keep referential identity. Returns the previous reference when there is
  // nothing new — this keeps the heavy useMemos in <SwarmTree /> stable across
  // polls and prevents Framer Motion from re-running entrance animations.
  const mergeEvents = useCallback((prev: SwarmEvent[], incoming: SwarmEvent[]) => {
    if (incoming.length === 0) return prev.length === 0 ? prev : []
    if (incoming.length === prev.length) {
      let identical = true
      for (let i = 0; i < incoming.length; i++) {
        if (incoming[i].id !== prev[i].id) { identical = false; break }
      }
      if (identical) return prev
    }
    const byId = new Map(prev.map((e) => [e.id, e]))
    return incoming.map((e) => byId.get(e.id) ?? e)
  }, [])

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/swarms")
      if (!res.ok) return
      const data = await res.json()
      const runs = data.swarms || []
      const active = runs.find(
        (s: any) => s.status === "running" || s.status === "creating" || s.status === "paused"
      )
      if (active) {
        setSwarm((prev) =>
          prev && prev.swarm_id === active.swarm_id && prev.status === active.status
            ? prev
            : active
        )
        onSwarmDetected?.(active)
        const evRes = await fetch(`/api/swarms/${active.swarm_id}`)
        if (evRes.ok) {
          const evData = await evRes.json()
          setEvents((prev) => mergeEvents(prev, evData.events || []))
        }
      } else {
        setSwarm(null)
        setEvents((prev) => (prev.length === 0 ? prev : []))
        onSwarmDetected?.(null)
      }
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [onSwarmDetected, mergeEvents])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Poll every 5s while active. Pause polling when the tab is hidden so we
  // don't burn cycles on background tabs (and so we don't smash state on
  // re-focus all at once).
  useEffect(() => {
    if (!swarm) return
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return
      refresh()
    }, 5000)
    return () => clearInterval(interval)
  }, [swarm, refresh])

  if (loading || !swarm) return null

  const hasTreeEvents = events.some(
    (e) => e.machine_index !== null && ["text", "tool_call", "tool_result", "step_complete"].includes(e.event_type)
  )

  // ---- Fullscreen layout (matches SwarmPanel design) ----
  if (fullscreen) {
    return (
      <div className="w-full h-full flex flex-col min-h-0">
        {/* Header bar */}
        <div className="shrink-0 flex items-center justify-between px-4 sm:px-5 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center size-7 rounded-lg bg-amber-500/10 dark:bg-amber-500/15">
              <GitFork className="size-4 text-amber-500" weight="duotone" />
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold tracking-tight">Swarm Running</span>
                <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-blue-600 dark:text-blue-400">
                  <span className="relative flex size-1.5">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-blue-500 opacity-75" />
                    <span className="relative inline-flex size-1.5 rounded-full bg-blue-500" />
                  </span>
                  Live
                </span>
              </div>
              <span className="text-[11px] text-muted-foreground/70 leading-none mt-0.5">
                {swarm.machine_count} machine{swarm.machine_count !== 1 ? "s" : ""} allocated
              </span>
            </div>
          </div>
          <Link
            href="/swarms"
            className="h-8 px-3 text-xs font-medium inline-flex items-center gap-1.5 rounded-lg border border-border/40 bg-background/60 text-muted-foreground hover:text-foreground hover:bg-background/90 transition-colors"
          >
            View all <ArrowRight className="size-3" />
          </Link>
        </div>

        {/* Main content area */}
        <div className="flex-1 min-h-0 flex flex-col rounded-2xl border border-border/50 bg-background/50 backdrop-blur-sm mx-1 sm:mx-2 mb-1 overflow-hidden">
          {hasTreeEvents ? (
            <div className="flex-1 min-h-0">
              <SwarmTree
                events={events}
                machineCount={swarm.machine_count}
                prompt={swarm.prompt}
                status={swarm.status}
                className="h-full"
                containerClassName="rounded-b-xl"
              />
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 py-12">
              <div className="max-w-md px-5 py-3 rounded-xl border border-border/40 bg-muted/30 text-center">
                <p className="text-xs text-muted-foreground/60 uppercase tracking-wider font-medium mb-1">Task</p>
                <p className="text-sm text-foreground/80 line-clamp-3 leading-relaxed">{swarm.prompt}</p>
              </div>
              <div className="flex flex-col items-center gap-2">
                <div className="relative">
                  <CircleNotch className="size-8 animate-spin text-muted-foreground/40" />
                  <div className="absolute inset-0 rounded-full blur-xl bg-muted-foreground/5" />
                </div>
                <span className="text-sm text-muted-foreground">
                  {swarm.status === "creating"
                    ? "Creating temporary machines\u2026"
                    : `Running on ${swarm.machine_count} machine${swarm.machine_count !== 1 ? "s" : ""}\u2026`}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ---- Inline banner layout (original) ----
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -12 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-3xl mx-auto mb-6"
      >
        <div className="rounded-2xl border border-border/50 bg-card/50 backdrop-blur-sm overflow-hidden shadow-sm">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
            <div className="flex items-center gap-2">
              <GitFork className="size-4 text-amber-500" weight="duotone" />
              <span className="text-sm font-medium">Swarm Running</span>
              <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-blue-600 dark:text-blue-400">
                <span className="relative flex size-1.5">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-blue-500 opacity-75" />
                  <span className="relative inline-flex size-1.5 rounded-full bg-blue-500" />
                </span>
                Live
              </span>
            </div>
            <Link
              href="/swarms"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
            >
              View all <ArrowRight className="size-3" />
            </Link>
          </div>

          {/* Prompt */}
          <div className="px-4 py-2 border-b border-border/20">
            <p className="text-xs text-muted-foreground truncate">
              {swarm.prompt}
            </p>
          </div>

          {/* Tree or loading */}
          {hasTreeEvents ? (
            <SwarmTree
              events={events}
              machineCount={swarm.machine_count}
              prompt={swarm.prompt}
              status={swarm.status}
              className="rounded-b-2xl"
              containerClassName="rounded-b-2xl"
              height={Math.min(350, Math.max(220, swarm.machine_count * 50 + 150))}
            />
          ) : (
            <div className="flex items-center gap-2 px-4 py-6 justify-center">
              <CircleNotch className="size-4 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                {swarm.status === "creating"
                  ? "Creating temporary machines..."
                  : `Running on ${swarm.machine_count} machine${swarm.machine_count !== 1 ? "s" : ""}...`}
              </span>
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
