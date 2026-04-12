import React, { useState, useEffect, useCallback } from 'react'
import { cn } from '../lib/utils'

interface AwaitingHumanBannerProps {
  reason: string
  machineId: string
  since?: number
  /** True while the SSE stream is still open (agent is actively waiting) */
  isActive?: boolean
  /** Called after the resume API call succeeds, so the parent can clear store state */
  onResume?: () => void
  className?: string
}

// ── Inline icons (no external dependency) ──

function HandIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M18 8.5V4a2 2 0 00-4 0v1.5M14 5.5V3a2 2 0 00-4 0v5.5M10 8.5V5a2 2 0 00-4 0v6.5M6 11.5V10a2 2 0 00-4 0v4c0 5.523 4.477 10 10 10h1a9 9 0 009-9v-3.5a2 2 0 00-4 0v1" stroke="currentColor" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function PlayIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  )
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg className={cn('animate-spin', className)} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
    </svg>
  )
}

export function AwaitingHumanBanner({
  reason,
  machineId,
  since,
  isActive,
  onResume,
  className,
}: AwaitingHumanBannerProps) {
  const [elapsed, setElapsed] = useState(0)
  const [resuming, setResuming] = useState(false)
  const [resumed, setResumed] = useState(false)

  // Tick the elapsed timer while active
  useEffect(() => {
    if (!isActive || resumed) return
    const start = since || Date.now()
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000))
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [since, isActive, resumed])

  const handleResume = useCallback(async () => {
    if (!machineId || resuming || resumed) return
    setResuming(true)
    try {
      const res = await window.coasty.resumeHuman(machineId)
      if (res.success && res.resumed !== false) {
        setResumed(true)
        onResume?.()
      } else {
        console.error('Failed to resume:', res.error || (res.resumed === false ? 'Machine is not awaiting human input' : 'Unknown error'))
        setResuming(false)
      }
    } catch (err) {
      console.error('Resume error:', err)
      setResuming(false)
    }
  }, [machineId, resuming, resumed])

  const mins = Math.floor(elapsed / 60)
  const secs = elapsed % 60
  const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`

  // ── Completed state ──
  if (!isActive || resumed) {
    return (
      <div
        className={cn(
          'flex items-center gap-2.5 rounded-xl border px-3.5 py-2',
          'border-neutral-700/50 bg-neutral-800/30',
          className,
        )}
      >
        <CheckIcon className="w-4 h-4 shrink-0 text-emerald-500" />
        <span className="text-xs text-neutral-400">
          Human handoff completed
        </span>
      </div>
    )
  }

  // ── Active state — agent is waiting for human ──
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-2xl border px-4 py-3.5',
        'border-amber-600/40 bg-gradient-to-b from-amber-950/30 to-amber-950/10',
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="relative mt-0.5 shrink-0">
          <HandIcon className="w-5 h-5 text-amber-400" />
          <span className="absolute -right-0.5 -top-0.5 w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-amber-200">
              Your turn
            </span>
            <span className="text-[10px] tabular-nums text-amber-400/50">
              {timeStr}
            </span>
          </div>
          <p className="text-[12.5px] leading-relaxed text-amber-300/80">
            {reason}
          </p>
        </div>
      </div>

      {/* Resume button — no "Connect to desktop" since Electron runs locally */}
      <div className="pl-8">
        <button
          type="button"
          onClick={handleResume}
          disabled={resuming}
          className={cn(
            'flex items-center justify-center gap-2 rounded-lg border px-4 py-2 text-[13px] font-medium transition-all w-full',
            'border-amber-500/60 bg-amber-600 text-amber-50',
            'hover:bg-amber-500',
            resuming && 'opacity-60 cursor-not-allowed',
          )}
        >
          {resuming ? (
            <SpinnerIcon className="w-4 h-4" />
          ) : (
            <PlayIcon className="w-4 h-4" />
          )}
          {resuming ? 'Resuming...' : "Done, Continue"}
        </button>
      </div>
    </div>
  )
}
