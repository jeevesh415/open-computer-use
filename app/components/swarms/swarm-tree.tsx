"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import {
  CheckCircle,
  XCircle,
  Warning,
  Terminal,
  Monitor,
  CircleNotch,
  CaretRight,
  CaretLeft,
  CaretUp,
  CaretDown,
  Eye,
  Wrench,
  MagnifyingGlassPlus,
  MagnifyingGlassMinus,
  MagnifyingGlass,
  ArrowsOutCardinal,
  ArrowCounterClockwise,
  Globe,
  GridFour,
  X,
  ChatCircleDots,
  Megaphone,
  Database,
  Lifebuoy,
  ShieldStar,
  Scales,
  HourglassMedium,
  Lightning,
  ArrowBendUpRight,
  HandPalm,
  TreeStructure,
  SquaresFour,
  Play,
  Pause,
  SkipForward,
  ClipboardText,
} from "@phosphor-icons/react"
import { AnimatePresence, motion } from "motion/react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"
import { AwaitingHumanBanner } from "@/app/components/chat/awaiting-human-banner"

// ---------------------------------------------------------------------------
// Web search result parsing
// ---------------------------------------------------------------------------

interface WebSearchBlock {
  query: string
  results: Array<{ title: string; url: string; snippet: string }>
}

/**
 * Detect and extract [WEB SEARCH: "query"] blocks from text.
 * Returns { searches, remainingText } where searches is an array of parsed
 * search blocks and remainingText has those blocks removed.
 */
function extractWebSearches(text: string): {
  searches: WebSearchBlock[]
  remainingText: string
} {
  const searches: WebSearchBlock[] = []
  // Match [WEB SEARCH: "query"] followed by numbered results until next block or end
  const searchBlockRegex = /\[WEB SEARCH:\s*"([^"]+)"\]\n?([\s\S]*?)(?=\[WEB SEARCH:|$)/g
  let match: RegExpExecArray | null
  let hasMatch = false

  while ((match = searchBlockRegex.exec(text)) !== null) {
    hasMatch = true
    const query = match[1]
    const body = match[2].trim()
    const results: WebSearchBlock["results"] = []

    // Parse numbered results: "1. Title\n   URL: ...\n   snippet"
    const resultRegex = /\d+\.\s*(.+?)(?:\n\s+URL:\s*(\S+))?(?:\n\s+(.+?))?(?=\n\d+\.|$)/g
    let rMatch: RegExpExecArray | null
    while ((rMatch = resultRegex.exec(body)) !== null) {
      results.push({
        title: rMatch[1]?.trim() || "",
        url: rMatch[2]?.trim() || "",
        snippet: rMatch[3]?.trim() || "",
      })
    }

    searches.push({ query, results })
  }

  if (!hasMatch) return { searches: [], remainingText: text }

  // Remove all search blocks from the text
  const remainingText = text
    .replace(/\[WEB SEARCH:\s*"[^"]+"\]\n?[\s\S]*?(?=\[WEB SEARCH:|$)/g, "")
    .trim()

  return { searches, remainingText }
}

// ---------------------------------------------------------------------------
// Types (exported for reuse)
// ---------------------------------------------------------------------------

export interface SwarmEvent {
  id: string
  swarm_id: string
  machine_index: number | null
  event_type: string
  content: string
  screenshot: string | null
  tool_name: string | null
  created_at: string
}

export interface TimelineStep {
  machineIndex: number
  text: string
  toolCalls: Array<{ name: string; content: string }>
  toolResults: Array<{ name: string; content: string; screenshot: string | null }>
  screenshot: string | null
  status: "success" | "error" | "pending" | "awaiting_human"
  machineId?: string
  awaitingHumanReason?: string
  timestamp: string
}

// ---------------------------------------------------------------------------
// Strip ALL internal agent tags/markers from display text
// ---------------------------------------------------------------------------

export function stripAgentTags(text: string): string {
  return text
    // Strip cua-section tags but KEEP inner content (so tree graph shows plans/reflections)
    .replace(/<cua-section[^>]*>/g, "")
    .replace(/<\/cua-section>/g, "")
    .replace(/\[TASK_PLAN_START\]/g, "")
    .replace(/\[TASK_PLAN_END\]/g, "")
    .replace(/\[Coasty_REPORT_START\]/g, "")
    .replace(/\[Coasty_REPORT_END\]/g, "")
    .replace(/<file-attachment[^>]*>[\s\S]*?<\/file-attachment>/g, "")
    .replace(/<file-attachment[^>]*\/>/g, "")
    .replace(/<file-attachment[^>]*>/g, "")
    .replace(/<\/file-attachment>/g, "")
    .replace(/```python\s+agent\.[\s\S]*?```/g, "")
    .replace(/\[NEED_USER_INPUT\]/g, "")
    .replace(/<[a-z][\w-]*[^>]*\/>/g, "")
    .trim()
}

// ---------------------------------------------------------------------------
// Swarm tool classification & interaction extraction
// ---------------------------------------------------------------------------

export type SwarmToolType =
  | "direct_message"
  | "broadcast"
  | "shared_memory_write"
  | "shared_memory_read"
  | "help_request"
  | "expertise_claim"
  | "decision_proposal"
  | "dependency_wait"
  | "resume_task"

export interface SwarmInteraction {
  id: string
  type: SwarmToolType
  fromMachine: number
  toMachine: number | null // null = all/coordinator/memory
  label: string
  timestamp: string
}

const SWARM_TOOL_META: Record<
  SwarmToolType,
  { icon: typeof ChatCircleDots; color: string; bgColor: string; label: string }
> = {
  direct_message: {
    icon: ChatCircleDots,
    color: "text-blue-500",
    bgColor: "bg-blue-500/10 border-blue-500/20",
    label: "Message",
  },
  broadcast: {
    icon: Megaphone,
    color: "text-cyan-500",
    bgColor: "bg-cyan-500/10 border-cyan-500/20",
    label: "Broadcast",
  },
  shared_memory_write: {
    icon: Database,
    color: "text-violet-500",
    bgColor: "bg-violet-500/10 border-violet-500/20",
    label: "Write Memory",
  },
  shared_memory_read: {
    icon: Database,
    color: "text-violet-400",
    bgColor: "bg-violet-500/8 border-violet-500/15",
    label: "Read Memory",
  },
  help_request: {
    icon: Lifebuoy,
    color: "text-amber-500",
    bgColor: "bg-amber-500/10 border-amber-500/20",
    label: "Help Request",
  },
  expertise_claim: {
    icon: ShieldStar,
    color: "text-emerald-500",
    bgColor: "bg-emerald-500/10 border-emerald-500/20",
    label: "Expertise",
  },
  decision_proposal: {
    icon: Scales,
    color: "text-orange-500",
    bgColor: "bg-orange-500/10 border-orange-500/20",
    label: "Decision",
  },
  dependency_wait: {
    icon: HourglassMedium,
    color: "text-rose-400",
    bgColor: "bg-rose-500/10 border-rose-500/20",
    label: "Waiting",
  },
  resume_task: {
    icon: Lightning,
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/8 border-emerald-500/15",
    label: "Resumed",
  },
}

/** Classify a tool name into a swarm tool type, or null if not a swarm tool */
export function classifySwarmTool(toolName: string): SwarmToolType | null {
  const n = toolName.toLowerCase()
  if (n.includes("send_swarm_message")) return "direct_message"
  if (n.includes("broadcast_swarm_message")) return "broadcast"
  if (n.includes("write_shared_memory")) return "shared_memory_write"
  if (n.includes("read_shared_memory") || n.includes("list_shared_memory"))
    return "shared_memory_read"
  if (n.includes("request_help")) return "help_request"
  if (n.includes("claim_expertise")) return "expertise_claim"
  if (n.includes("propose_decision")) return "decision_proposal"
  if (n.includes("wait_for_dependency")) return "dependency_wait"
  if (n.includes("resume_own_task")) return "resume_task"
  return null
}

/** Try to extract the target machine index from a tool call's content/args */
function extractTargetMachine(content: string): number | null {
  // Match patterns like: "to_machine": "2" or to_machine: 2 or machine_index: 1
  const m =
    content.match(/to_machine["']?\s*[:=]\s*["']?(\d+)/) ||
    content.match(/machine_index["']?\s*[:=]\s*["']?(\d+)/) ||
    content.match(/machine[_ ](\d+)/)
  return m ? parseInt(m[1], 10) : null
}

/** Extract short message label from content */
function extractMessagePreview(content: string): string {
  // Try to extract the "message" field from JSON-like content
  const m = content.match(/message["']?\s*[:=]\s*["']([^"']{1,60})/)
  if (m) return m[1].length > 50 ? m[1].slice(0, 50) + "\u2026" : m[1]
  // Try to extract a "key" field for shared memory
  const k = content.match(/key["']?\s*[:=]\s*["']([^"']{1,40})/)
  if (k) return k[1]
  // Try to extract "domain" for expertise
  const d = content.match(/domain["']?\s*[:=]\s*["']([^"']{1,40})/)
  if (d) return d[1]
  // Try to extract "question" for decisions
  const q = content.match(/question["']?\s*[:=]\s*["']([^"']{1,60})/)
  if (q) return q[1].length > 50 ? q[1].slice(0, 50) + "\u2026" : q[1]
  return ""
}

/** Extract all inter-machine interactions from swarm events */
export function extractSwarmInteractions(events: SwarmEvent[]): SwarmInteraction[] {
  const interactions: SwarmInteraction[] = []
  let idCounter = 0

  for (const event of events) {
    if (event.event_type !== "tool_call" || event.machine_index === null) continue
    const toolType = classifySwarmTool(event.tool_name || event.content)
    if (!toolType) continue

    let toMachine: number | null = null
    if (toolType === "direct_message") {
      toMachine = extractTargetMachine(event.content)
    }

    interactions.push({
      id: `interaction-${idCounter++}`,
      type: toolType,
      fromMachine: event.machine_index,
      toMachine,
      label: extractMessagePreview(event.content),
      timestamp: event.created_at,
    })
  }

  return interactions
}

// Stroke colors for SVG connection arcs (hex values for SVG)
const INTERACTION_STROKE_COLORS: Record<SwarmToolType, string> = {
  direct_message: "#3b82f6",
  broadcast: "#06b6d4",
  shared_memory_write: "#8b5cf6",
  shared_memory_read: "#a78bfa",
  help_request: "#f59e0b",
  expertise_claim: "#10b981",
  decision_proposal: "#f97316",
  dependency_wait: "#fb7185",
  resume_task: "#34d399",
}

// ---------------------------------------------------------------------------
// Build timeline steps from flat events
// ---------------------------------------------------------------------------

