"use client"

import { Markdown } from "@/components/prompt-kit/markdown"
import { cn } from "@/lib/utils"
import {
  CheckCircle,
  XCircle,
  CaretRight,
  Eye,
  Code,
  Terminal,
  MagnifyingGlass,
  Timer,
  Copy,
  Check,
} from "@phosphor-icons/react"
import { AnimatePresence, motion } from "framer-motion"
import { memo, useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import type { Components } from "react-markdown"
import { AwaitingHumanBanner } from "./awaiting-human-banner"
import { LinkMarkdown } from "./link-markdown"

// ── Refined Markdown for CUA sections ──
//
// The shared <Markdown> component renders inline `<code>` as a `<span>` with
// `bg-primary-foreground` — a high-contrast token that paints as black-on-white
// in dark mode, which looks harsh inside the cua timeline. We override the
// `code` mapper here so inline code becomes a subtle rounded chip (mono font,
// 0.88em so it visually balances with surrounding text, hairline ring), while
// keeping link rendering via the project's <LinkMarkdown> wrapper.

const CUA_MARKDOWN_COMPONENTS: Partial<Components> = {
  code: function CodeComponent({ className, children, node, ...props }: any) {
    const isInline =
      !node?.position?.start.line ||
      node?.position?.start.line === node?.position?.end.line
    if (isInline) {
      return (
        <span
          className="rounded-md bg-foreground/[0.06] ring-1 ring-foreground/[0.05] px-1.5 py-0.5 font-mono text-[0.88em] text-foreground/90"
          {...props}
        >
          {children}
        </span>
      )
    }
    // Block code: plain <code>, parent's [&_pre] selectors style the wrapper.
    return (
      <code
        className={cn("font-mono text-[12px] text-foreground/85", className)}
        {...props}
      >
        {children}
      </code>
    )
  },
  a: function AComponent({ href, children, ...props }: any) {
    if (!href) return <span {...props}>{children}</span>
    return (
      <LinkMarkdown href={href} {...props}>
        {children}
      </LinkMarkdown>
    )
  },
}

function CuaMarkdown({ children }: { children: string }) {
  return <Markdown components={CUA_MARKDOWN_COMPONENTS}>{children}</Markdown>
}

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

  // Micro-interactions:
  //   • Rest        — tilted -7° to match TerminalDot's character.
  //   • Hover       — straightens to 0°, scales up 12%, lifts 1px, and
  //                   the shadow + ring intensify. Reads as "the
  //                   screenshot is righting itself for inspection."
  //   • Press       — quick scale-down + slight counter-tilt for a
  //                   tactile click response.
  // Springs are tuned snappy (stiffness 380 / damping 25) so the
  // interactions feel responsive rather than bouncy.
  return (
    <>
      <motion.button
        type="button"
        onClick={() => setLightboxOpen(true)}
        aria-label="View screenshot"
        initial={false}
        animate={{ rotate: -7, scale: 1, y: 0 }}
        whileHover={{ rotate: 0, scale: 1.12, y: -1 }}
        whileTap={{ scale: 0.95, rotate: -3 }}
        transition={{ type: "spring", stiffness: 380, damping: 25 }}
        className={cn(
          // 36×22 landscape — close to 16:10 screen aspect so the
          // thumbnail reads as a tiny screen rather than a generic
          // square chip. Position -left-[15px] keeps the dot's center
          // on the timeline rail at x=3 (36/2 - 3 = 15).
          "absolute -left-[15px] top-[3px] z-[2] block h-[22px] w-[36px] cursor-pointer overflow-hidden rounded-[5px]",
          "ring-1 ring-black/[0.06] dark:ring-white/[0.08]",
          "shadow-[0_1px_2px_rgba(0,0,0,0.06),0_3px_6px_rgba(0,0,0,0.04)]",
          // Shadow + ring transitions handled by CSS since they're not
          // on Framer Motion's animatable transform path.
          "transition-[box-shadow,outline-color] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
          "hover:ring-black/[0.12] dark:hover:ring-white/[0.16]",
          "hover:shadow-[0_3px_8px_rgba(0,0,0,0.10),0_8px_24px_rgba(0,0,0,0.08)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40",
        )}
      >
        <img src={src} alt="" className="size-full object-cover" draggable={false} />
      </motion.button>

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

function stripAgentMarkup(raw: string): string {
  // The code agent wraps each command/answer in <answer>...</answer>
  // tags and wraps stdout in ``` fences. Strip both so the user sees
  // clean text — these are internal markers, not user-facing markup.
  // Used by every code-agent-* section type (thought, result, summary)
  // since the agent can leak the tags into any of them.
  return raw
    // Strip <answer> / </answer> tags wherever they appear (inline OR
    // on their own line). The backend produces both forms.
    .replace(/<\/?answer\b[^>]*>/gi, "")
    // Strip inline triple-backtick fences with an optional language tag
    // (e.g. ```bash ...```) wherever they appear.
    .replace(/```\w*\s*/g, "")
    .replace(/\s*```/g, "")
    // Strip lone fence lines that survived (``` on its own line).
    .split("\n")
    .filter((line) => !/^\s*```\s*\w*\s*$/.test(line))
    .join("\n")
    // Collapse runs of 3+ blank lines down to one for tidiness.
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function CopyButton({
  text,
  className,
}: {
  text: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)

  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (typeof navigator === "undefined" || !navigator.clipboard) return
    void navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={copied ? "Copied" : "Copy result"}
      title={copied ? "Copied" : "Copy"}
      className={cn(
        "-mr-1 inline-flex size-6 items-center justify-center rounded-md text-foreground/35 transition-all duration-150 hover:bg-foreground/[0.06] hover:text-foreground/80 active:scale-95",
        className
      )}
    >
      {copied ? (
        <Check weight="bold" className="size-3 text-emerald-500" />
      ) : (
        <Copy weight="regular" className="size-3" />
      )}
    </button>
  )
}

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
    // Bottom padding intentionally omitted — the parent timeline uses a
    // uniform `gap-y` to space adjacent items, so individual cards stay
    // tight internally and breathing room lives at the seam between them.
    <div className={cn("group/step relative", hasScreenshot ? "pl-8" : "pl-6")}>
      {hasScreenshot ? (
        <ScreenshotDot src={screenshot!} />
      ) : (
        <PlainDot status={status} />
      )}

      {/* Action — the natural language line (truncated for readability) */}
      {actionText && (
        <p className="text-[15px] leading-relaxed text-foreground/90 break-words overflow-hidden">
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
            <div className="px-3 pb-2.5 -mt-0.5 overflow-hidden">
              <p className="text-[12.5px] leading-relaxed text-foreground/60 dark:text-foreground/50 break-words">
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
            <CuaMarkdown>{step.observation}</CuaMarkdown>
          </DetailRow>
        </div>
      )}
    </div>
  )
}

// ── Timeline markers for non-step items ──

function TerminalDot() {
  // The code-step equivalent of ScreenshotDot. A small solid-black
  // rectangle — slightly tilted (-7deg) for character — with a mono
  // `>_` prompt in white. Minimal: no title bar, no traffic lights —
  // just the silhouette of a terminal screen and a prompt cursor.
  // Layers:
  //   • neutral-950 base — the canonical "terminal black" surface
  //   • subtle ring (light/dark adaptive) defines the outer edge
  //   • inset-top white highlight + layered drop shadows for depth
  return (
    <div
      aria-hidden="true"
      className={cn(
        "absolute -left-[13px] top-[2px]",
        "flex h-[22px] w-[32px] items-center justify-center",
        "rounded-[6px] -rotate-[7deg]",
        "bg-neutral-950",
        "ring-1 ring-black/40 dark:ring-white/[0.08]",
        "shadow-[0_2px_6px_rgba(0,0,0,0.18),0_5px_14px_rgba(0,0,0,0.08),inset_0_1px_0_rgba(255,255,255,0.08)]",
      )}
    >
      <span className="font-mono text-[10px] font-bold leading-none tracking-tight text-neutral-100/90">
        {">_"}
      </span>
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
      // The agent's mid-execution reasoning is virtually always a code
      // command (with the agent's narrative occasionally mixed in).
      // Rendering through Markdown was the source of the inconsistent
      // formatting the user reported: Python comments (`# x`) became
      // <h1> headings, `>` lines became blockquotes, indentation got
      // collapsed in paragraphs, and stripped fence markers left some
      // lines as plain prose and others as monospace. We bypass
      // Markdown entirely and render the whole block as a single
      // monospace <pre> so every line — code, narrative, comment —
      // gets the same treatment.
      const cleaned = truncateText(stripAgentMarkup(item.content), 3000)
      if (!cleaned) return null
      return (
        <pre
          className={cn(
            "m-0 pl-6 py-1",
            "font-mono text-[12.5px] leading-[1.65] tabular-nums text-foreground/85",
            "whitespace-pre-wrap break-words",
            "min-w-0 overflow-hidden",
          )}
        >
          {cleaned}
        </pre>
      )
    }

    case "code-agent-result": {
      // Single-card view: a clean two-row card with a contextual header
      // label + copy button on top and mono content below. The content
      // is filtered by stripAgentMarkup which removes <answer>/</answer>
      // tags and ``` fence markers so the user sees clean text. The
      // card sits behind a TerminalDot timeline marker — the code-step
      // equivalent of the ScreenshotDot used for visual actions.
      const cleaned = stripAgentMarkup(item.content)
      if (!cleaned) return null
      const hasError = /\bError:\s/.test(cleaned)
      return (
        <div className="relative pl-8 py-1.5">
          <TerminalDot />
          {/* Result card — shadcn-style minimal: hairline border on a
              subtle muted surface, no title bar, mono body. Copy button
              floats in the top-right corner, muted at rest and full
              brightness on hover. Errors are signaled by red body text
              only — no extra chrome. */}
          <div className="group/result-card relative overflow-hidden rounded-lg border border-foreground/[0.07] bg-foreground/[0.02]">
            <div className="absolute right-1.5 top-1.5 opacity-40 transition-opacity duration-150 group-hover/result-card:opacity-100">
              <CopyButton text={cleaned} />
            </div>
            <pre
              className={cn(
                // pr-10 reserves room for the floating copy button so
                // long unbreakable lines never slide under it.
                "m-0 pl-4 pr-10 py-3 font-mono text-[12px] leading-[1.65] tabular-nums whitespace-pre-wrap break-words",
                hasError
                  ? "text-red-500/85 dark:text-red-400/90"
                  : "text-foreground/85"
              )}
            >
              {cleaned}
            </pre>
          </div>
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

    case "code-agent-summary": {
      // The agent's end-of-execution recap. No card chrome, no sparkle
      // icon, no decorative gradient — just a small muted label and
      // clean prose. Copy button hovers in the top-right at low opacity
      // until the group is hovered. stripAgentMarkup filters any
      // <answer> tags / fences the agent leaks into the summary too.
      // Cap at 5000 chars (very generous — most summaries fit easily).
      const cleaned = truncateText(stripAgentMarkup(item.content), 5000)
      if (!cleaned) return null
      return (
        <div className="group/summary relative pl-6 py-2">
          <div className="absolute right-1 top-2 opacity-40 transition-opacity duration-150 group-hover/summary:opacity-100">
            <CopyButton text={cleaned} />
          </div>
          <div className="mb-2">
            <span className="text-[11.5px] font-medium tracking-tight text-foreground/55">
              Session Summary
            </span>
          </div>
          <div
            className={cn(
              "text-[14px] leading-[1.65] text-foreground/85",
              // Containment: long unbreakable strings wrap inside the
              // bubble instead of pushing it wider.
              "min-w-0 overflow-hidden break-words",
              "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
              "[&_p]:my-2",
              "[&_strong]:font-semibold [&_strong]:text-foreground",
              "[&_em]:italic [&_em]:text-foreground/75",
              "[&_ul]:my-2 [&_ul]:space-y-0.5 [&_ul]:pl-4",
              "[&_ol]:my-2 [&_ol]:space-y-0.5 [&_ol]:pl-5",
              "[&_li]:marker:text-foreground/35 [&_li]:leading-[1.55]",
              "[&_h1]:mt-3 [&_h1]:mb-1.5 [&_h1]:text-[15px] [&_h1]:font-semibold [&_h1]:text-foreground",
              "[&_h2]:mt-3 [&_h2]:mb-1.5 [&_h2]:text-[14.5px] [&_h2]:font-semibold [&_h2]:text-foreground",
              "[&_h3]:mt-2.5 [&_h3]:mb-1 [&_h3]:text-[14px] [&_h3]:font-medium [&_h3]:text-foreground",
              "[&_pre]:my-2 [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-foreground/[0.06] [&_pre]:!bg-foreground/[0.03] [&_pre]:p-3",
              "[&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_pre]:overflow-x-hidden",
              "[&_code]:break-words",
              "[&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-[3px] [&_a]:decoration-foreground/30 hover:[&_a]:decoration-foreground/60 [&_a]:break-all",
              "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-foreground/15 [&_blockquote]:pl-3 [&_blockquote]:text-foreground/70 [&_blockquote]:italic"
            )}
          >
            <CuaMarkdown>{cleaned}</CuaMarkdown>
          </div>
        </div>
      )
    }

    case "search-results": {
      const label = item.query ? `Search: ${item.query}` : "Web search"
      return (
        <div className="pl-6">
          <DetailRow icon={MagnifyingGlass} label={label} defaultOpen>
            <CuaMarkdown>{item.content}</CuaMarkdown>
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
        <div
          className={cn(
            "pl-6 py-0.5 text-[15px] leading-relaxed text-foreground/80",
            "min-w-0 overflow-hidden break-words",
            "[&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_pre]:overflow-x-hidden",
            "[&_code]:break-words",
            "[&_a]:break-all",
          )}
        >
          <CuaMarkdown>{truncateText(cleaned, 500)}</CuaMarkdown>
        </div>
      )
    }

    default:
      return null
  }
}

// ── Live "still working" pulse ──
//
// Shown at the foot of the timeline while `isStreaming` is true, to signal
// that the agent is still active between sections. The pulse hides itself
// in any state where another live signal already exists (the
// AwaitingHumanBanner has its own timer + resume button) or where work has
// visibly concluded (status=completed, code-agent-done, summary). That
// keeps the indicator from contradicting what the user just read.

type ThinkingVisibility = "show" | "hidden"

function shouldShowThinking(items: TopLevelItem[]): ThinkingVisibility {
  if (items.length === 0) return "show"
  const last = items[items.length - 1]
  switch (last.kind) {
    case "awaiting-human":
    case "awaiting-human-timeout":
      return "hidden"
    case "status":
      // Terminal — completed or error; either way the agent is done.
      return "hidden"
    case "code-agent-done":
    case "code-agent-summary":
      return "hidden"
    default:
      return "show"
  }
}

function ThinkingPulse() {
  // Muted "Thinking" label with the .text-shine glow sweep — the same
  // self-contained text effect used for page-loader titles. The timeline
  // rail to the left already serves as the visual border, so no extra
  // chrome is added here: just the shimmering word at the same pl-6
  // indent as every other item in the timeline.
  return (
    <motion.div
      initial={{ opacity: 0, y: 3 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      role="status"
      aria-live="polite"
      aria-label="Agent is working"
      className="pl-6"
    >
      <span className="text-shine text-[13.5px] font-medium tracking-tight text-muted-foreground">
        Thinking
      </span>
    </motion.div>
  )
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

  // Show the live "thinking" pulse only while streaming AND when no other
  // signal is already covering the same ground — see shouldShowThinking
  // for the corner cases (awaiting-human / status / done / summary).
  const showThinking = isStreaming === true && shouldShowThinking(items) === "show"

  return (
    <div className={cn("flex flex-col", className)}>
      <div className="relative">
        {/* ── Timeline rail ──────────────────────────────────────
            A single 1px column at left-[2.5px] hosts two coupled
            layers that read as one object:
              1. Static soft gradient line (replaces the old dotted
                 pattern — reads as ink, not as a graph axis).
                 Draws itself top→down on first mount via the
                 .cua-line-draw class (scaleY 0→1 over 800ms).
              2. A travelling light caret — a 60px soft glow that
                 drifts top→bottom on a 4s loop, fading in/out at
                 the edges so it materializes rather than blinks.
                 Only renders while isStreaming; AnimatePresence
                 fades the whole layer in/out at state boundaries
                 so it never snaps. */}
        {/* overflow-hidden clips the travelling caret to the rail's
            vertical bounds — without it the caret would bleed above
            and below the message bubble during its drift cycle. */}
        <div
          className="absolute left-[2.5px] top-0 bottom-0 w-px overflow-hidden"
          aria-hidden="true"
        >
          {/* Static gradient line — vertical fade at both ends bakes
              the old mask treatment into the gradient itself. */}
          <div
            className="cua-line-draw absolute inset-0 opacity-[0.20] dark:opacity-[0.28]"
            style={{
              backgroundImage:
                "linear-gradient(to bottom, transparent 0%, currentColor 10%, currentColor 90%, transparent 100%)",
            }}
          />
          {/* Travelling light caret — only mounted while streaming.
              The 60px height + soft top/bottom fade make it tail
              like a comet. Opacity ramps inside the @keyframes
              itself so we don't need a separate animation here. */}
          <AnimatePresence>
            {isStreaming === true && (
              <motion.div
                key="cua-caret"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                className="cua-caret-drift absolute left-0 w-px h-[60px] opacity-[0.55] dark:opacity-[0.65]"
                style={{
                  backgroundImage:
                    "linear-gradient(to bottom, transparent 0%, currentColor 50%, transparent 100%)",
                }}
              />
            )}
          </AnimatePresence>
        </div>
        {/* Generous vertical rhythm — 20px between every item. Each
            point gets clear breathing room so the timeline reads as
            distinct beats rather than a paragraph of activity. Per-item
            internal padding stays tight; all the breath lives at the
            seam between items. */}
        <div className="relative flex flex-col gap-y-5">
          {/* initial={false} → existing items on first mount (chat history
              load) don't animate. New items appended during streaming get
              the soft fade + 6px lift. Keyed by index because the items
              array only ever appends — stable index = stable mount. */}
          <AnimatePresence initial={false}>
            {items.map((item, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
              >
                <ItemRenderer
                  item={item}
                  screenshot={stepScreenshotMap.get(i)}
                  isStreaming={isStreaming}
                />
              </motion.div>
            ))}
            {showThinking && <ThinkingPulse key="thinking-pulse" />}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
})
