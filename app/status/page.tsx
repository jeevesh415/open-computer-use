"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { cn } from "@/lib/utils"
import { LandingHeader } from "@/app/components/landing/landing-header"
import { LandingFooter } from "@/app/components/landing/landing-footer"
import { motion } from "framer-motion"
import {
  CheckCircle,
  Warning,
  XCircle,
  ArrowClockwise,
  Globe,
  Cpu,
  Database,
  ShieldCheck,
  Circuitry,
  CloudArrowUp,
  Clock,
  ArrowSquareOut,
  CaretDown,
} from "@phosphor-icons/react"
import { useTranslations } from "next-intl"
import type {
  ServiceStatus,
  ServiceCheck,
  StatusResponse,
  DayStatus,
  ServiceHistory,
  HistoryResponse,
} from "@/lib/status"

/* ─── constants ─── */

/** Maps internal service keys (stored in DB) → polished display names */
const SERVICE_DISPLAY_NAMES: Record<string, string> = {
  Website: "Web Application",
  "AI Backend": "Orchestration Engine",
  Database: "Data Layer",
  Authentication: "Identity & Auth",
  "AI Models": "Model Inference",
  "File Storage": "Object Storage",
}

const SERVICE_ICONS: Record<string, React.ComponentType<any>> = {
  Website: Globe,
  "AI Backend": Cpu,
  Database: Database,
  Authentication: ShieldCheck,
  "AI Models": Circuitry,
  "File Storage": CloudArrowUp,
}

const STATUS_CONFIG: Record<
  ServiceStatus,
  {
    labelKey: string
    color: string
    bg: string
    border: string
    dot: string
    dotPing: string
  }
> = {
  operational: {
    labelKey: "statuses.operational",
    color: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-500/[0.06] dark:bg-emerald-400/[0.08]",
    border: "border-emerald-500/15 dark:border-emerald-400/15",
    dot: "bg-emerald-500",
    dotPing: "bg-emerald-400",
  },
  degraded: {
    labelKey: "statuses.degraded",
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-500/[0.06] dark:bg-amber-400/[0.08]",
    border: "border-amber-500/15 dark:border-amber-400/15",
    dot: "bg-amber-500",
    dotPing: "bg-amber-400",
  },
  outage: {
    labelKey: "statuses.outage",
    color: "text-rose-600 dark:text-rose-400",
    bg: "bg-rose-500/[0.06] dark:bg-rose-400/[0.08]",
    border: "border-rose-500/15 dark:border-rose-400/15",
    dot: "bg-rose-500",
    dotPing: "bg-rose-400",
  },
}

/* ─── animation (fast, reduced for status pages) ─── */

const fade = {
  hidden: { opacity: 0, y: 12 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.3, delay: i * 0.03, ease: [0.25, 0.1, 0.25, 1] as const },
  }),
}

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04 } },
}

/* ─── uptime bar ─── */

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00")
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diff = Math.round((today.getTime() - d.getTime()) / (1000 * 60 * 60 * 24))
  if (diff === 0) return "Today"
  if (diff === 1) return "Yesterday"
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
}

