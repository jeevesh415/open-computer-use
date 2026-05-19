"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Plus, Copy, Check, Trash2, Key, MoreHorizontal, BarChart3,
  Shield, BookOpen,
  Search, Download, RefreshCw, ChevronDown, ChevronRight, X,
  FileJson, FileText, ArrowUpDown, EyeOff, Eye, ExternalLink,
  Activity, Layers,
} from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { PageLoader } from "@/components/common/page-loader"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { fetchClient } from "@/lib/fetch"
import { useTranslations } from "next-intl"

/* ═══════════════════════════════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════════════════════════════ */

const EASE = [0.22, 1, 0.36, 1] as const

type KeyKind = "live" | "test"

const SCOPE_OPTIONS = [
  { id: "predict", label: "Predict",  desc: "Run model predictions" },
  { id: "session", label: "Sessions", desc: "Stateful multi-step tasks" },
  { id: "ground",  label: "Ground",   desc: "Locate UI elements" },
  { id: "ocr",     label: "OCR",      desc: "Extract text from images" },
  { id: "parse",   label: "Parse",    desc: "Parse pyautogui code" },
] as const

const SNIPPET_LANGS = [
  { id: "python",     label: "Python" },
  { id: "javascript", label: "Node" },
  { id: "curl",       label: "cURL" },
  { id: "go",         label: "Go" },
  { id: "ruby",       label: "Ruby" },
  { id: "php",        label: "PHP" },
] as const
type SnippetLangId = (typeof SNIPPET_LANGS)[number]["id"]

/* ═══════════════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════════════ */

interface APIKey {
  id: string
  name: string
  tier: string
  scopes: string[]
  created_at: string
  last_used_at: string | null
  key_prefix: string
}

interface Stats {
  keyCount: number
  totalRequests: number
  totalCredits: number
  requests24h: number
  requests7d: number
  credits7d: number
  avgCreditsPerRequest: number
  peakHour: number | null
  balance: number
  tier: string
}

interface DailyPoint {
  date: string
  requests: number
  credits: number
}

interface RecentRequest {
  endpoint: string
  credits: number
  time: string
  request_id?: string | null
}

type EndpointBreakdown = Record<string, { requests: number; credits: number }>

/* ═══════════════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════════════ */

function timeAgo(date: string | null): string {
  if (!date) return "Never"
  const diff = Date.now() - new Date(date).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1)   return "Just now"
  if (mins < 60)  return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30)  return `${days}d ago`
  return new Date(date).toLocaleDateString()
}

function formatNum(n: number): string {
  if (n < 1000)        return n.toLocaleString()
  if (n < 10_000)      return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k"
  if (n < 1_000_000)   return Math.round(n / 1000) + "k"
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M"
}

function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).catch(() => execCopy(text))
  }
  return execCopy(text)
}

function execCopy(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const el = document.createElement("textarea")
    el.value = text
    el.style.position = "fixed"
    el.style.left = "-9999px"
    document.body.appendChild(el)
    el.select()
    try {
      const ok = document.execCommand("copy")
      if (ok) resolve(); else reject()
    } catch { reject() }
    finally { document.body.removeChild(el) }
  })
}

/**
 * API keys are 55–63 chars (`sk-coasty-live-` + 48 hex, or legacy `cua_sk_` + hex).
 * For inline display, abbreviate to ~24 chars; full key always goes to clipboard.
 */
function abbreviateKey(key: string): string {
  if (key.length <= 24) return key
  return `${key.slice(0, 18)}...${key.slice(-5)}`
}

function endpointBadgeClass(ep: string): string {
  if (ep.startsWith("session")) return "bg-blue-500/10 text-blue-600 dark:text-blue-400"
  if (ep === "ground")          return "bg-amber-500/10 text-amber-600 dark:text-amber-400"
  if (ep === "ocr")             return "bg-purple-500/10 text-purple-600 dark:text-purple-400"
  if (ep === "parse")           return "bg-slate-500/10 text-slate-600 dark:text-slate-400"
  return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
}

function endpointShort(ep: string): string {
  if (ep === "predict")          return "PRED"
  if (ep === "session_predict")  return "S/PRED"
  if (ep === "session_create")   return "S/NEW"
  if (ep === "session_reset")    return "S/RST"
  if (ep === "session_delete")   return "S/DEL"
  return ep.slice(0, 5).toUpperCase()
}

function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