export function buildTimelineSteps(events: SwarmEvent[]): TimelineStep[] {
  const steps: TimelineStep[] = []
  let current: TimelineStep | null = null

  function flush() {
    if (current) {
      steps.push(current)
      current = null
    }
  }

  for (const event of events) {
    const mIdx = event.machine_index ?? 0

    if (event.event_type === "text") {
      flush()
      const cleaned = stripAgentTags(event.content)
      if (!cleaned) continue
      current = {
        machineIndex: mIdx,
        text: cleaned,
        toolCalls: [],
        toolResults: [],
        screenshot: null,
        status: "pending",
        timestamp: event.created_at,
      }
    } else if (event.event_type === "tool_call") {
      if (!current) {
        current = {
          machineIndex: mIdx,
          text: "",
          toolCalls: [],
          toolResults: [],
          screenshot: null,
          status: "pending",
          timestamp: event.created_at,
        }
      }
      current.toolCalls.push({
        name: event.tool_name || stripAgentTags(event.content),
        content: stripAgentTags(event.content),
      })
    } else if (event.event_type === "tool_result") {
      if (!current) {
        current = {
          machineIndex: mIdx,
          text: "",
          toolCalls: [],
          toolResults: [],
          screenshot: null,
          status: "pending",
          timestamp: event.created_at,
        }
      }
      current.toolResults.push({
        name: event.tool_name || "",
        content: stripAgentTags(event.content),
        screenshot: event.screenshot,
      })
      if (event.screenshot) current.screenshot = event.screenshot
    } else if (event.event_type === "step_complete") {
      if (current) current.status = "success"
      flush()
    } else if (event.event_type === "error") {
      if (current) {
        current.status = "error"
        current.text = current.text || stripAgentTags(event.content)
      } else {
        steps.push({
          machineIndex: mIdx,
          text: stripAgentTags(event.content),
          toolCalls: [],
          toolResults: [],
          screenshot: null,
          status: "error",
          timestamp: event.created_at,
        })
      }
    } else if (event.event_type === "awaiting_human") {
      flush()
      let reason = "Human intervention needed"
      try {
        const parsed = JSON.parse(event.content)
        reason = parsed.reason || reason
      } catch { /* use default */ }
      steps.push({
        machineIndex: mIdx,
        text: reason,
        toolCalls: [],
        toolResults: [],
        screenshot: null,
        status: "awaiting_human",
        machineId: (event as any).machine_id || "",
        awaitingHumanReason: reason,
        timestamp: event.created_at,
      })
    } else if (event.event_type === "machine_status") {
      flush()
      steps.push({
        machineIndex: mIdx,
        text: `Machine ${event.content}`,
        toolCalls: [],
        toolResults: [],
        screenshot: null,
        status:
          event.content === "completed" ? "success" : event.content === "failed" ? "error" : "pending",
        timestamp: event.created_at,
      })
    } else if (event.event_type === "swarm_meta") {
      flush()
      steps.push({
        machineIndex: 0,
        text: `Swarm ${event.content}`,
        toolCalls: [],
        toolResults: [],
        screenshot: null,
        status:
          event.content === "completed" ? "success" : event.content === "cancelled" ? "error" : "pending",
        timestamp: event.created_at,
      })
    } else if (event.event_type === "swarm_planning") {
      flush()
      steps.push({
        machineIndex: 0,
        text: event.content || "Task decomposition",
        toolCalls: [],
        toolResults: [],
        screenshot: null,
        status: "success",
        timestamp: event.created_at,
      })
    } else if (event.event_type === "swarm_summary") {
      flush()
      steps.push({
        machineIndex: 0,
        text: event.content || "Swarm summary",
        toolCalls: [],
        toolResults: [],
        screenshot: null,
        status: "success",
        timestamp: event.created_at,
      })
    }
  }

  flush()
  return steps
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EASE = [0.22, 1, 0.36, 1] as const
// Header geometry. The fork from the prompt and the inter-agent communication
// band live in a single SVG so the arcs visibly anchor to the column tops.
const FORK_HEIGHT = 52
const BAND_HEIGHT = 88
const MIN_ZOOM = 0.15
const MAX_ZOOM = 2
const ZOOM_STEP = 0.15

// ---------------------------------------------------------------------------
// SwarmTree — pan/zoom canvas with prompt root → fork → machine branches
// ---------------------------------------------------------------------------

export function SwarmTree({
  events,
  machineCount,
  prompt,
  status,
  className,
  containerClassName,
  height,
}: {
  events: SwarmEvent[]
  machineCount: number
  prompt: string
  status: string
  className?: string
  containerClassName?: string
  height?: number | string
}) {
  const machineIndices = useMemo(
    () =>
      Array.from(
        new Set(events.filter((e) => e.machine_index !== null).map((e) => e.machine_index!))
      ).sort((a, b) => a - b),
    [events]
  )

  const perMachineSteps = useMemo(() => {
    const map: Record<number, TimelineStep[]> = {}
    for (const idx of machineIndices) {
      const filtered = events.filter(
        (e) => e.machine_index === idx || e.machine_index === null
      )
      map[idx] = buildTimelineSteps(filtered).filter((s) => s.machineIndex === idx)
    }
    return map
  }, [events, machineIndices])

  const machineStatuses = useMemo(() => {
    const s: Record<number, "success" | "error" | "pending"> = {}
    for (const idx of machineIndices) {
      const statusEvents = events.filter(
        (e) => e.machine_index === idx && e.event_type === "machine_status"
      )
      const last = statusEvents[statusEvents.length - 1]
      s[idx] = last
        ? last.content === "completed"
          ? "success"
          : last.content === "failed"
            ? "error"
            : "pending"
        : "pending"
    }
    return s
  }, [events, machineIndices])

  // Extract swarm interactions for connection visualization
  const swarmInteractions = useMemo(
    () => extractSwarmInteractions(events),
    [events]
  )
  const hasInteractions = swarmInteractions.length > 0

  // Per-machine subtask text from the swarm planner. SwarmPanel emits these as
  // a swarm_planning event whose content is "Machine N: <subtask>\n..."; we
  // parse them back out here so the Machines view can show each card's brief.
  const machineSubtasks = useMemo(() => {
    const map: Record<number, string> = {}
    for (const event of events) {
      if (event.event_type !== "swarm_planning") continue
      for (const line of event.content.split("\n")) {
        const m = line.match(/^Machine\s+(\d+):\s*(.+)$/)
        if (m) map[parseInt(m[1], 10)] = m[2].trim()
      }
    }
    return map
  }, [events])

  // Collect latest screenshot per machine (for matrix view)
  const latestScreenshots = useMemo(() => {
    const map: Record<number, { src: string; toolName: string }> = {}
    for (const event of events) {
      if (event.screenshot && event.machine_index !== null) {
        map[event.machine_index] = {
          src: event.screenshot,
          toolName: event.tool_name || event.event_type,
        }
      }
    }
    return map
  }, [events])

  const screenshotCount = Object.keys(latestScreenshots).length
  const [showScreenshotMatrix, setShowScreenshotMatrix] = useState(false)
  // View mode: "machines" shows a grid of player-style cards (one per machine);
  // "graph" shows the pan/zoom tree. Default to machines — the per-machine
  // player cards are the more direct read of "what's happening right now".
  const [viewMode, setViewMode] = useState<"graph" | "machines">("machines")

  // Stabilise column count: prefer the declared machineCount so the canvas does
  // NOT snap-to-fit each time a new machine reports its first event mid-stream.
  const cols = Math.max(machineIndices.length, machineCount || 0) || 1

  // The set of machine slots to render. Always include every expected machine
  // (0..machineCount-1) AND every machine that has emitted at least one event,
  // sorted ascending. This means:
  //  - During boot, all N slots show as "Booting…" placeholders.
  //  - As machines start reporting, their slots populate with real data while
  //    the rest stay as placeholders — no card disappears or reappears as
  //    events stream in.
  //  - When machineCount is unknown (0), we just show the real machines.
  const displayMachineIndices = useMemo(() => {
    const set = new Set<number>(machineIndices)
    if (machineCount && machineCount > 0) {
      for (let i = 0; i < machineCount; i++) set.add(i)
    }
    return Array.from(set).sort((a, b) => a - b)
  }, [machineIndices, machineCount])

  // Pan/zoom state
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const isPanning = useRef(false)
  const panStart = useRef({ x: 0, y: 0 })
  const panOrigin = useRef({ x: 0, y: 0 })
  const lastPinchDist = useRef<number | null>(null)
  const [isMobile, setIsMobile] = useState(false)
  // Hide the canvas for one paint so the initial fit lands without a visible snap.
  const [hasFitted, setHasFitted] = useState(false)

  const isLive = status === "running" || status === "creating" || status === "planning" || status === "aggregating"

  // Both views share the same pan/zoom canvas; only the inner content's
  // natural width differs. Compute it from viewMode + cols so auto-fit, resetView,
  // and the panned content's wrapper all agree.
  const naturalContentWidth = useMemo(() => {
    if (viewMode === "graph") return Math.max(cols * 220, 300)
    return Math.max(
      cols * MACHINE_CARD_WIDTH + Math.max(0, cols - 1) * MACHINE_CARD_GAP,
      320
    )
  }, [viewMode, cols])

  // Auto-fit before paint so the first frame the user sees is already centered.
  // Refits whenever the view mode toggles (cards and tree have different natural
  // widths), but NOT when more machines stream in mid-run — that's what made
  // the original feel unstable.
  useLayoutEffect(() => {
    if (!containerRef.current || !contentRef.current) return
    const containerW = containerRef.current.clientWidth
    setIsMobile(containerW < 768)
    const fit = Math.min(1, (containerW - 32) / naturalContentWidth)
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, fit))
    setZoom(clamped)
    const scaledW = naturalContentWidth * clamped
    setPan({ x: Math.max(0, (containerW - scaledW) / 2), y: 0 })
    setHasFitted(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode])

  // Keep mobile flag in sync on container resize without triggering a refit.
  useEffect(() => {
    if (!containerRef.current || typeof ResizeObserver === "undefined") return
    const el = containerRef.current
    const ro = new ResizeObserver(() => setIsMobile(el.clientWidth < 768))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Non-passive wheel listener so preventDefault() stops page scroll.
  // Convention (Figma / Excalidraw / Miro): ctrl/cmd + wheel zooms around the
  // cursor; plain wheel pans. Mac trackpad pinch fires wheel with ctrlKey=true,
  // and two-finger scroll fires wheel with ctrlKey=false — so this gives Mac
  // users intuitive pan + pinch-zoom out of the box.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const isZoom = e.ctrlKey || e.metaKey
      if (isZoom) {
        const rect = el.getBoundingClientRect()
        const cursorX = e.clientX - rect.left
        const cursorY = e.clientY - rect.top
        // Continuous, pixel-proportional zoom so trackpad pinch feels smooth
        // (not staircased like the discrete ZOOM_STEP would produce).
        setZoom((prev) => {
          const factor = Math.exp(-e.deltaY * 0.01)
          const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev * factor))
          const ratio = next / prev
          setPan((p) => ({
            x: cursorX - ratio * (cursorX - p.x),
            y: cursorY - ratio * (cursorY - p.y),
          }))
          return next
        })
      } else {
        const sensitivity = e.deltaMode === 0 ? 1 : 16
        setPan((p) => ({
          x: p.x - e.deltaX * sensitivity,
          y: p.y - e.deltaY * sensitivity,
        }))
      }
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
          const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev + delta * 0.005))
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
  const zoomIn = useCallback(() => {
    setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP))
  }, [])
  const zoomOut = useCallback(() => {
    setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP))
  }, [])
  const resetView = useCallback(() => {
    if (!containerRef.current) return
    const containerW = containerRef.current.clientWidth
    const fit = Math.min(1, (containerW - 32) / naturalContentWidth)
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, fit))
    setZoom(clamped)
    const scaledW = naturalContentWidth * clamped
    setPan({ x: Math.max(0, (containerW - scaledW) / 2), y: 0 })
  }, [naturalContentWidth])

  if (displayMachineIndices.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-16 text-center">
        <Terminal className="size-6 text-muted-foreground/30 mb-2" />
        <p className="text-xs text-muted-foreground">No event logs recorded</p>
      </div>
    )
  }

  const zoomPercent = Math.round(zoom * 100)

  return (
    <div className={cn("relative h-full", className)}>
      {/* Dotted canvas background — both modes pan/zoom over the same canvas */}
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.35] dark:opacity-[0.18]"
          style={{
            backgroundImage: "radial-gradient(circle, currentColor 0.5px, transparent 0.5px)",
            backgroundSize: "20px 20px",
          }}
        />
        <div className="absolute -top-10 -right-10 h-48 w-48 rounded-full bg-amber-500/[0.03] dark:bg-amber-400/[0.04] blur-3xl" />
        <div className="absolute -bottom-10 -left-10 h-40 w-40 rounded-full bg-blue-500/[0.03] dark:bg-blue-400/[0.04] blur-3xl" />
      </div>

      {/* View-mode pill — top-left segmented toggle between Graph and Machines */}
      <div className="absolute top-3 left-3 z-[10]">
        <div className="inline-flex rounded-lg border border-border/40 bg-background/90 backdrop-blur-sm shadow-sm p-0.5 gap-0.5">
          <button
            type="button"
            onClick={() => setViewMode("graph")}
            className={cn(
              "h-6 px-2.5 inline-flex items-center gap-1.5 rounded-[6px] text-[11px] font-medium transition-all duration-150",
              viewMode === "graph"
                ? "bg-foreground/[0.08] text-foreground shadow-[inset_0_0_0_1px_rgba(0,0,0,0.04)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]"
                : "text-muted-foreground/70 hover:text-foreground"
            )}
            aria-pressed={viewMode === "graph"}
            title="Graph view"
          >
            <TreeStructure
              className="size-3.5"
              weight={viewMode === "graph" ? "fill" : "regular"}
            />
            <span className="hidden sm:inline">Graph</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode("machines")}
            className={cn(
              "h-6 px-2.5 inline-flex items-center gap-1.5 rounded-[6px] text-[11px] font-medium transition-all duration-150",
              viewMode === "machines"
                ? "bg-foreground/[0.08] text-foreground shadow-[inset_0_0_0_1px_rgba(0,0,0,0.04)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]"
                : "text-muted-foreground/70 hover:text-foreground"
            )}
            aria-pressed={viewMode === "machines"}
            title="Machines view"
          >
            <SquaresFour
              className="size-3.5"
              weight={viewMode === "machines" ? "fill" : "regular"}
            />
            <span className="hidden sm:inline">Machines</span>
            <span className="text-[10px] font-mono tabular-nums text-muted-foreground/60 ml-0.5">
              {machineIndices.length}
            </span>
          </button>
        </div>
      </div>

      {/* Top-right pan/zoom controls — both modes share the same canvas */}
      <div className="absolute top-3 right-3 z-[10] flex items-center gap-1">
        <span className="text-[10px] tabular-nums text-muted-foreground/50 mr-1 select-none">
          {zoomPercent}%
        </span>
        {screenshotCount > 0 && (
          <button
            onClick={() => setShowScreenshotMatrix((o) => !o)}
            className={cn(
              "h-7 px-2 flex items-center justify-center gap-1 rounded-lg border bg-background/90 backdrop-blur-sm text-muted-foreground hover:text-foreground hover:bg-background transition-colors shadow-sm",
              showScreenshotMatrix
                ? "border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/5"
                : "border-border/40"
            )}
            title="Screenshot matrix"
          >
            <GridFour className="size-3.5" weight={showScreenshotMatrix ? "fill" : "regular"} />
            <span className="text-[10px] font-medium">{screenshotCount}</span>
          </button>
        )}
        <button
          onClick={zoomIn}
          className="h-7 w-7 flex items-center justify-center rounded-lg border border-border/40 bg-background/90 backdrop-blur-sm text-muted-foreground hover:text-foreground hover:bg-background transition-colors shadow-sm"
          title="Zoom in"
        >
          <MagnifyingGlassPlus className="size-3.5" />
        </button>
        <button
          onClick={zoomOut}
          className="h-7 w-7 flex items-center justify-center rounded-lg border border-border/40 bg-background/90 backdrop-blur-sm text-muted-foreground hover:text-foreground hover:bg-background transition-colors shadow-sm"
          title="Zoom out"
        >
          <MagnifyingGlassMinus className="size-3.5" />
        </button>
        <button
          onClick={resetView}
          className="h-7 w-7 flex items-center justify-center rounded-lg border border-border/40 bg-background/90 backdrop-blur-sm text-muted-foreground hover:text-foreground hover:bg-background transition-colors shadow-sm"
          title="Fit to view"
        >
          <ArrowCounterClockwise className="size-3.5" />
        </button>
      </div>

      {/* D-pad navigation — small screens & touch devices, both modes */}
      {isMobile && (
        <div className="absolute bottom-14 left-3 z-[10] flex flex-col items-center gap-1" data-no-pan>
          <button
            onClick={panUp}
            className="h-9 w-9 flex items-center justify-center rounded-xl border border-border/50 bg-background/95 backdrop-blur-sm text-muted-foreground active:scale-90 active:bg-muted transition-all shadow-sm"
            title="Pan up"
          >
            <CaretUp className="size-4" weight="bold" />
          </button>
          <div className="flex items-center gap-1">
            <button
              onClick={panLeft}
              className="h-9 w-9 flex items-center justify-center rounded-xl border border-border/50 bg-background/95 backdrop-blur-sm text-muted-foreground active:scale-90 active:bg-muted transition-all shadow-sm"
              title="Pan left"
            >
              <CaretLeft className="size-4" weight="bold" />
            </button>
            <button
              onClick={resetView}
              className="h-9 w-9 flex items-center justify-center rounded-xl border border-border/50 bg-background/95 backdrop-blur-sm text-muted-foreground active:scale-90 active:bg-muted transition-all shadow-sm"
              title="Reset view"
            >
              <ArrowCounterClockwise className="size-3.5" />
            </button>
            <button
              onClick={panRight}
              className="h-9 w-9 flex items-center justify-center rounded-xl border border-border/50 bg-background/95 backdrop-blur-sm text-muted-foreground active:scale-90 active:bg-muted transition-all shadow-sm"
              title="Pan right"
            >
              <CaretRight className="size-4" weight="bold" />
            </button>
          </div>
          <button
            onClick={panDown}
            className="h-9 w-9 flex items-center justify-center rounded-xl border border-border/50 bg-background/95 backdrop-blur-sm text-muted-foreground active:scale-90 active:bg-muted transition-all shadow-sm"
            title="Pan down"
          >
            <CaretDown className="size-4" weight="bold" />
          </button>
        </div>
      )}

      {/* Hint \u2014 applies to both modes (canvas pan/zoom) */}
      <div className={cn(
        "absolute left-3 z-[10] flex items-center gap-1.5 text-[10px] text-muted-foreground/35 select-none pointer-events-none",
        isMobile ? "bottom-2.5 right-3 justify-center" : "bottom-2.5"
      )}>
        <ArrowsOutCardinal className="size-3" />
        <span>{isMobile ? "Pinch to zoom \u00b7 Use D-pad to pan" : "Drag to pan \u00b7 Scroll to zoom"}</span>
      </div>

      {/* Pan/zoom viewport \u2014 shared by both modes. The transform/cursor/handlers
          are mode-agnostic; only the inner content differs (tree vs cards). */}
      <div
        ref={containerRef}
        className={cn("relative z-[1] overflow-hidden h-full select-none", containerClassName)}
        style={{
          ...(height != null ? { height } : {}),
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
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
            transition: isPanning.current
              ? "none"
              : "transform 0.22s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.25s ease-out",
            opacity: hasFitted ? 1 : 0,
            backfaceVisibility: "hidden",
          }}
        >
          {viewMode === "graph" ? (
            <div className="px-6 py-6" style={{ width: naturalContentWidth }}>
              {/* Root prompt node */}
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: EASE }}
                className="flex justify-center mb-1"
              >
                <div className="relative max-w-md px-5 py-3 rounded-xl border border-border/40 bg-background/90 backdrop-blur-sm text-center shadow-sm">
                  <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-500/40 to-transparent" />
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground/60 mb-1 font-medium">Prompt</p>
                  <p className="text-sm leading-snug line-clamp-2">{prompt}</p>
                </div>
              </motion.div>

              {/* Unified header connector — fork beziers from the prompt fanning
                  out to each machine column, plus the inter-agent communication
                  band when interactions exist. */}
              <motion.div
                className="flex justify-center overflow-hidden"
                initial={false}
                animate={{ height: hasInteractions ? FORK_HEIGHT + BAND_HEIGHT : FORK_HEIGHT }}
                transition={{ duration: 0.45, ease: EASE }}
              >
                <svg
                  width={Math.max(cols * 220, 200)}
                  height={FORK_HEIGHT + BAND_HEIGHT}
                  viewBox={`0 0 ${Math.max(cols * 220, 200)} ${FORK_HEIGHT + BAND_HEIGHT}`}
                  className="shrink-0"
                >
                  <SwarmConnectionDefs />

                  {/* Fork beziers — prompt center → each machine column top.
                      Use displayMachineIndices so all expected columns appear
                      from the moment the swarm starts, not only after the first
                      per-machine event for each one arrives. */}
                  {displayMachineIndices.map((_, i) => {
                    const totalW = Math.max(cols * 220, 200)
                    const colW = totalW / cols
                    const startX = totalW / 2
                    const endX = colW * i + colW / 2
                    const midY = 26
                    return (
                      <motion.path
                        key={`fork-${i}`}
                        d={`M ${startX} 0 C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${FORK_HEIGHT}`}
                        fill="none"
                        className="stroke-border/50"
                        strokeWidth={1.5}
                        strokeDasharray="4 3"
                        initial={{ pathLength: 0, opacity: 0 }}
                        animate={{ pathLength: 1, opacity: 1 }}
                        transition={{ duration: 0.6, delay: 0.1 + i * 0.08, ease: "easeOut" }}
                      />
                    )
                  })}

                  {/* Communication band */}
                  {hasInteractions && (
                    <SwarmConnectionBand
                      interactions={swarmInteractions}
                      machineIndices={displayMachineIndices}
                      totalWidth={Math.max(cols * 220, 200)}
                      bandTop={FORK_HEIGHT}
                      bandHeight={BAND_HEIGHT}
                    />
                  )}
                </svg>
              </motion.div>

              {/* Machine branches */}
              <div
                className="grid gap-4"
                style={{
                  gridTemplateColumns: `repeat(${cols}, minmax(180px, 1fr))`,
                }}
              >
                {displayMachineIndices.map((idx, i) => {
                  const steps = perMachineSteps[idx] || []
                  const mStatus = machineStatuses[idx] || "pending"
                  return (
                    <motion.div
                      key={idx}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.35, delay: 0.15 + i * 0.06, ease: EASE }}
                    >
                      <MachineBranch
                        machineIndex={idx}
                        steps={steps}
                        status={mStatus}
                        isLive={isLive}
                      />
                    </motion.div>
                  )
                })}
              </div>
            </div>
          ) : (
            <MachineGridView
              machineIndices={displayMachineIndices}
              perMachineSteps={perMachineSteps}
              machineStatuses={machineStatuses}
              latestScreenshots={latestScreenshots}
              swarmInteractions={swarmInteractions}
              machineSubtasks={machineSubtasks}
              isLive={isLive}
              prompt={prompt}
            />
          )}
        </div>
      </div>

      {/* Interaction legend — floating bottom-left, only in graph mode (the
          machine cards already show their own per-machine interaction badges) */}
      {viewMode === "graph" && hasInteractions && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.6, ease: EASE }}
          className={cn(
            "absolute z-[10] select-none",
            isMobile ? "bottom-10 left-3 right-3" : "bottom-8 left-3"
          )}
        >
          <SwarmInteractionLegend interactions={swarmInteractions} />
        </motion.div>
      )}

      {/* Live screenshot strip — graph mode only; machines view already shows the screenshots prominently */}
      {viewMode === "graph" && !isMobile && screenshotCount > 0 && !showScreenshotMatrix && (
        <div className="absolute bottom-2.5 right-3 z-[10] max-w-[55%]">
          <div className="flex items-end gap-1.5 justify-end">
            {machineIndices.map((idx, i) => {
              const ss = latestScreenshots[idx]
              if (!ss) return null
              return (
                <ScreenshotLiveThumb
                  key={idx}
                  machineIndex={idx}
                  src={ss.src}
                  status={machineStatuses[idx]}
                  delay={i * 0.08}
                />
              )
            })}
          </div>
        </div>
      )}

      {/* Screenshot matrix overlay — fullscreen (toggled via button, or always on mobile when tapped) */}
      <AnimatePresence>
        {showScreenshotMatrix && screenshotCount > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 z-[20] flex flex-col"
          >
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-background/80 backdrop-blur-md"
              onClick={() => setShowScreenshotMatrix(false)}
            />

            {/* Content */}
            <div className="relative z-[1] flex flex-col h-full">
              {/* Header */}
              <div className="shrink-0 flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-2">
                  <GridFour className="size-4 text-amber-500" weight="fill" />
                  <span className="text-sm font-semibold tracking-tight">Machine Screenshots</span>
                  <span className="text-[10px] text-muted-foreground/60 bg-muted/50 px-1.5 py-0.5 rounded-full">
                    {screenshotCount} machine{screenshotCount !== 1 ? "s" : ""}
                  </span>
                </div>
                <button
                  onClick={() => setShowScreenshotMatrix(false)}
                  className="h-7 w-7 flex items-center justify-center rounded-lg border border-border/40 bg-background/90 text-muted-foreground hover:text-foreground hover:bg-background transition-colors"
                >
                  <X className="size-3.5" />
                </button>
              </div>

              {/* Grid */}
              <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
                <div
                  className="grid gap-3"
                  style={{
                    gridTemplateColumns: `repeat(${Math.min(screenshotCount, 3)}, minmax(0, 1fr))`,
                  }}
                >
                  {machineIndices.map((idx, i) => {
                    const ss = latestScreenshots[idx]
                    if (!ss) return null
                    return (
                      <motion.div
                        key={idx}
                        initial={{ opacity: 0, y: 12, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        transition={{ duration: 0.35, delay: i * 0.06, ease: EASE }}
                      >
                        <ScreenshotMatrixCard
                          machineIndex={idx}
                          src={ss.src}
                          toolName={ss.toolName}
                          status={machineStatuses[idx]}
                        />
                      </motion.div>
                    )
                  })}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Swarm header connector — SVG <defs> + a <g> group that renders all
// inter-agent communication inside the unified header SVG (fork + band).
//
// Coordinate system: the parent SVG has its origin at the prompt; the fork
// occupies y = 0 → FORK_HEIGHT; the band occupies y = bandTop → bandBottom
// where bandBottom is the top edge of the machine header pills. Every arc
// anchors at y = bandBottom so it visibly emerges from a machine column.
// ---------------------------------------------------------------------------

interface ConnectionGroup {
  type: SwarmToolType
  fromMachine: number
  toMachine: number | null
  count: number
  label: string
}

function groupSwarmInteractions(interactions: SwarmInteraction[]): ConnectionGroup[] {
  const map = new Map<string, ConnectionGroup>()
  for (const i of interactions) {
    const key = `${i.type}-${i.fromMachine}-${i.toMachine}`
    const existing = map.get(key)
    if (existing) {
      existing.count++
      if (!existing.label && i.label) existing.label = i.label
    } else {
      map.set(key, {
        type: i.type,
        fromMachine: i.fromMachine,
        toMachine: i.toMachine,
        count: 1,
        label: i.label,
      })
    }
  }
  return Array.from(map.values())
}

function SwarmConnectionDefs() {
  return (
    <defs>
      <style>{`
        @keyframes swarm-flow { to { stroke-dashoffset: -20; } }
        .swarm-arc { animation: swarm-flow 1.8s linear infinite; }
        @keyframes swarm-pulse-soft {
          0%, 100% { opacity: 0.32; }
          50%      { opacity: 0.78; }
        }
        .swarm-pulse-soft { animation: swarm-pulse-soft 2.2s ease-in-out infinite; }
        @keyframes swarm-hub-pulse {
          0%, 100% { opacity: 0.05; }
          50%      { opacity: 0.13; }
        }
        .swarm-hub-pulse { animation: swarm-hub-pulse 3.4s ease-in-out infinite; }
      `}</style>
      {Object.entries(INTERACTION_STROKE_COLORS).map(([type, color]) => (
        <filter
          key={`glow-${type}`}
          id={`glow-${type}`}
          x="-50%" y="-50%" width="200%" height="200%"
        >
          <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur" />
          <feFlood floodColor={color} floodOpacity="0.5" result="color" />
          <feComposite in="color" in2="blur" operator="in" result="glow" />
          <feMerge>
            <feMergeNode in="glow" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      ))}
      {Object.entries(INTERACTION_STROKE_COLORS).map(([type, color]) => (
        <marker
          key={`arrow-${type}`}
          id={`swarm-arrow-${type}`}
          markerWidth="6"
          markerHeight="4"
          refX="5"
          refY="2"
          orient="auto"
        >
          <path d="M 0 0 L 6 2 L 0 4 z" fill={color} opacity="0.85" />
        </marker>
      ))}
    </defs>
  )
}

function SwarmConnectionBand({
  interactions,
  machineIndices,
  totalWidth,
  bandTop,
  bandHeight,
  anchor = "bottom",
  xForMachine,
}: {
  interactions: SwarmInteraction[]
  machineIndices: number[]
  totalWidth: number
  bandTop: number
  bandHeight: number
  // Where the arcs hook back to the machine columns.
  //  - "bottom" (graph view): the band sits ABOVE the machines, arcs rise UP.
  //  - "top" (machines view): the band sits BELOW the cards, arcs drop DOWN.
  anchor?: "top" | "bottom"
  // Override how each machine's X is computed. Default is evenly distributed
  // across totalWidth (correct for the graph view's `repeat(N, 1fr)` grid).
  // Machines view uses fixed-width cards, so it passes its own mapper.
  xForMachine?: (machineIndex: number) => number
}) {
  if (interactions.length === 0 || machineIndices.length === 0) return null

  const cols = machineIndices.length
  const colW = totalWidth / cols
  const bandBottom = bandTop + bandHeight
  const centerX = totalWidth / 2

  // Where arcs and badges hook to the machine columns.
  const anchorY = anchor === "bottom" ? bandBottom : bandTop
  // Direction arcs flex AWAY from the anchor (-1 = up, +1 = down).
  const peakDir = anchor === "bottom" ? -1 : 1

  function machineX(machineIndex: number): number {
    if (xForMachine) return xForMachine(machineIndex)
    const colIdx = machineIndices.indexOf(machineIndex)
    if (colIdx === -1) return centerX
    return colW * colIdx + colW / 2
  }

  const groups = groupSwarmInteractions(interactions)
  const directConnections = groups.filter(
    (g) => g.type === "direct_message" && g.toMachine !== null && g.fromMachine !== g.toMachine
  )
  const broadcasts = groups.filter((g) => g.type === "broadcast")
  const memoryOps = groups.filter(
    (g) => g.type === "shared_memory_write" || g.type === "shared_memory_read"
  )
  const coordOps = groups.filter((g) =>
    ["help_request", "expertise_claim", "decision_proposal", "dependency_wait", "resume_task"].includes(g.type)
  )

  // MEM hub geometry — sits centered, biased slightly AWAY from the anchor
  // so shared-memory S-curves arrive at a flat angle.
  const hubW = 96
  const hubH = 22
  const hubCY = anchor === "bottom"
    ? bandTop + Math.round(bandHeight * 0.55)
    : bandTop + Math.round(bandHeight * 0.45)
  const hubY = hubCY - hubH / 2
  const hubX = centerX - hubW / 2
  // Direction from hub toward the machine column (used to place S-curve control points).
  const hubToMachineDy = anchorY > hubCY ? 1 : -1

  // Stack offset so overlapping direct-message arcs are visually separable.
  let arcIndex = 0

  return (
    <g>
      {/* Faint dashed column continuation. Only rendered when the band sits
          BETWEEN the fork end and the machine column tops (graph view), where
          the stubs bridge a real visual gap. In the machines view the band
          sits directly under the cards with no gap — arcs touch the card edge
          already, so adding stubs would dangle into empty space below. */}
      {anchor === "bottom" && machineIndices.map((idx, i) => (
        <motion.line
          key={`stub-${idx}`}
          x1={machineX(idx)} y1={bandTop}
          x2={machineX(idx)} y2={bandBottom}
          className="stroke-border/45"
          strokeWidth={1}
          strokeDasharray="2 4"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.55 + i * 0.05, ease: "easeOut" }}
        />
      ))}

      {/* Hub soft halo — rendered before arcs so arcs render on top */}
      {memoryOps.length > 0 && (
        <ellipse
          cx={centerX} cy={hubCY}
          rx={hubW / 2 + 14}
          ry={hubH / 2 + 10}
          fill={INTERACTION_STROKE_COLORS.shared_memory_write}
          className="swarm-hub-pulse"
        />
      )}

      {/* Direct message arcs — quadratic Bezier flexing AWAY from the anchor */}
      {directConnections.map((conn) => {
        const fromX = machineX(conn.fromMachine)
        const toX = machineX(conn.toMachine!)
        const dist = Math.abs(toX - fromX)
        const offset = (arcIndex++ % 3) * 5
        const rawH = Math.max(34, Math.min(64, dist * 0.16)) + offset
        const arcH = Math.min(rawH, bandHeight - 14)
        const peakY = anchorY + peakDir * arcH
        const badgeY = peakY + peakDir * 7
        const midX = (fromX + toX) / 2
        const stroke = INTERACTION_STROKE_COLORS[conn.type]
        return (
          <motion.g
            key={`dm-${conn.fromMachine}-${conn.toMachine}-${conn.count}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.45, delay: 0.85, ease: EASE }}
          >
            <path
              d={`M ${fromX} ${anchorY} Q ${midX} ${peakY}, ${toX} ${anchorY}`}
              fill="none"
              stroke={stroke}
              strokeWidth={3.5}
              opacity={0.14}
              filter={`url(#glow-${conn.type})`}
            />
            <path
              d={`M ${fromX} ${anchorY} Q ${midX} ${peakY}, ${toX} ${anchorY}`}
              fill="none"
              stroke={stroke}
              strokeWidth={1.5}
              strokeDasharray="6 4"
              className="swarm-arc"
              opacity={0.82}
              markerEnd={`url(#swarm-arrow-${conn.type})`}
            />
            <circle cx={fromX} cy={anchorY} r={2.5} fill={stroke} opacity={0.85} />
            {conn.count > 1 && (
              <g>
                <circle cx={midX} cy={badgeY} r={8.5} fill="hsl(var(--background))" />
                <circle cx={midX} cy={badgeY} r={8.5} fill={stroke} opacity={0.18} />
                <circle cx={midX} cy={badgeY} r={8.5}
                  fill="none"
                  stroke={stroke}
                  strokeOpacity={0.45}
                  strokeWidth={0.75}
                />
                <text
                  x={midX} y={badgeY + 2.8}
                  textAnchor="middle"
                  fontSize={9.5}
                  fontWeight={600}
                  fill={stroke}
                >
                  {conn.count}
                </text>
              </g>
            )}
          </motion.g>
        )
      })}

      {/* Broadcasts — fan from origin to every other machine */}
      {broadcasts.map((conn) => {
        const fromX = machineX(conn.fromMachine)
        const stroke = INTERACTION_STROKE_COLORS.broadcast
        return (
          <motion.g
            key={`bc-${conn.fromMachine}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.95, ease: EASE }}
          >
            {machineIndices
              .filter((idx) => idx !== conn.fromMachine)
              .map((targetIdx) => {
                const toX = machineX(targetIdx)
                const dist = Math.abs(toX - fromX)
                const arcH = Math.min(Math.max(28, dist * 0.14), bandHeight - 20)
                const peakY = anchorY + peakDir * arcH
                const midX = (fromX + toX) / 2
                return (
                  <path
                    key={`bc-${conn.fromMachine}-${targetIdx}`}
                    d={`M ${fromX} ${anchorY} Q ${midX} ${peakY}, ${toX} ${anchorY}`}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={1.2}
                    strokeDasharray="3 4"
                    className="swarm-arc"
                    opacity={0.55}
                  />
                )
              })}
            <circle cx={fromX} cy={anchorY} r={6} fill={stroke} className="swarm-pulse-soft" />
            <circle cx={fromX} cy={anchorY} r={2.5} fill={stroke} opacity={0.85} />
          </motion.g>
        )
      })}

      {/* Shared-memory arcs — smooth S-curve between each machine and the hub side */}
      {memoryOps.map((conn) => {
        const mX = machineX(conn.fromMachine)
        const stroke = INTERACTION_STROKE_COLORS[conn.type]
        const isWrite = conn.type === "shared_memory_write"
        const hubSideX = mX < centerX ? hubX : hubX + hubW
        // Control points are offset from the hub TOWARD the machine column so
        // the S-curve approaches the hub at a flat angle regardless of whether
        // the machine sits above or below the hub.
        const ctrlA = hubCY + hubToMachineDy * 14
        const ctrlB = hubCY + hubToMachineDy * 12
        const path = isWrite
          ? `M ${mX} ${anchorY} C ${mX} ${ctrlA}, ${hubSideX} ${ctrlB}, ${hubSideX} ${hubCY}`
          : `M ${hubSideX} ${hubCY} C ${hubSideX} ${ctrlB}, ${mX} ${ctrlA}, ${mX} ${anchorY}`
        return (
          <motion.g
            key={`mem-${conn.type}-${conn.fromMachine}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.45, delay: 1.05, ease: EASE }}
          >
            <path
              d={path}
              fill="none"
              stroke={stroke}
              strokeWidth={3}
              opacity={0.1}
              filter={`url(#glow-${conn.type})`}
            />
            <path
              d={path}
              fill="none"
              stroke={stroke}
              strokeWidth={1.25}
              strokeDasharray="4 3"
              className="swarm-arc"
              opacity={0.75}
              markerEnd={`url(#swarm-arrow-${conn.type})`}
            />
          </motion.g>
        )
      })}

      {/* MEM hub pill — drawn after memory arcs so it sits on top */}
      {memoryOps.length > 0 && (
        <motion.g
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.45, delay: 1.1, ease: EASE }}
          style={{ transformOrigin: `${centerX}px ${hubCY}px`, transformBox: "fill-box" }}
        >
          <rect x={hubX} y={hubY} width={hubW} height={hubH} rx={hubH / 2}
            fill="hsl(var(--background))" />
          <rect x={hubX} y={hubY} width={hubW} height={hubH} rx={hubH / 2}
            fill={INTERACTION_STROKE_COLORS.shared_memory_write} opacity={0.1} />
          <rect x={hubX} y={hubY} width={hubW} height={hubH} rx={hubH / 2}
            fill="none"
            stroke={INTERACTION_STROKE_COLORS.shared_memory_write}
            strokeOpacity={0.5}
            strokeWidth={0.75}
          />
          <g transform={`translate(${hubX + 12}, ${hubCY}) rotate(45)`}>
            <rect x={-3.5} y={-3.5} width={7} height={7} rx={1}
              fill={INTERACTION_STROKE_COLORS.shared_memory_write}
              opacity={0.9}
            />
          </g>
          <text
            x={centerX + 9}
            y={hubCY + 3.2}
            textAnchor="middle"
            fontSize={9.5}
            fontWeight={600}
            fill={INTERACTION_STROKE_COLORS.shared_memory_write}
            opacity={0.95}
            style={{ letterSpacing: "0.08em" }}
          >
            SHARED MEM
          </text>
        </motion.g>
      )}

      {/* Coordination badges — small attached circles just inside the band near each machine */}
      {coordOps.map((conn, ci) => {
        const mX = machineX(conn.fromMachine)
        const stroke = INTERACTION_STROKE_COLORS[conn.type]
        const badgeY = anchorY + peakDir * (12 + (ci % 2) * 16)
        const glyph =
          conn.type === "help_request" ? "?"
          : conn.type === "expertise_claim" ? "\u2605"
          : conn.type === "decision_proposal" ? "\u2696"
          : conn.type === "dependency_wait" ? "\u23F3"
          : "\u21BB"
        return (
          <motion.g
            key={`coord-${conn.type}-${conn.fromMachine}-${ci}`}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.35, delay: 1.15 + ci * 0.05, ease: EASE }}
            style={{ transformOrigin: `${mX}px ${badgeY}px`, transformBox: "fill-box" }}
          >
            <circle cx={mX} cy={badgeY} r={8} fill="hsl(var(--background))" />
            <circle cx={mX} cy={badgeY} r={8} fill={stroke} opacity={0.2} />
            <circle cx={mX} cy={badgeY} r={8}
              fill="none"
              stroke={stroke}
              strokeOpacity={0.55}
              strokeWidth={0.75}
            />
            <text
              x={mX} y={badgeY + 3.2}
              textAnchor="middle"
              fontSize={9.5}
              fontWeight={700}
              fill={stroke}
            >
              {glyph}
            </text>
          </motion.g>
        )
      })}
    </g>
  )
}

