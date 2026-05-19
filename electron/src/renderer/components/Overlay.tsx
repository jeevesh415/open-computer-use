import React from 'react'
import ReactDOM from 'react-dom'
import { useConnectionStore } from '../stores/connection-store'
import { useWindowStore } from '../stores/window-store'
import { useAuthStore } from '../stores/auth-store'
import { useChatSubmit, type SubmitResult } from '../hooks/useChatSubmit'
import { useChatStore } from '../stores/chat-store'
import { MessageList } from './MessageList'
import { ChatHistory } from './ChatHistory'
import { ApprovalPrompt } from './ApprovalPrompt'
import { StreamingTicker } from './StreamingTicker'
import { useApprovalStore, APPROVAL_MODE_ORDER, APPROVAL_MODE_LABELS } from '../stores/approval-store'
import type { ApprovalMode } from '../stores/approval-store'
import { useDisplayStore } from '../stores/display-store'

/* ─── Helpers ─── */

function statusDot(state: string): string {
  switch (state) {
    case 'connected': return 'bg-emerald-400'
    case 'connecting': return 'bg-yellow-400 animate-pulse'
    case 'error': return 'bg-red-400'
    default: return 'bg-neutral-500'
  }
}

function statusLabel(state: string): string {
  switch (state) {
    case 'connected': return 'Connected'
    case 'connecting': return 'Connecting...'
    case 'error': return 'Connection error'
    default: return 'Disconnected'
  }
}

const OPACITY_PRESETS = [1, 0.7, 0.4, 0.2]
const OPACITY_STEP = 0.05
const OPACITY_MIN = 0.15

/* ─── Icons ─── */

function EyeIcon({ opacity }: { opacity: number }) {
  if (opacity > 0.8) {
    return (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>)
  }
  if (opacity > 0.5) {
    return (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="2" /></svg>)
  }
  return (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /></svg>)
}

