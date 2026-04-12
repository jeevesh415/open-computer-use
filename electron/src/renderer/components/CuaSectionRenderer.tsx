import React, { memo, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../lib/utils'
import { Markdown } from './Markdown'
import { AwaitingHumanBanner } from './AwaitingHumanBanner'

// ── Icons (inline SVGs replacing @phosphor-icons/react) ──

function IconCheckCircle({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
    </svg>
  )
}

function IconXCircle({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z" />
    </svg>
  )
}

function IconChevronRight({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18l6-6-6-6" />
    </svg>
  )
}

function IconEye({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function IconCode({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  )
}

function IconBrain({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 2A5.5 5.5 0 0 0 4 7.5c0 1.5.6 2.9 1.6 3.9L12 18l6.4-6.6A5.5 5.5 0 0 0 14.5 2a5.5 5.5 0 0 0-5 3.2" />
      <path d="M12 18v4" />
    </svg>
  )
}

function IconLightning({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M7 2v11h3v9l7-12h-4l4-8z" />
    </svg>
  )
}

function IconTerminal({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  )
}

function IconMagnifyingGlass({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}


// ── Types ──

type SectionType =
  | 'verification'
  | 'analysis'
  | 'next-action'
  | 'grounded-action'
  | 'reflection'
  | 'code-agent-summary'
  | 'code-agent-thought'
  | 'code-agent-result'
  | 'code-agent-done'
  | 'action-result'
  | 'status'
  | 'search-results'
  | 'awaiting-human'
  | 'awaiting-human-timeout'
  | 'awaiting-human-resumed'

interface ParsedSection {
  type: SectionType
  content: string
  attrs: Record<string, string>
}

interface StepGroup {
  kind: 'step'
  action: string
  observation: string | null
  code: string | null
  results: { content: string; status: string }[]
}

type TopLevelItem =
  | StepGroup
  | { kind: 'status'; content: string; status: string }
  | { kind: 'code-agent-thought'; content: string; step: string; budget: string }
  | { kind: 'code-agent-result'; content: string; step: string }
  | { kind: 'code-agent-done'; content: string; step: string }
  | { kind: 'code-agent-summary'; content: string }
  | { kind: 'search-results'; query: string; content: string }
  | { kind: 'awaiting-human'; reason: string; machineId: string }
  | { kind: 'awaiting-human-timeout'; content: string }
  | { kind: 'awaiting-human-resumed'; content: string }
  | { kind: 'text'; content: string }

// ── Parser ──

const TAG_REGEX = /<cua-section\s+([^>]*)>([\s\S]*?)<\/cua-section>/g
const ATTR_REGEX = /(\w[\w-]*)="([^"]*)"/g

function stripAgentCode(text: string): string {
  return text.replace(/```(?:python)?\s*agent\.[\s\S]*?```/g, '').trim()
}

/** Truncate long text with ellipsis, respecting word boundaries */
function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  const cut = text.lastIndexOf(' ', maxLen)
  return text.slice(0, cut > maxLen * 0.5 ? cut : maxLen) + '…'
}

/** Clean agent code for display: truncate long string args */
function formatAgentCode(code: string): string {
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
      sections.push({ type: 'next-action' as SectionType, content: before, attrs: { _plain: 'true' } })
    }
    const attrs = parseAttributes(match[1])
    sections.push({
      type: (attrs.type ?? 'next-action') as SectionType,
      content: match[2].trim(),
      attrs,
    })
    lastIndex = match.index + match[0].length
  }

  const trailing = raw.slice(lastIndex).trim()
  if (trailing) {
    sections.push({ type: 'next-action' as SectionType, content: trailing, attrs: { _plain: 'true' } })
  }
  return sections
}

// ── Grouping ──