// ---------------------------------------------------------------------------
// Machines view — responsive grid of player-style cards, one per machine.
// Activated via the Graph/Machines pill toggle at the top-left of SwarmTree.
// Screenshot is the dominant visual; metadata strip below is intentionally
// slim so a row of cards reads like a multi-cam dashboard.
// ---------------------------------------------------------------------------

// Card width is fixed in machines view so the fork beziers can terminate
// at the precise X-center of each card and the visual "trunk → branch → card"
// metaphor stays intact regardless of screen width. The container scrolls
// horizontally when N machines exceed the viewport.
const MACHINE_CARD_WIDTH = 280
const MACHINE_CARD_GAP = 16

function MachineGridView({
  machineIndices,
  perMachineSteps,
  machineStatuses,
  latestScreenshots,
  swarmInteractions,
  machineSubtasks,
  isLive,
  prompt,
}: {
  machineIndices: number[]
  perMachineSteps: Record<number, TimelineStep[]>
  machineStatuses: Record<number, "success" | "error" | "pending">
  latestScreenshots: Record<number, { src: string; toolName: string }>
  swarmInteractions: SwarmInteraction[]
  machineSubtasks: Record<number, string>
  isLive: boolean
  prompt: string
}) {
  // Group interactions by their origin machine so each card shows its own activity.
  const interactionsByMachine = useMemo(() => {
    const map: Record<number, SwarmInteraction[]> = {}
    for (const i of swarmInteractions) {
      if (!map[i.fromMachine]) map[i.fromMachine] = []
      map[i.fromMachine].push(i)
    }
    return map
  }, [swarmInteractions])

  const cols = machineIndices.length
  // Width of the cards row (and therefore the fork SVG). Card centers land
  // at i * (W + gap) + W/2 from the left edge of this content block.
  const contentWidth = Math.max(
    cols * MACHINE_CARD_WIDTH + Math.max(0, cols - 1) * MACHINE_CARD_GAP,
    320
  )

  return (
    // Sits inside the SwarmTree pan/zoom canvas — no own scroll, no own
    // background. The outer canvas owns drag/wheel/pinch behaviour for both
    // views, so this component just emits its content at its natural width.
    <div className="px-6 py-6" style={{ width: contentWidth }}>
      {/* Root prompt — same chrome as the graph view so the two modes
          read as one design */}
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: EASE }}
          className="flex justify-center mb-1"
        >
          <div className="relative max-w-md px-5 py-3 rounded-xl border border-border/40 bg-background/95 text-center shadow-sm">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-500/40 to-transparent" />
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground/60 mb-1 font-medium">Prompt</p>
            <p className="text-sm leading-snug line-clamp-2">{prompt}</p>
          </div>
        </motion.div>

        {/* Fork SVG — prompt center fans out to each card's center. Same bezier
            family as the graph view's fork so toggling feels like a re-skin
            rather than a different visualisation. */}
        <div className="flex justify-center">
          <svg
            width={contentWidth}
            height={FORK_HEIGHT}
            viewBox={`0 0 ${contentWidth} ${FORK_HEIGHT}`}
            className="shrink-0"
          >
            {machineIndices.map((_, i) => {
              const startX = contentWidth / 2
              const endX = i * (MACHINE_CARD_WIDTH + MACHINE_CARD_GAP) + MACHINE_CARD_WIDTH / 2
              const midY = 26
              return (
                <motion.path
                  key={`fork-${i}`}
                  d={`M ${startX} 0 C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${FORK_HEIGHT}`}
                  fill="none"
                  className="stroke-border/50"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 1 }}
                  transition={{ duration: 0.6, delay: 0.1 + i * 0.08, ease: "easeOut" }}
                />
              )
            })}
          </svg>
        </div>

        {/* Player-card row — fixed widths so each card's center sits exactly
            under its fork bezier's endpoint. Wrap behaviour is intentionally
            disabled; the container scrolls horizontally on narrow viewports
            (same metaphor as the graph canvas's pan). */}
        <div
          className="flex"
          style={{ gap: MACHINE_CARD_GAP, width: contentWidth }}
        >
          {machineIndices.map((idx, i) => (
            <div
              key={idx}
              className="shrink-0"
              style={{ width: MACHINE_CARD_WIDTH }}
            >
              <MachinePlayerCard
                machineIndex={idx}
                steps={perMachineSteps[idx] || []}
                status={machineStatuses[idx] || "pending"}
                screenshot={latestScreenshots[idx]}
                interactions={interactionsByMachine[idx] || []}
                subtask={machineSubtasks[idx]}
                isLive={isLive}
                delay={i * 0.05}
              />
            </div>
          ))}
        </div>

        {/* Inter-agent communication band — sits BELOW the cards (the space
            beneath the cards row was otherwise empty). Arcs drop DOWN from
            each card's bottom edge, the MEM hub is centered, and coordination
            badges float just under their machine. Same component as the graph
            view — only the `anchor` direction and `xForMachine` mapping change. */}
        {swarmInteractions.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.5, ease: EASE }}
            className="flex justify-center mt-1"
          >
            <svg
              width={contentWidth}
              height={BAND_HEIGHT}
              viewBox={`0 0 ${contentWidth} ${BAND_HEIGHT}`}
              className="shrink-0 overflow-visible"
            >
              <SwarmConnectionDefs />
              <SwarmConnectionBand
                interactions={swarmInteractions}
                machineIndices={machineIndices}
                totalWidth={contentWidth}
                bandTop={0}
                bandHeight={BAND_HEIGHT}
                anchor="top"
                xForMachine={(idx) => {
                  const i = machineIndices.indexOf(idx)
                  if (i === -1) return contentWidth / 2
                  return i * (MACHINE_CARD_WIDTH + MACHINE_CARD_GAP) + MACHINE_CARD_WIDTH / 2
                }}
              />
            </svg>
          </motion.div>
        )}
    </div>
  )
}

