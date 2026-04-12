"use client"

import React, { useEffect, useState, useMemo, useCallback } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { toast } from "sonner"
import { useCredits } from "@/lib/hooks/use-credits"
import { useUser } from "@/lib/user-store/provider"
import {
  ShoppingCart,
  ArrowUp,
  CheckCircle,
  XCircle,
  Spinner,
  CreditCard,
  Receipt,
  Coins,
  TrendUp,
  TrendDown,
  CalendarBlank,
  Lightning,
  ArrowsClockwise,
  Clock,
  ChartLine,
  Funnel,
  Export,
} from "@phosphor-icons/react"
import { cn } from "@/lib/utils"
import {
  Check,
  Zap,
  ArrowRight,
  HardDrive,
  ChevronDown,
  Activity,
  Wallet,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react"
import { CoastyIcon } from "@/components/icons/coasty"
import { motion } from "framer-motion"
import { useTranslations } from "next-intl"

// ─── Plan & Package Data ────────────────────────────────────────────────────

const subscriptionPlans = [
  {
    id: "lite",
    name: "Lite",
    tier: "lite",
    price: 9,
    monthlyCredits: 100,
    machines: 1,
    swarm: 2,
    description: "Light daily automation",
    features: [
      "1 VM (deleted after inactivity)",
      "2 agents in parallel",
      "Basic search",
      "Standard support (real humans)",
    ],
    popular: false,
  },
  {
    id: "starter",
    name: "Starter",
    tier: "starter",
    price: 19,
    monthlyCredits: 200,
    machines: 1,
    swarm: 3,
    description: "Automate tasks every day",
    features: [
      "1 always-on VM",
      "3 agents in parallel",
      "Advanced search & extraction",
      "Standard support (real humans)",
    ],
    popular: false,
  },
  {
    id: "professional",
    name: "Plus",
    tier: "professional",
    price: 50,
    monthlyCredits: 600,
    machines: 2,
    swarm: 6,
    description: "Scale complex workflows",
    features: [
      "2 always-on VMs",
      "6 agents in parallel",
      "Advanced search & extraction",
      "Priority support, 24hr response",
    ],
    popular: true,
  },
  {
    id: "enterprise",
    name: "Pro",
    tier: "enterprise",
    price: 100,
    monthlyCredits: 1500,
    machines: 3,
    swarm: 9,
    description: "Unlimited heavy automation",
    features: [
      "3 always-on VMs",
      "9 agents in parallel",
      "Advanced search & extraction",
      "Premium support, 12hr response",
    ],
    popular: false,
  },
]

const additionalCreditPackages = [
  {
    id: "boost-small",
    name: "Boost",
    credits: 150,
    price: 19,
    description: "Quick top-up",
  },
  {
    id: "boost-medium",
    name: "Power Boost",
    credits: 500,
    price: 49,
    description: "Most popular",
    savings: "23% off",
  },
  {
    id: "boost-large",
    name: "Ultra Boost",
    credits: 1200,
    price: 99,
    description: "Best value",
    savings: "35% off",
  },
]

// ─── Types ──────────────────────────────────────────────────────────────────

interface Transaction {
  id: string
  type: "purchase" | "usage" | "refund" | "bonus" | "subscription" | "subscription_grant" | "subscription_renewal" | "subscription_reactivation"
  amount: number
  balance_after: number
  created_at: string
  usage_description?: string
  price_paid?: number
}

interface UserSubscription {
  id: string
  status: string
  tier?: string
  current_period_end?: string
  cancel_at_period_end: boolean
  created_at?: string
}

type TimeRange = "7d" | "30d" | "90d" | "all"
type TransactionFilter = "all" | "purchase" | "usage" | "refund" | "bonus" | "subscription"

// ─── Helpers ────────────────────────────────────────────────────────────────

function getTimeRangeDate(range: TimeRange): Date | null {
  if (range === "all") return null
  const now = new Date()
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
}

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function formatShortDate(dateString: string) {
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })
}

function formatRelativeDate(dateString: string, t?: (key: string, values?: any) => string) {
  const now = new Date()
  const date = new Date(dateString)
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const diffHr = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHr / 24)

  if (t) {
    if (diffMin < 1) return t("timeAgo.justNow")
    if (diffMin < 60) return t("timeAgo.minutesAgo", { count: diffMin })
    if (diffHr < 24) return t("timeAgo.hoursAgo", { count: diffHr })
    if (diffDay < 7) return t("timeAgo.daysAgo", { count: diffDay })
  } else {
    if (diffMin < 1) return "Just now"
    if (diffMin < 60) return `${diffMin}m ago`
    if (diffHr < 24) return `${diffHr}h ago`
    if (diffDay < 7) return `${diffDay}d ago`
  }
  return formatShortDate(dateString)
}

// ─── Interactive Chart ──────────────────────────────────────────────────────

interface ChartDataPoint {
  date: string
  earned: number
  spent: number
  balance: number
}

function formatAxisValue(value: number): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`
  return value.toLocaleString()
}

function computeNiceTicks(maxVal: number, count: number): number[] {
  if (maxVal <= 0) return [0]
  const rough = maxVal / count
  const mag = Math.pow(10, Math.floor(Math.log10(rough)))
  const residual = rough / mag
  const nice = residual <= 1.5 ? 1 : residual <= 3 ? 2 : residual <= 7 ? 5 : 10
  const step = nice * mag
  const ticks: number[] = []
  for (let v = 0; v <= maxVal + step * 0.01; v += step) {
    ticks.push(Math.round(v))
  }
  return ticks
}

function buildSmoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ")
  let d = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(i + 2, pts.length - 1)]
    const tension = 0.3
    const cp1x = p1.x + (p2.x - p0.x) * tension
    const cp1y = p1.y + (p2.y - p0.y) * tension
    const cp2x = p2.x - (p3.x - p1.x) * tension
    const cp2y = p2.y - (p3.y - p1.y) * tension
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`
  }
  return d
}

const SERIES_CONFIG = [
  { key: "balance" as const, color: "#6198de", label: "Balance", width: 2.5, areaOpacity: [0.22, 0.12, 0.05, 0.01, 0] },
  { key: "earned" as const, color: "#3cb57c", label: "Earned", width: 2, areaOpacity: [0.18, 0.09, 0.035, 0.008, 0] },
  { key: "spent" as const, color: "#d46b5f", label: "Used", width: 2, areaOpacity: [0.18, 0.09, 0.035, 0.008, 0] },
] as const