const OBSERVATION_TYPES = new Set<SectionType>(['verification', 'analysis', 'reflection'])

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
      const merged = parts.join('\n\n')
      if (pendingStep && pendingStep.action) flushStep()
      if (!pendingStep) {
        pendingStep = { kind: 'step', action: '', observation: merged, code: null, results: [] }
      } else {
        pendingStep.observation = pendingStep.observation
          ? pendingStep.observation + '\n\n' + merged
          : merged
      }
      continue
    }

    if (s.type === 'next-action') {
      if (pendingStep && pendingStep.action) flushStep()
      if (!pendingStep) {
        pendingStep = { kind: 'step', action: '', observation: null, code: null, results: [] }
      }
      if (s.attrs._plain === 'true') {
        flushStep()
        items.push({ kind: 'text', content: s.content })
      } else {
        pendingStep.action = s.content
      }
    } else if (s.type === 'grounded-action') {
      if (pendingStep) pendingStep.code = s.content
    } else if (s.type === 'action-result') {
      if (pendingStep) pendingStep.results.push({ content: s.content, status: s.attrs.status || 'success' })
    } else if (s.type === 'status') {
      flushStep()
      items.push({ kind: 'status', content: s.content, status: s.attrs.status || 'completed' })
    } else if (s.type === 'code-agent-thought') {
      flushStep()
      items.push({ kind: 'code-agent-thought', content: s.content, step: s.attrs.step || '', budget: s.attrs.budget || '' })
    } else if (s.type === 'code-agent-result') {
      flushStep()
      items.push({ kind: 'code-agent-result', content: s.content, step: s.attrs.step || '' })
    } else if (s.type === 'code-agent-done') {
      flushStep()
      items.push({ kind: 'code-agent-done', content: s.content, step: s.attrs.step || '' })
    } else if (s.type === 'code-agent-summary') {
      flushStep()
      items.push({ kind: 'code-agent-summary', content: s.content })
    } else if (s.type === 'search-results') {
      flushStep()
      items.push({ kind: 'search-results', query: s.attrs.query || '', content: s.content })
    } else if (s.type === 'awaiting-human') {
      flushStep()
      items.push({ kind: 'awaiting-human', reason: s.attrs.reason || s.content, machineId: s.attrs.machineId || s.attrs.machineid || '' })
    } else if (s.type === 'awaiting-human-timeout') {
      flushStep()
      items.push({ kind: 'awaiting-human-timeout', content: s.content })
    } else if (s.type === 'awaiting-human-resumed') {
      flushStep()
      items.push({ kind: 'awaiting-human-resumed', content: s.content })
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
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm cursor-zoom-out"
      onClick={onClose}
      style={{ animation: 'cua-fade-in 0.15s ease' }}
    >
      <img
        src={src}
        alt="Screenshot"
        className="max-w-[90vw] max-h-[90vh] rounded-lg object-contain"
        onClick={(e) => e.stopPropagation()}
        style={{ animation: 'cua-bounce-in 0.3s cubic-bezier(0.34,1.56,0.64,1)' }}
      />
      <style>{`
        @keyframes cua-fade-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes cua-bounce-in { from { transform: scale(0.92); } to { transform: scale(1); } }
      `}</style>
    </div>,
    document.body
  )
}

// ── Screenshot Thumbnail (replaces timeline dot) ──

function ScreenshotDot({ src }: { src: string }) {
  const [lightboxOpen, setLightboxOpen] = useState(false)

  return (
    <>
      <div
        className="absolute -left-[10px] top-[3px] z-[2] cursor-pointer cua-thumb"
        onClick={() => setLightboxOpen(true)}
      >
        <div className="w-[26px] h-[26px] rounded-[5px] overflow-hidden ring-1 ring-white/[0.08] shadow-sm">
          <img src={src} alt="" className="w-full h-full object-cover" draggable={false} />
        </div>
        <style>{`
          .cua-thumb { transition: transform 0.25s cubic-bezier(0.34,1.56,0.64,1); }
          .cua-thumb:hover { transform: scale(1.18); }
          .cua-thumb:active { transform: scale(0.95); }
        `}</style>
      </div>

      {lightboxOpen && (
        <ScreenshotLightbox src={src} onClose={() => setLightboxOpen(false)} />
      )}
    </>
  )
}

// ── Plain Timeline Dot (no screenshot) — no-op with dotted line ──
// Kept as a stub so StepCard doesn't need restructuring.

function PlainDot({ status: _status }: { status: 'success' | 'error' | 'pending' }) {
  return null
}

// ── Primitives ──

function DetailRow({
  icon: Icon,
  label,
  children,
  defaultOpen = false,
}: {
  icon: React.ElementType
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
        className="group/detail flex items-center gap-1.5 py-1 text-[12.5px] text-neutral-500/50 hover:text-neutral-400/80 transition-colors"
      >
        <IconChevronRight
          className={cn(
            'w-2.5 h-2.5 shrink-0 transition-transform duration-200 ease-out',
            open && 'rotate-90'
          )}
        />
        <Icon className="w-3 h-3 shrink-0 opacity-50 group-hover/detail:opacity-80 transition-opacity" />
        <span>{label}</span>
      </button>
      <div
        className={cn(
          'overflow-hidden transition-all duration-150 ease-out',
          open ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'
        )}
      >
        <div className="ml-[22px] pb-2 text-[13px] leading-relaxed text-neutral-400/80">
          {children}
        </div>
      </div>
    </div>
  )
}