function MachinePlayerCard({
  machineIndex,
  steps,
  status,
  screenshot,
  interactions,
  subtask,
  isLive,
  delay,
}: {
  machineIndex: number
  steps: TimelineStep[]
  status: "success" | "error" | "pending"
  screenshot: { src: string; toolName: string } | undefined
  interactions: SwarmInteraction[]
  subtask: string | undefined
  isLive: boolean
  delay: number
}) {
  const totalSteps = steps.length

  // Per-card playhead. Starts at the latest step; auto-advances when new steps
  // arrive *while* the user is already on the latest (so live cards keep
  // following), but stays put when the user has scrubbed back into history.
  const [currentStepIndex, setCurrentStepIndex] = useState(() =>
    Math.max(0, totalSteps - 1)
  )
  const prevTotal = useRef(totalSteps)
  useEffect(() => {
    if (totalSteps === 0) {
      prevTotal.current = 0
      return
    }
    const wasAtLatest = currentStepIndex >= prevTotal.current - 1
    if (totalSteps > prevTotal.current && wasAtLatest) {
      setCurrentStepIndex(totalSteps - 1)
    } else if (currentStepIndex >= totalSteps) {
      setCurrentStepIndex(totalSteps - 1)
    }
    prevTotal.current = totalSteps
  }, [totalSteps, currentStepIndex])

  const currentStep = totalSteps > 0 ? steps[currentStepIndex] : undefined
  const isLatest = totalSteps === 0 || currentStepIndex >= totalSteps - 1
  const isRunning = isLive && status === "pending"
  const isFollowingLive = isLatest && isRunning

  // Resolve which screenshot to show in the frame:
  //   1. The current step's screenshot, if it has one.
  //   2. Else: the most recent screenshot at or before the current step.
  //   3. Else: the live "latest" from the parent (so brand-new machines that
  //      have only sent screenshots — no steps yet — still render their frame).
  const frameScreenshot = useMemo(() => {
    if (currentStep?.screenshot) return currentStep.screenshot
    for (let i = currentStepIndex; i >= 0; i--) {
      if (steps[i]?.screenshot) return steps[i].screenshot
    }
    return screenshot?.src ?? null
  }, [currentStep, currentStepIndex, steps, screenshot])

  // The action ticker — text or, if absent, the last tool call's name.
  const currentAction = useMemo(() => {
    if (!currentStep) return ""
    if (currentStep.text) return stripAgentTags(currentStep.text)
    const lastTool = currentStep.toolCalls[currentStep.toolCalls.length - 1]
    if (lastTool) return lastTool.name
    return ""
  }, [currentStep])

  const interactionsByType = useMemo(() => {
    const counts: Partial<Record<SwarmToolType, number>> = {}
    for (const i of interactions) {
      counts[i.type] = (counts[i.type] || 0) + 1
    }
    return counts
  }, [interactions])

  const cardBorder =
    status === "success"
      ? "border-emerald-500/25 dark:border-emerald-500/30"
      : status === "error"
        ? "border-red-500/25 dark:border-red-500/30"
        : isRunning
          ? "border-blue-500/25 dark:border-blue-400/25"
          : "border-border/50"

  const canPrev = currentStepIndex > 0
  const canNext = currentStepIndex < totalSteps - 1
  const goPrev = useCallback(() => setCurrentStepIndex((i) => Math.max(0, i - 1)), [])
  const goNext = useCallback(
    () => setCurrentStepIndex((i) => Math.min(totalSteps - 1, i + 1)),
    [totalSteps]
  )
  const goLive = useCallback(
    () => setCurrentStepIndex(Math.max(0, totalSteps - 1)),
    [totalSteps]
  )

  // Step strip: render last 16 segments, but remember the actual indices so
  // click-to-jump and the playhead highlight land on the right step.
  const stripWindow = 16
  const stripStart = Math.max(0, totalSteps - stripWindow)

  return (
    <motion.div
      initial={{ opacity: 0, y: 14, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.4, delay, ease: EASE }}
      className={cn(
        "group relative rounded-2xl border overflow-hidden bg-background shadow-sm",
        "transition-shadow duration-200 hover:shadow-md",
        cardBorder
      )}
    >
      {/* Screenshot frame — 16:10, dominant visual */}
      <div className="relative aspect-[16/10] bg-foreground/[0.03] overflow-hidden">
        {frameScreenshot ? (
          <motion.img
            key={frameScreenshot}
            src={frameScreenshot}
            alt={`Machine ${machineIndex + 1} screen`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="absolute inset-0 w-full h-full object-cover"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <Monitor className="size-7 text-muted-foreground/20" />
            <span className="text-[10px] text-muted-foreground/40">
              {isRunning ? "Booting…" : "No screenshot yet"}
            </span>
          </div>
        )}

        {/* Top gradient so the chrome pills stay legible on bright screenshots */}
        <div className="absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-background/55 via-background/10 to-transparent pointer-events-none" />

        {/* Top-left: machine identity pill */}
        <div className="absolute top-2 left-2 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-background/85 backdrop-blur-sm border border-border/40 text-[10px] font-medium shadow-sm">
          <span
            className={cn(
              "relative flex size-1.5",
              isRunning && "items-center justify-center"
            )}
          >
            {isRunning && (
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-blue-500 opacity-65" />
            )}
            <span
              className={cn(
                "relative inline-flex size-1.5 rounded-full",
                status === "success" ? "bg-emerald-500" :
                status === "error" ? "bg-red-500" :
                isRunning ? "bg-blue-500" :
                "bg-muted-foreground/40"
              )}
            />
          </span>
          <span className="tracking-tight">Machine #{machineIndex + 1}</span>
        </div>

        {/* Top-right: status / live indicator */}
        <div className="absolute top-2 right-2 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-background/85 backdrop-blur-sm border border-border/40 text-[10px] font-medium shadow-sm">
          {status === "success" ? (
            <>
              <CheckCircle className="size-2.5 text-emerald-500" weight="fill" />
              <span className="text-muted-foreground">Done</span>
            </>
          ) : status === "error" ? (
            <>
              <XCircle className="size-2.5 text-red-500" weight="fill" />
              <span className="text-muted-foreground">Error</span>
            </>
          ) : isRunning ? (
            <>
              <Play className="size-2.5 text-blue-500" weight="fill" />
              <span className="text-muted-foreground tabular-nums">
                {totalSteps} {totalSteps === 1 ? "step" : "steps"}
              </span>
            </>
          ) : (
            <>
              <Pause className="size-2.5 text-muted-foreground" weight="fill" />
              <span className="text-muted-foreground">Idle</span>
            </>
          )}
        </div>

        {/* Bottom gradient + player transport — reveal on hover (and always
            when scrubbing through history, so users see how to get back) */}
        <div
          className={cn(
            "absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-background/70 via-background/25 to-transparent pointer-events-none transition-opacity duration-200",
            isFollowingLive ? "opacity-0 group-hover:opacity-100" : "opacity-100"
          )}
        />
        <div
          className={cn(
            "absolute inset-x-0 bottom-0 px-2 pb-2 flex items-center justify-center gap-1.5 transition-opacity duration-200",
            isFollowingLive ? "opacity-0 group-hover:opacity-100" : "opacity-100"
          )}
        >
          <button
            type="button"
            onClick={goPrev}
            disabled={!canPrev}
            className="h-7 w-7 inline-flex items-center justify-center rounded-full bg-background/90 backdrop-blur-sm border border-border/40 text-foreground/85 hover:text-foreground hover:bg-background disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-sm"
            title="Previous step"
            aria-label="Previous step"
          >
            <CaretLeft className="size-3.5" weight="bold" />
          </button>

          <div className="inline-flex items-center gap-1.5 px-2.5 h-7 rounded-full bg-background/90 backdrop-blur-sm border border-border/40 text-[10px] font-medium shadow-sm">
            {isFollowingLive ? (
              <>
                <span className="relative flex size-1.5">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-blue-500 opacity-65" />
                  <span className="relative inline-flex size-1.5 rounded-full bg-blue-500" />
                </span>
                <span className="tracking-tight">Live</span>
              </>
            ) : totalSteps > 0 ? (
              <span className="tabular-nums tracking-tight">
                {currentStepIndex + 1} <span className="text-muted-foreground/55">/ {totalSteps}</span>
              </span>
            ) : (
              <span className="text-muted-foreground/60">—</span>
            )}
          </div>

          <button
            type="button"
            onClick={goNext}
            disabled={!canNext}
            className="h-7 w-7 inline-flex items-center justify-center rounded-full bg-background/90 backdrop-blur-sm border border-border/40 text-foreground/85 hover:text-foreground hover:bg-background disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-sm"
            title="Next step"
            aria-label="Next step"
          >
            <CaretRight className="size-3.5" weight="bold" />
          </button>

          {!isLatest && (
            <button
              type="button"
              onClick={goLive}
              className={cn(
                "h-7 px-2 inline-flex items-center gap-1 rounded-full backdrop-blur-sm border text-[10px] font-medium transition-all shadow-sm",
                isRunning
                  ? "bg-blue-500/15 border-blue-500/30 text-blue-600 dark:text-blue-300 hover:bg-blue-500/20"
                  : "bg-background/90 border-border/40 text-foreground/85 hover:text-foreground hover:bg-background"
              )}
              title={isRunning ? "Jump to live" : "Jump to latest step"}
            >
              <SkipForward className="size-3" weight="fill" />
              <span>{isRunning ? "Live" : "Latest"}</span>
            </button>
          )}
        </div>
      </div>

      {/* Body strip */}
      <div className="px-3.5 py-3 space-y-2.5">
        {/* Subtask brief — the prompt this specific machine was given by the
            swarm planner. Stays muted/italic so the action ticker below is
            clearly the live element. */}
        {subtask && (
          <div className="flex items-start gap-1.5">
            <ClipboardText
              className="size-3 text-amber-500/85 shrink-0 mt-[3px]"
              weight="fill"
            />
            <p className="text-[11px] italic text-muted-foreground/85 leading-relaxed line-clamp-2">
              {subtask}
            </p>
          </div>
        )}

        {/* Action ticker — what the (currently selected) step is doing */}
        {currentAction ? (
          <div className="flex items-start gap-1.5 min-h-[2.4em]">
            <span
              className={cn(
                "mt-[5px] size-1 rounded-full shrink-0",
                isFollowingLive ? "bg-blue-500" :
                currentStep?.status === "success" ? "bg-emerald-500" :
                currentStep?.status === "error" ? "bg-red-500" :
                currentStep?.status === "awaiting_human" ? "bg-amber-500" :
                "bg-muted-foreground/40"
              )}
            />
            <p className="text-[12px] text-foreground/85 line-clamp-2 leading-relaxed">
              {currentAction}
            </p>
          </div>
        ) : (
          <p className="text-[12px] text-muted-foreground/50 italic min-h-[2.4em]">
            Waiting for activity…
          </p>
        )}

        {/* Click-to-scrub step strip — each segment is a real step.
            The current playhead is the brighter, slightly taller segment. */}
        {totalSteps > 0 && (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-[2px] flex-1 h-2">
              {steps.slice(stripStart).map((step, i) => {
                const actualIndex = stripStart + i
                const isCurrent = actualIndex === currentStepIndex
                const baseColor =
                  step.status === "success" ? "bg-emerald-500" :
                  step.status === "error" ? "bg-red-500" :
                  step.status === "awaiting_human" ? "bg-amber-500" :
                  "bg-muted-foreground"
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setCurrentStepIndex(actualIndex)}
                    title={`Step ${actualIndex + 1}`}
                    aria-label={`Jump to step ${actualIndex + 1}`}
                    className={cn(
                      "flex-1 rounded-full transition-all duration-200 cursor-pointer",
                      isCurrent
                        ? cn(baseColor, "h-2 opacity-95 shadow-[0_0_0_1.5px_hsl(var(--background)),0_0_0_2.5px_var(--ring,rgb(59,130,246))]")
                        : cn(baseColor, "h-1 opacity-55 hover:opacity-80")
                    )}
                  />
                )
              })}
            </div>
            <span className="text-[10px] font-mono tabular-nums text-muted-foreground/55 shrink-0">
              {currentStepIndex + 1}/{totalSteps}
            </span>
          </div>
        )}

        {/* Interaction badges row */}
        {Object.keys(interactionsByType).length > 0 && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {(Object.entries(interactionsByType) as Array<[SwarmToolType, number]>).map(
              ([type, count]) => {
                const meta = SWARM_TOOL_META[type]
                if (!meta) return null
                const Icon = meta.icon
                return (
                  <span
                    key={type}
                    className={cn(
                      "inline-flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded-full border",
                      meta.bgColor,
                      meta.color
                    )}
                    title={`${meta.label}${count > 1 ? ` × ${count}` : ""}`}
                  >
                    <Icon className="size-2.5" weight="fill" />
                    {count > 1 && <span className="tabular-nums">{count}</span>}
                  </span>
                )
              }
            )}
          </div>
        )}
      </div>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Swarm interaction legend — small key showing connection types
