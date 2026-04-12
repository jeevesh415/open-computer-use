"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { cn } from "@/lib/utils"
import { LandingHeader } from "@/app/components/landing/landing-header"
import { LandingFooter } from "@/app/components/landing/landing-footer"
import { motion } from "framer-motion"
import { GuideLines } from "@/app/components/landing/guide-lines"
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

/* ─── types ─── */

interface ServiceStatus {
  name: string
  status: "operational" | "degraded" | "outage"
  latency: number | null
  message?: string
}

interface StatusResponse {
  overall: "operational" | "degraded" | "outage"
  timestamp: string
  services: ServiceStatus[]
}

interface DayStatus {
  date: string
  status: "operational" | "degraded" | "outage"
  checks: number
  operational_count: number
  avg_latency: number | null
}

interface ServiceHistory {
  service_name: string
  days: DayStatus[]
  uptime_percent: number
}

interface HistoryResponse {
  services: ServiceHistory[]
  has_data: boolean
}

/* ─── constants ─── */

const SERVICE_ICONS: Record<string, React.ComponentType<any>> = {
  Website: Globe,
  "AI Backend": Cpu,
  Database: Database,
  Authentication: ShieldCheck,
  "AI Models": Circuitry,
  "File Storage": CloudArrowUp,
}

const STATUS_CONFIG = {
  operational: {
    labelKey: "statuses.operational" as const,
    color: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-500/[0.06] dark:bg-emerald-400/[0.08]",
    border: "border-emerald-500/15 dark:border-emerald-400/15",
    dot: "bg-emerald-500",
    dotPing: "bg-emerald-400",
  },
  degraded: {
    labelKey: "statuses.degraded" as const,
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-500/[0.06] dark:bg-amber-400/[0.08]",
    border: "border-amber-500/15 dark:border-amber-400/15",
    dot: "bg-amber-500",
    dotPing: "bg-amber-400",
  },
  outage: {
    labelKey: "statuses.outage" as const,
    color: "text-rose-600 dark:text-rose-400",
    bg: "bg-rose-500/[0.06] dark:bg-rose-400/[0.08]",
    border: "border-rose-500/15 dark:border-rose-400/15",
    dot: "bg-rose-500",
    dotPing: "bg-rose-400",
  },
}

/* ─── animation ─── */

const fade = {
  hidden: { opacity: 0, y: 20 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, delay: i * 0.05, ease: [0.25, 0.1, 0.25, 1] as const },
  }),
}

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
}

/* ─── uptime bar (real data per service) ─── */

function ServiceUptimeBar({ days }: { days: DayStatus[] }) {
  return (
    <div className="flex gap-[2px] items-end">
      {days.map((day) => {
        const hasData = day.checks > 0
        return (
          <div
            key={day.date}
            className={cn(
              "flex-1 rounded-[1px] transition-all duration-200",
              "hover:opacity-80 cursor-default",
              !hasData
                ? "bg-muted-foreground/10 h-7"
                : day.status === "operational"
                  ? "bg-emerald-500/60 dark:bg-emerald-400/50 h-7"
                  : day.status === "degraded"
                    ? "bg-amber-500/60 dark:bg-amber-400/50 h-5"
                    : "bg-rose-500/60 dark:bg-rose-400/50 h-3"
            )}
            title={
              hasData
                ? `${day.date} — ${day.status} (${day.operational_count}/${day.checks} checks OK${day.avg_latency ? `, ${day.avg_latency}ms avg` : ""})`
                : `${day.date} — No data`
            }
          />
        )
      })}
    </div>
  )
}

/* ─── components ─── */

const BANNER_GLOW = {
  operational: "from-emerald-500/20 via-emerald-500/5 to-transparent dark:from-emerald-400/15 dark:via-emerald-400/5",
  degraded: "from-amber-500/20 via-amber-500/5 to-transparent dark:from-amber-400/15 dark:via-amber-400/5",
  outage: "from-rose-500/20 via-rose-500/5 to-transparent dark:from-rose-400/15 dark:via-rose-400/5",
} as const

