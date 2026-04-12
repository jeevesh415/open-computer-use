"use client"

import { Markdown } from "@/components/prompt-kit/markdown"
import { cn } from "@/lib/utils"
import {
  CheckCircle,
  XCircle,
  CaretRight,
  Eye,
  Code,
  Brain,
  Lightning,
  Terminal,
  MagnifyingGlass,
  Timer,
} from "@phosphor-icons/react"
import { AnimatePresence, motion } from "framer-motion"
import { memo, useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { AwaitingHumanBanner } from "./awaiting-human-banner"

// ── Types ──

type SectionType =
  | "verification"
  | "analysis"
  | "next-action"
  | "grounded-action"
  | "reflection"
  | "code-agent-summary"
  | "code-agent-thought"
  | "code-agent-result"
  | "code-agent-done"
  | "action-result"
  | "status"
  | "search-results"
  | "awaiting-human"
  | "awaiting-human-timeout"
  | "awaiting-human-resumed"

interface ParsedSection {
  type: SectionType
  content: string
  attrs: Record<string, string>
}

interface StepGroup {
  kind: "step"
  action: string
  observation: string | null
  code: string | null
  results: { content: string; status: string }[]
}

type TopLevelItem =
  | StepGroup
  | { kind: "status"; content: string; status: string }
  | { kind: "code-agent-thought"; content: string; step: string; budget: string }
  | { kind: "code-agent-result"; content: string; step: string }
  | { kind: "code-agent-done"; content: string; step: string }
  | { kind: "code-agent-summary"; content: string }
  | { kind: "search-results"; query: string; content: string }
  | { kind: "awaiting-human"; reason: string; machineId: string }
  | { kind: "awaiting-human-timeout"; content: string }
  | { kind: "awaiting-human-resumed"; content: string }
  | { kind: "text"; content: string }

// ── Parser ──

const TAG_REGEX = /<cua-section\s+([^>]*)>([\s\S]*?)<\/cua-section>/g
const ATTR_REGEX = /(\w[\w-]*)="([^"]*)"/g

function stripAgentCode(text: string): string {
  return text.replace(/```(?:python)?\s*agent\.[\s\S]*?```/g, "").trim()
}

/** Truncate long text with ellipsis, respecting word boundaries */
function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  const cut = text.lastIndexOf(" ", maxLen)
  return text.slice(0, cut > maxLen * 0.5 ? cut : maxLen) + "…"
}

/**
 * Clean agent code for display: truncate long string args (like code agent prompts),
 * strip excessive \n sequences, and format for readability.
 */
function formatAgentCode(code: string): string {
  // Truncate very long string arguments inside agent calls (e.g. code_agent prompts)
  return code.replace(/"([^"]{200,})"/g, (_match, content: string) => {
    return `"${content.slice(0, 150)}…"`
  })
}

function parseAttributes(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  let m: RegExpExecArray | null
  while ((m = ATTR_REGEX.exec(attrString)) !== null) {
    attrs[m[1]] = m[2]
  }
  return attrs
}