// ---------------------------------------------------------------------------

function SwarmInteractionLegend({
  interactions,
  className,
}: {
  interactions: SwarmInteraction[]
  className?: string
}) {
  const types = useMemo(() => {
    const seen = new Set<SwarmToolType>()
    for (const i of interactions) seen.add(i.type)
    return Array.from(seen)
  }, [interactions])

  if (types.length === 0) return null

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {types.map((type) => {
        const meta = SWARM_TOOL_META[type]
        const Icon = meta.icon
        return (
          <span
            key={type}
            className={cn(
              "inline-flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded-full border",
              meta.bgColor,
              meta.color
            )}
          >
            <Icon className="size-2.5" weight="fill" />
            {meta.label}
          </span>
        )
      })}
      <span className="text-[9px] text-muted-foreground/40 ml-0.5">
        {interactions.length} interaction{interactions.length !== 1 ? "s" : ""}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Screenshot matrix card — single machine screenshot in the grid
// ---------------------------------------------------------------------------

function ScreenshotMatrixCard({
  machineIndex,
  src,
  toolName,
  status,
}: {
  machineIndex: number
  src: string
  toolName: string
  status: "success" | "error" | "pending"
}) {
  const [lightboxOpen, setLightboxOpen] = useState(false)

  return (
    <>
      <div
        className={cn(
          "group rounded-xl border overflow-hidden transition-all cursor-pointer shadow-sm hover:shadow-md",
          status === "success"
            ? "border-emerald-500/20 hover:border-emerald-500/40"
            : status === "error"
              ? "border-red-500/20 hover:border-red-500/40"
              : "border-border/40 hover:border-border/60"
        )}
        onClick={() => setLightboxOpen(true)}
        data-no-pan
      >
        {/* Machine label bar */}
        <div className={cn(
          "flex items-center justify-between px-2.5 py-1.5",
          status === "success"
            ? "bg-emerald-50/60 dark:bg-emerald-950/20"
            : status === "error"
              ? "bg-red-50/60 dark:bg-red-950/20"
              : "bg-muted/30"
        )}>
          <div className="flex items-center gap-1.5">
            <Monitor className="size-3 text-muted-foreground/70" />
            <span className="text-[11px] font-medium">Machine #{machineIndex + 1}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {status === "success" && <CheckCircle className="size-3 text-emerald-500" weight="fill" />}
            {status === "error" && <XCircle className="size-3 text-red-500" weight="fill" />}
            {status === "pending" && <CircleNotch className="size-3 text-blue-500 animate-spin" />}
          </div>
        </div>

        {/* Screenshot */}
        <div className="relative bg-black/5 dark:bg-white/5">
          <img
            src={src}
            alt={`Machine #${machineIndex + 1}`}
            className="w-full aspect-video object-cover group-hover:scale-[1.02] transition-transform duration-300"
            draggable={false}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="absolute bottom-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <span className="inline-flex items-center gap-1 text-[9px] text-white/90 bg-black/50 backdrop-blur-sm rounded-md px-1.5 py-0.5">
              <MagnifyingGlassPlus className="size-2.5" />
              View
            </span>
          </div>
        </div>

        {/* Last action label */}
        <div className="px-2.5 py-1.5 border-t border-border/20 bg-background/60">
          <p className="text-[10px] text-muted-foreground/60 truncate">
            {toolName}
          </p>
        </div>
      </div>

      <AnimatePresence>
        {lightboxOpen && <ScreenshotLightbox src={src} onClose={() => setLightboxOpen(false)} />}
      </AnimatePresence>
    </>
  )
}

// ---------------------------------------------------------------------------
// Live screenshot thumbnail — persistent bottom-right strip on desktop
// ---------------------------------------------------------------------------

function ScreenshotLiveThumb({
  machineIndex,
  src,
  status,
  delay,
}: {
  machineIndex: number
  src: string
  status: "success" | "error" | "pending"
  delay: number
}) {
  const [lightboxOpen, setLightboxOpen] = useState(false)

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 10, scale: 0.9 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, delay, ease: EASE }}
        className="group relative cursor-pointer"
        onClick={() => setLightboxOpen(true)}
        data-no-pan
      >
        <div
          className={cn(
            "rounded-lg overflow-hidden border shadow-lg transition-all",
            "hover:shadow-xl hover:scale-105 hover:z-10",
            "w-[120px]",
            status === "success"
              ? "border-emerald-500/30 ring-1 ring-emerald-500/10"
              : status === "error"
                ? "border-red-500/30 ring-1 ring-red-500/10"
                : "border-border/50 ring-1 ring-border/10"
          )}
        >
          {/* Screenshot image */}
          <div className="relative bg-black/5 dark:bg-white/5">
            <img
              src={src}
              alt={`Machine #${machineIndex + 1}`}
              className="w-full aspect-video object-cover"
              draggable={false}
            />
            {/* Status indicator dot */}
            <div className="absolute top-1 left-1">
              {status === "pending" && (
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-blue-500 opacity-60" />
                  <span className="relative inline-flex size-2 rounded-full bg-blue-500" />
                </span>
              )}
              {status === "success" && (
                <span className="inline-flex size-2 rounded-full bg-emerald-500 ring-1 ring-white/30" />
              )}
              {status === "error" && (
                <span className="inline-flex size-2 rounded-full bg-red-500 ring-1 ring-white/30" />
              )}
            </div>
          </div>

          {/* Label */}
          <div className="px-1.5 py-1 bg-background/90 backdrop-blur-sm border-t border-border/20">
            <div className="flex items-center gap-1">
              <Monitor className="size-2.5 text-muted-foreground/60 shrink-0" />
              <span className="text-[9px] font-medium text-muted-foreground/80 truncate">
                #{machineIndex + 1}
              </span>
            </div>
          </div>
        </div>
      </motion.div>

      <AnimatePresence>
        {lightboxOpen && <ScreenshotLightbox src={src} onClose={() => setLightboxOpen(false)} />}
      </AnimatePresence>
    </>
  )
}