function UptimeBarSegment({ day }: { day: DayStatus }) {
  const [hovered, setHovered] = useState(false)
  const hasData = day.checks > 0
  const failedChecks = hasData ? day.checks - day.operational_count : 0

  return (
    <div
      className="relative flex-1 group"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        className={cn(
          "w-full rounded-[1px] transition-all duration-150",
          hovered && "opacity-80 scale-y-110",
          !hasData
            ? "bg-muted-foreground/10 h-7"
            : day.status === "operational"
              ? "bg-emerald-500/60 dark:bg-emerald-400/50 h-7"
              : day.status === "degraded"
                ? "bg-amber-500/60 dark:bg-amber-400/50 h-5"
                : "bg-rose-500/60 dark:bg-rose-400/50 h-3",
        )}
        role="img"
        aria-label={
          hasData
            ? `${formatDate(day.date)}: ${day.status}, ${day.operational_count}/${day.checks} checks passed`
            : `${formatDate(day.date)}: No data`
        }
      />

      {hovered && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 pointer-events-none">
          <div className="bg-popover border border-border/60 rounded-lg shadow-lg px-3 py-2 min-w-[140px] text-center">
            <p className="text-[11px] font-medium text-foreground whitespace-nowrap">
              {formatDate(day.date)}
            </p>
            <p className="text-[10px] text-muted-foreground/60 mb-1.5">{day.date}</p>

            {hasData ? (
              <>
                <div className="flex items-center justify-center gap-1.5 mb-1">
                  <span
                    className={cn(
                      "inline-block h-1.5 w-1.5 rounded-full",
                      day.status === "operational"
                        ? "bg-emerald-500"
                        : day.status === "degraded"
                          ? "bg-amber-500"
                          : "bg-rose-500",
                    )}
                  />
                  <span
                    className={cn(
                      "text-[11px] font-medium capitalize",
                      day.status === "operational"
                        ? "text-emerald-600 dark:text-emerald-400"
                        : day.status === "degraded"
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-rose-600 dark:text-rose-400",
                    )}
                  >
                    {day.status}
                  </span>
                </div>

                <div className="space-y-0.5 text-[10px] text-muted-foreground/70 tabular-nums">
                  <p>
                    {day.operational_count}/{day.checks} checks passed
                  </p>
                  {failedChecks > 0 && (
                    <p className="text-rose-500/80 dark:text-rose-400/80">
                      {failedChecks} failed
                    </p>
                  )}
                  {day.avg_latency != null && <p>{day.avg_latency}ms avg</p>}
                </div>
              </>
            ) : (
              <p className="text-[10px] text-muted-foreground/40">No checks recorded</p>
            )}

            <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px">
              <div className="w-2 h-2 bg-popover border-r border-b border-border/60 rotate-45 -translate-y-1" />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ServiceUptimeBar({ days, label }: { days: DayStatus[]; label: string }) {
  return (
    <div
      className="flex gap-[2px] items-end"
      role="img"
      aria-label={`${label}: 7-day uptime chart`}
    >
      {days.map((day) => (
        <UptimeBarSegment key={day.date} day={day} />
      ))}
    </div>
  )
}

/* ─── banner ─── */

const BANNER_GLOW: Record<ServiceStatus, string> = {
  operational:
    "from-emerald-500/20 via-emerald-500/5 to-transparent dark:from-emerald-400/15 dark:via-emerald-400/5",
  degraded:
    "from-amber-500/20 via-amber-500/5 to-transparent dark:from-amber-400/15 dark:via-amber-400/5",
  outage:
    "from-rose-500/20 via-rose-500/5 to-transparent dark:from-rose-400/15 dark:via-rose-400/5",
}

const BANNER_ICONS: Record<ServiceStatus, React.ComponentType<any>> = {
  operational: CheckCircle,
  degraded: Warning,
  outage: XCircle,
}

const BANNER_ICON_COLORS: Record<ServiceStatus, string> = {
  operational: "text-emerald-500 dark:text-emerald-400",
  degraded: "text-amber-500 dark:text-amber-400",
  outage: "text-rose-500 dark:text-rose-400",
}

const OVERALL_KEYS: Record<ServiceStatus, string> = {
  operational: "overallStatuses.allOperational",
  degraded: "overallStatuses.someDegraded",
  outage: "overallStatuses.disruption",
}

const OVERALL_DESC_KEYS: Record<ServiceStatus, string> = {
  operational: "overallDescriptions.allOperational",
  degraded: "overallDescriptions.someDegraded",
  outage: "overallDescriptions.disruption",
}

function OverallBanner({ status }: { status: ServiceStatus }) {
  const t = useTranslations("statusPage")
  const config = STATUS_CONFIG[status]
  const Icon = BANNER_ICONS[status]

  return (
    <motion.div
      variants={fade}
      custom={0}
      className="relative overflow-hidden rounded-2xl border border-border/40"
      role="status"
      aria-live="polite"
      aria-label={t(OVERALL_KEYS[status])}
    >
      <div className={cn("absolute inset-0 bg-gradient-to-br", BANNER_GLOW[status])} />
      <div className="absolute inset-0 bg-card/40 backdrop-blur-sm" />

      <div className="relative px-6 py-8 sm:px-8 sm:py-10">
        <div className="flex flex-col items-center text-center gap-4">
          <div
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-full border",
              config.bg,
              config.border,
            )}
          >
            <Icon size={22} weight="fill" className={BANNER_ICON_COLORS[status]} />
          </div>

          <div>
            <h2 className={cn("text-xl sm:text-2xl font-bold tracking-tight", config.color)}>
              {t(OVERALL_KEYS[status])}
            </h2>
            <p className="text-sm text-muted-foreground/60 mt-1.5 max-w-md mx-auto leading-relaxed">
              {t(OVERALL_DESC_KEYS[status])}
            </p>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

/* ─── service card ─── */

function ServiceCard({
  service,
  index,
  history,
}: {
  service: ServiceCheck
  index: number
  history: ServiceHistory | null
}) {
  const t = useTranslations("statusPage")
  const [expanded, setExpanded] = useState(false)
  const config = STATUS_CONFIG[service.status]
  const displayName = SERVICE_DISPLAY_NAMES[service.name] || service.name
  const Icon = SERVICE_ICONS[service.name] || Globe
  const hasHistory = history != null && history.days.some((d) => d.checks > 0)
  const cardId = `service-${service.name.replace(/\s+/g, "-").toLowerCase()}`
  const panelId = `${cardId}-panel`

  return (
    <motion.div
      variants={fade}
      custom={index + 2}
      className={cn(
        "rounded-xl border border-border/40 bg-card/50 backdrop-blur-sm transition-colors duration-200",
        "hover:border-border/60 hover:bg-card/70",
      )}
    >
      <button
        onClick={() => hasHistory && setExpanded(!expanded)}
        className={cn(
          "flex w-full items-center justify-between p-4 sm:p-5 text-left",
          hasHistory ? "cursor-pointer" : "cursor-default",
        )}
        aria-expanded={hasHistory ? expanded : undefined}
        aria-controls={hasHistory ? panelId : undefined}
        id={cardId}
      >
        <div className="flex items-center gap-3.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-foreground/[0.04] dark:bg-foreground/[0.06]">
            <Icon size={18} weight="duotone" className="text-foreground/60" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">{displayName}</p>
            {service.latency !== null && (
              <p className="text-[11px] text-muted-foreground/50 mt-0.5">
                {t("responseTime", { ms: service.latency })}
              </p>
            )}
            {service.message && (
              <p className="text-[11px] text-rose-500/70 dark:text-rose-400/70 mt-0.5">
                {service.message}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {hasHistory && (
            <span className="text-[11px] text-muted-foreground/40 tabular-nums mr-1">
              {history.uptime_percent}%
            </span>
          )}
          <span className={cn("text-[12px] font-medium", config.color)}>
            {t(config.labelKey)}
          </span>
          <StatusIcon status={service.status} />
          {hasHistory && (
            <CaretDown
              size={12}
              weight="bold"
              className={cn(
                "text-muted-foreground/40 transition-transform duration-200 ml-0.5",
                expanded && "rotate-180",
              )}
            />
          )}
        </div>
      </button>

      {expanded && history && (
        <div
          className="px-4 pb-4 sm:px-5 sm:pb-5"
          id={panelId}
          role="region"
          aria-labelledby={cardId}
        >
          <div className="rounded-xl bg-foreground/[0.02] dark:bg-foreground/[0.03] border border-border/30 p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] font-medium text-muted-foreground/60">
                {t("uptimeLabel")}
              </p>
              <span
                className={cn(
                  "text-sm font-bold tabular-nums",
                  history.uptime_percent >= 99.5
                    ? "text-emerald-600 dark:text-emerald-400"
                    : history.uptime_percent >= 95
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-rose-600 dark:text-rose-400",
                )}
              >
                {history.uptime_percent}%
              </span>
            </div>
            <ServiceUptimeBar days={history.days} label={displayName} />
            <div className="flex items-center justify-between mt-2">
              <span className="text-[10px] text-muted-foreground/40">{t("daysAgo")}</span>
              <span className="text-[10px] text-muted-foreground/40">{t("today")}</span>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  )
}

/* ─── status icon for service cards ─── */
function StatusIcon({ status }: { status: ServiceStatus }) {
  const cls = BANNER_ICON_COLORS[status]
  switch (status) {
    case "operational":
      return <CheckCircle size={16} weight="fill" className={cls} />
    case "degraded":
      return <Warning size={16} weight="fill" className={cls} />
    case "outage":
      return <XCircle size={16} weight="fill" className={cls} />
  }
}

/* ─── overall uptime summary ─── */

function OverallUptimeSection({ history }: { history: HistoryResponse | null }) {
  const t = useTranslations("statusPage")
  const overallUptime = useMemo(() => {
    if (!history?.has_data || !history.services.length) return null

    const dayMap = new Map<string, { total: number; operational: number }>()

    for (const service of history.services) {
      for (const day of service.days) {
        if (day.checks === 0) continue
        const existing = dayMap.get(day.date) || { total: 0, operational: 0 }
        existing.total += day.checks
        existing.operational += day.operational_count
        dayMap.set(day.date, existing)
      }
    }

    if (dayMap.size === 0) return null

    const days: DayStatus[] = []
    let totalChecks = 0
    let totalOp = 0

    for (let i = 6; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const dateStr = d.toISOString().split("T")[0]
      const data = dayMap.get(dateStr)

      if (data) {
        const ratio = data.operational / data.total
        const status: ServiceStatus =
          ratio >= 0.95 ? "operational" : ratio >= 0.7 ? "degraded" : "outage"
        days.push({
          date: dateStr,
          status,
          checks: data.total,
          operational_count: data.operational,
          avg_latency: null,
        })
        totalChecks += data.total
        totalOp += data.operational
      } else {
        // No data for this day — show as empty (not "100% uptime")
        days.push({
          date: dateStr,
          status: "operational",
          checks: 0,
          operational_count: 0,
          avg_latency: null,
        })
      }
    }

    // Avoid 100% when there's simply no data
    if (totalChecks === 0) return null

    const percent =
      totalChecks > 0
        ? parseFloat(((totalOp / totalChecks) * 100).toFixed(2))
        : 0

    return { days, percent }
  }, [history])

  if (!overallUptime) return null

  return (
    <motion.div
      variants={fade}
      custom={10}
      className="mt-8 rounded-2xl border border-border/40 bg-card/50 backdrop-blur-sm p-5 sm:p-6"
    >
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-sm font-medium text-foreground">{t("overallUptime")}</p>
          <p className="text-[11px] text-muted-foreground/50 mt-0.5">
            {t("overallUptimeDesc")}
          </p>
        </div>
        <span
          className={cn(
            "text-lg font-bold tabular-nums",
            overallUptime.percent >= 99.5
              ? "text-emerald-600 dark:text-emerald-400"
              : overallUptime.percent >= 95
                ? "text-amber-600 dark:text-amber-400"
                : "text-rose-600 dark:text-rose-400",
          )}
        >
          {overallUptime.percent}%
        </span>
      </div>
      <ServiceUptimeBar days={overallUptime.days} label="Overall" />
      <div className="flex items-center justify-between mt-2">
        <span className="text-[10px] text-muted-foreground/40">{t("daysAgo")}</span>
        <span className="text-[10px] text-muted-foreground/40">{t("today")}</span>
      </div>
    </motion.div>
  )
}

/* ─── error state ─── */

function ErrorState({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations("statusPage")
  return (
    <div
      className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.04] p-6 sm:p-8 text-center"
      role="alert"
    >
      <XCircle
        size={32}
        weight="duotone"
        className="text-rose-500/60 mx-auto mb-3"
      />
      <p className="text-sm font-medium text-foreground mb-1">
        Unable to load status
      </p>
      <p className="text-[13px] text-muted-foreground/60 mb-4">
        The status API is not responding. This may indicate a service disruption.
      </p>
      <button
        onClick={onRetry}
        className="inline-flex items-center gap-2 rounded-xl border border-border/60 px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:border-border transition-colors"
      >
        <ArrowClockwise size={14} weight="bold" />
        {t("refresh")}
      </button>
    </div>
  )
}

/* ─── loading skeleton ─── */

function LoadingSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading status...">
      <div className="rounded-2xl border border-border/30 bg-card/30 p-6 sm:p-8 animate-pulse">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 rounded-full bg-muted-foreground/10" />
          <div className="space-y-2 text-center">
            <div className="h-6 w-48 rounded-lg bg-muted-foreground/10 mx-auto" />
            <div className="h-3 w-64 rounded-lg bg-muted-foreground/10 mx-auto" />
          </div>
        </div>
      </div>
      {Array.from({ length: 6 }, (_, i) => (
        <div
          key={i}
          className="rounded-xl border border-border/30 bg-card/30 p-4 sm:p-5 animate-pulse"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3.5">
              <div className="h-9 w-9 rounded-xl bg-muted-foreground/10" />
              <div className="space-y-1.5">
                <div className="h-4 w-28 rounded-md bg-muted-foreground/10" />
                <div className="h-3 w-20 rounded-md bg-muted-foreground/10" />
              </div>
            </div>
            <div className="h-4 w-20 rounded-md bg-muted-foreground/10" />
          </div>
        </div>
      ))}
    </div>
  )
}

/* ─── page ─── */

export default function StatusPage() {
  const t = useTranslations("statusPage")
  const [data, setData] = useState<StatusResponse | null>(null)
  const [history, setHistory] = useState<HistoryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [lastChecked, setLastChecked] = useState<Date | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const dataRef = { current: data }
  dataRef.current = data

  const fetchStatus = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    try {
      const res = await fetch("/api/status", { cache: "no-store" })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json: StatusResponse = await res.json()
      setData(json)
      setLastChecked(new Date())
      setError(false)
    } catch {
      if (!dataRef.current) setError(true)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/status/history", { cache: "no-store" })
      if (!res.ok) {
        console.error("[Status] History fetch failed:", res.status, res.statusText)
        return
      }
      const json: HistoryResponse = await res.json()
      setHistory(json)
    } catch (err) {
      console.error("[Status] History fetch error:", err)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    fetchHistory()
    const statusInterval = setInterval(() => fetchStatus(), 60_000)
    const historyInterval = setInterval(() => fetchHistory(), 300_000)
    return () => {
      clearInterval(statusInterval)
      clearInterval(historyInterval)
    }
  }, [fetchStatus, fetchHistory])

  const historyByService = useMemo(() => {
    if (!history?.services) return new Map<string, ServiceHistory>()
    const map = new Map<string, ServiceHistory>()
    for (const s of history.services) map.set(s.service_name, s)
    return map
  }, [history])

  return (
    <div className="relative min-h-screen bg-background">
      <LandingHeader />

      <main className="pt-28 sm:pt-32 pb-24">
        <div className="mx-auto px-7 sm:px-10 max-w-3xl">
          {/* ── header ── */}
          <motion.div initial="hidden" animate="show" variants={stagger} className="mb-8">
            <motion.p
              variants={fade}
              custom={0}
              className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/60 mb-3"
            >
              {t("title")}
            </motion.p>
            <motion.div
              variants={fade}
              custom={0}
              className="flex items-start justify-between gap-4"
            >
              <div>
                <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-foreground leading-[1.2] tracking-tight">
                  {t("brandTitle")}
                </h1>
                <p className="text-sm sm:text-base text-muted-foreground/70 mt-2 max-w-lg leading-relaxed">
                  {t("subtitle")}
                </p>
              </div>
              <button
                onClick={() => fetchStatus(true)}
                disabled={refreshing}
                aria-label={t("refresh")}
                className={cn(
                  "shrink-0 flex items-center gap-2 rounded-xl border border-border/60 px-3.5 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:border-border transition-colors mt-1",
                  refreshing && "opacity-50 pointer-events-none",
                )}
              >
                <ArrowClockwise
                  size={14}
                  weight="bold"
                  className={cn(refreshing && "animate-spin")}
                />
                <span className="hidden sm:inline">{t("refresh")}</span>
              </button>
            </motion.div>
          </motion.div>

          {/* ── content ── */}
          {loading ? (
            <LoadingSkeleton />
          ) : error && !data ? (
            <ErrorState onRetry={() => fetchStatus(true)} />
          ) : data ? (
            <motion.div
              initial="hidden"
              animate="show"
              variants={stagger}
              className="space-y-4"
            >
              <OverallBanner status={data.overall} />

              <motion.div variants={fade} custom={1}>
                <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground/40 mb-3 px-1">
                  {t("services")}
                  {history?.has_data && (
                    <span className="ml-2 font-normal normal-case tracking-normal text-muted-foreground/30">
                      — {t("clickUptime")}
                    </span>
                  )}
                </p>
              </motion.div>

              {data.services.map((service, i) => (
                <ServiceCard
                  key={service.name}
                  service={service}
                  index={i}
                  history={historyByService.get(service.name) || null}
                />
              ))}

              <OverallUptimeSection history={history} />

              {lastChecked && (
                <motion.div
                  variants={fade}
                  custom={data.services.length + 4}
                  className="flex items-center justify-center gap-2 pt-4"
                >
                  <Clock size={12} weight="duotone" className="text-muted-foreground/40" />
                  <p className="text-[11px] text-muted-foreground/40">
                    {t("lastChecked", { time: lastChecked.toLocaleTimeString() })}
                  </p>
                </motion.div>
              )}

              <motion.div
                variants={fade}
                custom={data.services.length + 5}
                className="rounded-2xl border border-border/40 bg-card/30 p-5 sm:p-6 mt-8"
              >
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {t("experiencingIssues")}
                    </p>
                    <p className="text-[13px] text-muted-foreground/60 mt-0.5">
                      {t("issuesDescription")}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <a
                      href="https://cal.com/coasty/15min"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-[13px] font-medium text-foreground/70 hover:text-foreground transition-colors"
                    >
                      {t("talkToCofounders")}
                      <ArrowSquareOut size={13} weight="bold" className="shrink-0" />
                    </a>
                    <span className="text-border" aria-hidden="true">|</span>
                    <a
                      href="mailto:founders@coasty.ai"
                      className="inline-flex items-center gap-1.5 text-[13px] font-medium text-foreground/70 hover:text-foreground transition-colors"
                    >
                      {t("emailUs")}
                      <ArrowSquareOut size={13} weight="bold" className="shrink-0" />
                    </a>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          ) : null}
        </div>
      </main>

      <LandingFooter />
    </div>
  )
}