function OverallBanner({ status }: { status: "operational" | "degraded" | "outage" }) {
  const t = useTranslations("statusPage")
  const config = STATUS_CONFIG[status]

  return (
    <motion.div
      variants={fade}
      custom={0}
      className="relative overflow-hidden rounded-2xl border border-border/40"
    >
      <div className={cn("absolute inset-0 bg-gradient-to-br", BANNER_GLOW[status])} />
      <div className="absolute inset-0 bg-card/40 backdrop-blur-sm" />

      <div className="relative px-6 py-8 sm:px-8 sm:py-10">
        <div className="flex flex-col items-center text-center gap-4">
          <div className={cn(
            "flex h-10 w-10 items-center justify-center rounded-full border",
            config.bg, config.border,
          )}>
            {status === "operational" ? (
              <CheckCircle size={22} weight="fill" className="text-emerald-500 dark:text-emerald-400" />
            ) : status === "degraded" ? (
              <Warning size={22} weight="fill" className="text-amber-500 dark:text-amber-400" />
            ) : (
              <XCircle size={22} weight="fill" className="text-rose-500 dark:text-rose-400" />
            )}
          </div>

          <div>
            <h2 className={cn("text-xl sm:text-2xl font-bold tracking-tight", config.color)}>
              {status === "operational"
                ? t("overallStatuses.allOperational")
                : status === "degraded"
                  ? t("overallStatuses.someDegraded")
                  : t("overallStatuses.disruption")}
            </h2>
            <p className="text-sm text-muted-foreground/60 mt-1.5 max-w-md mx-auto leading-relaxed">
              {status === "operational"
                ? t("overallDescriptions.allOperational")
                : status === "degraded"
                  ? t("overallDescriptions.someDegraded")
                  : t("overallDescriptions.disruption")}
            </p>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

function ServiceCard({
  service,
  index,
  history,
}: {
  service: ServiceStatus
  index: number
  history: ServiceHistory | null
}) {
  const t = useTranslations("statusPage")
  const [expanded, setExpanded] = useState(false)
  const config = STATUS_CONFIG[service.status]
  const Icon = SERVICE_ICONS[service.name] || Globe
  const hasHistory = history && history.days.some((d) => d.checks > 0)

  return (
    <motion.div
      variants={fade}
      custom={index + 2}
      className={cn(
        "rounded-xl border border-border/40 bg-card/50 backdrop-blur-sm transition-all duration-200",
        "hover:border-border/60 hover:bg-card/70"
      )}
    >
      {/* Main row */}
      <button
        onClick={() => hasHistory && setExpanded(!expanded)}
        className={cn(
          "flex w-full items-center justify-between p-4 sm:p-5 text-left",
          hasHistory && "cursor-pointer",
          !hasHistory && "cursor-default"
        )}
      >
        <div className="flex items-center gap-3.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-foreground/[0.04] dark:bg-foreground/[0.06]">
            <Icon size={18} weight="duotone" className="text-foreground/60" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">{service.name}</p>
            {service.latency !== null && (
              <p className="text-[11px] text-muted-foreground/50 mt-0.5">
                {t("responseTime", { ms: service.latency })}
              </p>
            )}
            {service.message && (
              <p className="text-[11px] text-rose-500/70 mt-0.5">
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
          {service.status === "operational" ? (
            <CheckCircle size={16} weight="fill" className="text-emerald-500" />
          ) : service.status === "degraded" ? (
            <Warning size={16} weight="fill" className="text-amber-500" />
          ) : (
            <XCircle size={16} weight="fill" className="text-rose-500" />
          )}
          {hasHistory && (
            <CaretDown
              size={12}
              weight="bold"
              className={cn(
                "text-muted-foreground/40 transition-transform duration-200 ml-0.5",
                expanded && "rotate-180"
              )}
            />
          )}
        </div>
      </button>

      {/* Expanded uptime graph */}
      {expanded && history && (
        <div className="px-4 pb-4 sm:px-5 sm:pb-5">
          <div className="rounded-xl bg-foreground/[0.02] dark:bg-foreground/[0.03] border border-border/30 p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] font-medium text-muted-foreground/60">
                {t("uptimeLabel")}
              </p>
              <span className={cn(
                "text-sm font-bold tabular-nums",
                history.uptime_percent >= 99.5
                  ? "text-emerald-600 dark:text-emerald-400"
                  : history.uptime_percent >= 95
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-rose-600 dark:text-rose-400"
              )}>
                {history.uptime_percent}%
              </span>
            </div>
            <ServiceUptimeBar days={history.days} />
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

/* ─── overall uptime summary ─── */

function OverallUptimeSection({ history }: { history: HistoryResponse | null }) {
  const t = useTranslations("statusPage")
  const overallUptime = useMemo(() => {
    if (!history || !history.has_data || history.services.length === 0) return null

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

    for (let i = 89; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const dateStr = d.toISOString().split("T")[0]
      const data = dayMap.get(dateStr)

      if (data) {
        const ratio = data.operational / data.total
        const status = ratio >= 0.95 ? "operational" : ratio >= 0.7 ? "degraded" : "outage"
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
        days.push({
          date: dateStr,
          status: "operational",
          checks: 0,
          operational_count: 0,
          avg_latency: null,
        })
      }
    }

    const percent = totalChecks > 0
      ? Math.round((totalOp / totalChecks) * 10000) / 100
      : 100

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
        <span className={cn(
          "text-lg font-bold tabular-nums",
          overallUptime.percent >= 99.5
            ? "text-emerald-600 dark:text-emerald-400"
            : overallUptime.percent >= 95
              ? "text-amber-600 dark:text-amber-400"
              : "text-rose-600 dark:text-rose-400"
        )}>
          {overallUptime.percent}%
        </span>
      </div>
      <ServiceUptimeBar days={overallUptime.days} />
      <div className="flex items-center justify-between mt-2">
        <span className="text-[10px] text-muted-foreground/40">{t("daysAgo")}</span>
        <span className="text-[10px] text-muted-foreground/40">{t("today")}</span>
      </div>
    </motion.div>
  )
}

/* ─── page ─── */

export default function StatusPage() {
  const t = useTranslations("statusPage")
  const [data, setData] = useState<StatusResponse | null>(null)
  const [history, setHistory] = useState<HistoryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastChecked, setLastChecked] = useState<Date | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const fetchStatus = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    try {
      const res = await fetch("/api/status", { cache: "no-store" })
      const json = await res.json()
      setData(json)
      setLastChecked(new Date())
    } catch {
      setData({
        overall: "outage",
        timestamp: new Date().toISOString(),
        services: [
          { name: "Website", status: "outage", latency: null, message: "Unable to reach status API" },
        ],
      })
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/status/history", { cache: "no-store" })
      const json = await res.json()
      setHistory(json)
    } catch {
      // History is optional — page works without it
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    fetchHistory()
    const interval = setInterval(() => fetchStatus(), 60000)
    return () => clearInterval(interval)
  }, [fetchStatus, fetchHistory])

  const historyByService = useMemo(() => {
    if (!history?.services) return new Map<string, ServiceHistory>()
    const map = new Map<string, ServiceHistory>()
    for (const s of history.services) {
      map.set(s.service_name, s)
    }
    return map
  }, [history])

  return (
    <div className="relative min-h-screen bg-background">
      <GuideLines />
      <LandingHeader />

      <div className="pt-28 sm:pt-32 pb-24">
        <div className="mx-auto px-7 sm:px-10 max-w-3xl">

          {/* ── header ── */}
          <motion.div
            initial="hidden"
            animate="show"
            variants={stagger}
            className="mb-8"
          >
            <motion.p
              variants={fade}
              custom={0}
              className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/60 mb-3"
            >
              {t("title")}
            </motion.p>
            <motion.div variants={fade} custom={0} className="flex items-start justify-between gap-4">
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
                className={cn(
                  "shrink-0 flex items-center gap-2 rounded-xl border border-border/60 px-3.5 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:border-border transition-all mt-1",
                  refreshing && "opacity-50 pointer-events-none"
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
            <div className="space-y-4">
              <div className="rounded-2xl border border-border/30 bg-card/30 p-6 sm:p-8 animate-pulse">
                <div className="flex items-center gap-4">
                  <div className="h-3 w-3 rounded-full bg-muted-foreground/10" />
                  <div className="space-y-2">
                    <div className="h-5 w-48 rounded-lg bg-muted-foreground/10" />
                    <div className="h-3 w-64 rounded-lg bg-muted-foreground/10" />
                  </div>
                </div>
              </div>
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="rounded-xl border border-border/30 bg-card/30 p-4 sm:p-5 animate-pulse">
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
                    <span className="text-border">|</span>
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
      </div>

      <LandingFooter />
    </div>
  )
}