// ---------------------------------------------------------------------------
// Machine branch — single vertical column in the tree
// ---------------------------------------------------------------------------

function MachineBranch({
  machineIndex,
  steps,
  status,
  isLive,
}: {
  machineIndex: number
  steps: TimelineStep[]
  status: "success" | "error" | "pending"
  isLive: boolean
}) {
  // Track how many steps have been seen so only truly new steps get entrance animation
  const seenSteps = useRef(0)
  const isFirstRender = useRef(true)

  useEffect(() => {
    // After first render, mark initial steps as seen so they don't re-animate
    if (isFirstRender.current) {
      isFirstRender.current = false
      seenSteps.current = steps.length
    }
  }, [])

  useEffect(() => {
    // Update seen count after render so the animation has a chance to play
    const timer = setTimeout(() => {
      seenSteps.current = steps.length
    }, 50)
    return () => clearTimeout(timer)
  }, [steps.length])

  return (
    <div className="flex flex-col items-center">
      <div
        className={cn(
          "w-full rounded-xl border px-3 py-2.5 text-center transition-colors shadow-sm",
          status === "success"
            ? "border-emerald-500/25 bg-emerald-50 dark:bg-emerald-950/40"
            : status === "error"
              ? "border-red-500/25 bg-red-50 dark:bg-red-950/40"
              : "border-border/40 bg-background"
        )}
      >
        <div className="flex items-center justify-center gap-1.5">
          <Monitor className="size-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">Machine #{machineIndex + 1}</span>
          {status === "success" && <CheckCircle className="size-3 text-emerald-500" weight="fill" />}
          {status === "error" && <XCircle className="size-3 text-red-500" weight="fill" />}
          {status === "pending" && <CircleNotch className="size-3 text-blue-500 animate-spin" />}
        </div>
      </div>

      {steps.length > 0 && (
        <div className="relative w-full mt-0 pt-2">
          {/* Animated dashed connector line — grows from top */}
          <motion.div
            className="absolute left-1/2 top-0 bottom-0 w-px -translate-x-1/2 origin-top"
            style={{
              backgroundImage:
                "repeating-linear-gradient(to bottom, hsl(var(--border) / 0.35) 0px, hsl(var(--border) / 0.35) 4px, transparent 4px, transparent 8px)",
            }}
            initial={{ scaleY: 0, opacity: 0 }}
            animate={{ scaleY: 1, opacity: 1 }}
            transition={{ duration: 0.8, ease: EASE }}
          />
          <div className="relative flex flex-col gap-2 items-center">
            {steps.map((step, i) => {
              // For history load: stagger all cards. For live: only animate genuinely new steps.
              const isNew = i >= seenSteps.current
              return (
                <BranchStepCard
                  key={`${machineIndex}-${i}-${step.timestamp}`}
                  step={step}
                  index={i}
                  animateEntrance={isFirstRender.current || isNew}
                  staggerDelay={isFirstRender.current ? i * 0.06 : 0}
                />
              )
            })}
          </div>
        </div>
      )}

      {steps.length === 0 && (
        <div className="mt-3 text-[11px] text-muted-foreground/50 text-center">No steps</div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Branch step card
// ---------------------------------------------------------------------------

function BranchStepCard({
  step,
  index,
  animateEntrance = true,
  staggerDelay = 0,
}: {
  step: TimelineStep
  index: number
  animateEntrance?: boolean
  staggerDelay?: number
}) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const hasScreenshot = !!step.screenshot
  const hasDetails = step.toolCalls.length > 0 || step.toolResults.length > 0

  // Parse web search blocks from text
  const { searches, remainingText } = useMemo(
    () => (step.text ? extractWebSearches(step.text) : { searches: [], remainingText: step.text }),
    [step.text]
  )

  return (
    <motion.div
      initial={animateEntrance ? { opacity: 0, y: 18, scale: 0.92 } : false}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        duration: 0.45,
        delay: staggerDelay,
        ease: EASE,
      }}
      className="relative w-full z-[1]"
    >
      <div className="absolute left-1/2 -top-1 -translate-x-1/2 z-[2]">
        {hasScreenshot ? (
          <ScreenshotDotSmall src={step.screenshot!} />
        ) : step.status === "awaiting_human" ? (
          <HandPalm className="size-3.5 text-amber-500 animate-pulse" weight="fill" />
        ) : (
          <span
            className={cn(
              "block size-2.5 rounded-full ring-2 ring-background",
              step.status === "success"
                ? "bg-emerald-500/70"
                : step.status === "error"
                  ? "bg-red-500/70"
                  : "bg-muted-foreground/30"
            )}
          />
        )}
      </div>

      <div
        className={cn(
          "mx-1 mt-2 rounded-lg border px-3 py-2 text-left transition-colors duration-150 shadow-sm",
          step.status === "awaiting_human"
            ? "border-amber-300/50 bg-amber-50/60 dark:border-amber-600/30 dark:bg-amber-950/25 p-0 overflow-hidden"
            : "border-border/30 bg-background/95 hover:border-border/55 hover:bg-background"
        )}
      >
        {step.status === "awaiting_human" ? (
          <AwaitingHumanBanner
            reason={step.awaitingHumanReason || step.text}
            machineId={step.machineId || ""}
            isActive={true}
          />
        ) : remainingText ? (
          <p className="text-[12px] leading-relaxed text-foreground/85 line-clamp-3">{remainingText}</p>
        ) : null}

        {searches.length > 0 && (
          <div className="space-y-1.5 mt-1">
            {searches.map((search, si) => (
              <WebSearchCard key={si} search={search} />
            ))}
          </div>
        )}

        {step.toolResults.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 mt-1.5">
            {step.toolResults.map((r, j) => {
              const swarmType = classifySwarmTool(r.name || "")
              if (swarmType) {
                return <SwarmToolBadge key={j} type={swarmType} name={r.name} content={r.content} />
              }
              return (
                <span
                  key={j}
                  className={cn(
                    "inline-flex items-center gap-1 text-[10px] leading-none px-1.5 py-0.5 rounded-full",
                    step.status === "error"
                      ? "text-red-500/80 bg-red-500/8"
                      : "text-emerald-600/80 dark:text-emerald-400/70 bg-emerald-500/8"
                  )}
                >
                  <StatusDot status={step.status} />
                  {r.name || "Action"}
                </span>
              )
            })}
          </div>
        )}

        {/* Swarm tool calls — special rendering */}
        {step.toolCalls.length > 0 && step.toolCalls.some((tc) => classifySwarmTool(tc.name)) && (
          <div className="flex flex-wrap items-center gap-1 mt-1.5">
            {step.toolCalls
              .filter((tc) => classifySwarmTool(tc.name))
              .map((tc, j) => {
                const swarmType = classifySwarmTool(tc.name)!
                return <SwarmToolBadge key={`stc-${j}`} type={swarmType} name={tc.name} content={tc.content} />
              })}
          </div>
        )}

        {hasScreenshot && (
          <div className="mt-2">
            <ScreenshotInline src={step.screenshot!} />
          </div>
        )}

        {hasDetails && (
          <div className="mt-1">
            <button
              type="button"
              onClick={() => setDetailsOpen((o) => !o)}
              className="flex items-center gap-1 py-0.5 text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
            >
              <CaretRight
                weight="bold"
                className={cn(
                  "size-2 shrink-0 transition-transform duration-150",
                  detailsOpen && "rotate-90"
                )}
              />
              <Eye className="size-2.5 shrink-0" />
              <span>Details</span>
            </button>
            <AnimatePresence initial={false}>
              {detailsOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.15, ease: "easeOut" }}
                  className="overflow-hidden"
                >
                  <div className="pt-1 pb-1 space-y-1.5">
                    {step.toolCalls.map((tc, j) => {
                      const swarmType = classifySwarmTool(tc.name)
                      if (swarmType) {
                        const meta = SWARM_TOOL_META[swarmType]
                        const Icon = meta.icon
                        return (
                          <div key={`tc-${j}`} className={cn("text-[11px] rounded-md border px-2 py-1.5", meta.bgColor)}>
                            <span className={cn("inline-flex items-center gap-1 font-medium", meta.color)}>
                              <Icon className="size-3" weight="fill" />
                              {meta.label}
                            </span>
                            {tc.content && (
                              <p className="text-muted-foreground/60 mt-0.5 break-words whitespace-pre-wrap text-[10px] line-clamp-4">
                                {tc.content}
                              </p>
                            )}
                          </div>
                        )
                      }
                      return (
                        <div key={`tc-${j}`} className="text-[11px]">
                          <span className="inline-flex items-center gap-1 text-violet-600 dark:text-violet-400 font-medium">
                            <Wrench className="size-2.5" />
                            {tc.name || "Tool call"}
                          </span>
                          {tc.content && (
                            <p className="text-muted-foreground/60 mt-0.5 break-words whitespace-pre-wrap text-[10px] line-clamp-4">
                              {tc.content}
                            </p>
                          )}
                        </div>
                      )
                    })}
                    {step.toolResults.map((tr, j) => {
                      const swarmType = classifySwarmTool(tr.name)
                      if (swarmType) {
                        const meta = SWARM_TOOL_META[swarmType]
                        const Icon = meta.icon
                        return (
                          <div key={`tr-${j}`} className={cn("text-[11px] rounded-md border px-2 py-1.5", meta.bgColor)}>
                            <span className={cn("inline-flex items-center gap-1 font-medium", meta.color)}>
                              <Icon className="size-3" weight="fill" />
                              {meta.label} Result
                            </span>
                            {tr.content && (
                              <p className="text-muted-foreground/60 mt-0.5 break-words whitespace-pre-wrap text-[10px] line-clamp-4">
                                {tr.content}
                              </p>
                            )}
                            {tr.screenshot && <ScreenshotInline src={tr.screenshot} />}
                          </div>
                        )
                      }
                      return (
                        <div key={`tr-${j}`} className="text-[11px]">
                          <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                            <CheckCircle className="size-2.5" weight="fill" />
                            {tr.name || "Result"}
                          </span>
                          {tr.content && (
                            <p className="text-muted-foreground/60 mt-0.5 break-words whitespace-pre-wrap text-[10px] line-clamp-4">
                              {tr.content}
                            </p>
                          )}
                          {tr.screenshot && <ScreenshotInline src={tr.screenshot} />}
                        </div>
                      )
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Swarm Tool Badge — special visual for swarm communication tools
// ---------------------------------------------------------------------------

function SwarmToolBadge({
  type,
  name,
  content,
}: {
  type: SwarmToolType
  name: string
  content: string
}) {
  const meta = SWARM_TOOL_META[type]
  const Icon = meta.icon
  const targetMachine = extractTargetMachine(content || name)
  const preview = extractMessagePreview(content || name)

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[10px] leading-none px-2 py-1 rounded-lg border transition-colors",
        meta.bgColor,
        meta.color
      )}
    >
      <Icon className="size-3 shrink-0" weight="fill" />
      <span className="font-medium">{meta.label}</span>
      {type === "direct_message" && targetMachine !== null && (
        <span className="inline-flex items-center gap-0.5 opacity-70">
          <ArrowBendUpRight className="size-2" weight="bold" />
          #{targetMachine + 1}
        </span>
      )}
      {type === "broadcast" && (
        <span className="opacity-60">all</span>
      )}
      {preview && type !== "direct_message" && type !== "broadcast" && (
        <span className="opacity-60 truncate max-w-[80px]">{preview}</span>
      )}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Web Search Card — compact display for search results in tree nodes
// ---------------------------------------------------------------------------

function WebSearchCard({ search }: { search: WebSearchBlock }) {
  const [expanded, setExpanded] = useState(false)
  const resultCount = search.results.length

  return (
    <div className="rounded-md border border-blue-500/15 bg-blue-50/50 dark:bg-blue-950/20 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((o) => !o)}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-left hover:bg-blue-50/80 dark:hover:bg-blue-950/30 transition-colors"
      >
        <MagnifyingGlass className="size-3 text-blue-500 shrink-0" weight="bold" />
        <span className="text-[11px] font-medium text-blue-700 dark:text-blue-300 truncate flex-1">
          {search.query}
        </span>
        <span className="text-[9px] text-blue-500/60 shrink-0">
          {resultCount > 0 ? `${resultCount} result${resultCount !== 1 ? "s" : ""}` : "No results"}
        </span>
        <CaretRight
          weight="bold"
          className={cn(
            "size-2 text-blue-500/50 shrink-0 transition-transform duration-150",
            expanded && "rotate-90"
          )}
        />
      </button>
      <AnimatePresence initial={false}>
        {expanded && resultCount > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="px-2 pb-1.5 space-y-1 border-t border-blue-500/10">
              {search.results.slice(0, 5).map((r, ri) => (
                <div key={ri} className="pt-1">
                  <div className="flex items-start gap-1">
                    <Globe className="size-2.5 text-blue-400/60 shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-medium text-foreground/80 leading-tight truncate">
                        {r.title}
                      </p>
                      {r.snippet && (
                        <p className="text-[9px] text-muted-foreground/50 leading-snug line-clamp-2 mt-0.5">
                          {r.snippet}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Screenshot components
// ---------------------------------------------------------------------------

function ScreenshotDotSmall({ src }: { src: string }) {
  const [lightboxOpen, setLightboxOpen] = useState(false)
  return (
    <>
      <motion.div
        className="cursor-pointer z-[2] transition-transform duration-150 hover:scale-[1.2]"
        whileTap={{ scale: 0.95 }}
        transition={{ type: "spring", stiffness: 500, damping: 15 }}
        onClick={() => setLightboxOpen(true)}
      >
        <div className="size-5 rounded-[4px] overflow-hidden ring-2 ring-background shadow-sm">
          <img src={src} alt="" className="size-full object-cover" draggable={false} />
        </div>
      </motion.div>
      <AnimatePresence>
        {lightboxOpen && <ScreenshotLightbox src={src} onClose={() => setLightboxOpen(false)} />}
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

function ScreenshotInline({ src }: { src: string }) {
  const [lightboxOpen, setLightboxOpen] = useState(false)
  return (
    <>
      <motion.div
        className="mt-1.5 cursor-pointer inline-block transition-transform duration-150 hover:scale-[1.02]"
        whileTap={{ scale: 0.98 }}
        onClick={() => setLightboxOpen(true)}
      >
        <div className="max-w-[280px] rounded-lg overflow-hidden ring-1 ring-border/30">
          <img src={src} alt="Screenshot" className="w-full object-cover" draggable={false} />
        </div>
      </motion.div>
      <AnimatePresence>
        {lightboxOpen && <ScreenshotLightbox src={src} onClose={() => setLightboxOpen(false)} />}
      </AnimatePresence>
    </>
  )
}

function StatusDot({ status }: { status: string }) {
  if (status === "success")
    return <span className="inline-block size-1.5 rounded-full bg-emerald-500/70 shrink-0" />
  if (status === "error")
    return <span className="inline-block size-1.5 rounded-full bg-red-500/70 shrink-0" />
  return <span className="inline-block size-1.5 rounded-full bg-muted-foreground/30 shrink-0" />
}