function parseSections(raw: string): ParsedSection[] {
  const sections: ParsedSection[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  TAG_REGEX.lastIndex = 0

  while ((match = TAG_REGEX.exec(raw)) !== null) {
    const before = raw.slice(lastIndex, match.index).trim()
    if (before) {
      sections.push({ type: "next-action" as SectionType, content: before, attrs: { _plain: "true" } })
    }
    const attrs = parseAttributes(match[1])
    sections.push({
      type: (attrs.type ?? "next-action") as SectionType,
      content: match[2].trim(),
      attrs,
    })
    lastIndex = match.index + match[0].length
  }

  const trailing = raw.slice(lastIndex).trim()
  if (trailing) {
    sections.push({ type: "next-action" as SectionType, content: trailing, attrs: { _plain: "true" } })
  }
  return sections
}

// ── Grouping ──

const OBSERVATION_TYPES = new Set<SectionType>(["verification", "analysis", "reflection"])

function buildTopLevel(sections: ParsedSection[]): TopLevelItem[] {
  const items: TopLevelItem[] = []
  let i = 0
  let pendingStep: StepGroup | null = null

  function flushStep() {
    if (pendingStep) {
      items.push(pendingStep)
      pendingStep = null
    }
  }

  while (i < sections.length) {
    const s = sections[i]

    if (OBSERVATION_TYPES.has(s.type)) {
      const parts: string[] = []
      while (i < sections.length && OBSERVATION_TYPES.has(sections[i].type)) {
        parts.push(sections[i].content)
        i++
      }
      const merged = parts.join("\n\n")
      if (pendingStep && pendingStep.action) flushStep()
      if (!pendingStep) {
        pendingStep = { kind: "step", action: "", observation: merged, code: null, results: [] }
      } else {
        pendingStep.observation = pendingStep.observation
          ? pendingStep.observation + "\n\n" + merged
          : merged
      }
      continue
    }

    if (s.type === "next-action") {
      if (pendingStep && pendingStep.action) flushStep()
      if (!pendingStep) {
        pendingStep = { kind: "step", action: "", observation: null, code: null, results: [] }
      }
      if (s.attrs._plain === "true") {
        flushStep()
        items.push({ kind: "text", content: s.content })
      } else {
        pendingStep.action = s.content
      }
    } else if (s.type === "grounded-action") {
      if (pendingStep) pendingStep.code = s.content
    } else if (s.type === "action-result") {
      if (pendingStep) pendingStep.results.push({ content: s.content, status: s.attrs.status || "success" })
    } else if (s.type === "status") {
      flushStep()
      items.push({ kind: "status", content: s.content, status: s.attrs.status || "completed" })
    } else if (s.type === "code-agent-thought") {
      flushStep()
      items.push({ kind: "code-agent-thought", content: s.content, step: s.attrs.step || "", budget: s.attrs.budget || "" })
    } else if (s.type === "code-agent-result") {
      flushStep()
      items.push({ kind: "code-agent-result", content: s.content, step: s.attrs.step || "" })
    } else if (s.type === "code-agent-done") {
      flushStep()
      items.push({ kind: "code-agent-done", content: s.content, step: s.attrs.step || "" })
    } else if (s.type === "code-agent-summary") {
      flushStep()
      items.push({ kind: "code-agent-summary", content: s.content })
    } else if (s.type === "search-results") {
      flushStep()
      items.push({ kind: "search-results", query: s.attrs.query || "", content: s.content })
    } else if (s.type === "awaiting-human") {
      flushStep()
      items.push({ kind: "awaiting-human", reason: s.attrs.reason || s.content, machineId: s.attrs.machineId || s.attrs.machineid || "" })
    } else if (s.type === "awaiting-human-timeout") {
      flushStep()
      items.push({ kind: "awaiting-human-timeout", content: s.content })
    } else if (s.type === "awaiting-human-resumed") {
      flushStep()
      items.push({ kind: "awaiting-human-resumed", content: s.content })
    }

    i++
  }

  flushStep()
  return items
}

// ── Screenshot Lightbox ──

function ScreenshotLightbox({
  src,
  onClose,
}: {
  src: string
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
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

// ── Screenshot Thumbnail (replaces timeline dot) ──

function ScreenshotDot({ src }: { src: string }) {
  const [lightboxOpen, setLightboxOpen] = useState(false)

  return (
    <>
      <motion.div
        className="absolute -left-[10px] top-[3px] z-[2] cursor-pointer"
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.96 }}
        transition={{ type: "spring", stiffness: 400, damping: 20 }}
        onClick={() => setLightboxOpen(true)}
      >
        <div className="size-[26px] rounded-[5px] overflow-hidden ring-1 ring-black/[0.06] dark:ring-white/[0.08] shadow-sm">
          <img src={src} alt="" className="size-full object-cover" draggable={false} />
        </div>
      </motion.div>

      <AnimatePresence>
        {lightboxOpen && (
          <ScreenshotLightbox src={src} onClose={() => setLightboxOpen(false)} />
        )}
      </AnimatePresence>
    </>
  )
}

// ── Plain Timeline Dot (no screenshot) — no-op with dotted line ──
// Kept as a stub so StepCard doesn't need restructuring.

function PlainDot({ status: _status }: { status: "success" | "error" | "pending" }) {
  return null
}

// ── Primitives ──

function DetailRow({
  icon: Icon,
  label,
  children,
  defaultOpen = false,
}: {
  icon: React.ComponentType<any>
  label: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="group/detail flex items-center gap-1.5 py-1 text-[12.5px] text-muted-foreground/50 hover:text-muted-foreground/80 transition-colors"
      >
        <CaretRight
          weight="bold"
          className={cn(
            "size-2.5 shrink-0 transition-transform duration-200 ease-out",
            open && "rotate-90"
          )}
        />
        <Icon className="size-3 shrink-0 opacity-50 group-hover/detail:opacity-80 transition-opacity" />
        <span>{label}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="ml-[22px] pb-2 text-[13px] leading-relaxed text-muted-foreground/80">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function StatusDot({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-block size-[5px] rounded-full shrink-0",
        status === "success" && "bg-emerald-400 dark:bg-emerald-500/70",
        status === "error" && "bg-red-400 dark:bg-red-500/70",
        status !== "success" && status !== "error" && "bg-foreground/[0.14] dark:bg-foreground/[0.10]",
      )}
    />
  )
}

// ── Step ──

/** Extract a short task description from agent.call_code_agent(...) code */
function extractCodeAgentTask(code: string): string | null {
  const match = code.match(/agent\.call_code_agent\s*\(\s*task\s*=\s*"([\s\S]*?)(?:"\s*[,)])/)
    || code.match(/agent\.call_code_agent\s*\(\s*task\s*=\s*'([\s\S]*?)(?:'\s*[,)])/)
  if (!match) return null
  return match[1].replace(/\\n/g, " ").trim()
}