function UsageChart({
  data,
  height = 260,
  chartView = "area",
}: {
  data: ChartDataPoint[]
  height?: number
  chartView?: "area" | "bar"
}) {
  const t = useTranslations("billing")
  const containerRef = React.useRef<HTMLDivElement>(null)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null)
  const [visibleSeries, setVisibleSeries] = useState<Set<string>>(new Set(["balance", "earned", "spent"]))

  // Zoom & pan state
  const [zoom, setZoom] = useState(1)
  const [panOffset, setPanOffset] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const dragStart = React.useRef<{ x: number; offset: number } | null>(null)

  // Reset zoom/pan when data or view changes
  React.useEffect(() => { setZoom(1); setPanOffset(0) }, [data.length, chartView])

  const toggleSeries = (key: string) => {
    setVisibleSeries((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        if (next.size > 1) next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-muted-foreground/30 gap-2" style={{ height }}>
        <ChartLine className="h-8 w-8" weight="thin" />
        <span className="text-xs">{t("noActivity")}</span>
      </div>
    )
  }

  const vbW = 640
  const vbH = height
  const padding = { top: 24, right: 20, bottom: 36, left: 54 }
  const chartH = vbH - padding.top - padding.bottom
  const chartW = vbW - padding.left - padding.right

  // Apply zoom & pan — compute visible data window
  const totalPoints = data.length
  const visibleCount = Math.max(3, Math.ceil(totalPoints / zoom))
  const maxPan = Math.max(0, totalPoints - visibleCount)
  const clampedPan = Math.max(0, Math.min(maxPan, panOffset))
  const startIdx = Math.floor(clampedPan)
  const endIdx = Math.min(totalPoints, startIdx + visibleCount)
  const visibleData = data.slice(startIdx, endIdx)

  // Mouse handlers
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY < 0 ? 1.15 : 0.87
    const newZoom = Math.max(1, Math.min(totalPoints / 3, zoom * delta))
    // Zoom toward mouse position
    const rect = containerRef.current?.getBoundingClientRect()
    if (rect) {
      const mouseRatio = (e.clientX - rect.left) / rect.width
      const newVisibleCount = Math.max(3, Math.ceil(totalPoints / newZoom))
      const oldVisibleCount = Math.max(3, Math.ceil(totalPoints / zoom))
      const pointsDelta = oldVisibleCount - newVisibleCount
      const newPan = clampedPan + pointsDelta * mouseRatio
      setPanOffset(newPan)
    }
    setZoom(newZoom)
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    setIsDragging(true)
    dragStart.current = { x: e.clientX, offset: clampedPan }
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return

    // Update mouse position for crosshair
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    setMousePos({ x, y })

    // Find nearest data point
    const chartLeft = (padding.left / vbW) * rect.width
    const chartRight = ((vbW - padding.right) / vbW) * rect.width
    const relX = (x - chartLeft) / (chartRight - chartLeft)
    const idx = Math.round(relX * (visibleData.length - 1))
    setHoveredIndex(Math.max(0, Math.min(visibleData.length - 1, idx)))

    // Drag to pan
    if (isDragging && dragStart.current) {
      const dx = e.clientX - dragStart.current.x
      const pxPerPoint = rect.width / visibleCount
      const pointsDelta = -dx / pxPerPoint
      setPanOffset(dragStart.current.offset + pointsDelta)
    }
  }

  const handleMouseUp = () => {
    setIsDragging(false)
    dragStart.current = null
  }

  const handleMouseLeave = () => {
    setHoveredIndex(null)
    setMousePos(null)
    setIsDragging(false)
    dragStart.current = null
  }

  // Compute max for visible data
  const getVal = (d: ChartDataPoint, key: string) =>
    key === "balance" ? d.balance : key === "earned" ? d.earned : d.spent

  const visibleMax = Math.max(
    ...visibleData.flatMap((d) =>
      SERIES_CONFIG.filter((s) => visibleSeries.has(s.key)).map((s) => getVal(d, s.key))
    ),
    1,
  )

  const renderContent = () => {
    const ticks = computeNiceTicks(visibleMax, 4)
    const rawAxisMax = ticks[ticks.length - 1] || visibleMax
    const axisMax = chartView === "area" && rawAxisMax <= visibleMax ? rawAxisMax * 1.1 : rawAxisMax

    const baselineY = padding.top + chartH

    // Y-axis
    const yAxis = ticks.map((tick) => {
      const y = padding.top + chartH - (tick / axisMax) * chartH
      return (
        <g key={tick}>
          <line x1={padding.left} x2={vbW - padding.right} y1={y} y2={y} stroke="currentColor" strokeOpacity={tick === 0 ? 0.15 : 0.06} strokeWidth={0.5} />
          <text x={padding.left - 10} y={y + 3.5} textAnchor="end" fontSize={9.5} fill="currentColor" fillOpacity={0.4} fontFamily="system-ui, -apple-system, sans-serif" fontWeight={400}>
            {formatAxisValue(tick)}
          </text>
        </g>
      )
    })

    // X-axis
    const xStep = Math.max(1, Math.ceil(visibleData.length / 8))
    const xAxis = visibleData.map((d, i) => {
      if (i % xStep !== 0 && i !== visibleData.length - 1) return null
      const x = chartView === "bar"
        ? padding.left + (i + 0.5) * (chartW / visibleData.length)
        : padding.left + (i / Math.max(visibleData.length - 1, 1)) * chartW
      return (
        <text key={i} x={x} y={vbH - 8} textAnchor="middle" fontSize={9} fill="currentColor" fillOpacity={0.4} fontFamily="system-ui, -apple-system, sans-serif" fontWeight={400}>
          {formatShortDate(d.date)}
        </text>
      )
    })

    if (chartView === "bar") {
      const barGroupWidth = chartW / visibleData.length
      const barW = Math.min(barGroupWidth * 0.28, 16)
      const gap = Math.max(barW * 0.25, 2)

      return (
        <svg viewBox={`0 0 ${vbW} ${vbH}`} preserveAspectRatio="xMidYMid meet" className="w-full h-full">
          <defs>
            <linearGradient id="barEarnedGrad" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor="#3cb57c" stopOpacity={0.4} />
              <stop offset="100%" stopColor="#3cb57c" stopOpacity={0.75} />
            </linearGradient>
            <linearGradient id="barSpentGrad" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor="#d46b5f" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#d46b5f" stopOpacity={0.6} />
            </linearGradient>
          </defs>
          {yAxis}
          {visibleData.map((d, i) => {
            const cx = padding.left + (i + 0.5) * barGroupWidth
            const earnedH = visibleSeries.has("earned") ? (d.earned / axisMax) * chartH : 0
            const spentH = visibleSeries.has("spent") ? (d.spent / axisMax) * chartH : 0
            const isHovered = hoveredIndex === i
            return (
              <g key={i}>
                <rect x={cx - barGroupWidth / 2} y={padding.top} width={barGroupWidth} height={chartH} fill="transparent" />
                {isHovered && <rect x={cx - barGroupWidth / 2} y={padding.top} width={barGroupWidth} height={chartH} fill="currentColor" fillOpacity={0.03} rx={4} />}
                {visibleSeries.has("earned") && (
                  <rect x={cx - gap / 2 - barW} y={padding.top + chartH - earnedH} width={barW} height={Math.max(earnedH, 0)} rx={barW / 3} fill="url(#barEarnedGrad)" fillOpacity={isHovered ? 1 : 0.85} className="transition-all duration-150" />
                )}
                {visibleSeries.has("spent") && (
                  <rect x={cx + gap / 2} y={padding.top + chartH - spentH} width={barW} height={Math.max(spentH, 0)} rx={barW / 3} fill="url(#barSpentGrad)" fillOpacity={isHovered ? 1 : 0.8} className="transition-all duration-150" />
                )}
              </g>
            )
          })}
          {/* Crosshair */}
          {hoveredIndex !== null && (
            <line
              x1={padding.left + (hoveredIndex + 0.5) * barGroupWidth}
              x2={padding.left + (hoveredIndex + 0.5) * barGroupWidth}
              y1={padding.top} y2={baselineY}
              stroke="currentColor" strokeOpacity={0.08} strokeWidth={1} strokeDasharray="4 3"
            />
          )}
          {xAxis}
        </svg>
      )
    }

    // Area chart
    const activeSeries = SERIES_CONFIG.filter((s) => visibleSeries.has(s.key)).map((cfg) => ({
      ...cfg,
      points: visibleData.map((d, i) => ({
        x: padding.left + (i / Math.max(visibleData.length - 1, 1)) * chartW,
        y: padding.top + chartH - (getVal(d, cfg.key) / axisMax) * chartH,
      })),
    }))

    return (
      <svg viewBox={`0 0 ${vbW} ${vbH}`} preserveAspectRatio="xMidYMid meet" className="w-full h-full">
        <defs>
          {activeSeries.map((s) => {
            const minY = Math.min(...s.points.map((p) => p.y))
            return (
              <React.Fragment key={s.key}>
                <linearGradient id={`areaGrad-${s.key}`} gradientUnits="userSpaceOnUse" x1="0" y1={minY} x2="0" y2={baselineY}>
                  <stop offset="0%" stopColor={s.color} stopOpacity={s.areaOpacity[0]} />
                  <stop offset="25%" stopColor={s.color} stopOpacity={s.areaOpacity[1]} />
                  <stop offset="55%" stopColor={s.color} stopOpacity={s.areaOpacity[2]} />
                  <stop offset="80%" stopColor={s.color} stopOpacity={s.areaOpacity[3]} />
                  <stop offset="100%" stopColor={s.color} stopOpacity={s.areaOpacity[4]} />
                </linearGradient>
              </React.Fragment>
            )
          })}
          <filter id="glow"><feGaussianBlur stdDeviation="2.5" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>

        {yAxis}

        {activeSeries.map((s) => {
          const line = buildSmoothPath(s.points)
          const last = s.points[s.points.length - 1]
          const first = s.points[0]
          const area = `${line} L ${last.x} ${baselineY} L ${first.x} ${baselineY} Z`
          return (
            <g key={s.key} className="transition-opacity duration-300">
              <path d={area} fill={`url(#areaGrad-${s.key})`} />
              <path d={line} fill="none" stroke={s.color} strokeWidth={s.width + 3} strokeLinecap="round" strokeLinejoin="round" strokeOpacity={0.06} filter="url(#glow)" />
              <path d={line} fill="none" stroke={s.color} strokeWidth={s.width} strokeLinecap="round" strokeLinejoin="round" />
            </g>
          )
        })}

        {/* Crosshair + dots */}
        {hoveredIndex !== null && hoveredIndex < visibleData.length && (
          <g>
            <line
              x1={padding.left + (hoveredIndex / Math.max(visibleData.length - 1, 1)) * chartW}
              x2={padding.left + (hoveredIndex / Math.max(visibleData.length - 1, 1)) * chartW}
              y1={padding.top} y2={baselineY}
              stroke="currentColor" strokeOpacity={0.08} strokeWidth={1} strokeDasharray="4 3"
            />
            {/* Horizontal crosshair at nearest balance point */}
            {activeSeries.map((s) => (
              <React.Fragment key={s.key}>
                <circle cx={s.points[hoveredIndex].x} cy={s.points[hoveredIndex].y} r={7} fill={s.color} fillOpacity={0.08} />
                <circle cx={s.points[hoveredIndex].x} cy={s.points[hoveredIndex].y} r={4} fill={s.color} fillOpacity={0.9} stroke="var(--background)" strokeWidth={2} />
              </React.Fragment>
            ))}
          </g>
        )}

        {/* Invisible hover rects */}
        {visibleData.map((_, i) => {
          const x = padding.left + (i / Math.max(visibleData.length - 1, 1)) * chartW
          return (
            <rect key={i} x={x - chartW / visibleData.length / 2} y={padding.top} width={chartW / visibleData.length} height={chartH} fill="transparent" />
          )
        })}

        {xAxis}
      </svg>
    )
  }

  // Tooltip
  const renderTooltip = () => {
    if (hoveredIndex === null || !visibleData[hoveredIndex] || isDragging) return null
    const d = visibleData[hoveredIndex]
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect || !mousePos) return null

    // Position tooltip — flip if near edge
    const tooltipW = 160
    const leftPx = mousePos.x
    const flipLeft = leftPx + tooltipW + 16 > rect.width

    return (
      <div
        className="absolute z-30 pointer-events-none animate-in fade-in-0 zoom-in-95 duration-100"
        style={{
          left: flipLeft ? leftPx - tooltipW - 12 : leftPx + 12,
          top: Math.max(8, mousePos.y - 40),
        }}
      >
        <div className="bg-popover/95 backdrop-blur-xl border border-border/30 rounded-xl shadow-2xl shadow-black/10 px-3.5 py-2.5 text-xs space-y-1.5 min-w-[150px]">
          <div className="font-medium text-foreground/60 text-[10px] uppercase tracking-wider pb-0.5 border-b border-border/20">
            {formatShortDate(d.date)}
          </div>
          {SERIES_CONFIG.filter((s) => visibleSeries.has(s.key)).map((s) => {
            const val = getVal(d, s.key)
            const prefix = s.key === "earned" ? "+" : s.key === "spent" ? "-" : ""
            return (
              <div key={s.key} className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
                  <span className="text-muted-foreground/70">{s.label}</span>
                </div>
                <span className="font-semibold text-foreground tabular-nums">{prefix}{val.toLocaleString()}</span>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {/* Interactive legend — click to toggle series */}
      <div className="flex items-center gap-1 px-3">
        {SERIES_CONFIG.map((s) => {
          const active = visibleSeries.has(s.key)
          return (
            <button
              key={s.key}
              onClick={() => toggleSeries(s.key)}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium transition-all duration-150",
                active
                  ? "bg-muted/40 text-foreground/70"
                  : "text-muted-foreground/30 hover:text-muted-foreground/50"
              )}
            >
              <span
                className={cn("h-2 w-2 rounded-full transition-opacity duration-150", !active && "opacity-30")}
                style={{ backgroundColor: s.color }}
              />
              {s.label}
            </button>
          )
        })}
        {zoom > 1.05 && (
          <button
            onClick={() => { setZoom(1); setPanOffset(0) }}
            className="ml-auto text-[10px] text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors px-2 py-1"
          >
            Reset zoom
          </button>
        )}
      </div>

      {/* Chart */}
      <div
        ref={containerRef}
        className={cn("relative select-none", isDragging ? "cursor-grabbing" : "cursor-crosshair")}
        style={{ height }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      >
        {renderContent()}
        {renderTooltip()}

        {/* Zoom indicator */}
        {zoom > 1.05 && (
          <div className="absolute top-2 right-3 text-[9px] text-muted-foreground/30 font-medium tabular-nums">
            {zoom.toFixed(1)}x · {visibleData.length} pts
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Stat Card ──────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  subtext,
  icon: Icon,
  trend,
  trendLabel,
  accent = "default",
}: {
  label: string
  value: string
  subtext?: string
  icon: React.ComponentType<any>
  trend?: "up" | "down" | "neutral"
  trendLabel?: string
  accent?: "default" | "green" | "red" | "blue" | "purple"
}) {
  return (
    <div className="rounded-xl border border-border/40 bg-card/30 p-4 flex flex-col min-h-[120px]">
      <div className="flex items-center justify-between mb-auto">
        <span className="text-[11px] font-medium text-muted-foreground/50 uppercase tracking-wider">
          {label}
        </span>
        <div className="h-7 w-7 rounded-lg flex items-center justify-center bg-foreground/[0.04]">
          <Icon className="h-3.5 w-3.5 text-foreground/40" />
        </div>
      </div>
      <div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-[22px] font-bold tracking-tight text-foreground leading-none">
            {value}
          </span>
          {subtext && (
            <span className="text-[11px] text-muted-foreground/50 leading-none">{subtext}</span>
          )}
        </div>
        <div className="h-4 mt-1.5">
          {trend && trendLabel ? (
            <div className="flex items-center gap-1">
              {trend === "up" ? (
                <ArrowUpRight className="h-3 w-3 text-foreground/40" />
              ) : trend === "down" ? (
                <ArrowDownRight className="h-3 w-3 text-foreground/40" />
              ) : (
                <Activity className="h-3 w-3 text-muted-foreground/40" />
              )}
              <span className="text-[10px] leading-none text-muted-foreground/50">
                {trendLabel}
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

// ─── Transaction Row ────────────────────────────────────────────────────────

// ─── Transaction Grouping ──────────────────────────────────────────────────

// Extract session/machine UUID from usage_description like "Step 91: 1 min on <uuid>" or "Final charge: 3 min on <uuid>"
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

function extractSessionId(desc?: string): string | null {
  if (!desc) return null
  const match = desc.match(UUID_RE)
  return match ? match[0] : null
}

interface TransactionGroup {
  id: string
  type: "session" | "standalone"
  label: string
  icon: React.ElementType
  totalAmount: number
  totalDuration: number // minutes
  balanceAfter: number
  pricePaid?: number
  sessionId?: string
  firstDate: string
  lastDate: string
  transactions: Transaction[]
}

function groupTransactions(transactions: Transaction[]): TransactionGroup[] {
  const groups: TransactionGroup[] = []
  const sessionMap = new Map<string, Transaction[]>()
  const standaloneQueue: Transaction[] = []

  // First pass: bucket usage transactions by session UUID, everything else standalone
  for (const tx of transactions) {
    if (tx.type === "usage") {
      const sid = extractSessionId(tx.usage_description)
      if (sid) {
        if (!sessionMap.has(sid)) sessionMap.set(sid, [])
        sessionMap.get(sid)!.push(tx)
        continue
      }
    }
    standaloneQueue.push(tx)
  }

  // Build session groups (sorted by newest transaction in group)
  for (const [sid, txs] of sessionMap) {
    // txs are already sorted newest-first from the API
    const totalAmount = txs.reduce((s, t) => s + t.amount, 0)
    // Sum duration from all steps: "Final charge: 3 min" + "Step X: 1 min" etc.
    let totalMinutes = 0
    for (const t of txs) {
      const m = t.usage_description?.match(/(\d+)\s*min/)
      if (m) totalMinutes += parseInt(m[1], 10)
    }

    groups.push({
      id: `session-${sid}`,
      type: "session",
      label: "Agent Session",
      icon: Activity,
      totalAmount,
      totalDuration: totalMinutes,
      balanceAfter: txs[0].balance_after, // newest tx has latest balance
      sessionId: sid,
      firstDate: txs[txs.length - 1].created_at,
      lastDate: txs[0].created_at,
      transactions: txs,
    })
  }

  // Build standalone groups
  for (const tx of standaloneQueue) {
    // Parse duration for standalone usage without session id
    let dur = 0
    if (tx.type === "usage") {
      const m = tx.usage_description?.match(/(\d+)\s*min/)
      if (m) dur = parseInt(m[1], 10)
    }

    groups.push({
      id: `tx-${tx.id}`,
      type: "standalone",
      label: tx.type, // will be resolved to display label in component
      icon: Coins,
      totalAmount: tx.amount,
      totalDuration: dur,
      balanceAfter: tx.balance_after,
      pricePaid: tx.price_paid,
      sessionId: undefined,
      firstDate: tx.created_at,
      lastDate: tx.created_at,
      transactions: [tx],
    })
  }

  // Sort all groups by most recent transaction date (newest first)
  groups.sort((a, b) => new Date(b.lastDate).getTime() - new Date(a.lastDate).getTime())

  return groups
}

// ─── Transaction Row (for expanded session detail) ──────────────────────────

function TransactionDetailRow({ transaction, isLast }: { transaction: Transaction; isLast: boolean }) {
  const t = useTranslations("billing")
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-4 py-2 text-[12px]",
        !isLast && "border-b border-border/20"
      )}
    >
      <div className="flex-1 min-w-0">
        <span className="text-muted-foreground/60 truncate">
          {transaction.usage_description || transaction.type}
        </span>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className="text-muted-foreground/40 tabular-nums text-[11px]">
          {formatRelativeDate(transaction.created_at, t)}
        </span>
        <span className={cn(
          "tabular-nums font-medium w-14 text-right",
          transaction.amount > 0 ? "text-foreground/70" : "text-muted-foreground/60"
        )}>
          {transaction.amount > 0 ? "+" : ""}{transaction.amount.toLocaleString()}
        </span>
      </div>
    </div>
  )
}

// ─── Transaction Group Row ─────────────────────────────────────────────────

const typeConfigMap: Record<string, { icon: React.ComponentType<any>; labelKey: string }> = {
  purchase: { icon: ShoppingCart, labelKey: "transactionTypes.credit_purchase" },
  usage: { icon: Activity, labelKey: "transactionTypes.agent_usage" },
  refund: { icon: ArrowDownRight, labelKey: "transactionTypes.refund" },
  bonus: { icon: Lightning, labelKey: "transactionTypes.bonus" },
  subscription: { icon: CreditCard, labelKey: "transactionTypes.subscription" },
  subscription_grant: { icon: Zap, labelKey: "transactionTypes.subscription_grant" },
  subscription_renewal: { icon: Clock, labelKey: "transactionTypes.renewal" },
  subscription_reactivation: { icon: CheckCircle, labelKey: "transactionTypes.reactivation" },
}

function TransactionGroupRow({ group, isLast }: { group: TransactionGroup; isLast: boolean }) {
  const t = useTranslations("billing")
  const [expanded, setExpanded] = useState(false)
  const isSession = group.type === "session"
  const txCount = group.transactions.length
  const isPositive = group.totalAmount > 0

  // Resolve icon and label
  let Icon: React.ComponentType<any>
  let label: string
  if (isSession) {
    Icon = Activity
    label = t("transactionTypes.agent_usage")
  } else {
    const txType = group.transactions[0].type
    const cfg = typeConfigMap[txType]
    Icon = cfg?.icon || Coins
    label = cfg ? t(cfg.labelKey) : txType
  }

  // Subtitle info
  const subtitle = isSession
    ? `${group.totalDuration > 0 ? `${group.totalDuration} min` : `${txCount} step${txCount !== 1 ? "s" : ""}`}${group.sessionId ? ` · ${group.sessionId.slice(0, 8)}` : ""}`
    : group.transactions[0].usage_description || undefined

  return (
    <div className={cn(!isLast && "border-b border-border/30")}>
      {/* Group header */}
      <div
        className={cn(
          "flex items-center gap-3 px-4 py-3 transition-colors",
          isSession && txCount > 1 ? "cursor-pointer hover:bg-muted/20" : "hover:bg-muted/20"
        )}
        onClick={isSession && txCount > 1 ? () => setExpanded(!expanded) : undefined}
      >
        <div className={cn(
          "flex h-8 w-8 items-center justify-center rounded-lg shrink-0",
          isPositive ? "bg-emerald-500/10" : "bg-muted/50"
        )}>
          <Icon className={cn("h-3.5 w-3.5", isPositive ? "text-emerald-500/70" : "text-foreground/40")} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground truncate">
              {label}
            </span>
            {isSession && txCount > 1 && (
              <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4 shrink-0">
                {txCount} steps
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[11px] text-muted-foreground/50">
              {formatRelativeDate(group.lastDate, t)}
            </span>
            {subtitle && (
              <>
                <span className="text-muted-foreground/20">·</span>
                <span className="text-[11px] text-muted-foreground/50 truncate">
                  {subtitle}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="text-right">
            <div
              className={cn(
                "text-sm font-semibold tabular-nums",
                isPositive ? "text-foreground" : "text-muted-foreground"
              )}
            >
              {isPositive ? "+" : ""}
              {group.totalAmount.toLocaleString()}
            </div>
            {group.pricePaid ? (
              <div className="text-[11px] text-muted-foreground/40 tabular-nums">
                ${group.pricePaid}
              </div>
            ) : (
              <div className="text-[11px] text-muted-foreground/30 tabular-nums">
                bal {group.balanceAfter?.toLocaleString()}
              </div>
            )}
          </div>
          {isSession && txCount > 1 && (
            <ChevronDown className={cn(
              "h-3.5 w-3.5 text-muted-foreground/30 transition-transform duration-200",
              expanded && "rotate-180"
            )} />
          )}
        </div>
      </div>

      {/* Expanded detail rows */}
      {expanded && isSession && txCount > 1 && (
        <div className="bg-muted/[0.04] border-t border-border/20">
          {group.transactions.map((tx, i) => (
            <TransactionDetailRow
              key={tx.id}
              transaction={tx}
              isLast={i === group.transactions.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function BillingSection() {
  const t = useTranslations("billing")
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user } = useUser()
  const { credits, loading: creditsLoading, refetch: refetchCredits } = useCredits()
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loadingTransactions, setLoadingTransactions] = useState(true)
  const [purchasingPackage, setPurchasingPackage] = useState<string | null>(null)
  const [subscription, setSubscription] = useState<UserSubscription | null>(null)
  const [loadingSubscription, setLoadingSubscription] = useState(true)
  const [subscribingPlan, setSubscribingPlan] = useState<string | null>(null)
  const [selectedPlan, setSelectedPlan] = useState(2)

  // Chart & filter state
  const [timeRange, setTimeRange] = useState<TimeRange>("30d")
  const [typeFilter, setTypeFilter] = useState<TransactionFilter>("all")
  const [showAllTransactions, setShowAllTransactions] = useState(false)
  const [chartView, setChartView] = useState<"area" | "bar">("area")

  // Auto-refill state
  const [autoRefill, setAutoRefill] = useState({ enabled: false, package_id: "boost-small", threshold: 50, max_refills_per_day: 5 })
  const [loadingAutoRefill, setLoadingAutoRefill] = useState(true)
  const [savingAutoRefill, setSavingAutoRefill] = useState(false)

  // Fetch subscription status
  useEffect(() => {
    const fetchSubscription = async () => {
      if (!user) return
      try {
        const response = await fetch("/api/subscription/status")
        if (response.ok) {
          const data = await response.json()
          setSubscription(data.subscription)
        }
      } catch (error) {
        console.error("Error fetching subscription:", error)
      } finally {
        setLoadingSubscription(false)
      }
    }
    fetchSubscription()
  }, [user])

  // Fetch auto-refill settings
  useEffect(() => {
    const fetchAutoRefill = async () => {
      if (!user) return
      try {
        const response = await fetch("/api/credits/auto-refill")
        if (response.ok) {
          const data = await response.json()
          setAutoRefill(data)
        }
      } catch (error) {
        console.error("Error fetching auto-refill settings:", error)
      } finally {
        setLoadingAutoRefill(false)
      }
    }
    fetchAutoRefill()
  }, [user])

  const handleAutoRefillSave = async (updates: Partial<typeof autoRefill>) => {
    const previousSettings = { ...autoRefill }
    const newSettings = { ...autoRefill, ...updates }
    setAutoRefill(newSettings)
    setSavingAutoRefill(true)
    try {
      const response = await fetch("/api/credits/auto-refill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newSettings),
      })
      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || "Failed to save")
      }
      toast.success(
        "enabled" in updates
          ? (newSettings.enabled ? "Auto-refill enabled" : "Auto-refill disabled")
          : "Auto-refill updated"
      )
    } catch (error: any) {
      toast.error(error.message || "Failed to save auto-refill settings")
      setAutoRefill(previousSettings)
    } finally {
      setSavingAutoRefill(false)
    }
  }

  // Check for success/cancel from Stripe
  useEffect(() => {
    const success = searchParams.get("payment_success")
    const canceled = searchParams.get("payment_canceled")
    const subscriptionSuccess = searchParams.get("subscription_success")

    if (success === "true") {
      toast.success(t("toasts.paymentSuccess"))
      refetchCredits()
      window.history.replaceState({}, "", window.location.pathname)
    } else if (subscriptionSuccess === "true") {
      toast.success(t("toasts.subscriptionActivated"))
      refetchCredits()
      window.location.reload()
    } else if (canceled === "true") {
      toast.error(t("toasts.paymentCanceled"))
      window.history.replaceState({}, "", window.location.pathname)
    }
  }, [searchParams, refetchCredits])

  // Fetch all transactions (up to 500 for chart)
  useEffect(() => {
    const fetchTransactions = async () => {
      if (!user) return
      try {
        const response = await fetch("/api/credits/history?limit=500")
        if (!response.ok) throw new Error("Failed to fetch transactions")
        const data = await response.json()
        setTransactions(data.transactions)
      } catch (error) {
        console.error("Error fetching transactions:", error)
      } finally {
        setLoadingTransactions(false)
      }
    }
    fetchTransactions()
  }, [user])

  // ─── Computed data ──────────────────────────────────────────────────────

  const filteredTransactions = useMemo(() => {
    let filtered = [...transactions]
    const rangeDate = getTimeRangeDate(timeRange)
    if (rangeDate) {
      filtered = filtered.filter((tx) => new Date(tx.created_at) >= rangeDate)
    }
    if (typeFilter !== "all") {
      filtered = filtered.filter((tx) => {
        if (typeFilter === "subscription") {
          return tx.type.startsWith("subscription")
        }
        return tx.type === typeFilter
      })
    }
    return filtered
  }, [transactions, timeRange, typeFilter])

  const transactionGroups = useMemo(
    () => groupTransactions(filteredTransactions),
    [filteredTransactions]
  )

  const chartData = useMemo<ChartDataPoint[]>(() => {
    const rangeDate = getTimeRangeDate(timeRange)
    const relevant = rangeDate
      ? transactions.filter((tx) => new Date(tx.created_at) >= rangeDate)
      : transactions

    if (relevant.length === 0) return []

    // Group by day
    const dayMap = new Map<string, { earned: number; spent: number; balance: number }>()
    // Sort ascending for balance tracking
    const sorted = [...relevant].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    )

    for (const tx of sorted) {
      const day = new Date(tx.created_at).toISOString().split("T")[0]
      const existing = dayMap.get(day) || { earned: 0, spent: 0, balance: 0 }
      if (tx.amount > 0) {
        existing.earned += tx.amount
      } else {
        existing.spent += Math.abs(tx.amount)
      }
      existing.balance = tx.balance_after
      dayMap.set(day, existing)
    }

    // Fill gaps for smoother chart
    const days = Array.from(dayMap.keys()).sort()
    if (days.length === 0) return []

    const result: ChartDataPoint[] = []
    const start = new Date(days[0])
    const end = new Date(days[days.length - 1])
    let lastBalance = dayMap.get(days[0])?.balance || 0

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().split("T")[0]
      const entry = dayMap.get(key)
      if (entry) {
        lastBalance = entry.balance
        result.push({ date: key, ...entry })
      } else {
        result.push({ date: key, earned: 0, spent: 0, balance: lastBalance })
      }
    }

    return result
  }, [transactions, timeRange])

  const stats = useMemo(() => {
    const rangeDate = getTimeRangeDate(timeRange)
    const relevant = rangeDate
      ? transactions.filter((tx) => new Date(tx.created_at) >= rangeDate)
      : transactions

    const totalEarned = relevant.filter((tx) => tx.amount > 0).reduce((sum, tx) => sum + tx.amount, 0)
    const totalSpent = relevant.filter((tx) => tx.amount < 0).reduce((sum, tx) => sum + Math.abs(tx.amount), 0)
    const netChange = totalEarned - totalSpent
    const avgDailyUsage =
      relevant.length > 0
        ? totalSpent / Math.max(chartData.length, 1)
        : 0

    // Estimate days remaining at current rate
    const currentBalance = credits?.balance || 0
    const daysRemaining = avgDailyUsage > 0 ? Math.floor(currentBalance / avgDailyUsage) : null

    // Usage sessions count
    const usageSessions = relevant.filter((tx) => tx.type === "usage").length

    return { totalEarned, totalSpent, netChange, avgDailyUsage, daysRemaining, usageSessions }
  }, [transactions, timeRange, chartData, credits])

  // Subscription plan info
  const activePlan = subscription
    ? subscriptionPlans.find((p) => p.tier === subscription.tier)
    : null

  const creditUsagePercent = activePlan
    ? Math.min(
        100,
        ((activePlan.monthlyCredits - (credits?.balance || 0)) / activePlan.monthlyCredits) * 100
      )
    : 0

  // ─── Actions ────────────────────────────────────────────────────────────

  const handleSubscribe = async (planId: string, tier: string, price: number) => {
    if (!user) {
      toast.error(t("toasts.signInToSubscribe"))
      return
    }
    try {
      setSubscribingPlan(planId)
      const response = await fetch("/api/subscription/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, tier, price }),
      })
      if (!response.ok) throw new Error("Failed to create subscription checkout")
      const { url } = await response.json()
      if (url) window.location.href = url
    } catch (error) {
      console.error("Error creating subscription checkout:", error)
      toast.error(t("toasts.subscriptionCheckoutFailed"))
    } finally {
      setSubscribingPlan(null)
    }
  }

  const handlePurchaseCredits = async (packageId: string, credits: number, price: number) => {
    if (!user) {
      toast.error(t("toasts.signInToPurchase"))
      return
    }
    if (!subscription || subscription.status !== "active") {
      toast.error(t("toasts.needSubscription"))
      return
    }
    try {
      setPurchasingPackage(packageId)
      const response = await fetch("/api/credits/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packageId, credits, price }),
      })
      if (!response.ok) throw new Error("Failed to create checkout session")
      const { url } = await response.json()
      if (url) window.location.href = url
    } catch (error) {
      console.error("Error creating checkout session:", error)
      toast.error(t("toasts.checkoutFailed"))
    } finally {
      setPurchasingPackage(null)
    }
  }

  const handleManageSubscription = async () => {
    try {
      const response = await fetch("/api/subscription/portal", { method: "POST" })
      if (!response.ok) throw new Error("Failed to create portal session")
      const { url } = await response.json()
      if (url) window.location.href = url
    } catch (error) {
      console.error("Error creating portal session:", error)
      toast.error(t("toasts.manageFailed"))
    }
  }

  const handleExportCSV = useCallback(() => {
    if (filteredTransactions.length === 0) return
    const headers = "Date,Type,Amount,Balance After,Description,Price Paid"
    const rows = filteredTransactions.map((tx) =>
      [
        new Date(tx.created_at).toISOString(),
        tx.type,
        tx.amount,
        tx.balance_after,
        `"${(tx.usage_description || "").replace(/"/g, '""')}"`,
        tx.price_paid || "",
      ].join(",")
    )
    const csv = [headers, ...rows].join("\n")
    const blob = new Blob([csv], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `coasty-transactions-${timeRange}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(t("toasts.transactionsExported"))
  }, [filteredTransactions, timeRange, t])

  const plan = subscriptionPlans[selectedPlan]

  // ─── Animation helpers ──────────────────────────────────────────────────

  const fadeUp = (delay: number) => ({
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.4, delay, ease: [0.22, 1, 0.36, 1] as const },
  })

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="space-y-8">

      {/* ─── Overview Cards ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          <StatCard
            key="balance"
            label={t("stats.balance")}
            value={creditsLoading ? "..." : (credits?.balance || 0).toLocaleString()}
            subtext={t("stats.credits")}
            icon={Wallet}
            accent="purple"
            trend={stats.netChange > 0 ? "up" : stats.netChange < 0 ? "down" : "neutral"}
            trendLabel={stats.daysRemaining !== null ? `~${stats.daysRemaining}d at current rate` : undefined}
          />,
          <StatCard
            key="earned"
            label={t("stats.earned")}
            value={`+${stats.totalEarned.toLocaleString()}`}
            subtext={timeRange === "all" ? t("stats.allTime") : t("stats.lastRange", { range: timeRange.replace("d", " days") })}
            icon={TrendUp}
            accent="green"
          />,
          <StatCard
            key="used"
            label={t("stats.used")}
            value={stats.totalSpent.toLocaleString()}
            subtext={t("stats.sessions", { count: stats.usageSessions })}
            icon={Activity}
            accent="red"
            trend={stats.avgDailyUsage > 0 ? "neutral" : undefined}
            trendLabel={stats.avgDailyUsage > 0 ? t("stats.avgDaily", { count: Math.round(stats.avgDailyUsage) }) : undefined}
          />,
          <StatCard
            key="plan"
            label={t("stats.plan")}
            value={activePlan?.name || t("stats.free")}
            subtext={activePlan ? `$${activePlan.price}/mo` : t("stats.noPlan")}
            icon={CoastyIcon}
            accent="blue"
            trend={subscription?.cancel_at_period_end ? "down" : undefined}
            trendLabel={subscription?.cancel_at_period_end ? t("stats.canceling") : undefined}
          />,
        ].map((card, i) => (
          <motion.div key={i} {...fadeUp(i * 0.06)}>
            {card}
          </motion.div>
        ))}
      </div>

      {/* Monthly usage progress removed — balance already shown in stats cards */}

      {/* ─── Subscription / Plans / Buy Credits ──────────────────────────── */}
      {!subscription || subscription.status !== "active" ? (
        <motion.div {...fadeUp(0.3)}>
          <h4 className="text-base font-semibold mb-1">{t("choosePlan")}</h4>
          <p className="text-sm text-muted-foreground mb-6">
            {t("choosePlanDescription")}
          </p>

          {/* Plan pills */}
          <div className="flex items-center justify-center gap-2 mb-6 flex-wrap">
            {subscriptionPlans.map((p, i) => (
              <button
                key={p.name}
                onClick={() => setSelectedPlan(i)}
                className={cn(
                  "relative rounded-full text-sm font-medium transition-all duration-200 flex items-center gap-1.5 px-4 py-2.5",
                  selectedPlan === i
                    ? "bg-foreground text-background shadow-sm"
                    : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {p.name}
                <span
                  className={cn(
                    "text-xs font-normal",
                    selectedPlan === i
                      ? "text-background/70"
                      : "text-muted-foreground/60"
                  )}
                >
                  ${p.price}
                </span>
                {p.popular && selectedPlan !== i && (
                  <span className="absolute -top-1.5 -right-1.5 flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-foreground/50 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-foreground/50" />
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Savings pill */}
          {(() => {
            const humanCost =
              plan.price === 9
                ? 1000
                : plan.price === 19
                ? 1500
                : plan.price === 50
                ? 3000
                : 5000
            const moneySaved = (humanCost - plan.price).toLocaleString()
            const timeSaved =
              plan.price === 9
                ? "3-6 hrs"
                : plan.price === 19
                ? "6-12 hrs"
                : plan.price === 50
                ? "18-24 hrs"
                : "24-36 hrs"
            const multiplier =
              plan.price === 9
                ? "111x"
                : plan.price === 19
                ? "79x"
                : plan.price === 50
                ? "60x"
                : "50x"
            return (
              <div className="flex justify-center mb-6">
                <div className="inline-flex items-center gap-3 rounded-full border border-border bg-muted/40 px-4 py-2 flex-wrap justify-center">
                  <span className="text-xs text-muted-foreground">
                    {t("savingsVsHuman", { amount: `$${moneySaved}` })}
                  </span>
                  <span className="h-3 w-px bg-border hidden sm:block" />
                  <span className="text-xs text-muted-foreground">
                    {t("timeSaved", { time: timeSaved })}
                  </span>
                  <span className="h-3 w-px bg-border hidden sm:block" />
                  <span className="text-xs text-muted-foreground">
                    {t("cheaper", { multiplier })}
                  </span>
                </div>
              </div>
            )
          })()}

          {/* Plan card */}
          <div
            className={cn(
              "relative rounded-xl border p-6",
              plan.popular
                ? "border-foreground/15 bg-card/30"
                : "border-border/40"
            )}
          >
            {plan.popular && (
              <div className="absolute -top-2.5 left-4">
                <span className="rounded-full bg-foreground px-2.5 py-0.5 text-[11px] font-medium text-background">
                  {t("plans.plus.badge")}
                </span>
              </div>
            )}

            <div className="flex items-start justify-between mb-5">
              <div>
                <div className="flex items-center gap-2">
                  <CoastyIcon className="h-5 w-5 text-foreground/40" />
                  <h3 className="text-sm font-semibold">
                    {t("coastyPlan", { name: plan.name })}
                  </h3>
                </div>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-4xl font-semibold tracking-tight text-foreground">
                    ${plan.price}
                  </span>
                  <span className="text-sm text-muted-foreground">{t("perMonth")}</span>
                </div>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  {plan.description}
                </p>
              </div>
            </div>

            <div className="mb-3 flex items-center gap-2 rounded-lg bg-muted/50 border border-border/30 px-3 py-2">
              <Zap className="h-3.5 w-3.5 text-foreground/40 flex-shrink-0" />
              <span className="text-sm font-medium text-foreground">
                {t("creditsPerMonth", { count: plan.monthlyCredits.toLocaleString() })}
              </span>
            </div>

            <div className="mb-5 flex items-center gap-2 rounded-lg bg-muted/50 border border-border/30 px-3 py-2">
              <HardDrive className="h-3.5 w-3.5 text-foreground/40 flex-shrink-0" />
              <span className="text-sm font-medium text-foreground">
                {plan.id === "lite"
                  ? t("features.vmDeleted")
                  : plan.machines > 1
                    ? t("features.vmAlwaysOnPlural", { count: plan.machines })
                    : t("features.vmAlwaysOn", { count: plan.machines })}
              </span>
            </div>

            <Button
              className={cn(
                "w-full mb-5",
                !plan.popular && "hover:bg-primary hover:text-primary-foreground"
              )}
              variant={plan.popular ? "default" : "outline"}
              size="sm"
              onClick={() => handleSubscribe(plan.id, plan.tier, plan.price)}
              disabled={subscribingPlan === plan.id}
            >
              {subscribingPlan === plan.id ? (
                <>
                  <Spinner className="mr-2 h-4 w-4 animate-spin" />
                  {t("processing")}
                </>
              ) : (
                <>
                  {t("subscribeTo", { name: plan.name })}
                  <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </>
              )}
            </Button>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {plan.features.map((feature, idx) => (
                <div key={idx} className="flex items-start gap-2">
                  <Check className="h-3.5 w-3.5 text-foreground/40 mt-0.5 flex-shrink-0" />
                  <span className="text-sm text-muted-foreground">{feature}</span>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      ) : (
        <>
          {/* Active Subscription Card */}
          <motion.div {...fadeUp(0.3)} className="rounded-xl border border-border/30 bg-card/20 p-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-muted/50 flex items-center justify-center shrink-0">
                  <CheckCircle className="h-5 w-5 text-foreground/40" />
                </div>
                <div>
                  <h4 className="font-semibold text-foreground">
                    {activePlan?.name || "Active Plan"}
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    ${activePlan?.price || 0}/month
                    {activePlan && (
                      <span className="text-muted-foreground/50">
                        {" · "}{activePlan.monthlyCredits} credits/mo
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleManageSubscription}
                className="hover:bg-primary hover:text-primary-foreground w-full sm:w-auto"
              >
                <CreditCard className="mr-1.5 h-3.5 w-3.5" />
                Manage
              </Button>
            </div>

            <div className="mt-4 pt-3 border-t border-border/20 flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Status</span>
              <div className="flex items-center gap-1.5">
                {subscription.cancel_at_period_end ? (
                  <>
                    <XCircle className="h-3 w-3 text-muted-foreground/50" />
                    <span className="text-muted-foreground">
                      Cancels{" "}
                      {subscription.current_period_end
                        ? new Date(subscription.current_period_end).toLocaleDateString()
                        : "N/A"}
                    </span>
                  </>
                ) : (
                  <>
                    <CheckCircle className="h-3 w-3 text-foreground/50" />
                    <span className="text-foreground/70">
                      Renews{" "}
                      {subscription.current_period_end
                        ? new Date(subscription.current_period_end).toLocaleDateString()
                        : "N/A"}
                    </span>
                  </>
                )}
              </div>
            </div>

            <details className="mt-3 group">
              <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors flex items-center gap-1">
                View plan features
                <ArrowRight className="h-3 w-3 transition-transform group-open:rotate-90" />
              </summary>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {activePlan?.features.map((feature, idx) => (
                  <div key={idx} className="flex items-start gap-2">
                    <Check className="h-3 w-3 text-foreground/40 mt-0.5" />
                    <span className="text-xs text-muted-foreground">{feature}</span>
                  </div>
                )) || []}
              </div>
            </details>
          </motion.div>

        </>
      )}

      {/* ─── Auto-Refill ──────────────────────────────────────────────── */}
      <motion.div {...fadeUp(0.38)}>
        <div className="rounded-xl border border-border/40 overflow-hidden">
          <div className={cn("flex items-center justify-between px-4 py-3", autoRefill.enabled && "border-b border-border/30")}>
            <div className="flex items-center gap-2.5">
              <div className="h-7 w-7 rounded-lg bg-foreground/[0.04] flex items-center justify-center shrink-0">
                <ArrowsClockwise className="h-3.5 w-3.5 text-foreground/40" weight="bold" />
              </div>
              <div>
                <h4 className="text-sm font-semibold">Auto-Refill</h4>
                <p className="text-[11px] text-muted-foreground/50">Automatically top up when credits run low</p>
              </div>
            </div>
            <button
              onClick={() => handleAutoRefillSave({ enabled: !autoRefill.enabled })}
              disabled={savingAutoRefill || loadingAutoRefill || !subscription || subscription.status !== "active"}
              className={cn(
                "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed",
                autoRefill.enabled ? "bg-foreground" : "bg-muted-foreground/20"
              )}
            >
              <span
                className={cn(
                  "pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-sm ring-0 transition-transform duration-200 ease-in-out",
                  autoRefill.enabled ? "translate-x-4" : "translate-x-0"
                )}
              />
            </button>
          </div>

          {autoRefill.enabled && (
            <div className="px-4 py-3 space-y-3">
              {/* Package selection */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Refill package</span>
                <Select
                  value={autoRefill.package_id}
                  onValueChange={(v) => handleAutoRefillSave({ package_id: v })}
                  disabled={savingAutoRefill}
                >
                  <SelectTrigger className="h-7 w-[180px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="boost-small">Boost — 150 credits ($19)</SelectItem>
                    <SelectItem value="boost-medium">Power Boost — 500 credits ($49)</SelectItem>
                    <SelectItem value="boost-large">Ultra Boost — 1,200 credits ($99)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Threshold */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Refill when balance drops below</span>
                <Select
                  value={String(autoRefill.threshold)}
                  onValueChange={(v) => handleAutoRefillSave({ threshold: Number(v) })}
                  disabled={savingAutoRefill}
                >
                  <SelectTrigger className="h-7 w-[140px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="20">20 credits</SelectItem>
                    <SelectItem value="50">50 credits</SelectItem>
                    <SelectItem value="100">100 credits</SelectItem>
                    <SelectItem value="200">200 credits</SelectItem>
                    <SelectItem value="500">500 credits</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Max per day */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Max refills per day</span>
                <input
                  type="number"
                  min={1}
                  max={999}
                  value={autoRefill.max_refills_per_day}
                  onChange={(e) => {
                    const val = Math.max(1, Math.min(999, parseInt(e.target.value) || 1))
                    setAutoRefill((prev) => ({ ...prev, max_refills_per_day: val }))
                  }}
                  onBlur={() => handleAutoRefillSave({ max_refills_per_day: autoRefill.max_refills_per_day })}
                  disabled={savingAutoRefill}
                  className="h-7 w-[100px] rounded-md border border-input dark:border-0 dark:bg-secondary dark:hover:bg-secondary/50 bg-transparent px-3 text-xs text-right tabular-nums shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
              </div>

              {/* Daily spending cap info */}
              <div className="rounded-lg bg-muted/20 px-3 py-2">
                <p className="text-[11px] text-muted-foreground/60">
                  Max daily spend:{" "}
                  <span className="font-medium text-foreground/60">
                    ${autoRefill.max_refills_per_day * (
                      autoRefill.package_id === "boost-small" ? 19
                        : autoRefill.package_id === "boost-medium" ? 49
                        : 99
                    )}
                  </span>
                  {" · "}Card on file will be charged automatically
                </p>
              </div>
            </div>
          )}
        </div>
      </motion.div>

      {/* ─── Additional Credits ──────────────────────────────────────────── */}
      <motion.div {...fadeUp(0.4)}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h4 className="text-sm font-semibold">Add Credits</h4>
            <p className="text-xs text-muted-foreground/60 mt-0.5">Top up anytime — no subscription required</p>
          </div>
        </div>
        <div className="rounded-xl border border-border/40 overflow-hidden divide-y divide-border/30">
          {additionalCreditPackages.map((pkg) => (
            <div
              key={pkg.id}
              className="flex items-center gap-4 px-4 py-3 hover:bg-muted/20 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-semibold tabular-nums">{pkg.credits.toLocaleString()}</span>
                  <span className="text-xs text-muted-foreground/50">credits</span>
                  {pkg.savings && (
                    <span className="text-[10px] font-medium text-emerald-500/80">{pkg.savings}</span>
                  )}
                </div>
                <span className="text-[11px] text-muted-foreground/40">{pkg.description}</span>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs px-3 shrink-0"
                onClick={() =>
                  handlePurchaseCredits(pkg.id, pkg.credits, pkg.price)
                }
                disabled={purchasingPackage === pkg.id}
              >
                {purchasingPackage === pkg.id ? (
                  <Spinner className="h-3 w-3 animate-spin" />
                ) : (
                  <>${pkg.price}</>
                )}
              </Button>
            </div>
          ))}
        </div>
      </motion.div>

      {/* ─── Usage Chart ─────────────────────────────────────────────────── */}
      <motion.div {...fadeUp(0.45)} className="rounded-xl border border-border/30 bg-card/20 overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 pt-5 pb-1">
          <div className="flex items-center gap-2.5">
            <div className="h-7 w-7 rounded-lg bg-foreground/[0.04] flex items-center justify-center shrink-0">
              <ChartLine className="h-3.5 w-3.5 text-foreground/40" weight="bold" />
            </div>
            <span className="text-sm font-semibold">Credit Activity</span>
          </div>
          <div className="flex items-center gap-2">
            {/* Chart view toggle */}
            <div className="flex items-center rounded-lg bg-muted/30 p-0.5">
              {(["area", "bar"] as const).map((view) => (
                <button
                  key={view}
                  onClick={() => setChartView(view)}
                  className={cn(
                    "px-2 py-1 text-[10px] font-medium rounded-md transition-all duration-150 capitalize",
                    chartView === view
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground/40 hover:text-muted-foreground/70"
                  )}
                >
                  {view}
                </button>
              ))}
            </div>
            {/* Time range pills */}
            <div className="flex items-center rounded-lg bg-muted/30 p-0.5">
              {(["7d", "30d", "90d", "all"] as TimeRange[]).map((range) => (
                <button
                  key={range}
                  onClick={() => setTimeRange(range)}
                  className={cn(
                    "px-2.5 py-1 text-[10px] font-medium rounded-md transition-all duration-150",
                    timeRange === range
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground/40 hover:text-muted-foreground/70"
                  )}
                >
                  {range === "all" ? "All" : range}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="px-1 pb-3">
          {loadingTransactions ? (
            <div className="flex items-center justify-center h-[240px]">
              <Spinner className="h-5 w-5 animate-spin text-muted-foreground/20" />
            </div>
          ) : (
            <UsageChart data={chartData} height={240} chartView={chartView} />
          )}
        </div>
      </motion.div>

      {/* ─── Transaction History ──────────────────────────────────────────── */}
      <motion.div {...fadeUp(0.55)}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <Receipt className="h-4 w-4 text-muted-foreground/50 shrink-0" weight="bold" />
            <span className="text-sm font-semibold">Transactions</span>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
              {transactionGroups.length}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            {/* Type filter */}
            <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as TransactionFilter)}>
              <SelectTrigger size="sm" className="h-7 text-[11px] gap-1.5 min-w-0 w-auto">
                <Funnel className="h-3 w-3 text-muted-foreground/50" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="usage">Usage</SelectItem>
                <SelectItem value="purchase">Purchases</SelectItem>
                <SelectItem value="subscription">Subscription</SelectItem>
                <SelectItem value="bonus">Bonuses</SelectItem>
                <SelectItem value="refund">Refunds</SelectItem>
              </SelectContent>
            </Select>

            {/* Export */}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-[11px] px-2"
              onClick={handleExportCSV}
              disabled={filteredTransactions.length === 0}
            >
              <Export className="h-3 w-3 mr-1" />
              Export
            </Button>
          </div>
        </div>

        <div
          className={cn(
            "rounded-xl border border-border/40 overflow-hidden",
            showAllTransactions && "max-h-[500px] overflow-y-auto"
          )}
        >
          {loadingTransactions ? (
            <div className="flex justify-center py-12">
              <Spinner className="h-5 w-5 animate-spin text-muted-foreground/30" />
            </div>
          ) : transactionGroups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center px-4">
              <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center mb-3">
                <Receipt className="h-5 w-5 text-muted-foreground/30" />
              </div>
              <p className="text-sm text-muted-foreground/60">No transactions found</p>
              <p className="text-xs text-muted-foreground/40 mt-1">
                {typeFilter !== "all"
                  ? "Try changing the filter"
                  : "Transactions will appear here as you use Coasty"}
              </p>
            </div>
          ) : (
            <div>
              {(showAllTransactions ? transactionGroups : transactionGroups.slice(0, 8)).map(
                (group, i, arr) => (
                  <TransactionGroupRow
                    key={group.id}
                    group={group}
                    isLast={i === arr.length - 1}
                  />
                )
              )}
            </div>
          )}
        </div>

        {/* Show more / less */}
        {transactionGroups.length > 8 && (
          <div className="flex justify-center mt-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground/50 hover:text-muted-foreground"
              onClick={() => setShowAllTransactions(!showAllTransactions)}
            >
              {showAllTransactions
                ? "Show less"
                : `Show all ${transactionGroups.length} groups`}
              <ChevronDown
                className={cn(
                  "h-3 w-3 ml-1 transition-transform",
                  showAllTransactions && "rotate-180"
                )}
              />
            </Button>
          </div>
        )}
      </motion.div>

    </div>
  )
}