function rowsToCSV(rows: RecentRequest[]): string {
  const header = ["request_id", "endpoint", "credits", "time"]
  const escape = (v: unknown) => {
    const s = v == null ? "" : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [header.join(",")]
  for (const r of rows) {
    lines.push([escape(r.request_id ?? ""), escape(r.endpoint), escape(r.credits), escape(r.time)].join(","))
  }
  return lines.join("\n")
}

/* ═══════════════════════════════════════════════════════════════════
   Stat Tile — clean, no watermark, signature hairline accent
   ═══════════════════════════════════════════════════════════════════ */

function StatTile({
  label, value, suffix, hint, sparkData, accent,
}: {
  label: string
  value: string
  suffix?: string
  hint?: string
  sparkData?: number[]
  accent?: "emerald" | "default"
}) {
  return (
    <div className="group relative rounded-2xl border border-foreground/[0.06] bg-foreground/[0.015] dark:bg-foreground/[0.02] p-5 overflow-hidden transition-colors hover:border-foreground/[0.1]">
      {/* Hairline top accent — single signature element */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/[0.08] to-transparent" />

      <div className="flex items-center justify-between mb-3">
        <span className="text-[10.5px] font-medium uppercase tracking-[0.16em] text-muted-foreground/45">
          {label}
        </span>
        {accent === "emerald" && (
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]" />
        )}
      </div>

      <div className="flex items-baseline gap-1.5">
        <span className="text-[26px] font-medium tracking-tight text-foreground leading-none tabular-nums">
          {value}
        </span>
        {suffix && (
          <span className="text-[11px] text-muted-foreground/45 leading-none">{suffix}</span>
        )}
      </div>

      <div className="mt-2.5 h-3.5 flex items-center justify-between gap-3">
        {hint && (
          <span className="text-[10.5px] text-muted-foreground/45 truncate">{hint}</span>
        )}
        {sparkData && sparkData.length > 0 && (
          <div className="ml-auto flex items-end gap-[2px] h-3">
            {sparkData.map((v, i) => {
              const max = Math.max(...sparkData, 1)
              const h = v > 0 ? Math.max((v / max) * 100, 18) : 6
              return (
                <div
                  key={i}
                  className={cn(
                    "w-[3px] rounded-[1px] transition-colors",
                    v > 0 ? "bg-foreground/25 group-hover:bg-foreground/40" : "bg-foreground/[0.05]",
                  )}
                  style={{ height: `${h}%` }}
                />
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   Activity Chart — smooth bezier, refined colors
   ═══════════════════════════════════════════════════════════════════ */

function ActivityChart({ daily }: { daily: DailyPoint[] }) {
  const [hovered, setHovered] = useState<number | null>(null)
  const hasData = daily.some(d => d.requests > 0)
  const totalReqs  = daily.reduce((s, d) => s + d.requests, 0)
  const totalCreds = daily.reduce((s, d) => s + d.credits, 0)

  const W = 400, H = 84, TOP = 8, BOT = 4
  const chartH = H - TOP - BOT
  const maxVal = Math.max(...daily.map(d => d.requests), 1)

  const scaled = daily.map((d, i) => {
    const x = daily.length > 1 ? (i / (daily.length - 1)) * W : W / 2
    const norm = d.requests > 0 ? Math.max(d.requests / maxVal, 0.18) : 0.02
    const sy = H - BOT - norm * chartH
    return { x, sy, data: d }
  })

  function smoothPath(pts: typeof scaled): string {
    if (pts.length < 2) return pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.sy}`).join(" ")
    const clampY = (v: number) => Math.max(TOP - 2, Math.min(H - BOT + 2, v))
    let d = `M ${pts[0].x} ${pts[0].sy}`
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(i - 1, 0)]
      const p1 = pts[i]
      const p2 = pts[i + 1]
      const p3 = pts[Math.min(i + 2, pts.length - 1)]
      const t = 0.25
      const cp1y = clampY(p1.sy + (p2.sy - p0.sy) * t)
      const cp2y = clampY(p2.sy - (p3.sy - p1.sy) * t)
      d += ` C ${p1.x + (p2.x - p0.x) * t} ${cp1y}, ${p2.x - (p3.x - p1.x) * t} ${cp2y}, ${p2.x} ${p2.sy}`
    }
    return d
  }

  const linePath = smoothPath(scaled)
  const areaPath = `${linePath} L ${W} ${H} L 0 ${H} Z`

  return (
    <div className="relative rounded-2xl border border-foreground/[0.06] bg-foreground/[0.015] dark:bg-foreground/[0.02] overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/[0.08] to-transparent" />
      <div className="px-5 sm:px-6 pt-4 pb-3">
        <div className="flex items-baseline justify-between mb-1 gap-3">
          <div className="flex items-baseline gap-3 min-w-0">
            <span className="text-[10.5px] font-medium uppercase tracking-[0.16em] text-muted-foreground/45">
              Activity
            </span>
            {hasData && (
              <span className="text-[10.5px] text-muted-foreground/35 tabular-nums truncate">
                {formatNum(totalReqs)} request{totalReqs !== 1 ? "s" : ""} · {formatNum(totalCreds)} credits
              </span>
            )}
          </div>
          <span className="text-[10.5px] text-muted-foreground/35">14 days</span>
        </div>

        <div className="relative h-24 mt-3">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-full text-foreground">
            <defs>
              <linearGradient id="dev-act-area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="currentColor" stopOpacity={hasData ? 0.1 : 0.04} />
                <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
              </linearGradient>
              <linearGradient id="dev-act-line" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%"   stopColor="currentColor" stopOpacity="0.06" />
                <stop offset="20%"  stopColor="currentColor" stopOpacity={hasData ? 0.28 : 0.08} />
                <stop offset="80%"  stopColor="currentColor" stopOpacity={hasData ? 0.28 : 0.08} />
                <stop offset="100%" stopColor="currentColor" stopOpacity="0.06" />
              </linearGradient>
            </defs>

            <path d={areaPath} fill="url(#dev-act-area)" />
            <path d={linePath} fill="none" stroke="url(#dev-act-line)" strokeWidth="1.5" />

            {hasData && scaled.map((p, i) => (
              p.data.requests > 0 && (
                <circle
                  key={i}
                  cx={p.x}
                  cy={p.sy}
                  r={hovered === i ? 3 : 1.5}
                  fill={hovered === i ? "currentColor" : "none"}
                  fillOpacity={hovered === i ? 0.4 : 0}
                  stroke="currentColor"
                  strokeWidth={hovered === i ? 1.5 : 1}
                  strokeOpacity={hovered === i ? 0.45 : 0.18}
                  className="transition-all duration-150"
                />
              )
            ))}
          </svg>

          <div className="absolute inset-0 flex">
            {daily.map((d, i) => (
              <div
                key={d.date}
                className="flex-1 relative"
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
              >
                {hovered === i && d.requests > 0 && (
                  <div className="absolute -top-1 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-md bg-foreground text-background text-[9.5px] font-medium whitespace-nowrap z-10 pointer-events-none shadow-lg">
                    <span className="tabular-nums">{d.requests}</span> req · <span className="tabular-nums">{d.credits}</span> cr
                  </div>
                )}
              </div>
            ))}
          </div>

          {!hasData && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-[11px] text-muted-foreground/30 font-medium">
                Your API activity will appear here
              </span>
            </div>
          )}
        </div>

        <div className="flex justify-between mt-2">
          <span className="text-[9.5px] text-muted-foreground/30 tabular-nums">{daily[0]?.date.slice(5)}</span>
          <span className="text-[9.5px] text-muted-foreground/30 tabular-nums">Today</span>
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   Endpoint Breakdown — uses the byEndpoint API field that the old
   page fetched but never displayed
   ═══════════════════════════════════════════════════════════════════ */

function EndpointBreakdownPanel({ byEndpoint }: { byEndpoint: EndpointBreakdown }) {
  const rows = useMemo(() => {
    return Object.entries(byEndpoint)
      .map(([ep, v]) => ({ endpoint: ep, ...v }))
      .sort((a, b) => b.requests - a.requests)
  }, [byEndpoint])

  const totalReqs = rows.reduce((s, r) => s + r.requests, 0)

  return (
    <div className="relative rounded-2xl border border-foreground/[0.06] bg-foreground/[0.015] dark:bg-foreground/[0.02] overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/[0.08] to-transparent" />
      <div className="px-5 sm:px-6 pt-4 pb-4">
        <div className="flex items-baseline justify-between mb-3">
          <span className="text-[10.5px] font-medium uppercase tracking-[0.16em] text-muted-foreground/45">
            By endpoint
          </span>
          <span className="text-[10.5px] text-muted-foreground/35 tabular-nums">30 days</span>
        </div>

        {rows.length === 0 ? (
          <div className="py-6 flex flex-col items-center gap-2">
            <Layers className="h-5 w-5 text-muted-foreground/20" strokeWidth={1.4} />
            <span className="text-[11px] text-muted-foreground/30">No endpoint usage yet</span>
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map(r => {
              const pct = totalReqs > 0 ? (r.requests / totalReqs) * 100 : 0
              return (
                <div key={r.endpoint} className="group/row">
                  <div className="flex items-center gap-3 mb-1">
                    <span className={cn(
                      "shrink-0 w-14 text-center text-[9.5px] font-bold tracking-wider py-0.5 rounded",
                      endpointBadgeClass(r.endpoint),
                    )}>
                      {endpointShort(r.endpoint)}
                    </span>
                    <code className="text-[11px] font-mono text-muted-foreground/55 flex-1 truncate">
                      {r.endpoint}
                    </code>
                    <span className="text-[10.5px] text-muted-foreground/45 tabular-nums shrink-0">
                      {formatNum(r.requests)}
                    </span>
                    <span className="text-[10px] text-muted-foreground/30 tabular-nums w-16 text-right shrink-0">
                      {formatNum(r.credits)} cr
                    </span>
                  </div>
                  <div className="h-[2px] rounded-full bg-foreground/[0.04] overflow-hidden ml-[68px]">
                    <div
                      className="h-full bg-foreground/30 group-hover/row:bg-foreground/45 transition-colors rounded-full"
                      style={{ width: `${Math.max(pct, 1)}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   API Key Card — aurora header (deterministic per-key palette) +
   masked key with reveal/copy. Test keys use a distinct amber palette
   so live and test are visually unmistakable at a glance.
   ═══════════════════════════════════════════════════════════════════ */

const PALETTES = [
  { a: "#6366f1", b: "#a78bfa", c: "#818cf8" },
  { a: "#3b82f6", b: "#8b5cf6", c: "#60a5fa" },
  { a: "#06b6d4", b: "#6366f1", c: "#22d3ee" },
  { a: "#8b5cf6", b: "#ec4899", c: "#c084fc" },
  { a: "#10b981", b: "#06b6d4", c: "#34d399" },
  { a: "#ec4899", b: "#8b5cf6", c: "#f9a8d4" },
  { a: "#14b8a6", b: "#3b82f6", c: "#2dd4bf" },
  { a: "#a855f7", b: "#f43f5e", c: "#d946ef" },
] as const

const TEST_PALETTE = { a: "#f59e0b", b: "#ef4444", c: "#fbbf24" } as const

function useKeyVisuals(keyId: string, isTest: boolean) {
  return useMemo(() => {
    let hash = 0
    for (let i = 0; i < keyId.length; i++) {
      hash = keyId.charCodeAt(i) + ((hash << 5) - hash)
    }
    const r = (seed: number) => {
      const x = Math.sin(seed * 9301 + 49297) * 49297
      return x - Math.floor(x)
    }
    return {
      palette: isTest ? TEST_PALETTE : PALETTES[Math.abs(hash) % PALETTES.length],
      blobPos: {
        x1: 15 + r(hash + 1) * 30,
        y1: 20 + r(hash + 2) * 30,
        x2: 55 + r(hash + 3) * 30,
        y2: 30 + r(hash + 4) * 40,
      },
      // CSS keyframes need a valid identifier — strip non-alphanumerics
      uid: keyId.slice(0, 8).replace(/[^a-zA-Z0-9]/g, "x"),
    }
  }, [keyId, isTest])
}

function APIKeyCard({
  apiKey, index, fullKey, onRevoke,
}: {
  apiKey: APIKey
  index: number
  fullKey?: string
  onRevoke: (id: string) => void
}) {
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)
  const hasFullKey = !!fullKey
  const isTest = apiKey.key_prefix.startsWith("sk-coasty-test-")
  const { palette, blobPos, uid } = useKeyVisuals(apiKey.id, isTest)

  const displayValue = revealed && hasFullKey
    ? fullKey
    : `${apiKey.key_prefix}${"•".repeat(8)}`

  const copyKey = useCallback(() => {
    const text = hasFullKey ? fullKey! : apiKey.key_prefix
    copyToClipboard(text).then(() => {
      setCopied(true)
      toast.success(hasFullKey ? "API key copied" : "Key prefix copied — full key only shown at creation")
      setTimeout(() => setCopied(false), 1800)
    }).catch(() => toast.error("Copy failed — select the text manually"))
  }, [fullKey, apiKey.key_prefix, hasFullKey])

  const dotColor = isTest
    ? "bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.5)]"
    : "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]"

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.4, delay: 0.04 + index * 0.04, ease: EASE }}
      className={cn(
        "group relative h-full flex flex-col rounded-2xl overflow-hidden",
        "bg-card border border-border/40",
        "transition-all duration-300 ease-out",
        "hover:border-border/80 hover:shadow-lg hover:shadow-black/[0.04] dark:hover:shadow-black/[0.12]",
      )}
    >
      {/* ── Aurora header ── */}
      <div className="relative h-24 w-full overflow-hidden shrink-0">
        <style dangerouslySetInnerHTML={{ __html: `
          @keyframes ak-drift-${uid} {
            0%, 100% { transform: translate(0, 0) scale(1); }
            33%      { transform: translate(8px, -6px) scale(1.05); }
            66%      { transform: translate(-6px, 8px) scale(0.97); }
          }
          @keyframes ak-drift2-${uid} {
            0%, 100% { transform: translate(0, 0) scale(1); }
            50%      { transform: translate(-10px, 6px) scale(1.04); }
          }
          @keyframes ak-shimmer-${uid} {
            0%   { transform: translateX(-100%); }
            100% { transform: translateX(200%); }
          }
        ` }} />

        {/* Base gradient */}
        <div
          className="absolute inset-0"
          style={{ background: `linear-gradient(135deg, ${palette.a}15 0%, transparent 50%, ${palette.b}10 100%)` }}
        />

        {/* Drifting blob 1 */}
        <div
          className="absolute will-change-transform rounded-full"
          style={{
            width: "70%", height: "140%",
            left: `${blobPos.x1}%`, top: `${blobPos.y1 - 40}%`,
            background: `radial-gradient(ellipse at center, ${palette.a}30, transparent 70%)`,
            filter: "blur(24px)",
            animation: `ak-drift-${uid} 10s ease-in-out infinite`,
          }}
        />

        {/* Drifting blob 2 */}
        <div
          className="absolute will-change-transform rounded-full"
          style={{
            width: "60%", height: "120%",
            left: `${blobPos.x2}%`, top: `${blobPos.y2 - 30}%`,
            background: `radial-gradient(ellipse at center, ${palette.b}25, transparent 70%)`,
            filter: "blur(20px)",
            animation: `ak-drift2-${uid} 8s ease-in-out infinite`,
          }}
        />

        {/* Shimmer sweep */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `linear-gradient(105deg, transparent 40%, ${palette.c}08 50%, transparent 60%)`,
            animation: `ak-shimmer-${uid} 6s ease-in-out infinite`,
          }}
        />

        {/* Bottom fade into card body */}
        <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-card to-transparent" />

        {/* Test badge sits in the aurora corner */}
        {isTest && (
          <span className="absolute top-2.5 right-2.5 inline-flex items-center px-1.5 py-px rounded text-[9px] font-bold uppercase tracking-wider bg-amber-500/15 text-amber-600 dark:text-amber-400 backdrop-blur-sm">
            test
          </span>
        )}
      </div>

      {/* ── Card body ── */}
      <div className="flex flex-col flex-1 px-5 pb-4 pt-0.5 relative">
        {/* Name row */}
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className={cn("h-2 w-2 rounded-full shrink-0", dotColor)} />
            <h3 className="text-[15px] font-semibold truncate text-foreground tracking-[-0.01em]">
              {apiKey.name}
            </h3>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 rounded-lg text-muted-foreground/30 hover:text-foreground sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 transition-all shrink-0"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={copyKey} className="gap-2 text-[12px]">
                <Copy className="h-3.5 w-3.5" />
                {hasFullKey ? "Copy key" : "Copy prefix"}
              </DropdownMenuItem>
              {hasFullKey && (
                <DropdownMenuItem onClick={() => setRevealed(v => !v)} className="gap-2 text-[12px]">
                  {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  {revealed ? "Hide key" : "Reveal key"}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={() => onRevoke(apiKey.id)}
                className="gap-2 text-[12px] text-destructive focus:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Revoke
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Key chip — masked or revealed; always copy-on-click. The inner
            <code> uses min-w-0 + overflow-x-auto so a 63-char revealed key
            scrolls within the chip rather than blowing the card wider. */}
        <div className={cn(
          "flex items-center gap-2 w-full overflow-hidden rounded-xl border px-3 py-2 mb-3 transition-colors",
          hasFullKey
            ? "border-emerald-500/20 bg-emerald-500/[0.03]"
            : "border-border/30 bg-foreground/[0.015]",
        )}>
          <Key className={cn(
            "h-3.5 w-3.5 shrink-0",
            hasFullKey ? "text-emerald-500/45" : "text-muted-foreground/30",
          )} />
          <button
            onClick={copyKey}
            aria-label={copied ? "Key copied" : "Copy key"}
            className="flex-1 min-w-0 text-left"
          >
            <code className="block w-full text-[11px] font-mono text-muted-foreground/55 overflow-x-auto whitespace-nowrap scrollbar-invisible select-all">
              {displayValue}
            </code>
          </button>
          {hasFullKey && (
            <button
              onClick={() => setRevealed(v => !v)}
              aria-label={revealed ? "Hide key" : "Reveal key"}
              className="shrink-0 text-muted-foreground/40 hover:text-foreground/75 transition-colors p-0.5"
            >
              {revealed ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            </button>
          )}
          <button
            onClick={copyKey}
            aria-label={copied ? "Key copied" : "Copy key"}
            className="shrink-0 text-muted-foreground/40 hover:text-foreground/75 transition-colors p-0.5"
          >
            {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
          </button>
        </div>

        {/* Status meta line */}
        <div className="flex items-center gap-1.5 text-[11px] mb-3">
          <span className={cn(
            "font-medium",
            isTest ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400",
          )}>
            {isTest ? "Test" : "Active"}
          </span>
          <span className="text-muted-foreground/20">·</span>
          <span className="text-muted-foreground/40">{apiKey.scopes.length} scope{apiKey.scopes.length !== 1 ? "s" : ""}</span>
          {apiKey.last_used_at && (
            <>
              <span className="text-muted-foreground/20">·</span>
              <span className="tabular-nums text-muted-foreground/40">{timeAgo(apiKey.last_used_at)}</span>
            </>
          )}
        </div>

        {/* Scopes */}
        <div className="flex flex-wrap gap-1.5 mt-auto">
          {apiKey.scopes.map(scope => (
            <span
              key={scope}
              className="inline-flex items-center rounded-md border border-border/30 bg-background/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground/55"
            >
              {scope}
            </span>
          ))}
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="border-t border-border/30 px-5 py-3 flex items-center gap-1.5">
        <Shield className="h-3.5 w-3.5 text-muted-foreground/30 shrink-0" />
        <span className="text-[11px] text-muted-foreground/40">Created {timeAgo(apiKey.created_at)}</span>
      </div>
    </motion.div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   Created-Key Code Snippet (preserved from original — clean already)
   ═══════════════════════════════════════════════════════════════════ */

function getSnippetCode(lang: SnippetLangId, key: string, forCopy: boolean): string {
  const k = forCopy ? key : abbreviateKey(key)
  switch (lang) {
    case "python":
      return `import requests, base64

KEY = "${k}"
img = base64.b64encode(
    open("screen.png", "rb").read()
).decode()

r = requests.post(
    "https://coasty.ai/v1/predict",
    headers={"X-API-Key": KEY},
    json={
        "screenshot": img,
        "instruction": "Click the login button",
    },
)
for a in r.json()["actions"]:
    print(a["action_type"], a["params"])`
    case "javascript":
      return `import fs from "node:fs"

const KEY = "${k}"
const img = fs
  .readFileSync("screen.png")
  .toString("base64")

const res = await fetch(
  "https://coasty.ai/v1/predict",
  {
    method: "POST",
    headers: {
      "X-API-Key": KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      screenshot: img,
      instruction: "Click the login button",
    }),
  },
)
const { actions } = await res.json()`
    case "curl":
      return `KEY="${k}"

curl -X POST \\
  https://coasty.ai/v1/predict \\
  -H "X-API-Key: $KEY" \\
  -H "Content-Type: application/json" \\
  -d @- <<EOF
{
  "screenshot": "$(base64 < screen.png | tr -d '\\n')",
  "instruction": "Click the login button"
}
EOF`
    case "go":
      return `package main

import (
  "bytes"
  "encoding/base64"
  "encoding/json"
  "net/http"
  "os"
)

const KEY = "${k}"

func main() {
  f, _ := os.ReadFile("screen.png")
  img := base64.StdEncoding.EncodeToString(f)

  body, _ := json.Marshal(map[string]any{
    "screenshot":  img,
    "instruction": "Click the login button",
  })

  req, _ := http.NewRequest("POST",
    "https://coasty.ai/v1/predict",
    bytes.NewReader(body))
  req.Header.Set("X-API-Key", KEY)
  req.Header.Set(
    "Content-Type", "application/json")

  http.DefaultClient.Do(req)
}`
    case "ruby":
      return `require "base64"
require "json"
require "net/http"

KEY = "${k}"
img = Base64.strict_encode64(
  File.read("screen.png")
)

uri = URI(
  "https://coasty.ai/v1/predict"
)
req = Net::HTTP::Post.new(uri)
req["X-API-Key"] = KEY
req["Content-Type"] = "application/json"
req.body = {
  screenshot: img,
  instruction: "Click the login button"
}.to_json

res = Net::HTTP.start(
  uri.hostname, uri.port, use_ssl: true
) { |h| h.request(req) }`
    case "php":
      return `<?php
$KEY = "${k}";
$img = base64_encode(
  file_get_contents("screen.png")
);

$ch = curl_init(
  "https://coasty.ai/v1/predict"
);
curl_setopt_array($ch, [
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_POST => true,
  CURLOPT_HTTPHEADER => [
    "X-API-Key: $KEY",
    "Content-Type: application/json",
  ],
  CURLOPT_POSTFIELDS => json_encode([
    "screenshot" => $img,
    "instruction" => "Click the login button",
  ]),
]);

$res = curl_exec($ch);`
  }
}

function CodeSnippetBlock({
  apiKey, onCopy,
}: {
  apiKey: string
  onCopy: (text: string) => Promise<void>
}) {
  const [snippetLang, setSnippetLang] = useState<SnippetLangId>("python")
  const [copiedSnippet, setCopiedSnippet] = useState(false)
  const displayCode = getSnippetCode(snippetLang, apiKey, false)
  const copyCode    = getSnippetCode(snippetLang, apiKey, true)

  const handleCopy = () => {
    onCopy(copyCode)
      .then(() => {
        setCopiedSnippet(true)
        toast.success("Snippet copied")
        setTimeout(() => setCopiedSnippet(false), 1600)
      })
      .catch(() => toast.error("Copy failed"))
  }

  return (
    <div className="border-t border-foreground/[0.05] bg-foreground/[0.012]">
      <div className="px-4 sm:px-6 pt-3 sm:pt-4 pb-3">
        <div className="flex items-center justify-between mb-2.5">
          <p className="text-[10px] sm:text-[10.5px] font-medium text-muted-foreground/45 uppercase tracking-[0.16em]">
            Quick start
          </p>
          <button
            onClick={handleCopy}
            aria-label={copiedSnippet ? "Snippet copied" : "Copy snippet"}
            className={cn(
              "group inline-flex items-center gap-1 h-6 px-1.5 -mr-1 rounded text-[10px] font-medium transition-colors",
              copiedSnippet ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground/45 hover:text-foreground/75",
            )}
          >
            {copiedSnippet ? (
              <><Check className="h-3 w-3" strokeWidth={2.4} /> Copied</>
            ) : (
              <><Copy className="h-3 w-3" /> Copy</>
            )}
          </button>
        </div>

        {/* Language tabs — match guide-client tab pill style */}
        <div className="flex items-center gap-0.5 sm:gap-1 mb-2.5 overflow-x-auto scrollbar-invisible">
          {SNIPPET_LANGS.map(l => (
            <button
              key={l.id}
              onClick={() => setSnippetLang(l.id)}
              className={cn(
                "px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg text-[10.5px] sm:text-[11px] font-medium transition-colors duration-150 shrink-0",
                snippetLang === l.id
                  ? "bg-foreground/[0.08] dark:bg-foreground/[0.12] text-foreground"
                  : "text-muted-foreground/45 hover:text-foreground/75 hover:bg-foreground/[0.04]",
              )}
            >
              {l.label}
            </button>
          ))}
        </div>

        <div className="rounded-lg border border-foreground/[0.06] bg-foreground/[0.02] overflow-hidden">
          <pre className="px-3 sm:px-3.5 py-2.5 sm:py-3 text-[10.5px] sm:text-[11px] leading-relaxed font-mono text-foreground/65 overflow-x-auto scrollbar-invisible">
            <code>{displayCode}</code>
          </pre>
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   Traces Panel — filters, export, expandable rows
   ═══════════════════════════════════════════════════════════════════ */

type TimeRange = "1h" | "24h" | "7d" | "14d" | "30d" | "all"
type SortKey = "newest" | "oldest" | "credits-desc" | "credits-asc"

const TIME_RANGES: { id: TimeRange; label: string; ms: number | null }[] = [
  { id: "1h",  label: "1h",  ms: 60 * 60 * 1000 },
  { id: "24h", label: "24h", ms: 24 * 60 * 60 * 1000 },
  { id: "7d",  label: "7d",  ms: 7 * 24 * 60 * 60 * 1000 },
  { id: "14d", label: "14d", ms: 14 * 24 * 60 * 60 * 1000 },
  { id: "30d", label: "30d", ms: 30 * 24 * 60 * 60 * 1000 },
  { id: "all", label: "All", ms: null },
]

const SORT_LABELS: Record<SortKey, string> = {
  "newest":       "Newest first",
  "oldest":       "Oldest first",
  "credits-desc": "Credits (high → low)",
  "credits-asc":  "Credits (low → high)",
}

function TracesPanel({
  recent, onRefresh,
}: {
  recent: RecentRequest[]
  onRefresh: () => Promise<void> | void
}) {
  const [search, setSearch] = useState("")
  const [selectedEndpoints, setSelectedEndpoints] = useState<Set<string>>(new Set())
  const [timeRange, setTimeRange] = useState<TimeRange>("24h")
  const [sortKey, setSortKey] = useState<SortKey>("newest")
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [visibleCount, setVisibleCount] = useState(25)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  useEffect(() => { setVisibleCount(25) }, [search, selectedEndpoints, timeRange, sortKey])

  useEffect(() => {
    if (!autoRefresh) return
    const id = setInterval(() => { Promise.resolve(onRefresh()).catch(() => {}) }, 30_000)
    return () => clearInterval(id)
  }, [autoRefresh, onRefresh])

  const allEndpoints = useMemo(() => {
    const set = new Set<string>()
    for (const r of recent) set.add(r.endpoint)
    return Array.from(set).sort()
  }, [recent])

  const filtered = useMemo(() => {
    const now = Date.now()
    const range = TIME_RANGES.find(r => r.id === timeRange)
    const cutoff = range?.ms ? now - range.ms : null
    const q = search.trim().toLowerCase()
    let rows = recent.filter(r => {
      if (cutoff !== null && new Date(r.time).getTime() < cutoff) return false
      if (selectedEndpoints.size > 0 && !selectedEndpoints.has(r.endpoint)) return false
      if (q) {
        const hay = `${r.endpoint} ${r.request_id ?? ""}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
    rows = [...rows].sort((a, b) => {
      switch (sortKey) {
        case "oldest":       return new Date(a.time).getTime() - new Date(b.time).getTime()
        case "credits-desc": return b.credits - a.credits
        case "credits-asc":  return a.credits - b.credits
        case "newest":
        default:             return new Date(b.time).getTime() - new Date(a.time).getTime()
      }
    })
    return rows
  }, [recent, search, selectedEndpoints, timeRange, sortKey])

  const visible = filtered.slice(0, visibleCount)
  const hasFilters = search.length > 0 || selectedEndpoints.size > 0 || timeRange !== "24h"

  const clearFilters = () => {
    setSearch("")
    setSelectedEndpoints(new Set())
    setTimeRange("24h")
  }

  const toggleEndpoint = (ep: string) => {
    setSelectedEndpoints(prev => {
      const next = new Set(prev)
      if (next.has(ep)) next.delete(ep); else next.add(ep)
      return next
    })
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    try { await onRefresh() } finally { setRefreshing(false) }
  }

  const exportCSV = () => {
    if (filtered.length === 0) return
    downloadFile(`traces-${new Date().toISOString().slice(0, 10)}.csv`, rowsToCSV(filtered), "text/csv;charset=utf-8")
    toast.success(`Exported ${filtered.length} row${filtered.length === 1 ? "" : "s"}`)
  }

  const exportJSON = () => {
    if (filtered.length === 0) return
    downloadFile(`traces-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(filtered, null, 2), "application/json")
    toast.success(`Exported ${filtered.length} row${filtered.length === 1 ? "" : "s"}`)
  }

  const copyJSON = () => {
    if (filtered.length === 0) return
    copyToClipboard(JSON.stringify(filtered, null, 2))
      .then(() => toast.success("Copied JSON"))
      .catch(() => toast.error("Copy failed"))
  }

  const copyValue = (v: string, k: string) => {
    copyToClipboard(v)
      .then(() => {
        setCopiedKey(k)
        setTimeout(() => setCopiedKey(prev => (prev === k ? null : prev)), 1400)
      })
      .catch(() => {})
  }

  return (
    <div className="relative rounded-2xl border border-foreground/[0.06] bg-foreground/[0.015] dark:bg-foreground/[0.02] overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/[0.08] to-transparent" />

      {/* Header */}
      <div className="px-5 sm:px-6 pt-4 pb-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-baseline gap-3">
          <span className="text-[10.5px] font-medium uppercase tracking-[0.16em] text-muted-foreground/45">
            Traces
          </span>
          <span className="text-[10.5px] text-muted-foreground/35 tabular-nums">
            {filtered.length === recent.length
              ? `${recent.length}`
              : `${filtered.length} of ${recent.length}`}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setAutoRefresh(v => !v)}
            title={autoRefresh ? "Auto-refresh on (30s)" : "Auto-refresh off"}
            className={cn(
              "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[10.5px] font-medium border transition-all",
              autoRefresh
                ? "border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-600 dark:text-emerald-400"
                : "border-foreground/[0.08] bg-background/40 text-muted-foreground/55 hover:text-foreground hover:border-foreground/20",
            )}
          >
            <span className={cn(
              "h-1.5 w-1.5 rounded-full",
              autoRefresh ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground/30",
            )} />
            Live
          </button>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            title="Refresh now"
            className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-foreground/[0.08] bg-background/40 text-muted-foreground/60 hover:text-foreground hover:border-foreground/20 disabled:opacity-50 transition-all"
          >
            <RefreshCw className={cn("h-3 w-3", refreshing && "animate-spin")} />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                disabled={filtered.length === 0}
                title="Export"
                className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[10.5px] font-medium border border-foreground/[0.08] bg-background/40 text-muted-foreground/60 hover:text-foreground hover:border-foreground/20 disabled:opacity-40 transition-all"
              >
                <Download className="h-3 w-3" />
                Export
                <ChevronDown className="h-3 w-3 opacity-60" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={exportCSV}  className="text-[12px]"><FileText className="h-3.5 w-3.5 mr-2" />CSV</DropdownMenuItem>
              <DropdownMenuItem onClick={exportJSON} className="text-[12px]"><FileJson className="h-3.5 w-3.5 mr-2" />JSON</DropdownMenuItem>
              <DropdownMenuItem onClick={copyJSON}   className="text-[12px]"><Copy      className="h-3.5 w-3.5 mr-2" />Copy JSON</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Toolbar */}
      <div className="px-5 sm:px-6 pb-3 flex items-center gap-2 flex-wrap border-b border-foreground/[0.04]">
        <div className="relative flex-1 min-w-[180px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/40" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search endpoint or request_id"
            className="w-full h-7 pl-7 pr-7 rounded-md text-[11.5px] bg-background/40 border border-foreground/[0.08] placeholder:text-muted-foreground/35 text-foreground/85 focus:outline-none focus:border-foreground/20 focus:bg-background/70 transition-colors"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-foreground transition-colors">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        <div className="inline-flex items-center rounded-md border border-foreground/[0.08] bg-background/40 p-0.5">
          {TIME_RANGES.map(r => (
            <button
              key={r.id}
              onClick={() => setTimeRange(r.id)}
              className={cn(
                "h-6 px-2 rounded text-[10.5px] font-medium tabular-nums transition-colors",
                timeRange === r.id
                  ? "bg-foreground/[0.08] dark:bg-foreground/[0.12] text-foreground"
                  : "text-muted-foreground/50 hover:text-foreground/85",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className={cn(
              "inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[10.5px] font-medium border bg-background/40 transition-all",
              selectedEndpoints.size > 0
                ? "border-foreground/25 text-foreground"
                : "border-foreground/[0.08] text-muted-foreground/60 hover:text-foreground hover:border-foreground/20",
            )}>
              Endpoints
              {selectedEndpoints.size > 0 && (
                <span className="ml-0.5 h-4 min-w-4 px-1 rounded-full bg-foreground text-background text-[9px] font-bold tabular-nums inline-flex items-center justify-center">
                  {selectedEndpoints.size}
                </span>
              )}
              <ChevronDown className="h-3 w-3 opacity-60" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            {allEndpoints.length === 0 ? (
              <div className="px-2 py-1.5 text-[11px] text-muted-foreground/40">No endpoints yet</div>
            ) : (
              <>
                {allEndpoints.map(ep => {
                  const checked = selectedEndpoints.has(ep)
                  return (
                    <DropdownMenuItem
                      key={ep}
                      onSelect={(e) => { e.preventDefault(); toggleEndpoint(ep) }}
                      className="text-[11.5px] flex items-center gap-2"
                    >
                      <span className={cn(
                        "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border transition-colors",
                        checked ? "bg-foreground border-foreground" : "border-foreground/30",
                      )}>
                        {checked && <Check className="h-2.5 w-2.5 text-background" />}
                      </span>
                      <code className="flex-1 truncate font-mono text-[11px]">{ep}</code>
                    </DropdownMenuItem>
                  )
                })}
                {selectedEndpoints.size > 0 && (
                  <DropdownMenuItem
                    onSelect={(e) => { e.preventDefault(); setSelectedEndpoints(new Set()) }}
                    className="text-[11px] text-muted-foreground/60 border-t border-foreground/[0.06] mt-1 pt-1.5"
                  >
                    <X className="h-3 w-3 mr-2" />Clear selection
                  </DropdownMenuItem>
                )}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[10.5px] font-medium border border-foreground/[0.08] bg-background/40 text-muted-foreground/60 hover:text-foreground hover:border-foreground/20 transition-all">
              <ArrowUpDown className="h-3 w-3" />
              {SORT_LABELS[sortKey]}
              <ChevronDown className="h-3 w-3 opacity-60" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {(Object.keys(SORT_LABELS) as SortKey[]).map(k => (
              <DropdownMenuItem
                key={k}
                onSelect={() => setSortKey(k)}
                className="text-[11.5px] flex items-center gap-2"
              >
                <span className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  sortKey === k ? "bg-foreground" : "bg-transparent border border-foreground/30",
                )} />
                {SORT_LABELS[k]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {hasFilters && (
          <button
            onClick={clearFilters}
            className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[10.5px] text-muted-foreground/55 hover:text-foreground transition-colors"
          >
            <X className="h-3 w-3" />Clear
          </button>
        )}
      </div>

      {/* Body */}
      {recent.length === 0 ? (
        <div className="px-5 pb-8 pt-8 flex flex-col items-center text-center">
          <Activity className="h-7 w-7 text-muted-foreground/15 mb-3" strokeWidth={1.2} />
          <p className="text-[11px] text-muted-foreground/30">
            API requests will appear here as you make calls
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="px-5 pb-8 pt-8 flex flex-col items-center text-center">
          <Search className="h-7 w-7 text-muted-foreground/15 mb-3" strokeWidth={1.2} />
          <p className="text-[11px] text-muted-foreground/40">No traces match these filters</p>
          <button onClick={clearFilters} className="mt-2 text-[10.5px] font-medium text-foreground/70 hover:text-foreground underline-offset-2 hover:underline">
            Clear filters
          </button>
        </div>
      ) : (
        <>
          <div className="divide-y divide-foreground/[0.04]">
            {visible.map((r, i) => {
              const key = r.request_id || `${r.time}-${i}`
              const isOpen = expanded === key
              return (
                <div key={key} className="group/row">
                  <button
                    onClick={() => setExpanded(isOpen ? null : key)}
                    className="w-full flex items-center gap-3 px-5 sm:px-6 py-2.5 text-left transition-colors hover:bg-foreground/[0.02]"
                  >
                    <ChevronRight className={cn(
                      "h-3 w-3 text-muted-foreground/30 shrink-0 transition-transform",
                      isOpen && "rotate-90 text-muted-foreground/60",
                    )} />
                    <span className={cn(
                      "shrink-0 w-12 text-center text-[10px] font-bold tracking-wider py-0.5 rounded",
                      endpointBadgeClass(r.endpoint),
                    )}>
                      {endpointShort(r.endpoint)}
                    </span>
                    <span className="text-[11px] text-muted-foreground/60 flex-1 truncate font-mono">
                      {r.request_id ?? r.endpoint.replace(/_/g, " ")}
                    </span>
                    <span className="text-[10px] text-muted-foreground/40 tabular-nums">{r.credits} cr</span>
                    <span className="text-[10px] text-muted-foreground/30 tabular-nums w-14 text-right">
                      {timeAgo(r.time)}
                    </span>
                  </button>

                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        key="detail"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.22, ease: EASE }}
                        className="overflow-hidden bg-foreground/[0.012]"
                      >
                        <div className="px-12 sm:px-14 py-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                          <DetailRow
                            label="Endpoint"
                            value={r.endpoint}
                            onCopy={() => copyValue(r.endpoint, `${key}-ep`)}
                            copied={copiedKey === `${key}-ep`}
                            mono
                          />
                          <DetailRow
                            label="Credits"
                            value={`${r.credits}`}
                            onCopy={() => copyValue(String(r.credits), `${key}-cr`)}
                            copied={copiedKey === `${key}-cr`}
                          />
                          <DetailRow
                            label="Request ID"
                            value={r.request_id ?? "—"}
                            onCopy={r.request_id ? () => copyValue(r.request_id!, `${key}-id`) : undefined}
                            copied={copiedKey === `${key}-id`}
                            mono
                          />
                          <DetailRow
                            label="Timestamp"
                            value={new Date(r.time).toLocaleString()}
                            secondary={r.time}
                            onCopy={() => copyValue(r.time, `${key}-t`)}
                            copied={copiedKey === `${key}-t`}
                          />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )
            })}
          </div>

          {visibleCount < filtered.length && (
            <div className="border-t border-foreground/[0.04] px-5 py-2.5 flex items-center justify-center">
              <button
                onClick={() => setVisibleCount(c => c + 25)}
                className="text-[11px] font-medium text-muted-foreground/65 hover:text-foreground transition-colors"
              >
                Load 25 more  ·  <span className="text-muted-foreground/35 tabular-nums">{filtered.length - visibleCount} remaining</span>
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function DetailRow({
  label, value, secondary, onCopy, copied, mono,
}: {
  label: string
  value: string
  secondary?: string
  onCopy?: () => void
  copied?: boolean
  mono?: boolean
}) {
  return (
    <div className="flex items-start gap-3 group/detail">
      <span className="text-[9.5px] font-semibold text-muted-foreground/40 uppercase tracking-[0.14em] w-16 shrink-0 pt-0.5">
        {label}
      </span>
      <div className="flex-1 min-w-0">
        <div className={cn("text-[11.5px] text-foreground/80 break-all", mono && "font-mono text-[11px]")}>
          {value}
        </div>
        {secondary && (
          <div className="text-[10px] text-muted-foreground/35 font-mono truncate mt-0.5">{secondary}</div>
        )}
      </div>
      {onCopy && (
        <button
          onClick={onCopy}
          className="opacity-0 group-hover/detail:opacity-100 text-muted-foreground/40 hover:text-foreground transition-all shrink-0"
          title="Copy"
        >
          {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
        </button>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   Quick Reference Tab — focused, self-contained docs
   ═══════════════════════════════════════════════════════════════════ */

const REFERENCE_ENDPOINTS = [
  { method: "POST",   path: "/v1/predict",                    desc: "Stateless prediction",  cost: "5 cr" },
  { method: "POST",   path: "/v1/sessions",                   desc: "Create session",        cost: "10 cr" },
  { method: "POST",   path: "/v1/sessions/{id}/predict",      desc: "Session prediction",    cost: "4 cr" },
  { method: "POST",   path: "/v1/sessions/{id}/reset",        desc: "Reset session",         cost: "Free" },
  { method: "DELETE", path: "/v1/sessions/{id}",              desc: "Delete session",        cost: "Free" },
  { method: "POST",   path: "/v1/ground",                     desc: "Locate UI element",     cost: "3 cr" },
  { method: "POST",   path: "/v1/ocr",                        desc: "Extract text",          cost: "3 cr" },
  { method: "POST",   path: "/v1/parse",                      desc: "Parse pyautogui code",  cost: "Free" },
  { method: "GET",    path: "/v1/usage",                      desc: "Usage summary",         cost: "Free" },
] as const

const REFERENCE_ACTIONS = [
  { type: "click",     desc: "Mouse click at (x, y)" },
  { type: "type_text", desc: "Type a string" },
  { type: "key_press", desc: "Press a key (enter, tab…)" },
  { type: "key_combo", desc: "Combo (ctrl+c, cmd+v…)" },
  { type: "scroll",    desc: "Scroll at a position" },
  { type: "drag",      desc: "Drag between two points" },
  { type: "move",      desc: "Move cursor" },
  { type: "wait",      desc: "Pause execution" },
  { type: "done",      desc: "Task completed" },
  { type: "fail",      desc: "Task impossible" },
] as const

function methodBadgeClass(method: string): string {
  if (method === "POST")   return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
  if (method === "GET")    return "bg-blue-500/10 text-blue-600 dark:text-blue-400"
  if (method === "DELETE") return "bg-rose-500/10 text-rose-600 dark:text-rose-400"
  return "bg-slate-500/10 text-slate-600 dark:text-slate-400"
}

function ReferenceSection({
  id, title, eyebrow, children,
}: {
  id?: string
  title: string
  eyebrow?: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="relative rounded-2xl border border-foreground/[0.06] bg-foreground/[0.015] dark:bg-foreground/[0.02] overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/[0.08] to-transparent" />
      <div className="px-5 sm:px-6 pt-4 pb-5">
        {eyebrow && (
          <div className="text-[10.5px] font-medium uppercase tracking-[0.16em] text-muted-foreground/45 mb-1.5">
            {eyebrow}
          </div>
        )}
        <h2 className="text-[15px] font-medium text-foreground tracking-[-0.005em] mb-4">
          {title}
        </h2>
        {children}
      </div>
    </section>
  )
}

function QuickReferenceTab() {
  const [lang, setLang] = useState<SnippetLangId>("python")
  const [copied, setCopied] = useState(false)
  // Use the placeholder key only — never reveals a real key
  const sample = getSnippetCode(lang, "sk-coasty-live-...", true)

  const handleCopy = () => {
    copyToClipboard(sample)
      .then(() => {
        setCopied(true)
        toast.success("Snippet copied")
        setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => toast.error("Copy failed"))
  }

  return (
    <div className="space-y-5">
      {/* ── Full docs link (top) ── */}
      <Link
        href="/guide?tab=api"
        className="group flex items-center justify-between gap-4 px-5 py-4 rounded-2xl border border-foreground/[0.06] bg-foreground/[0.015] hover:bg-foreground/[0.03] hover:border-foreground/[0.1] transition-all"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-foreground/[0.05]">
            <BookOpen className="h-4 w-4 text-foreground/55" strokeWidth={1.6} />
          </div>
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-foreground tracking-[-0.005em]">Full API documentation</div>
            <div className="text-[11px] text-muted-foreground/50 mt-0.5 truncate">
              Sessions, machines, schedules, MCP, error handling, and webhook signing
            </div>
          </div>
        </div>
        <ExternalLink className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-foreground/70 shrink-0 transition-colors" />
      </Link>

      {/* ── Authentication ── */}
      <ReferenceSection title="Authentication" eyebrow="Step 1">
        <p className="text-[12.5px] text-muted-foreground/60 leading-relaxed mb-4">
          Every request needs an{" "}
          <code className="text-[11px] px-1.5 py-0.5 rounded-md bg-foreground/[0.05] font-mono text-foreground/80">X-API-Key</code>{" "}
          header. Credits are deducted per request from your shared balance.
        </p>
        <div className="rounded-lg border border-foreground/[0.06] bg-foreground/[0.02] overflow-hidden">
          <pre className="px-3.5 py-3 text-[11px] leading-relaxed font-mono text-foreground/65 overflow-x-auto scrollbar-invisible">
            <code>X-API-Key: sk-coasty-live-your_key_here</code>
          </pre>
        </div>
      </ReferenceSection>

      {/* ── Quick start ── */}
      <ReferenceSection title="Quick start" eyebrow="Step 2">
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <div className="flex items-center gap-0.5 sm:gap-1 overflow-x-auto scrollbar-invisible">
            {SNIPPET_LANGS.map(l => (
              <button
                key={l.id}
                onClick={() => setLang(l.id)}
                className={cn(
                  "px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg text-[10.5px] sm:text-[11px] font-medium transition-colors duration-150 shrink-0",
                  lang === l.id
                    ? "bg-foreground/[0.08] dark:bg-foreground/[0.12] text-foreground"
                    : "text-muted-foreground/45 hover:text-foreground/75 hover:bg-foreground/[0.04]",
                )}
              >
                {l.label}
              </button>
            ))}
          </div>
          <button
            onClick={handleCopy}
            aria-label={copied ? "Snippet copied" : "Copy snippet"}
            className={cn(
              "inline-flex items-center gap-1 h-6 px-1.5 rounded text-[10px] font-medium transition-colors",
              copied ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground/45 hover:text-foreground/75",
            )}
          >
            {copied ? (<><Check className="h-3 w-3" strokeWidth={2.4} /> Copied</>) : (<><Copy className="h-3 w-3" /> Copy</>)}
          </button>
        </div>
        <div className="rounded-lg border border-foreground/[0.06] bg-foreground/[0.02] overflow-hidden">
          <pre className="px-3.5 py-3 text-[11px] leading-relaxed font-mono text-foreground/65 overflow-x-auto scrollbar-invisible max-h-[320px]">
            <code>{getSnippetCode(lang, "sk-coasty-live-...", false)}</code>
          </pre>
        </div>
      </ReferenceSection>

      {/* ── Endpoints + Action types ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ReferenceSection title="Endpoints" eyebrow="Reference">
          <div className="rounded-lg border border-foreground/[0.06] bg-foreground/[0.015] overflow-hidden divide-y divide-foreground/[0.04]">
            {REFERENCE_ENDPOINTS.map(row => (
              <div key={`${row.method} ${row.path}`} className="flex items-center gap-3 px-3.5 py-2.5">
                <span className={cn(
                  "shrink-0 w-14 text-center text-[9.5px] font-bold tracking-wider py-0.5 rounded",
                  methodBadgeClass(row.method),
                )}>
                  {row.method}
                </span>
                <code className="text-[11px] font-mono text-foreground/65 flex-1 truncate">{row.path}</code>
                <span className="text-[10.5px] text-muted-foreground/35 hidden md:block w-32 truncate">{row.desc}</span>
                <span className="text-[10px] font-mono text-muted-foreground/40 w-12 text-right shrink-0 tabular-nums">{row.cost}</span>
              </div>
            ))}
          </div>
        </ReferenceSection>

        <ReferenceSection title="Action types" eyebrow="Reference">
          <div className="rounded-lg border border-foreground/[0.06] bg-foreground/[0.015] overflow-hidden divide-y divide-foreground/[0.04]">
            {REFERENCE_ACTIONS.map(row => (
              <div key={row.type} className="flex items-center gap-3 px-3.5 py-2.5">
                <code className="text-[11px] font-mono font-medium text-foreground/70 w-24 shrink-0">{row.type}</code>
                <span className="text-[11px] text-muted-foreground/45 flex-1 truncate">{row.desc}</span>
              </div>
            ))}
          </div>
        </ReferenceSection>
      </div>

      {/* ── Response shape ── */}
      <ReferenceSection title="Response shape" eyebrow="Reference">
        <p className="text-[12.5px] text-muted-foreground/55 leading-relaxed mb-3">
          Every prediction returns structured actions, a status signal, and token usage.
        </p>
        <div className="rounded-lg border border-foreground/[0.06] bg-foreground/[0.02] overflow-hidden">
          <pre className="px-3.5 py-3 text-[11px] leading-relaxed font-mono text-foreground/65 overflow-x-auto scrollbar-invisible">
            <code>{`{
  "request_id": "req_abc123",
  "actions": [
    { "action_type": "click", "params": { "x": 512, "y": 340 } },
    { "action_type": "type_text", "params": { "text": "hello" } }
  ],
  "reasoning": "I see a search bar at (512, 340)…",
  "status": "continue",
  "usage": {
    "input_tokens": 1523,
    "output_tokens": 245,
    "credits_charged": 5
  }
}`}</code>
          </pre>
        </div>
      </ReferenceSection>

    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   Create-Key Dialog (refined: drops cinematic intro for a clean form
   with Live/Test toggle and scope selection)
   ═══════════════════════════════════════════════════════════════════ */

function CreateKeyDialog({
  open, onOpenChange, onCreate, creating,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (args: { name: string; kind: KeyKind; scopes: string[] }) => void
  creating: boolean
}) {
  const [name, setName] = useState("")
  const [kind, setKind] = useState<KeyKind>("live")
  const [scopes, setScopes] = useState<string[]>(SCOPE_OPTIONS.map(s => s.id))

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setName("")
      setKind("live")
      setScopes(SCOPE_OPTIONS.map(s => s.id))
    }
  }, [open])

  const toggleScope = (id: string) => {
    setScopes(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id])
  }

  const canSubmit = name.trim().length > 0 && scopes.length > 0 && !creating

  const handleSubmit = () => {
    if (!canSubmit) return
    onCreate({ name: name.trim(), kind, scopes })
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-md p-0 gap-0 overflow-hidden">
        <div className="px-5 sm:px-6 pt-5 pb-3 border-b border-foreground/[0.05]">
          <AlertDialogTitle className="text-[15px] font-medium tracking-[-0.005em]">
            Create API key
          </AlertDialogTitle>
          <AlertDialogDescription className="text-[12.5px] text-muted-foreground/55 mt-1">
            Name your key and choose scopes. The secret is shown only once.
          </AlertDialogDescription>
        </div>

        <div className="px-5 sm:px-6 py-4 space-y-4">
          {/* Name */}
          <div>
            <label className="text-[10.5px] font-medium uppercase tracking-[0.16em] text-muted-foreground/50 mb-1.5 block">
              Name
            </label>
            <input
              autoFocus
              type="text"
              placeholder="Production, RPA Bot, Local testing…"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSubmit()}
              className="w-full h-9 px-3 rounded-lg border border-foreground/[0.08] bg-background/60 text-[12.5px] placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:bg-background transition-colors"
            />
          </div>

          {/* Live / Test mode */}
          <div>
            <label className="text-[10.5px] font-medium uppercase tracking-[0.16em] text-muted-foreground/50 mb-1.5 block">
              Mode
            </label>
            <div className="grid grid-cols-2 gap-1.5 p-1 rounded-lg bg-foreground/[0.03] border border-foreground/[0.05]">
              {([
                { id: "live" as const, label: "Live",    hint: "Bills credits"  },
                { id: "test" as const, label: "Test",    hint: "Sandbox · free" },
              ]).map(opt => (
                <button
                  key={opt.id}
                  onClick={() => setKind(opt.id)}
                  className={cn(
                    "flex flex-col items-start gap-0.5 px-3 py-2 rounded-md transition-all text-left",
                    kind === opt.id
                      ? "bg-background shadow-sm border border-foreground/[0.08]"
                      : "border border-transparent text-muted-foreground/55 hover:text-foreground/80",
                  )}
                >
                  <span className="text-[12px] font-medium leading-none">{opt.label}</span>
                  <span className="text-[10px] text-muted-foreground/40 leading-none">{opt.hint}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Scopes */}
          <div>
            <label className="text-[10.5px] font-medium uppercase tracking-[0.16em] text-muted-foreground/50 mb-1.5 block">
              Scopes
            </label>
            <div className="rounded-lg border border-foreground/[0.06] bg-foreground/[0.015] divide-y divide-foreground/[0.04]">
              {SCOPE_OPTIONS.map(s => {
                const checked = scopes.includes(s.id)
                return (
                  <button
                    key={s.id}
                    onClick={() => toggleScope(s.id)}
                    className="w-full flex items-start gap-3 px-3 py-2.5 text-left hover:bg-foreground/[0.02] transition-colors"
                  >
                    <span className={cn(
                      "mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border transition-colors",
                      checked ? "bg-foreground border-foreground" : "border-foreground/30",
                    )}>
                      {checked && <Check className="h-2.5 w-2.5 text-background" strokeWidth={3} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] font-medium text-foreground/85 leading-tight">{s.label}</div>
                      <div className="text-[10.5px] text-muted-foreground/45 mt-0.5 leading-tight">{s.desc}</div>
                    </div>
                  </button>
                )
              })}
            </div>
            {scopes.length === 0 && (
              <p className="text-[10.5px] text-rose-500/70 mt-1.5">Select at least one scope.</p>
            )}
          </div>
        </div>

        <AlertDialogFooter className="px-5 sm:px-6 py-3 border-t border-foreground/[0.05] bg-foreground/[0.012] gap-2">
          <AlertDialogCancel className="text-[12.5px] h-8">Cancel</AlertDialogCancel>
          <Button
            className="text-[12.5px] h-8 gap-1.5"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {creating ? "Creating…" : (
              <>
                <Plus className="h-3.5 w-3.5" />
                Create key
              </>
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   Created-Key Dialog (cleaner; uses CodeSnippetBlock)
   ═══════════════════════════════════════════════════════════════════ */

function CreatedKeyDialog({
  createdKey, onClose, onViewDocs,
}: {
  createdKey: string | null
  onClose: () => void
  onViewDocs: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [revealed, setRevealed] = useState(true)

  // Fixed-length mask (~31 chars) so the hidden state always fits the chip
  // without horizontal scroll — regardless of underlying key length
  // (live: 63, test: 63, legacy cua_sk_: 55).
  const masked = createdKey
    ? `${createdKey.slice(0, 18)}${"•".repeat(8)}${createdKey.slice(-5)}`
    : ""

  const handleCopy = () => {
    if (!createdKey) return
    copyToClipboard(createdKey)
      .then(() => {
        setCopied(true)
        toast.success("Copied to clipboard")
        setTimeout(() => setCopied(false), 1800)
      })
      .catch(() => toast.info("Press Ctrl+C to copy"))
  }

  // Reset reveal state on close
  useEffect(() => {
    if (!createdKey) {
      setRevealed(true)
      setCopied(false)
    }
  }, [createdKey])

  return (
    <AlertDialog open={!!createdKey} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-lg gap-0 p-0 overflow-hidden max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="px-5 sm:px-6 pt-5 pb-3 border-b border-foreground/[0.05]">
          <div className="flex items-center gap-2.5 mb-1">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/10 ring-1 ring-emerald-500/20">
              <Check className="h-3.5 w-3.5 text-emerald-500" strokeWidth={2.4} />
            </span>
            <AlertDialogTitle className="text-[14px] font-medium tracking-[-0.005em]">
              Your API key is ready
            </AlertDialogTitle>
          </div>
          <AlertDialogDescription className="text-[12px] text-muted-foreground/55 ml-[34px]">
            Save it somewhere safe — it won&apos;t be shown again.
          </AlertDialogDescription>
        </div>

        {/* Key reveal + copy.
            The chip itself is `overflow-hidden`; the inner <code> uses
            `overflow-x-auto whitespace-nowrap` so a 63-char revealed key
            scrolls within the chip instead of pushing the dialog wider.
            `min-w-0` is required — otherwise the flex child's intrinsic
            min-width (one unbreakable token = the whole key) wins and the
            chip refuses to shrink. */}
        <div className="px-5 sm:px-6 py-4 space-y-2">
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-foreground/[0.08] bg-foreground/[0.025] overflow-hidden">
            <Key className="h-3.5 w-3.5 text-muted-foreground/45 shrink-0" />
            <code className="flex-1 min-w-0 font-mono text-[11px] sm:text-[12px] text-foreground/80 select-all overflow-x-auto whitespace-nowrap scrollbar-invisible">
              {revealed ? createdKey : masked}
            </code>
            <button
              onClick={() => setRevealed(v => !v)}
              aria-label={revealed ? "Hide key" : "Reveal key"}
              className="shrink-0 text-muted-foreground/45 hover:text-foreground/80 transition-colors p-1"
            >
              {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
          <Button className="w-full gap-2 text-[12.5px] h-9" onClick={handleCopy}>
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy API key"}
          </Button>
        </div>

        {/* Quick start snippet */}
        {createdKey && <CodeSnippetBlock apiKey={createdKey} onCopy={copyToClipboard} />}

        {/* Footer */}
        <div className="border-t border-foreground/[0.05] px-5 sm:px-6 py-3 flex items-center justify-between gap-2">
          <AlertDialogCancel className="text-[12px] h-8">Close</AlertDialogCancel>
          <AlertDialogAction className="gap-1.5 text-[12px] h-8" onClick={onViewDocs}>
            <BookOpen className="h-3.5 w-3.5" />
            View reference
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   Main Content
   ═══════════════════════════════════════════════════════════════════ */

type TabId = "keys" | "usage" | "reference"

const TABS: { id: TabId; label: string; icon: typeof Key }[] = [
  { id: "keys",      label: "API keys",  icon: Key },
  { id: "usage",     label: "Usage",     icon: BarChart3 },
  { id: "reference", label: "Reference", icon: BookOpen },
]

export function DevelopersContent() {
  const tLoader = useTranslations("pageLoaders.developers")
  const [keys, setKeys] = useState<APIKey[]>([])
  const [stats, setStats] = useState<Stats>({
    keyCount: 0, totalRequests: 0, totalCredits: 0,
    requests24h: 0, requests7d: 0, credits7d: 0,
    avgCreditsPerRequest: 0, peakHour: null, balance: 0, tier: "",
  })
  const [byEndpoint, setByEndpoint] = useState<EndpointBreakdown>({})
  const [daily, setDaily]   = useState<DailyPoint[]>([])
  const [recent, setRecent] = useState<RecentRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const [revokeId, setRevokeId] = useState<string | null>(null)
  const [rawKeys, setRawKeys] = useState<Record<string, string>>({})
  const [activeTab, setActiveTab] = useState<TabId>("keys")
  const [keySearch, setKeySearch] = useState("")
  const [keyKindFilter, setKeyKindFilter] = useState<"all" | KeyKind>("all")

  const fetchKeys = useCallback(async () => {
    try {
      const res = await fetchClient("/api/developers")
      if (res.ok) {
        const data = await res.json()
        setKeys(data.keys ?? [])
        setStats(prev => data.stats ?? prev)
        setByEndpoint(data.byEndpoint ?? {})
        setDaily(data.daily ?? [])
        setRecent(data.recent ?? [])
      }
    } catch {
      // silent — empty state covers it
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchKeys() }, [fetchKeys])

  const createKey = async ({ name, kind, scopes }: { name: string; kind: KeyKind; scopes: string[] }) => {
    setCreating(true)
    try {
      const res = await fetchClient("/api/developers", {
        method: "POST",
        body: JSON.stringify({ name, kind, scopes }),
      })
      if (res.ok) {
        const data = await res.json()
        setCreatedKey(data.key)
        setRawKeys(prev => ({ ...prev, [data.key_id]: data.key }))
        setShowCreateDialog(false)
        fetchKeys()
        toast.success(`${kind === "test" ? "Test" : "Live"} key created`)
      } else {
        const err = await res.json().catch(() => ({}))
        toast.error(err?.error?.message ?? "Failed to create key")
      }
    } catch {
      toast.error("Failed to create key")
    } finally {
      setCreating(false)
    }
  }

  const revokeKey = async (id: string) => {
    try {
      const res = await fetchClient(`/api/developers/${id}`, { method: "DELETE" })
      if (res.ok) {
        setKeys(prev => prev.filter(k => k.id !== id))
        setRevokeId(null)
        toast.success("API key revoked")
      } else {
        toast.error("Failed to revoke key")
      }
    } catch {
      toast.error("Failed to revoke key")
    }
  }

  // Filtered keys for the list view
  const filteredKeys = useMemo(() => {
    const q = keySearch.trim().toLowerCase()
    return keys.filter(k => {
      const isTest = k.key_prefix.startsWith("sk-coasty-test-")
      if (keyKindFilter === "live" && isTest) return false
      if (keyKindFilter === "test" && !isTest) return false
      if (q) {
        const hay = `${k.name} ${k.key_prefix}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [keys, keySearch, keyKindFilter])

  const sparkRequests = daily.slice(-7).map(d => d.requests)
  const sparkCredits  = daily.slice(-7).map(d => d.credits)

  return (
    <PageLoader isLoading={loading} title={tLoader("title")} description={tLoader("description")}>
    <div className="h-full overflow-y-auto overflow-x-hidden scrollbar-invisible relative">

      {/* Ambient orbs — match guide / schedules / machines */}
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

        {/* ── Header ── */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: EASE }}
          className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4"
        >
          <div>
            <div className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground/45 mb-1.5">
              Developer platform
            </div>
            <h1 className="text-2xl sm:text-3xl font-medium tracking-tight">API & Integrations</h1>
            <p className="text-muted-foreground text-sm mt-1.5">
              Bring computer-use intelligence into your code. Manage keys, monitor usage, and ship.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href="/guide?tab=api"
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-xl border border-foreground/[0.08] text-[12.5px] font-medium text-muted-foreground/70 hover:text-foreground hover:border-foreground/20 hover:bg-foreground/[0.03] transition-all"
            >
              <BookOpen className="h-3.5 w-3.5" />
              Docs
            </Link>
            <button
              onClick={() => setShowCreateDialog(true)}
              className="inline-flex h-9 items-center justify-center rounded-xl px-4 text-[12.5px] font-medium gap-1.5 transition-all bg-foreground text-background hover:bg-foreground/90 shadow-sm"
            >
              <Plus className="h-3.5 w-3.5" />
              Create key
            </button>
          </div>
        </motion.div>

        {/* ── Stats row ── */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.05, ease: EASE }}
          className="grid grid-cols-2 lg:grid-cols-4 gap-3"
        >
          <StatTile
            label="Balance"
            value={formatNum(stats.balance)}
            suffix="credits"
            hint={stats.tier ? `${stats.tier} plan` : "Shared balance"}
            accent="emerald"
          />
          <StatTile
            label="Requests"
            value={formatNum(stats.totalRequests)}
            suffix="last 30d"
            hint={stats.requests24h > 0 ? `${formatNum(stats.requests24h)} today` : "No requests today"}
            sparkData={sparkRequests}
          />
          <StatTile
            label="Credits used"
            value={formatNum(stats.totalCredits)}
            suffix="last 30d"
            hint={stats.avgCreditsPerRequest > 0 ? `${stats.avgCreditsPerRequest} cr/req avg` : "—"}
            sparkData={sparkCredits}
          />
          <StatTile
            label="Active keys"
            value={String(stats.keyCount)}
            hint={stats.peakHour !== null && stats.totalRequests >= 5
              ? `Peak at ${String(stats.peakHour).padStart(2, "0")}:00`
              : "—"}
          />
        </motion.div>

        {/* ── Tab navigation (matches guide-client glass pattern) ── */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1, ease: EASE }}
          className="rounded-2xl border border-foreground/[0.06] bg-background/60 dark:bg-background/40 backdrop-blur-2xl p-1.5 shadow-sm w-fit"
        >
          <nav className="flex items-center gap-0.5" role="tablist">
            {TABS.map(tab => {
              const Icon = tab.icon
              const isActive = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "relative flex items-center justify-center gap-1.5 rounded-xl px-3 sm:px-3.5 py-1.5 text-[11px] sm:text-[12.5px] font-medium transition-all duration-200",
                    isActive
                      ? "bg-foreground/[0.08] dark:bg-foreground/[0.12] text-foreground"
                      : "text-muted-foreground/55 hover:text-foreground/80 hover:bg-foreground/[0.04]",
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={isActive ? 2.2 : 1.8} />
                  <span className="truncate">{tab.label}</span>
                </button>
              )
            })}
          </nav>
        </motion.div>

        {/* ── Tab content ── */}
        <AnimatePresence mode="wait">

          {/* ════ Keys tab ════ */}
          {activeTab === "keys" && (
            <motion.div
              key="keys"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3, ease: EASE }}
            >
              {keys.length === 0 ? (
                /* ── Empty state — restrained, single CTA ── */
                <div className="relative rounded-2xl border border-foreground/[0.06] bg-foreground/[0.015] dark:bg-foreground/[0.02] overflow-hidden">
                  <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/[0.08] to-transparent" />
                  <div className="pointer-events-none absolute inset-0">
                    <div className="absolute -top-12 right-1/4 h-56 w-56 rounded-full bg-foreground/[0.02] blur-3xl" />
                    <div className="absolute -bottom-12 left-1/4 h-48 w-48 rounded-full bg-foreground/[0.02] blur-3xl" />
                  </div>

                  <div className="relative flex flex-col items-center py-16 px-6 text-center">
                    <div className="relative h-12 w-12 mb-6 flex items-center justify-center">
                      <div className="absolute inset-0 rounded-2xl border border-foreground/[0.08] bg-foreground/[0.03]" />
                      <Key className="relative h-5 w-5 text-foreground/55" strokeWidth={1.6} />
                      <motion.span
                        className="absolute inset-0 rounded-2xl border border-foreground/15"
                        animate={{ opacity: [0, 0.6, 0], scale: [1, 1.18, 1.32] }}
                        transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
                      />
                    </div>

                    <div className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground/45 mb-2">
                      Get started
                    </div>
                    <h3 className="text-[18px] sm:text-[20px] font-medium tracking-tight mb-2">No API keys yet</h3>
                    <p className="text-[13px] text-muted-foreground/60 max-w-sm mb-7 leading-relaxed">
                      Create a key to start sending screenshots and receiving structured automation actions.
                    </p>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setShowCreateDialog(true)}
                        className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-[12.5px] font-medium transition-all text-background bg-foreground hover:bg-foreground/90 shadow-sm"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Create your first key
                      </button>
                      <Link
                        href="/guide?tab=api"
                        className="inline-flex items-center gap-1.5 h-9 px-4 rounded-xl border border-foreground/[0.08] text-[12.5px] font-medium text-muted-foreground/70 hover:text-foreground hover:border-foreground/20 transition-all"
                      >
                        Read the docs
                      </Link>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Search + kind filter toolbar */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="relative flex-1 min-w-[200px] max-w-sm">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/40" />
                      <input
                        type="text"
                        value={keySearch}
                        onChange={e => setKeySearch(e.target.value)}
                        placeholder="Search by name or prefix"
                        className="w-full h-8 pl-8 pr-7 rounded-lg text-[12px] bg-background/60 border border-foreground/[0.08] placeholder:text-muted-foreground/35 text-foreground/85 focus:outline-none focus:border-foreground/20 focus:bg-background transition-colors"
                      />
                      {keySearch && (
                        <button
                          onClick={() => setKeySearch("")}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-foreground transition-colors"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                    <div className="inline-flex items-center rounded-lg border border-foreground/[0.08] bg-background/60 p-0.5">
                      {([
                        { id: "all" as const,  label: "All"  },
                        { id: "live" as const, label: "Live" },
                        { id: "test" as const, label: "Test" },
                      ]).map(opt => (
                        <button
                          key={opt.id}
                          onClick={() => setKeyKindFilter(opt.id)}
                          className={cn(
                            "h-7 px-3 rounded-md text-[11px] font-medium transition-colors",
                            keyKindFilter === opt.id
                              ? "bg-foreground/[0.08] dark:bg-foreground/[0.12] text-foreground"
                              : "text-muted-foreground/55 hover:text-foreground/80",
                          )}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    <div className="ml-auto text-[10.5px] text-muted-foreground/35 tabular-nums">
                      {filteredKeys.length === keys.length
                        ? `${keys.length} key${keys.length !== 1 ? "s" : ""}`
                        : `${filteredKeys.length} of ${keys.length}`}
                    </div>
                  </div>

                  {/* Keys grid */}
                  {filteredKeys.length === 0 ? (
                    <div className="relative rounded-2xl border border-foreground/[0.06] bg-foreground/[0.015] dark:bg-foreground/[0.02] overflow-hidden px-5 py-10 text-center">
                      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/[0.08] to-transparent" />
                      <p className="text-[12px] text-muted-foreground/45">No keys match your filters.</p>
                      <button
                        onClick={() => { setKeySearch(""); setKeyKindFilter("all") }}
                        className="mt-2 text-[11px] font-medium text-foreground/70 hover:text-foreground underline-offset-2 hover:underline"
                      >
                        Clear filters
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <AnimatePresence initial={false}>
                        {filteredKeys.map((k, i) => (
                          <APIKeyCard
                            key={k.id}
                            apiKey={k}
                            index={i}
                            fullKey={rawKeys[k.id]}
                            onRevoke={(id) => setRevokeId(id)}
                          />
                        ))}
                      </AnimatePresence>
                    </div>
                  )}

                  {/* Footnote about test keys */}
                  <div className="flex items-start gap-2 px-1 pt-1">
                    <Shield className="h-3 w-3 text-muted-foreground/30 mt-0.5 shrink-0" />
                    <p className="text-[10.5px] text-muted-foreground/45 leading-relaxed">
                      Test keys (<code className="font-mono text-[10px]">sk-coasty-test-…</code>) return mock responses without billing credits. Use them for local development and CI.
                    </p>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {/* ════ Usage tab ════ */}
          {activeTab === "usage" && (
            <motion.div
              key="usage"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3, ease: EASE }}
              className="space-y-5"
            >
              {/* Activity + endpoint breakdown side-by-side on lg */}
              <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-5">
                <ActivityChart daily={daily} />
                <EndpointBreakdownPanel byEndpoint={byEndpoint} />
              </div>

              {/* Traces */}
              <TracesPanel recent={recent} onRefresh={fetchKeys} />
            </motion.div>
          )}

          {/* ════ Reference tab ════ */}
          {activeTab === "reference" && (
            <motion.div
              key="reference"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3, ease: EASE }}
            >
              <QuickReferenceTab />
            </motion.div>
          )}

        </AnimatePresence>
      </div>

      {/* ── Create dialog ── */}
      <CreateKeyDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onCreate={createKey}
        creating={creating}
      />

      {/* ── Created-key dialog ── */}
      <CreatedKeyDialog
        createdKey={createdKey}
        onClose={() => setCreatedKey(null)}
        onViewDocs={() => { setCreatedKey(null); setActiveTab("reference") }}
      />

      {/* ── Revoke confirm ── */}
      <AlertDialog open={!!revokeId} onOpenChange={(o) => !o && setRevokeId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke API key</AlertDialogTitle>
            <AlertDialogDescription>
              This key will immediately stop working. Any applications using it will fail. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => revokeId && revokeKey(revokeId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
    </PageLoader>
  )
}