function ShieldIcon({ mode }: { mode: string }) {
  const s = { width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  if (mode === 'full_control') return (<svg {...s}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><polyline points="9 12 11 14 15 10" /></svg>)
  if (mode === 'smart_approve') return (<svg {...s}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><circle cx="12" cy="12" r="2" fill="currentColor" /></svg>)
  if (mode === 'approve_all') return (<svg {...s}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>)
  return (<svg {...s}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><line x1="8" y1="8" x2="16" y2="16" /></svg>)
}

const MODE_DESCRIPTIONS: Record<ApprovalMode, string> = {
  full_control: 'Execute all actions automatically',
  smart_approve: 'Approve dangerous actions only',
  approve_all: 'Review every action before execution',
  off: 'Block all actions (pause agent)',
}

function shieldColor(mode: string, hasPending: boolean): string {
  const pulse = hasPending ? ' animate-pulse' : ''
  if (mode === 'off') return `text-red-400${pulse}`
  if (mode === 'approve_all') return `text-amber-400${pulse}`
  if (mode === 'smart_approve') return `text-blue-400${pulse}`
  return `text-emerald-400${pulse}`
}

function shieldLabel(mode: string): string {
  if (mode === 'off') return 'Paused'
  if (mode === 'approve_all') return 'Ask All'
  if (mode === 'smart_approve') return 'Smart'
  return 'Auto'
}

/** Only allow avatar URLs with safe protocols (https, http, data:image). */
function isSafeAvatarUrl(url: string): boolean {
  try {
    // data:image/* URLs are OK (e.g. base64 avatars from OAuth providers)
    if (/^data:image\//i.test(url)) return true
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

function UserAvatar({ avatar, name, size = 22 }: { avatar?: string; name?: string | null; size?: number }) {
  if (avatar && isSafeAvatarUrl(avatar)) {
    return <img src={avatar} alt="" width={size} height={size} className="rounded-full object-cover flex-shrink-0" referrerPolicy="no-referrer" />
  }
  const initial = name?.charAt(0)?.toUpperCase() || '?'
  return (
    <div className="rounded-full bg-neutral-700 flex items-center justify-center text-neutral-300 font-medium flex-shrink-0" style={{ width: size, height: size, fontSize: size * 0.45 }}>
      {initial}
    </div>
  )
}

/* ─── Display selector (multi-monitor) ─── */

const MonitorIcon = ({ size = 14, className = '' }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
  </svg>
)

/**
 * Shared dropdown panel rendered via a portal to document.body so it
 * is never clipped by the overlay's overflow-hidden container.
 * Positions itself relative to the trigger button's bounding rect.
 */
function DisplayDropdown({ displays, activeId, setActiveDisplay, onClose, triggerRef, anchor }: {
  displays: Array<{ id: number; name: string; width: number; height: number; isPrimary: boolean; scaleFactor: number }>
  activeId: number | null
  setActiveDisplay: (id: number | null) => void
  onClose: () => void
  triggerRef: React.RefObject<HTMLElement | null>
  anchor: 'above' | 'below' // above = opens upward, below = opens downward
}) {
  const menuRef = React.useRef<HTMLDivElement>(null)
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null)

  // Calculate position from trigger button
  const reposition = React.useCallback(() => {
    const btn = triggerRef.current
    const menu = menuRef.current
    if (!btn || !menu) return
    const r = btn.getBoundingClientRect()
    const menuH = menu.offsetHeight
    const MENU_W = 224 // w-56 = 14rem = 224px
    const GAP = 4

    let top: number
    if (anchor === 'above') {
      top = r.top - menuH - GAP
      // If it would overflow above the window, flip below
      if (top < 4) top = r.bottom + GAP
    } else {
      top = r.bottom + GAP
      // If it would overflow below the window, flip above
      if (top + menuH > window.innerHeight - 4) top = r.top - menuH - GAP
    }

    // Right-align to the button, but don't overflow left edge
    let left = r.right - MENU_W
    if (left < 4) left = 4

    setPos({ top, left })
  }, [anchor])

  React.useLayoutEffect(() => {
    reposition()
    // Recalculate after a frame in case the layout is still settling
    // (e.g. window resize animation or CSS transitions in progress)
    const raf = requestAnimationFrame(reposition)
    return () => cancelAnimationFrame(raf)
  }, [reposition])

  const menu = (
    <div ref={menuRef} data-display-dropdown
      className="fixed w-56 rounded-xl bg-neutral-800 border border-neutral-700/50 shadow-2xl overflow-hidden z-[9999]"
      style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden', top: 0, left: 0 }}>
      <div className="px-3 py-2 border-b border-neutral-700/30">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Capture Display</span>
      </div>
      {displays.map((d) => {
        const isActive = d.id === (activeId ?? displays.find((x) => x.isPrimary)?.id)
        return (
          <button
            key={d.id}
            onClick={() => { setActiveDisplay(d.isPrimary ? null : d.id); onClose() }}
            className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${isActive ? 'bg-neutral-700/40' : 'hover:bg-neutral-700/20'}`}
          >
            <MonitorIcon size={16} className={isActive ? 'text-brand-400' : 'text-neutral-500'} />
            <div className="flex-1 min-w-0">
              <div className={`text-xs font-medium ${isActive ? 'text-neutral-100' : 'text-neutral-300'}`}>
                {d.name}
              </div>
              <div className="text-[10px] text-neutral-600">{d.width}x{d.height}{d.scaleFactor > 1 ? ` @${d.scaleFactor}x` : ''}</div>
            </div>
            {isActive && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-brand-400 flex-shrink-0">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </button>
        )
      })}
    </div>
  )

  return ReactDOM.createPortal(menu, document.body)
}

/** Expanded mode: shown in the input toolbar with label. */
function DisplaySelector({ disabled, autoOpen, onAutoOpened }: { disabled?: boolean; autoOpen?: boolean; onAutoOpened?: () => void }) {
  const { displays, activeId, hasMultiple, setActiveDisplay, refreshDisplays } = useDisplayStore()
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)
  const btnRef = React.useRef<HTMLButtonElement>(null)

  // Auto-open when triggered from compact mode — delay until window
  // expansion animation (320ms) and CSS chat-reveal (60ms+350ms) finish
  // so the button's measured position matches the stable expanded layout.
  React.useEffect(() => {
    if (autoOpen && hasMultiple) {
      refreshDisplays().then(() => {
        setTimeout(() => setOpen(true), 420)
      })
      onAutoOpened?.()
    }
  }, [autoOpen])

  React.useEffect(() => { if (open) refreshDisplays() }, [open])
  React.useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)
        && !(e.target instanceof HTMLElement && e.target.closest('[data-display-dropdown]'))) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  if (!hasMultiple) return null

  const activeDisplay = displays.find((d) => d.id === activeId) ?? displays.find((d) => d.isPrimary) ?? displays[0]

  return (
    <div ref={ref} className="relative">
      <button ref={btnRef} type="button" onClick={() => setOpen(!open)} disabled={disabled}
        className="h-8 px-2 rounded-full text-neutral-500 hover:text-neutral-300 hover:bg-neutral-700/50 flex items-center gap-1.5 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200"
        title={`Screen: ${activeDisplay?.name ?? 'Primary'}`}>
        <MonitorIcon />
        <span className="text-[10px] font-medium max-w-[60px] truncate">{activeDisplay?.name ?? 'Primary'}</span>
      </button>
      {open && <DisplayDropdown displays={displays} activeId={activeId} setActiveDisplay={setActiveDisplay} onClose={() => setOpen(false)} triggerRef={btnRef} anchor="above" />}
    </div>
  )
}


/* ─── Compact placeholder ─── */

const PLACEHOLDER_LINES = [
  'Tell me to do anything on your PC...',
  'Open Chrome and book a flight...',
  'Fill out that form for you...',
  'Click, type, scroll — I see your screen...',
  'Research something and write it up...',
  'Tell me to do anything on your PC...',
]

function PlaceholderCarousel() {
  return (
    <div className="overflow-hidden h-[16px] pointer-events-none">
      <div className="carousel-track flex flex-col">
        {PLACEHOLDER_LINES.map((text, i) => (
          <span key={i} className="h-[16px] flex items-center text-xs text-neutral-500 truncate whitespace-nowrap shrink-0">{text}</span>
        ))}
      </div>
    </div>
  )
}

/* ─── Shared UI ─── */

function ExternalIcon() {
  return (<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-600 flex-shrink-0"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>)
}

function MenuLink({ icon, label, desc, url }: { icon: React.ReactNode; label: string; desc: string; url: string }) {
  return (
    <button onClick={() => window.open(url, '_blank')} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left hover:bg-neutral-800/60 transition-colors group">
      <span className="text-neutral-500 group-hover:text-neutral-300 flex-shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-neutral-300 group-hover:text-neutral-100">{label}</div>
        <div className="text-[10px] text-neutral-600">{desc}</div>
      </div>
      <ExternalIcon />
    </button>
  )
}

function SubPageHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-neutral-800/50 flex-shrink-0">
      <button onClick={onBack} className="flex items-center gap-1.5 px-2 py-1 -ml-1 rounded-lg hover:bg-neutral-800/60 text-neutral-400 hover:text-neutral-200 transition-colors">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        <span className="text-[11px] font-medium">Back</span>
      </button>
      <div className="flex-1" />
      <span className="text-[11px] font-medium text-neutral-500">{title}</span>
    </div>
  )
}

/* ─── Welcome screen ─── */

const TAGLINE_WORDS = [
  'I',
  'can',
  'do',
  'anything',
  'on',
  'your',
  'computer,',
  'just',
  'like',
  'a',
  'human.',
]

function WelcomeScreen({ user, showGuide, onTry, onDismiss, onEnable, connected }: {
  user: { name?: string | null } | null
  showGuide: boolean
  onTry: (text: string) => void
  onDismiss: () => void
  onEnable: () => void
  connected: boolean
}) {
  const firstName = user?.name?.split(' ')[0] ?? ''

  return (
    <div className="flex-1 flex flex-col items-center px-6 py-6 text-center overflow-y-auto">
      <div className="flex-1 flex flex-col items-center justify-center w-full max-w-[340px]">

        {/* ── Greeting with aurora wash ── */}
        <div className="relative">
          {/* Slow indigo→violet aurora drifting behind the greeting */}
          <div
            aria-hidden="true"
            className="aurora-drift absolute inset-0 -z-10 pointer-events-none"
            style={{
              filter: 'blur(40px)',
              background:
                'radial-gradient(60% 60% at 50% 55%, rgba(99,102,241,0.55) 0%, rgba(168,85,247,0.28) 42%, transparent 78%)',
            }}
          />
          <h3
            className="word-rise text-[42px] font-bold tracking-tight leading-none px-6 py-3"
            style={{ fontFamily: "'Caveat', cursive", animationDelay: '60ms', animationDuration: '760ms' }}
          >
            <span className="inline-block -rotate-1 text-neutral-50">
              Hello{firstName ? `, ${firstName}` : ''}!
            </span>
          </h3>
        </div>

        {/* ── Tagline — word-by-word stagger reveal ── */}
        <p className="text-[13.5px] text-neutral-200/95 tracking-tight leading-[1.65] font-normal px-2 mt-3 max-w-[280px]">
          {TAGLINE_WORDS.map((w, i) => (
            <span
              key={`${w}-${i}`}
              className="word-rise inline-block"
              style={{ animationDelay: `${380 + i * 80}ms`, animationDuration: '600ms' }}
            >
              {w}
              {i < TAGLINE_WORDS.length - 1 ? ' ' : ''}
            </span>
          ))}
        </p>

        {/* ── Sample prompts — Spotlight-style quoted text rows ──
             No icons, no chips, no colored accents. Just curly-quoted
             example commands that brighten on hover. The quotes carry
             the "this is a thing you can say" semantic. */}
        {/* Sample prompts removed — welcome screen is now greeting + tagline only.
            The "Control this PC from your phone" CTA lives as a persistent compact pill
            above the chat input, so it shows on every screen, not just here. */}

        {/* The Continue-on-phone CTA used to live here — it's now a
            persistent compact pill above the chat input so it stays
            visible during conversations, not just on the welcome screen. */}
      </div>
    </div>
  )
}

/* ─── Account Menu ─── */

function AccountMenu({
  onBack, updateStatus: initialUpdateStatus,
  approvalMode, pendingCount, onNavigateApproval,
  opacity, setOpacityAndPersist,
}: {
  onBack: () => void
  updateStatus: string
  approvalMode: ApprovalMode
  pendingCount: number
  onNavigateApproval: () => void
  opacity: number
  setOpacityAndPersist: (v: number) => void
}) {
  const { user, signOut } = useAuthStore()
  const [credits, setCredits] = React.useState<number | null>(null)
  const [runtime, setRuntime] = React.useState<number | null>(null)
  const [isUnlimited, setIsUnlimited] = React.useState<boolean>(false)
  const [appVersion, setAppVersion] = React.useState('...')
  const [localUpdateStatus, setLocalUpdateStatus] = React.useState(initialUpdateStatus)

  React.useEffect(() => {
    window.coasty.getCredits().then((res) => {
      if (res.success) {
        setCredits(res.balance ?? 0)
        // estimated_runtime_minutes is null for Unlimited subscribers
        // (no per-minute runtime concept on a token-budget plan).
        setRuntime(res.estimated_runtime_minutes ?? 0)
        setIsUnlimited(res.is_unlimited === true)
      }
    }).catch(() => {})
    window.coasty.getAppVersion().then(setAppVersion).catch(() => {})
  }, [])

  React.useEffect(() => {
    const cleanup = window.coasty.onUpdateStatusChanged(setLocalUpdateStatus)
    return cleanup
  }, [])

  const handleCheckForUpdates = () => { setLocalUpdateStatus('checking'); window.coasty.checkForUpdates() }

  return (
    <div className="flex flex-col flex-1 min-h-0 animate-chat-reveal">
      <SubPageHeader title="Account" onBack={onBack} />
      <div className="flex-1 overflow-y-auto px-3 py-2.5 space-y-2">
        {/* Profile */}
        <div className="flex items-center gap-3 px-2 py-2">
          <UserAvatar avatar={user?.avatar} name={user?.name} size={36} />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-neutral-100 truncate">{user?.name || 'User'}</div>
            <div className="text-[11px] text-neutral-500 truncate">{user?.email || ''}</div>
          </div>
        </div>

        {/* Credits */}
        <button onClick={() => window.open('https://coasty.ai/account?section=billing', '_blank')} className={`w-full rounded-lg border px-3 py-2.5 hover:bg-neutral-800/70 transition-colors group ${
          isUnlimited
            ? 'bg-amber-950/20 border-amber-500/20 hover:bg-amber-950/30'
            : 'bg-neutral-800/50 border-neutral-700/40'
        }`}>
          <div className="flex items-center justify-between mb-1">
            <span className={`text-[10px] font-medium uppercase tracking-wider ${
              isUnlimited ? 'text-amber-500/70' : 'text-neutral-500'
            }`}>
              {isUnlimited ? 'Plan' : 'Credits'}
            </span>
            <ExternalIcon />
          </div>
          {credits !== null ? (
            isUnlimited ? (
              <div className="flex items-center gap-1.5">
                {/* Inline ∞ glyph — matches the amber accent used on the
                    web app's UnlimitedHeroCard and on the landing /pricing
                    Unlimited tier. */}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400 -mt-0.5">
                  <path d="M18.178 8c5.096 0 5.096 8 0 8-5.095 0-7.133-8-12.739-8-4.585 0-4.585 8 0 8 5.606 0 7.644-8 12.74-8z" />
                </svg>
                <span className="text-lg font-semibold text-amber-100">Unlimited</span>
              </div>
            ) : (
              <div className="flex items-baseline gap-2">
                <span className="text-lg font-semibold text-neutral-100">{credits.toLocaleString()}</span>
                {runtime !== null && runtime > 0 && <span className="text-[10px] text-neutral-500">{runtime} min remaining</span>}
              </div>
            )
          ) : (
            <div className="h-5 w-20 rounded bg-neutral-700/50 animate-pulse" />
          )}
        </button>

        {/* Update */}
        {localUpdateStatus === 'ready' ? (
          <button onClick={() => window.coasty.installUpdate()} className="w-full rounded-lg bg-emerald-950/40 border border-emerald-800/40 px-3 py-2.5 hover:bg-emerald-950/60 transition-colors group">
            <div className="flex items-center gap-2.5">
              <div className="w-6 h-6 rounded-full bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400"><line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" /></svg>
              </div>
              <div className="flex-1 text-left"><div className="text-xs font-medium text-emerald-300">Update ready</div><div className="text-[10px] text-emerald-600">Restart to apply</div></div>
              <span className="text-[10px] font-medium text-emerald-500 group-hover:text-emerald-400">Restart</span>
            </div>
          </button>
        ) : (
          <button onClick={handleCheckForUpdates} disabled={localUpdateStatus === 'checking' || localUpdateStatus === 'downloading'} className="w-full rounded-lg bg-neutral-800/50 border border-neutral-700/40 px-3 py-2.5 hover:bg-neutral-800/70 transition-colors group disabled:opacity-50">
            <div className="flex items-center gap-2.5">
              <div className="w-6 h-6 rounded-full bg-neutral-700/40 flex items-center justify-center flex-shrink-0">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`text-neutral-400 ${localUpdateStatus === 'checking' ? 'animate-spin' : ''}`}><path d="M21 12a9 9 0 11-6.219-8.56" /></svg>
              </div>
              <div className="flex-1 text-left">
                <div className="text-xs font-medium text-neutral-300">
                  {localUpdateStatus === 'checking' ? 'Checking...' : localUpdateStatus === 'downloading' || localUpdateStatus === 'available' ? 'Downloading update...' : localUpdateStatus === 'error' ? 'Check failed — tap to retry' : 'Check for updates'}
                </div>
                <div className="text-[10px] text-neutral-600">v{appVersion}</div>
              </div>
            </div>
          </button>
        )}

        <div className="h-px bg-neutral-800/40" />
        <div className="space-y-0.5">
          <div className="px-3 pt-1 pb-0.5"><span className="text-[9px] font-medium text-neutral-600 uppercase tracking-widest">Overlay</span></div>

          {/* Approval mode — opens the approval-mode chooser page */}
          <button onClick={onNavigateApproval} className="press-scale w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/[0.04] group">
            <span className={`flex-shrink-0 ${shieldColor(approvalMode, pendingCount > 0)}`}>
              <ShieldIcon mode={approvalMode} />
            </span>
            <div className="flex-1 min-w-0 text-left">
              <div className="text-xs font-medium text-neutral-300 group-hover:text-neutral-100 tracking-tight">Approval mode</div>
              <div className="text-[10px] text-neutral-600">{shieldLabel(approvalMode)}{pendingCount > 0 ? ` · ${pendingCount} pending` : ''}</div>
            </div>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-600 flex-shrink-0">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>

          {/* Opacity — inline preset dots, sets immediately on click */}
          <div className="flex items-center gap-3 px-3 py-2">
            <span className="flex-shrink-0 text-neutral-500"><EyeIcon opacity={opacity} /></span>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-neutral-300 tracking-tight">Opacity</div>
              <div className="text-[10px] text-neutral-600">{Math.round(opacity * 100)}%</div>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {[1, 0.7, 0.4, 0.2].map((p) => {
                const active = Math.abs(opacity - p) < 0.05
                return (
                  <button
                    key={p}
                    onClick={() => setOpacityAndPersist(p)}
                    aria-label={`${Math.round(p * 100)}%`}
                    title={`${Math.round(p * 100)}%`}
                    className={`press-scale size-3.5 rounded-full transition-all ${active ? 'ring-2 ring-white/80' : 'ring-1 ring-white/15 hover:ring-white/40'}`}
                    style={{ background: `rgba(255,255,255,${0.2 + p * 0.6})` }}
                  />
                )
              })}
            </div>
          </div>
        </div>

        <div className="h-px bg-neutral-800/40" />
        <div className="space-y-0.5">
          <div className="px-3 pt-1 pb-0.5"><span className="text-[9px] font-medium text-neutral-600 uppercase tracking-widest">Account</span></div>
          <MenuLink icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>} label="Account Settings" desc="Profile and preferences" url="https://coasty.ai/account" />
          <MenuLink icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>} label="Privacy & Security" desc="Data and security settings" url="https://coasty.ai/account?section=privacy" />
        </div>
        <div className="h-px bg-neutral-800/40" />
        <div className="space-y-0.5">
          <div className="px-3 pt-1 pb-0.5"><span className="text-[9px] font-medium text-neutral-600 uppercase tracking-widest">Connect</span></div>
          <MenuLink icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>} label="Follow on X" desc="@coastyai" url="https://x.com/coastyai" />
          <MenuLink icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 00-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0020 4.77 5.07 5.07 0 0019.91 1S18.73.65 16 2.48a13.38 13.38 0 00-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 005 4.77a5.44 5.44 0 00-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 009 18.13V22" /></svg>} label="Star on GitHub" desc="coasty-ai" url="https://github.com/coasty-ai" />
          <MenuLink icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>} label="Contact Us" desc="founders@coasty.ai" url="mailto:founders@coasty.ai" />
        </div>
        <div className="h-px bg-neutral-800/40" />
        <button onClick={signOut} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left hover:bg-red-950/30 transition-colors group">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-500 group-hover:text-red-400 flex-shrink-0"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
          <span className="text-xs font-medium text-neutral-400 group-hover:text-red-400">Sign Out</span>
        </button>
      </div>
    </div>
  )
}

/* ─── Resize Handles ─── */

const EDGE = 6
const CORNER = 14
type ResizeEdge = 'top' | 'bottom' | 'left' | 'right' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
const CURSOR_MAP: Record<ResizeEdge, string> = {
  top: 'ns-resize', bottom: 'ns-resize', left: 'ew-resize', right: 'ew-resize',
  'top-left': 'nwse-resize', 'bottom-right': 'nwse-resize', 'top-right': 'nesw-resize', 'bottom-left': 'nesw-resize',
}

function ResizeHandles({ windowSize }: { windowSize: { width: number; height: number } }) {
  const [resizing, setResizing] = React.useState(false)
  const onEdgeDown = React.useCallback((edge: ResizeEdge) => (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation(); setResizing(true); window.coasty.startResize(edge)
  }, [])
  React.useEffect(() => {
    if (!resizing) return
    const onUp = () => { setResizing(false); window.coasty.stopResize() }
    window.addEventListener('mouseup', onUp); window.addEventListener('blur', onUp)
    return () => { window.removeEventListener('mouseup', onUp); window.removeEventListener('blur', onUp) }
  }, [resizing])
  const zone = (edge: ResizeEdge, style: React.CSSProperties) => (
    <div onMouseDown={onEdgeDown(edge)} className="absolute z-[60]" style={{ cursor: CURSOR_MAP[edge], ...style, WebkitAppRegion: 'no-drag' } as any} />
  )
  return (
    <>
      {zone('top', { top: 0, left: CORNER, right: CORNER, height: EDGE })}
      {zone('bottom', { bottom: 0, left: CORNER, right: CORNER, height: EDGE })}
      {zone('left', { left: 0, top: CORNER, bottom: CORNER, width: EDGE })}
      {zone('right', { right: 0, top: CORNER, bottom: CORNER, width: EDGE })}
      {zone('top-left', { top: 0, left: 0, width: CORNER, height: CORNER })}
      {zone('top-right', { top: 0, right: 0, width: CORNER, height: CORNER })}
      {zone('bottom-left', { bottom: 0, left: 0, width: CORNER, height: CORNER })}
      {zone('bottom-right', { bottom: 0, right: 0, width: CORNER, height: CORNER })}
      <div onMouseDown={onEdgeDown('bottom-right')} className="absolute bottom-1 right-1 w-4 h-4 flex items-end justify-end z-[60] opacity-30 hover:opacity-70 transition-opacity duration-150" style={{ cursor: 'nwse-resize', WebkitAppRegion: 'no-drag' } as any}>
        <svg width="10" height="10" viewBox="0 0 10 10" className="text-neutral-400"><line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /><line x1="9" y1="4.5" x2="4.5" y2="9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /><line x1="9" y1="8" x2="8" y2="9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
      </div>
      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-center pointer-events-none select-none z-50">
        <div className={`resize-handle-bar ${resizing ? 'resize-active' : ''}`} />
      </div>
      {resizing && (
        <div className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded bg-neutral-800/90 border border-neutral-700/40 text-[9px] text-neutral-500 font-mono pointer-events-none select-none z-50">
          {windowSize.width} × {windowSize.height}
        </div>
      )}
    </>
  )
}

/* ═══════════════════════════════════════════
   MAIN OVERLAY
   ═══════════════════════════════════════════ */

type Page = 'chat' | 'account' | 'history' | 'approval'

export function Overlay() {
  const connectionState = useConnectionStore((s) => s.state)
  const reconnect = useConnectionStore((s) => s.connect)
  const { mode, toggleExpanded } = useWindowStore()
  const { user, signOut } = useAuthStore()
  const {
    messages, isStreaming, chatTitle, canSend, handleSubmit, handleStop, clearMessages,
    // Yellow "Override & Run" surface — same source of truth used by
    // CompactPill so the busy state survives switching between compact
    // and expanded modes mid-flow.
    isMachineBusy, isStoppingMachine, forceStopAndSend, dismissBusyState,
    pendingInputText, pendingInputAlreadyInChat,
  } = useChatSubmit()
  type FileRef = { path: string; name: string; ext: string; isDirectory: boolean }
  const loadChat = useChatStore((s) => s.loadChat)
  const { mode: approvalMode, setMode: setApprovalMode, pendingApprovals } = useApprovalStore()
  const refreshDisplays = useDisplayStore((s) => s.refreshDisplays)

  const isExpanded = mode === 'expanded'
  const [input, setInput] = React.useState('')
  const [attachedFiles, setAttachedFiles] = React.useState<FileRef[]>([])
  const [opacity, setOpacity] = React.useState(1)
  const [page, setPage] = React.useState<Page>('chat')
  const [updateStatus, setUpdateStatus] = React.useState('idle')
  const [windowSize, setWindowSize] = React.useState<{ width: number; height: number }>({ width: 520, height: 680 })
  const [showGuide, setShowGuide] = React.useState(() => {
    try { return localStorage.getItem('coasty-guide-dismissed') !== 'true' } catch { return true }
  })
  const [displayAutoOpen, setDisplayAutoOpen] = React.useState(false)

  // Reset page on collapse
  React.useEffect(() => { if (!isExpanded) setPage('chat') }, [isExpanded])

  // Auto-expand on approval
  React.useEffect(() => { if (pendingApprovals.length > 0 && !isExpanded) toggleExpanded() }, [pendingApprovals.length])

  // ─── Auto-collapse on stream START + auto-restore on stream END ───
  //
  // Three refs drive the state machine:
  //
  //   wasExpandedAtStartRef — were they expanded when this stream began?
  //   userStoppedRef         — did they click Stop themselves?
  //   userToggledDuringStreamRef — did they manually toggle mode mid-task?
  //
  // Decision tree at stream END (true→false edge), given mode === 'compact':
  //
  //   stoppedByUser → expand. They asked us to abort; show them the panel
  //                   so they can react regardless of any prior toggling.
  //   wasExpanded
  //     && !userToggled → expand. Started expanded, didn't manually
  //                       override mid-stream → restore where they started.
  //   else            → leave compact. They started compact, OR they
  //                       manually toggled to compact during the stream.
  //                       Either way, respect their last choice.
  //
  // The `userToggled` flag is set by `userToggleExpand()` (defined below),
  // which wraps every user-initiated mode toggle. The system-driven
  // approval auto-expand and the auto-collapse/restore effect itself use
  // `setMode`/`toggleExpanded` directly so they don't pollute the flag.
  //
  // `wasStreaming` is captured at the top of the effect once so an
  // instant-fail stream (true→false in the same render cycle) still
  // reliably hits both edges via the snapshot rather than the ref.
  const prevStreamingRef = React.useRef(false)
  const wasExpandedAtStartRef = React.useRef(false)
  const userStoppedRef = React.useRef(false)
  const userToggledDuringStreamRef = React.useRef(false)
  const { setMode } = useWindowStore()

  // Wraps handleStop so the END branch can tell a user-initiated stop
  // apart from a natural stream completion.
  const stopTask = React.useCallback(() => {
    userStoppedRef.current = true
    handleStop()
  }, [handleStop])

  // Wraps toggleExpanded so user-initiated mode toggles during a stream
  // mark the userToggled flag — preventing the END branch from overriding
  // the user's last manual choice on a natural completion.
  const userToggleExpand = React.useCallback(() => {
    if (isStreaming) userToggledDuringStreamRef.current = true
    toggleExpanded()
  }, [isStreaming, toggleExpanded])

  React.useEffect(() => {
    const wasStreaming = prevStreamingRef.current

    if (isStreaming && !wasStreaming) {
      // Stream START
      wasExpandedAtStartRef.current = mode === 'expanded'
      userStoppedRef.current = false
      userToggledDuringStreamRef.current = false
      if (mode === 'expanded') setMode('compact')
    } else if (!isStreaming && wasStreaming) {
      // Stream END
      const stoppedByUser = userStoppedRef.current
      const wasExpanded = wasExpandedAtStartRef.current
      const userToggled = userToggledDuringStreamRef.current

      if (mode === 'compact') {
        if (stoppedByUser) {
          // User-initiated stop ALWAYS expands so they see what happened
          setMode('expanded')
        } else if (wasExpanded && !userToggled) {
          // Natural end + we auto-collapsed at start + user didn't
          // manually override mid-stream → restore to expanded
          setMode('expanded')
        }
        // else: stayed in compact intentionally — respect their choice
      }

      wasExpandedAtStartRef.current = false
      userStoppedRef.current = false
      userToggledDuringStreamRef.current = false
    }

    prevStreamingRef.current = isStreaming
  }, [isStreaming])

  // Drive the rainbow lifecycle from `isStreaming`. The renderer's
  // stream state is the only reliable signal for "is the agent doing work
  // right now". The backend's task_end WebSocket message is fire-and-forget
  // and can be lost (network blip, backend exception, etc.) — relying on it
  // alone leaves the rainbow stuck on. Guarded by a ref so we only push on
  // actual edge transitions, not on initial mount.
  const prevTaskActiveRef = React.useRef<boolean | null>(null)
  React.useEffect(() => {
    if (prevTaskActiveRef.current === isStreaming) return
    prevTaskActiveRef.current = isStreaming
    window.coasty.setTaskActive(isStreaming).catch(() => {})
  }, [isStreaming])

  // Sync opacity
  React.useEffect(() => {
    window.coasty.getOpacity().then(setOpacity)
    return window.coasty.onOpacityChanged(setOpacity)
  }, [])

  // Track window size
  React.useEffect(() => {
    window.coasty.getWindowSize().then(setWindowSize)
    return window.coasty.onWindowSizeChanged(setWindowSize)
  }, [])

  // Track updates
  React.useEffect(() => {
    window.coasty.getUpdateStatus().then(setUpdateStatus)
    return window.coasty.onUpdateStatusChanged(setUpdateStatus)
  }, [])

  // Load display list for multi-monitor selector
  React.useEffect(() => { refreshDisplays() }, [])

  // Ctrl+scroll opacity
  React.useEffect(() => {
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const next = Math.max(OPACITY_MIN, Math.min(1, opacity + (e.deltaY > 0 ? -OPACITY_STEP : OPACITY_STEP)))
      setOpacity(next); window.coasty.setOpacity(next)
    }
    window.addEventListener('wheel', handler, { passive: false })
    return () => window.removeEventListener('wheel', handler)
  }, [opacity])

  const cycleOpacity = () => {
    const idx = OPACITY_PRESETS.findIndex((p) => opacity >= p - 0.05)
    const next = OPACITY_PRESETS[(idx + 1) % OPACITY_PRESETS.length]
    setOpacity(next); window.coasty.setOpacity(next)
  }

  const dismissGuide = () => { setShowGuide(false); try { localStorage.setItem('coasty-guide-dismissed', 'true') } catch {} }
  const enableGuide = () => { setShowGuide(true); try { localStorage.removeItem('coasty-guide-dismissed') } catch {} }

  const pickItems = async (directories?: boolean) => {
    const result = await window.coasty.selectFiles(directories ? { directories: true } : undefined)
    if (result.success && result.files.length > 0) {
      setAttachedFiles((prev) => { const e = new Set(prev.map((f) => f.path)); return [...prev, ...result.files.filter((f) => !e.has(f.path))] })
    }
  }
  const removeFile = (path: string) => setAttachedFiles((prev) => prev.filter((f) => f.path !== path))

  const onSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    // ── Web-app-style submit handler ───────────────────────────────────
    //
    // The typed text stays in the textarea until the hook returns a
    // definite outcome about whether the message was sent. Web parity
    // (see app/components/chat-input/chat-input.tsx): never destroy
    // user-typed content without confirmation.
    //
    // Always navigate to the chat panel and (if compact) expand the
    // overlay so the user can see the chat thread / busy banner —
    // whether they're sending or being prompted to override.
    if (!isExpanded) userToggleExpand()
    if (page !== 'chat') setPage('chat')

    const files = attachedFiles.length > 0 ? attachedFiles : undefined

    if (isMachineBusy) {
      // Yellow Override & Run path. If the user typed something new
      // since busy was detected, send that; otherwise fall back to
      // the hook's stashed pending input.
      let result: SubmitResult
      if (input.trim()) {
        result = await forceStopAndSend(input, files)
      } else if (pendingInputText.trim()) {
        result = await forceStopAndSend()
      } else {
        // Empty input AND empty stash — nothing actionable. The
        // auto-dismiss useEffect will clear isMachineBusy.
        return
      }
      if (result === 'sent') {
        setInput(''); setAttachedFiles([])
      }
      return
    }
    if (!canSend(input)) return
    const result = await handleSubmit(input, files)
    if (result === 'sent') {
      setInput(''); setAttachedFiles([])
    }
    // result === 'busy': leave input + attachments alone so the user
    //   can edit and click Override & Run, or clear input to dismiss.
    // result === 'rejected': also leave input alone — caller didn't
    //   make progress, user's text shouldn't disappear.
  }
  const onKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSubmit() } }

  // ── Busy-state auto-dismiss ──────────────────────────────────────────
  // Same semantics as CompactPill: clearing the input cancels a
  // pre-check busy stash (user changed their mind) but does NOT
  // dismiss a post-error stash (the message is already visible in
  // the chat thread and would be orphaned without the yellow button).
  React.useEffect(() => {
    if (
      isMachineBusy
      && !input.trim()
      && !pendingInputAlreadyInChat
    ) {
      dismissBusyState()
    }
  }, [input, isMachineBusy, pendingInputAlreadyInChat, dismissBusyState])

  const goToPage = (p: Page) => { if (!isExpanded) userToggleExpand(); setPage(p) }

  return (
    <div
      // The rotating beam (.glow-border) lives on the compact pill only —
      // it's a signature of the floating-pill identity. In expanded mode
      // the panel reads as a card, so the beam would feel decorative.
      className={`morph-radius relative flex flex-col w-full h-full overflow-hidden premium-shadow ${isExpanded ? '' : 'glow-border'}`}
      style={{
        borderRadius: isExpanded ? 22 : 28,
        isolation: 'isolate',
      }}
    >
      {/* Opaque backing inside the rounded clip — anti-aliased corner pixels
          can never reveal the desktop because the tinted glass sits ABOVE
          a fully-opaque dark layer. Layer order:
            1. solid dark (back)
            2. blurred glass tint (front, applies backdrop-filter)
            3. top-down lighting gradient (subtle Apple specular) */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10"
        style={{ background: 'rgb(10, 10, 12)', borderRadius: 'inherit' }} />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background: 'rgba(255, 255, 255, 0.015)',
          backdropFilter: 'blur(40px) saturate(180%)',
          WebkitBackdropFilter: 'blur(40px) saturate(180%)',
          borderRadius: 'inherit',
        }} />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'linear-gradient(180deg, rgba(255,255,255,0.025) 0%, rgba(255,255,255,0) 38%, rgba(0,0,0,0.18) 100%)',
          borderRadius: 'inherit',
        }} />

      {/* ═══ PILL BAR ═══ */}
      <div className="titlebar-drag flex items-center gap-2.5 w-full h-14 px-3 flex-shrink-0 select-none">
        {/* Drag grip — compact only */}
        {!isExpanded && (
          <div className="drag-grip flex-shrink-0 grid grid-cols-2 gap-[2px] opacity-30 hover:opacity-60 transition-opacity" title="Drag to reposition">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="w-[2.5px] h-[2.5px] rounded-full bg-neutral-400" />
            ))}
          </div>
        )}

        {/* Logo + status badge */}
        <div className="titlebar-no-drag relative flex-shrink-0 cursor-default" title={statusLabel(connectionState)}
          onClick={(connectionState === 'disconnected' || connectionState === 'error') ? reconnect : undefined}
          style={(connectionState === 'disconnected' || connectionState === 'error') ? { cursor: 'pointer' } : undefined}>
          <svg className="w-5 h-5" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
            <defs><linearGradient id="coastyGrad" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stopColor="rgba(255,255,255,0)" stopOpacity={0} /><stop offset="30%" stopColor="rgba(255,255,255,0.1)" stopOpacity={1} /><stop offset="50%" stopColor="rgba(255,255,255,0.3)" stopOpacity={1} /><stop offset="70%" stopColor="rgba(255,255,255,0.6)" stopOpacity={1} /><stop offset="100%" stopColor="rgba(255,255,255,1)" stopOpacity={1} /></linearGradient></defs>
            <circle cx="100" cy="100" r="100" fill="url(#coastyGrad)" />
          </svg>
          <div className={`absolute -bottom-px -right-px w-1.5 h-1.5 rounded-full ring-[1.5px] ring-neutral-950 ${statusDot(connectionState)} ${isStreaming && connectionState === 'connected' ? 'breathe-emerald' : ''}`} />
          {updateStatus === 'ready' && <div className="absolute -top-px -right-px w-1.5 h-1.5 rounded-full bg-emerald-400 ring-[1.5px] ring-neutral-950" />}
        </div>

        {/* Input / title / live activity */}
        {isExpanded ? (
          <span className="flex-1 min-w-0 text-xs font-medium text-neutral-200 truncate">
            {chatTitle || 'Coasty'}
          </span>
        ) : isStreaming ? (
          <StreamingTicker />
        ) : (
          <div className="titlebar-no-drag flex-1 min-w-0 relative">
            {!input && <div className="absolute inset-0 flex items-center"><PlaceholderCarousel /></div>}
            <input type="text" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKeyDown}
              placeholder="" disabled={connectionState !== 'connected'}
              className="relative z-10 w-full bg-transparent text-xs text-neutral-200 placeholder-neutral-500 outline-none disabled:opacity-50" />
          </div>
        )}

        {/* Right actions */}
        <div className="titlebar-no-drag flex items-center gap-0.5">
          {!isExpanded && isStreaming ? (
            <button onClick={stopTask} aria-label="Stop" title="Stop"
              className="stop-fab press-scale size-7 rounded-full flex items-center justify-center text-white ml-0.5 mr-0.5">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="1.75" /></svg>
            </button>
          ) : !isExpanded && isMachineBusy && (input.trim() || pendingInputAlreadyInChat) ? (
            // Yellow "Override & Run" — visible when the machine is busy
            // AND there's queued content somewhere (live input or
            // post-error stash). See CompactPill.tsx for the full
            // explanation of why we use pendingInputAlreadyInChat (not
            // pendingInputText) — it lets the auto-dismiss work
            // correctly when the user clears the input to cancel.
            <button onClick={() => onSubmit()} disabled={isStoppingMachine}
              aria-label="Override and Run" title="Stop running task and start this one"
              className="press-scale size-7 rounded-full flex items-center justify-center bg-amber-600 hover:bg-amber-500 text-white ml-0.5 mr-0.5 disabled:opacity-50">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" /></svg>
            </button>
          ) : !isExpanded && input.trim() ? (
            <button onClick={() => onSubmit()} disabled={!canSend(input)} aria-label="Send" title="Send"
              className="send-fab press-scale size-7 rounded-full flex items-center justify-center text-neutral-900 ml-0.5 mr-0.5 disabled:cursor-not-allowed">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" /></svg>
            </button>
          ) : null}

          {/* New task — expanded chat only */}
          {isExpanded && page === 'chat' && (
            <button onClick={clearMessages} className="press-scale flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium text-neutral-500 hover:text-neutral-100 hover:bg-white/[0.06]" title="Start a new task">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              New
            </button>
          )}

          {/* History — expanded chat only, promoted from old toolbar row to the header */}
          {isExpanded && page === 'chat' && (
            <button onClick={() => goToPage('history')} className="press-scale flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium text-neutral-500 hover:text-neutral-100 hover:bg-white/[0.06]" title="Past tasks">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
              History
            </button>
          )}

          {/* Display selector — compact: expand overlay and open dropdown */}
          {!isExpanded && useDisplayStore.getState().hasMultiple && (
            <button onClick={() => { setDisplayAutoOpen(true); userToggleExpand(); setPage('chat') }}
              className="press-scale p-1.5 rounded-full hover:bg-white/[0.06] text-neutral-400 hover:text-neutral-100"
              title="Select display">
              <MonitorIcon size={13} />
            </button>
          )}

          {/* Expand / Collapse — chevron rotates instead of swapping */}
          <button onClick={() => userToggleExpand()} className="press-scale p-1.5 rounded-full hover:bg-white/[0.06] text-neutral-400 hover:text-neutral-100" title={isExpanded ? 'Collapse' : 'Expand'}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={{ transition: 'transform 320ms cubic-bezier(0.22, 1, 0.36, 1)', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)' }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {/* Avatar → Account (with amber pending-approval dot for visibility) */}
          {isExpanded && (
            <button onClick={() => goToPage('account')} className={`press-scale relative p-0.5 rounded-full ml-0.5 ${page === 'account' ? 'ring-2 ring-brand-500/60' : 'hover:ring-2 hover:ring-white/10'}`}
              style={{ transition: 'box-shadow 220ms var(--ease-spring), transform 180ms var(--ease-apple)' }}
              title={pendingApprovals.length > 0 ? `${pendingApprovals.length} pending approval${pendingApprovals.length === 1 ? '' : 's'}` : (user?.name || 'Account')}>
              <UserAvatar avatar={user?.avatar} name={user?.name} size={24} />
              {pendingApprovals.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-400 animate-pulse ring-[1.5px] ring-neutral-950" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* TOOLBAR row removed — History promoted to header right cluster,
          Approval mode + Opacity moved into the Account page (Overlay section). */}

      {/* ═══ RESIZE ═══ */}
      {isExpanded && <ResizeHandles windowSize={windowSize} />}

      {/* ═══ PAGES ═══ */}

      {isExpanded && page === 'account' && (
        <AccountMenu
          onBack={() => setPage('chat')}
          updateStatus={updateStatus}
          approvalMode={approvalMode}
          pendingCount={pendingApprovals.length}
          onNavigateApproval={() => setPage('approval')}
          opacity={opacity}
          setOpacityAndPersist={(v) => { setOpacity(v); window.coasty.setOpacity(v) }}
        />
      )}

      {isExpanded && page === 'history' && (
        <ChatHistory onSelectChat={(id) => { loadChat(id); setPage('chat') }} onBack={() => setPage('chat')} />
      )}

      {isExpanded && page === 'approval' && (
        <div className="flex flex-col flex-1 min-h-0 animate-chat-reveal">
          <SubPageHeader title="Action Approval" onBack={() => setPage('chat')} />
          <div className="flex-1 overflow-y-auto py-1">
            {APPROVAL_MODE_ORDER.map((m) => (
              <button key={m} onClick={() => { setApprovalMode(m); setPage('chat') }}
                className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-colors ${approvalMode === m ? 'bg-neutral-800/80' : 'hover:bg-neutral-800/40'}`}>
                <div className={`flex-shrink-0 ${approvalMode === m ? shieldColor(m, false) : 'text-neutral-500'}`}><ShieldIcon mode={m} /></div>
                <div className="flex-1 min-w-0">
                  <div className={`text-xs font-medium ${approvalMode === m ? 'text-neutral-100' : 'text-neutral-300'}`}>{APPROVAL_MODE_LABELS[m]}</div>
                  <div className="text-[10px] text-neutral-500 mt-0.5">{MODE_DESCRIPTIONS[m]}</div>
                </div>
                {approvalMode === m && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400 flex-shrink-0"><polyline points="20 6 9 17 4 12" /></svg>}
              </button>
            ))}
          </div>
        </div>
      )}

      {isExpanded && page === 'chat' && (
        <div className="flex flex-col flex-1 min-h-0 animate-chat-reveal">
          {messages.length === 0 && !isStreaming ? (
            <WelcomeScreen
              user={user}
              showGuide={showGuide}
              onTry={(text) => setInput(text)}
              onDismiss={dismissGuide}
              onEnable={enableGuide}
              connected={connectionState === 'connected'}
            />
          ) : (
            <MessageList messages={messages} isStreaming={isStreaming} />
          )}

          {/* Approvals */}
          {pendingApprovals.length > 0 && (
            <div className="px-3 pt-1 space-y-2 flex-shrink-0">
              {pendingApprovals.map((a) => <ApprovalPrompt key={a.id} approval={a} />)}
            </div>
          )}

          {/* Input area */}
          <div className="px-3 pb-3 pt-1 flex-shrink-0 max-h-[200px] flex flex-col">
            {updateStatus === 'ready' && (
              <button onClick={() => window.coasty.installUpdate()} className="group w-full flex items-center gap-2 px-3 py-1.5 mb-1.5 rounded-lg bg-emerald-950/40 border border-emerald-700/30 hover:border-emerald-600/50 transition-all">
                <div className="relative flex-shrink-0"><div className="w-4 h-4 rounded-full bg-emerald-500/20 flex items-center justify-center"><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400"><line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" /></svg></div><div className="absolute inset-0 rounded-full bg-emerald-400/20 animate-ping" /></div>
                <span className="text-[10px] font-medium text-emerald-400 flex-1 text-left">Update ready</span>
                <span className="text-[9px] font-medium text-emerald-600 group-hover:text-emerald-300 transition-colors">Restart</span>
              </button>
            )}
            {connectionState !== 'connected' && (
              <div className="mb-1.5 flex items-center justify-center gap-2">
                <span className="text-[10px] text-yellow-500">{connectionState === 'connecting' ? 'Connecting to backend...' : 'Not connected to backend'}</span>
                {connectionState !== 'connecting' && (
                  <>
                    <button onClick={reconnect} className="text-[10px] font-medium text-brand-400 hover:text-brand-300 transition-colors">Reconnect</button>
                  </>
                )}
              </div>
            )}

            {/* Compact "Control from phone" pill — persistent above the input.
                Single line, smaller icon, micro shimmer + soft aura kept
                from the welcome version but at half scale.

                Copy choice: the previous "Continue on your phone" framed
                this as continuing a chat thread, which under-sells what
                Coasty's mobile surface actually does (full remote control
                of this machine — clicks, typing, screenshots, the whole
                desktop). The new copy makes the value prop explicit. */}
            <a
              href="https://coasty.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="group press-scale shimmer-sweep flex items-center gap-2 px-2 py-1 mb-1.5 rounded-full bg-white/[0.025] hover:bg-white/[0.05] transition-colors self-center max-w-full"
              style={{ boxShadow: 'inset 0 0 0 0.5px rgba(255,255,255,0.05)' }}
              title="Sign in on coasty.ai from your phone to control this computer remotely"
            >
              <span
                className="relative flex-shrink-0 w-4 h-4 rounded-[5px] flex items-center justify-center bg-blue-500/15"
                style={{ boxShadow: 'inset 0 0 0 0.5px rgba(255,255,255,0.05)' }}
              >
                <span aria-hidden="true" className="aura-ring" />
                <svg
                  width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
                  className="text-blue-300 relative z-10"
                >
                  <rect x="5" y="2" width="14" height="20" rx="2.5" />
                  <line x1="12" y1="18" x2="12.01" y2="18" />
                </svg>
              </span>
              <span className="text-[10px] text-neutral-400 group-hover:text-neutral-100 tracking-tight transition-colors whitespace-nowrap">
                Control this PC from your phone
              </span>
              <span className="text-[10px] font-medium text-neutral-300 group-hover:text-neutral-50 tracking-tight transition-colors whitespace-nowrap">
                coasty.ai
              </span>
              <svg
                width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                className="nudge-arrow text-neutral-600 group-hover:text-neutral-200 flex-shrink-0"
              >
                <line x1="7" y1="17" x2="17" y2="7" />
                <polyline points="7 7 17 7 17 17" />
              </svg>
            </a>

            {/* Busy-state banner — appears above the input form whenever
                the machine has another task running and the user has
                content (or stashed content) waiting to be submitted.
                Without this, the only signal that the machine is busy
                is the colour change on the send button (amber → blue);
                users who don't know what the colour means assumed
                their messages were vanishing. The banner makes the
                state and the resolution explicit. */}
            {isMachineBusy && (input.trim() || pendingInputAlreadyInChat) && (
              <div
                className="mb-2 flex items-start gap-2 px-3 py-2 rounded-xl border border-amber-500/30 bg-amber-500/10 text-[11px] text-amber-200/90"
                role="status"
                aria-live="polite"
              >
                <svg
                  width="13" height="13" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  className="flex-shrink-0 mt-[1px]"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <div className="flex-1 leading-relaxed">
                  <strong className="font-semibold text-amber-100">Another task is running on this machine.</strong>{' '}
                  Click <span className="font-semibold">Override &amp; Run</span> to stop it and run your message instead.
                </div>
              </div>
            )}

            <form onSubmit={onSubmit}
              className="rounded-[22px] bg-neutral-900/70 p-2 transition-all duration-300 focus-within:bg-neutral-900/90"
              style={{
                boxShadow: 'inset 0 0 0 0.5px rgba(255,255,255,0.07), inset 0 1px 0 rgba(255,255,255,0.04), 0 8px 24px rgba(0,0,0,0.35)',
              }}>
              {attachedFiles.length > 0 && (
                <div className="flex flex-wrap gap-1 px-2 pt-1 pb-1.5 max-h-[52px] overflow-y-auto flex-shrink-0">
                  {attachedFiles.map((f) => (
                    <span key={f.path} title={f.path} className="group inline-flex items-center gap-1 bg-neutral-700/60 border border-neutral-600/30 rounded-md px-1.5 py-0.5 text-[10px] max-w-[160px]">
                      {f.isDirectory ? (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 text-blue-400"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" /></svg>
                      ) : (
                        <span className="font-mono font-semibold uppercase text-amber-400 flex-shrink-0">{f.ext || '?'}</span>
                      )}
                      <span className="text-neutral-300 truncate">{f.name}</span>
                      <button type="button" onClick={() => removeFile(f.path)} className="flex-shrink-0 text-neutral-600 hover:text-red-400 transition-colors ml-0.5">
                        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKeyDown}
                placeholder={attachedFiles.length > 0 ? 'What should I do with these files?' : 'Tell your AI what to do...'} rows={1} disabled={connectionState !== 'connected'}
                className={`w-full bg-transparent text-sm text-neutral-200 placeholder-neutral-500 resize-none px-3 pt-2 pb-1 outline-none overflow-y-auto disabled:opacity-50 ${attachedFiles.length > 0 ? 'h-[40px]' : 'h-[60px]'}`} />
              <div className="flex items-center justify-between px-1 pb-0.5">
                <div className="flex items-center gap-0.5">
                  <button type="button" onClick={() => pickItems()} disabled={connectionState !== 'connected'} className="press-scale size-8 rounded-full text-neutral-500 hover:text-neutral-100 hover:bg-white/[0.06] flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed" title="Attach files">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" /></svg>
                  </button>
                  <button type="button" onClick={() => pickItems(true)} disabled={connectionState !== 'connected'} className="press-scale size-8 rounded-full text-neutral-500 hover:text-neutral-100 hover:bg-white/[0.06] flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed" title="Attach folder">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" /></svg>
                  </button>
                  <DisplaySelector disabled={connectionState !== 'connected'} autoOpen={displayAutoOpen} onAutoOpened={() => setDisplayAutoOpen(false)} />
                </div>
                {isStreaming ? (
                  <button type="button" onClick={stopTask} className="stop-fab size-8 rounded-full flex items-center justify-center text-white" aria-label="Stop">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="1.5" /></svg>
                  </button>
                ) : isMachineBusy && (input.trim() || pendingInputAlreadyInChat) ? (
                  // Yellow "Override & Run" — same gating as the compact-
                  // mode button: live input OR a post-error stash that
                  // needs retrying. Submit routes through the form's
                  // onSubmit which detects isMachineBusy and calls
                  // forceStopAndSend.
                  <button type="submit" disabled={isStoppingMachine}
                    className="size-8 rounded-full bg-amber-600 hover:bg-amber-500 text-white flex items-center justify-center disabled:opacity-50"
                    aria-label="Override and Run" title="Stop running task and start this one">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" /></svg>
                  </button>
                ) : (
                  <button type="submit" disabled={!canSend(input)} className="send-fab size-8 rounded-full text-neutral-900 flex items-center justify-center disabled:cursor-not-allowed" aria-label="Send">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" /></svg>
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
