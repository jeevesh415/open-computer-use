"use client"

import { cn } from "@/lib/utils"
import {
  HandPalm,
  Play,
  Desktop,
  CheckCircle,
  CircleNotch,
} from "@phosphor-icons/react"
import { useState, useEffect, useCallback } from "react"

interface AwaitingHumanBannerProps {
  reason: string
  machineId: string
  since?: number
  /** True while the SSE stream is still open (agent is actively waiting) */
  isActive?: boolean
  className?: string
}

/**
 * Build a noVNC URL from machine data and open it in a new tab.
 */
async function openVncForMachine(machineId: string) {
  const res = await fetch(`/api/machines/${machineId}`)
  if (!res.ok) {
    // Fallback: send user to the machines page filtered by this machine
    window.open(`/machines?id=${machineId}`, "_blank")
    return
  }
  const data = await res.json()
  const machine = data.machine || data

  const ip = machine.publicIpAddress || machine.public_ip_address
  if (!ip) {
    window.open(`/machines?id=${machineId}`, "_blank")
    return
  }

  const port = machine.websocketPort || machine.websocket_port || 6080
  // VNC protocol truncates passwords to 8 chars (TightVNC)
  const password = (machine.vncPassword || machine.vnc_password || "").substring(0, 8)
  const encoded = encodeURIComponent(password)
  const url = `http://${ip}:${port}/vnc.html?autoconnect=1&resize=scale&password=${encoded}`
  window.open(url, "_blank")
}

export function AwaitingHumanBanner({
  reason,
  machineId,
  since,
  isActive,
  className,
}: AwaitingHumanBannerProps) {
  const [elapsed, setElapsed] = useState(0)
  const [resuming, setResuming] = useState(false)
  const [resumed, setResumed] = useState(false)
  const [connecting, setConnecting] = useState(false)

  useEffect(() => {
    if (!isActive) return
    const start = since || Date.now()
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000))
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [since, isActive])

  const handleResume = useCallback(async () => {
    if (!machineId || resuming) return
    setResuming(true)
    try {
      const res = await fetch(`/api/chat/resume-human/${machineId}`, {
        method: "POST",
      })
      if (res.ok) {
        setResumed(true)
      } else {
        console.error("Failed to resume:", await res.text())
        setResuming(false)
      }
    } catch (err) {
      console.error("Resume error:", err)
      setResuming(false)
    }
  }, [machineId, resuming])

  const handleConnect = useCallback(async () => {
    if (!machineId || connecting) return
    setConnecting(true)
    try {
      await openVncForMachine(machineId)
    } finally {
      setConnecting(false)
    }
  }, [machineId, connecting])

  const mins = Math.floor(elapsed / 60)
  const secs = elapsed % 60
  const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`

  // ── Completed state (agent already resumed — viewing history) ──
  if (!isActive || resumed) {
    return (
      <div
        className={cn(
          "flex items-center gap-2.5 rounded-xl border px-3.5 py-2",
          "border-zinc-200/50 bg-zinc-500/[0.03]",
          "dark:border-zinc-700/50 dark:bg-zinc-400/[0.03]",
          className,
        )}
      >
        <CheckCircle className="size-4 shrink-0 text-emerald-500" weight="fill" />
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          Human handoff completed
        </span>
      </div>
    )
  }

  // ── Active state (agent is currently waiting for human) ──
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-2xl border px-4 py-3.5",
        "border-amber-300/70 bg-gradient-to-b from-amber-50/80 to-amber-50/40",
        "dark:border-amber-600/40 dark:from-amber-950/30 dark:to-amber-950/10",
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="relative mt-0.5 shrink-0">
          <HandPalm className="size-5 text-amber-500 dark:text-amber-400" weight="fill" />
          <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-amber-400 animate-pulse" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-amber-800 dark:text-amber-200">
              Your turn
            </span>
            <span className="text-[10px] tabular-nums text-amber-500/70 dark:text-amber-400/50">
              {timeStr}
            </span>
          </div>
          <p className="text-[12.5px] leading-relaxed text-amber-700/90 dark:text-amber-300/80">
            {reason}
          </p>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-stretch gap-2.5 pl-8">
        <button
          type="button"
          onClick={handleConnect}
          disabled={connecting}
          className={cn(
            "flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-[13px] font-medium transition-all",
            "border-zinc-200/80 bg-white text-zinc-700 shadow-sm",
            "hover:bg-zinc-50 hover:border-zinc-300",
            "dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200",
            "dark:hover:bg-zinc-700 dark:hover:border-zinc-500",
            connecting && "opacity-60 cursor-not-allowed",
          )}
        >
          {connecting ? (
            <CircleNotch className="size-4 animate-spin" />
          ) : (
            <Desktop className="size-4" />
          )}
          Connect to desktop
        </button>
        <button
          type="button"
          onClick={handleResume}
          disabled={resuming}
          className={cn(
            "flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-[13px] font-medium transition-all",
            "border-amber-400/80 bg-amber-500 text-white shadow-sm",
            "hover:bg-amber-600 hover:border-amber-500",
            "dark:border-amber-500/60 dark:bg-amber-600 dark:text-amber-50",
            "dark:hover:bg-amber-500",
            resuming && "opacity-60 cursor-not-allowed",
          )}
        >
          {resuming ? (
            <CircleNotch className="size-4 animate-spin" />
          ) : (
            <Play className="size-4" weight="fill" />
          )}
          {resuming ? "Resuming..." : "Done, Continue"}
        </button>
      </div>
    </div>
  )
}