function StatusDot({ status }: { status: string }) {
  return (
    <span
      className={cn(
        'inline-block w-[5px] h-[5px] rounded-full shrink-0',
        status === 'success' && 'bg-emerald-500/70',
        status === 'error' && 'bg-red-500/70',
        status !== 'success' && status !== 'error' && 'bg-neutral-400/10',
      )}
    />
  )
}

// ── Step ──

/** Extract a short task description from agent.call_code_agent(...) code */
function extractCodeAgentTask(code: string): string | null {
  const match = code.match(/agent\.call_code_agent\s*\(\s*task\s*=\s*"([\s\S]*?)(?:"\s*[,)])/s)
    || code.match(/agent\.call_code_agent\s*\(\s*task\s*=\s*'([\s\S]*?)(?:'\s*[,)])/s)
  if (!match) return null
  return match[1].replace(/\\n/g, ' ').trim()
}

/** Check if grounded action code is an agent function call (code_agent, wait, etc.) */
function extractAgentAction(code: string): { type: string; label: string; detail?: string } | null {
  const codeAgentTask = extractCodeAgentTask(code)
  if (codeAgentTask || /agent\.call_code_agent/.test(code)) {
    return { type: 'code-agent', label: 'Code Agent', detail: codeAgentTask || undefined }
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
  const actionText = step.action ? stripAgentCode(step.action) : ''
  const hasDetails = step.observation || step.code || step.results.length > 0

  if (!actionText && !hasDetails) return null

  const hasError = step.results.some((r) => r.status === 'error')
  const isDone = step.results.length > 0
  const status: 'success' | 'error' | 'pending' = hasError
    ? 'error'
    : isDone
      ? 'success'
      : 'pending'
  const hasScreenshot = !!screenshot
  const agentAction = step.code ? extractAgentAction(step.code) : null

  return (
    <div className={cn('group/step relative pb-1', hasScreenshot ? 'pl-8' : 'pl-6')}>
      {hasScreenshot ? (
        <ScreenshotDot src={screenshot!} />
      ) : (
        <PlainDot status={status} />
      )}

      {/* Action — the natural language line (truncated for readability) */}
      {actionText && (
        <p className="text-[15px] leading-relaxed text-neutral-100/90">
          {truncateText(actionText, 200)}
        </p>
      )}

      {/* Agent function call pill + prompt card (e.g. code_agent) */}
      {agentAction && (
        <div className="mt-1.5 rounded-lg border border-emerald-400/12 bg-emerald-400/[0.03] overflow-hidden">
          <div className="flex items-center gap-2 px-2.5 py-1.5">
            <span className="inline-flex items-center gap-1.5 text-[11.5px] leading-none font-medium px-2 py-[3px] rounded-full bg-emerald-500/12 text-emerald-400">
              <IconTerminal className="w-3 h-3 shrink-0" />
              {agentAction.label}
            </span>
          </div>
          {agentAction.detail && (
            <div className="px-3 pb-2.5 -mt-0.5">
              <p className="text-[12.5px] leading-relaxed text-neutral-300/50">
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
                'inline-flex items-center gap-1 text-[11px] leading-none px-1.5 py-0.5 rounded-full',
                r.status === 'success' && 'text-emerald-400/70 bg-emerald-500/8',
                r.status === 'error' && 'text-red-400/70 bg-red-500/8',
                r.status !== 'success' && r.status !== 'error' && 'text-neutral-500/50 bg-neutral-500/5',
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
          <DetailRow icon={IconEye} label="What it noticed">
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
  onResumeHuman,
}: {
  item: TopLevelItem
  screenshot?: string | null
  isStreaming?: boolean
  onResumeHuman?: () => void
}) {
  switch (item.kind) {
    case 'step':
      return <StepCard step={item} screenshot={screenshot} />

    case 'status': {
      const done = item.status === 'completed'
      return (
        <div className="py-1.5 pl-6">
          <div className={cn(
            'inline-flex items-center gap-2 rounded-lg border px-3 py-1.5',
            done
              ? 'border-emerald-700/40 bg-emerald-400/[0.04]'
              : 'border-red-700/40 bg-red-400/[0.04]',
          )}>
            {done ? (
              <IconCheckCircle className="w-3.5 h-3.5 shrink-0 text-emerald-500" />
            ) : (
              <IconXCircle className="w-3.5 h-3.5 shrink-0 text-red-500" />
            )}
            <span className={cn(
              'text-[13px] font-medium',
              done ? 'text-emerald-300' : 'text-red-400',
            )}>
              {item.content}
            </span>
          </div>
        </div>
      )
    }

    case 'code-agent-thought': {
      const label = 'Thinking'
      return (
        <div className="pl-6">
          <DetailRow icon={IconBrain} label={label}>
            <Markdown>{item.content}</Markdown>
          </DetailRow>
        </div>
      )
    }

    case 'code-agent-result': {
      const label = 'Result'
      return (
        <div className="pl-6">
          <DetailRow icon={IconLightning} label={label} defaultOpen>
            <Markdown>{item.content}</Markdown>
          </DetailRow>
        </div>
      )
    }

    case 'code-agent-done':
      return (
        <div className="py-0.5 pl-6">
          <span className="inline-flex items-center gap-1.5 text-[12px] text-emerald-400/40">
            <IconCheckCircle className="w-3 h-3 shrink-0" />
            {item.content}
          </span>
        </div>
      )

    case 'code-agent-summary':
      return (
        <div className="pl-6">
          <DetailRow icon={IconTerminal} label="Summary" defaultOpen>
            <Markdown>{item.content}</Markdown>
          </DetailRow>
        </div>
      )

    case 'search-results': {
      const label = item.query ? `Search: ${item.query}` : 'Web search'
      return (
        <div className="pl-6">
          <DetailRow icon={IconMagnifyingGlass} label={label} defaultOpen>
            <Markdown>{item.content}</Markdown>
          </DetailRow>
        </div>
      )
    }

    case 'awaiting-human':
      return (
        <div className="relative pl-6 py-2">
          <AwaitingHumanBanner
            reason={item.reason}
            machineId={item.machineId}
            isActive={isStreaming}
            onResume={onResumeHuman}
          />
        </div>
      )

    case 'awaiting-human-timeout':
      return (
        <div className="py-1.5 pl-6">
          <div className="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 border-amber-700/40 bg-amber-400/[0.04]">
            <svg className="w-3.5 h-3.5 shrink-0 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
            </svg>
            <span className="text-[13px] font-medium text-amber-300">{item.content}</span>
          </div>
        </div>
      )

    case 'awaiting-human-resumed':
      return (
        <div className="py-1.5 pl-6">
          <div className="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 border-emerald-700/40 bg-emerald-400/[0.04]">
            <IconCheckCircle className="w-3.5 h-3.5 shrink-0 text-emerald-500" />
            <span className="text-[13px] font-medium text-emerald-300">
              Human finished — agent resuming with fresh screen state
            </span>
          </div>
        </div>
      )

    case 'text': {
      const cleaned = stripAgentCode(item.content)
      if (!cleaned) return null
      return (
        <div className="pl-6 py-0.5 text-[15px] leading-relaxed text-neutral-200/80">
          <Markdown>{truncateText(cleaned, 500)}</Markdown>
        </div>
      )
    }

    default:
      return null
  }
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
  onResumeHuman,
}: {
  content: string
  className?: string
  screenshots?: string[]
  isStreaming?: boolean
  onResumeHuman?: () => void
}) {
  const items = useMemo(() => {
    const sections = parseSections(content)
    return buildTopLevel(sections)
  }, [content])

  // Map screenshots to step items only
  const stepScreenshotMap = useMemo(() => {
    if (!screenshots || screenshots.length === 0) return new Map<number, string>()
    const map = new Map<number, string>()
    let screenshotIdx = 0
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === 'step' && screenshotIdx < screenshots.length) {
        map.set(i, screenshots[screenshotIdx])
        screenshotIdx++
      }
    }
    return map
  }, [items, screenshots])

  return (
    <div className={cn('flex flex-col', className)}>
      <div className="relative">
        {/* Timeline — dotted line, fades at ends */}
        <div
          className="absolute left-[2.5px] top-0 bottom-0 w-px opacity-[0.30]"
          style={{
            maskImage: 'linear-gradient(to bottom, transparent, black 12%, black 88%, transparent)',
            WebkitMaskImage: 'linear-gradient(to bottom, transparent, black 12%, black 88%, transparent)',
            backgroundImage: 'repeating-linear-gradient(to bottom, currentColor 0px, currentColor 2px, transparent 2px, transparent 7px)',
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
              onResumeHuman={onResumeHuman}
            />
          ))}
        </div>
      </div>
    </div>
  )
})