/** Check if grounded action code is an agent function call (code_agent, wait, etc.) */
function extractAgentAction(code: string): { type: string; label: string; detail?: string } | null {
  // Code agent
  const codeAgentTask = extractCodeAgentTask(code)
  if (codeAgentTask || /agent\.call_code_agent/.test(code)) {
    return { type: "code-agent", label: "Code Agent", detail: codeAgentTask || undefined }
  }
  return null
}

function StepCard({
  step,
  screenshot,
}: {
  step: StepGroup
  screenshot?: string | null
}) {
  const actionText = step.action ? stripAgentCode(step.action) : ""
  const hasDetails = step.observation || step.code || step.results.length > 0

  if (!actionText && !hasDetails) return null

  const hasError = step.results.some(r => r.status === "error")
  const isDone = step.results.length > 0
  const status: "success" | "error" | "pending" = hasError
    ? "error"
    : isDone
      ? "success"
      : "pending"
  const hasScreenshot = !!screenshot
  const agentAction = step.code ? extractAgentAction(step.code) : null

  return (
    <div className={cn("group/step relative pb-1", hasScreenshot ? "pl-8" : "pl-6")}>
      {hasScreenshot ? (
        <ScreenshotDot src={screenshot!} />
      ) : (
        <PlainDot status={status} />
      )}

      {/* Action — the natural language line (truncated for readability) */}
      {actionText && (
        <p className="text-[15px] leading-relaxed text-foreground/90">
          {truncateText(actionText, 200)}
        </p>
      )}

      {/* Agent function call pill + prompt card (e.g. code_agent) */}
      {agentAction && (
        <div className="mt-1.5 rounded-lg border border-emerald-500/15 dark:border-emerald-400/12 bg-emerald-500/[0.03] dark:bg-emerald-400/[0.03] overflow-hidden">
          <div className="flex items-center gap-2 px-2.5 py-1.5">
            <span className="inline-flex items-center gap-1.5 text-[11.5px] leading-none font-medium px-2 py-[3px] rounded-full bg-emerald-500/12 text-emerald-600 dark:text-emerald-400">
              <Terminal className="size-3 shrink-0" />
              {agentAction.label}
            </span>
          </div>
          {agentAction.detail && (
            <div className="px-3 pb-2.5 -mt-0.5">
              <p className="text-[12.5px] leading-relaxed text-foreground/60 dark:text-foreground/50">
                {truncateText(agentAction.detail, 300)}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Inline result badges */}
      {step.results.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mt-1">
          {step.results.map((r, j) => (
            <span
              key={j}
              className={cn(
                "inline-flex items-center gap-1 text-[11px] leading-none px-1.5 py-0.5 rounded-full",
                r.status === "success" && "text-emerald-600/80 dark:text-emerald-400/70 bg-emerald-500/8",
                r.status === "error" && "text-red-500/80 dark:text-red-400/70 bg-red-500/8",
                r.status !== "success" && r.status !== "error" && "text-muted-foreground/50 bg-muted-foreground/5",
              )}
            >
              <StatusDot status={r.status} />
              {truncateText(r.content, 120)}
            </span>
          ))}
        </div>
      )}

      {/* Expandable details */}
      {step.observation && (
        <div className="mt-0.5">
          <DetailRow icon={Eye} label="What it noticed">
            <Markdown>{step.observation}</Markdown>
          </DetailRow>
        </div>
      )}
    </div>
  )
}

// ── Item Renderer ──

function ItemRenderer({
  item,
  screenshot,
  isStreaming,
}: {
  item: TopLevelItem
  screenshot?: string | null
  isStreaming?: boolean
}) {
  switch (item.kind) {
    case "step":
      return <StepCard step={item} screenshot={screenshot} />

    case "status": {
      const done = item.status === "completed"
      return (
        <div className="py-1.5 pl-6">
          <div className={cn(
            "inline-flex items-center gap-2 rounded-lg border px-3 py-1.5",
            done
              ? "border-emerald-200/60 bg-emerald-500/[0.04] dark:border-emerald-700/40 dark:bg-emerald-400/[0.04]"
              : "border-red-200/60 bg-red-500/[0.04] dark:border-red-700/40 dark:bg-red-400/[0.04]",
          )}>
            {done ? (
              <CheckCircle className="size-3.5 shrink-0 text-emerald-500" weight="fill" />
            ) : (
              <XCircle className="size-3.5 shrink-0 text-red-500" weight="fill" />
            )}
            <span className={cn(
              "text-[13px] font-medium",
              done ? "text-emerald-700 dark:text-emerald-300" : "text-red-600 dark:text-red-400",
            )}>
              {item.content}
            </span>
          </div>
        </div>
      )
    }

    case "code-agent-thought": {
      const label = "Thinking"
      return (
        <div className="pl-6">
          <DetailRow icon={Brain} label={label}>
            <Markdown>{item.content}</Markdown>
          </DetailRow>
        </div>
      )
    }

    case "code-agent-result": {
      const label = "Result"
      return (
        <div className="pl-6">
          <DetailRow icon={Lightning} label={label} defaultOpen>
            <Markdown>{item.content}</Markdown>
          </DetailRow>
        </div>
      )
    }

    case "code-agent-done":
      return (
        <div className="py-0.5 pl-6">
          <span className="inline-flex items-center gap-1.5 text-[12px] text-emerald-600/50 dark:text-emerald-400/40">
            <CheckCircle className="size-3 shrink-0" weight="fill" />
            {item.content}
          </span>
        </div>
      )

    case "code-agent-summary":
      return (
        <div className="pl-6">
          <DetailRow icon={Terminal} label="Summary" defaultOpen>
            <Markdown>{item.content}</Markdown>
          </DetailRow>
        </div>
      )

    case "search-results": {
      const label = item.query ? `Search: ${item.query}` : "Web search"
      return (
        <div className="pl-6">
          <DetailRow icon={MagnifyingGlass} label={label} defaultOpen>
            <Markdown>{item.content}</Markdown>
          </DetailRow>
        </div>
      )
    }

    case "awaiting-human":
      return (
        <div className="relative pl-6 py-2">
          <AwaitingHumanBanner
            reason={item.reason}
            machineId={item.machineId}
            isActive={isStreaming}
          />
        </div>
      )

    case "awaiting-human-timeout":
      return (
        <div className="py-1.5 pl-6">
          <div className={cn(
            "inline-flex items-center gap-2 rounded-lg border px-3 py-1.5",
            "border-amber-200/60 bg-amber-500/[0.04]",
            "dark:border-amber-700/40 dark:bg-amber-400/[0.04]",
          )}>
            <Timer className="size-3.5 shrink-0 text-amber-500" weight="fill" />
            <span className="text-[13px] font-medium text-amber-700 dark:text-amber-300">
              {item.content}
            </span>
          </div>
        </div>
      )

    case "awaiting-human-resumed":
      return (
        <div className="py-1.5 pl-6">
          <div className={cn(
            "inline-flex items-center gap-2 rounded-lg border px-3 py-1.5",
            "border-emerald-200/60 bg-emerald-500/[0.04]",
            "dark:border-emerald-700/40 dark:bg-emerald-400/[0.04]",
          )}>
            <CheckCircle className="size-3.5 shrink-0 text-emerald-500" weight="fill" />
            <span className="text-[13px] font-medium text-emerald-700 dark:text-emerald-300">
              Human finished — agent resuming with fresh screen state
            </span>
          </div>
        </div>
      )

    case "text": {
      const cleaned = stripAgentCode(item.content)
      if (!cleaned) return null
      return (
        <div className="pl-6 py-0.5 text-[15px] leading-relaxed text-foreground/80">
          <Markdown>{truncateText(cleaned, 500)}</Markdown>
        </div>
      )
    }

    default:
      return null
  }
}

// ── Screenshot extraction helper ──

function toDataUri(raw: string): string | null {
  const clean = raw.trim()
  if (!clean) return null
  if (clean.startsWith("data:image/")) return clean
  if (clean.startsWith("/9j/")) return `data:image/jpeg;base64,${clean}`
  if (clean.startsWith("iVBOR")) return `data:image/png;base64,${clean}`
  return `data:image/jpeg;base64,${clean}`
}

/** Extract all screenshots from message parts in order */
export function extractScreenshots(
  parts?: Array<{ type: string; toolInvocation?: any }>
): string[] {
  if (!parts) return []
  const screenshots: string[] = []

  for (const part of parts) {
    if (part.type !== "tool-invocation" || !part.toolInvocation) continue
    const inv = part.toolInvocation as any

    // DB-persisted format
    if (inv.frontendScreenshot && typeof inv.frontendScreenshot === "string") {
      const uri = toDataUri(inv.frontendScreenshot)
      if (uri) {
        screenshots.push(uri)
        continue
      }
    }

    // Streaming format
    if (
      inv.state === "result" &&
      inv.result &&
      typeof inv.result === "object" &&
      "frontendScreenshot" in inv.result
    ) {
      const uri = toDataUri(inv.result.frontendScreenshot)
      if (uri) {
        screenshots.push(uri)
        continue
      }
    }
  }

  return screenshots
}

// ── Exported ──

export function hasCuaSections(content: string): boolean {
  return /<cua-section\s/.test(content)
}

export const CuaSectionRenderer = memo(function CuaSectionRenderer({
  content,
  className,
  screenshots,
  isStreaming,
}: {
  content: string
  className?: string
  screenshots?: string[]
  isStreaming?: boolean
}) {
  const items = useMemo(() => {
    const sections = parseSections(content)
    return buildTopLevel(sections)
  }, [content])

  // Map screenshots to step items only (skip non-step items)
  const stepScreenshotMap = useMemo(() => {
    if (!screenshots || screenshots.length === 0) return new Map<number, string>()
    const map = new Map<number, string>()
    let screenshotIdx = 0
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === "step" && screenshotIdx < screenshots.length) {
        map.set(i, screenshots[screenshotIdx])
        screenshotIdx++
      }
    }
    return map
  }, [items, screenshots])

  return (
    <div className={cn("flex flex-col", className)}>
      <div className="relative">
        {/* Timeline — dotted line, fades at ends */}
        <div
          className="absolute left-[2.5px] top-0 bottom-0 w-px opacity-[0.22] dark:opacity-[0.30]"
          style={{
            maskImage: "linear-gradient(to bottom, transparent, black 12%, black 88%, transparent)",
            WebkitMaskImage: "linear-gradient(to bottom, transparent, black 12%, black 88%, transparent)",
            backgroundImage: "repeating-linear-gradient(to bottom, currentColor 0px, currentColor 2px, transparent 2px, transparent 7px)",
          }}
          aria-hidden="true"
        />
        <div className="relative flex flex-col">
          {items.map((item, i) => (
            <ItemRenderer
              key={i}
              item={item}
              screenshot={stepScreenshotMap.get(i)}
              isStreaming={isStreaming}
            />
          ))}
        </div>
      </div>
    </div>
  )
})
