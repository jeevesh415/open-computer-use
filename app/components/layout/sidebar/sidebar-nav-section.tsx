"use client"

import { memo, useMemo, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import { useRouter, usePathname } from "next/navigation"
import {
  IconPlus,
  IconClockPlay,
  IconBinaryTree,
  IconBook2,
  IconCompass,
  IconDeviceDesktop,
  IconCalendarClock,
  IconShieldLock,
  IconKey,
} from "@tabler/icons-react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
} from "@/components/ui/hover-card"
import { useSidebar } from "@/components/ui/sidebar"
import { useChats } from "@/lib/chat-store/chats/provider"
import { useSidebarMachines } from "./hooks/use-sidebar-machines"
import { useLazyFetch } from "./hooks/use-lazy-fetch"

// ─── Types ────────────────────────────────────────────────────────
type HoverInfo = {
  description: string
  detail: string
  visual: "history" | "swarms" | "guide" | "machines" | "workforce" | "credentials"
}

// ═══════════════════════════════════════════════════════════════════
//  MINI UI DEMO VISUALS
// ═══════════════════════════════════════════════════════════════════

function HistoryVisual() {
  const t = useTranslations("sidebar")
  const rows = [
    { title: "Research competitors", time: "2h ago", width: "w-16" },
    { title: "Fill out invoice form", time: "5h ago", width: "w-20" },
    { title: "Book flights to NYC", time: "1d ago", width: "w-14" },
    { title: "Scrape pricing data", time: "2d ago", width: "w-[4.5rem]" },
  ]
  return (
    <div className="w-full h-full flex flex-col px-2.5 py-2 gap-[5px]">
      {rows.map((row, i) => (
        <div
          key={i}
          className={cn(
            "shv-row flex items-center gap-2 px-2 py-[5px] rounded-md border transition-all",
            i === 1
              ? "border-foreground/20 bg-foreground/[0.06] shv-selected"
              : "border-transparent"
          )}
          style={{ animationDelay: `${i * 0.08}s` }}
        >
          <div className={cn(
            "w-[18px] h-[18px] rounded-full border-[1.5px] flex items-center justify-center shrink-0",
            i === 1 ? "border-foreground/40 bg-foreground/10" : "border-foreground/15 bg-foreground/[0.04]"
          )}>
            <div className={cn("w-1.5 h-1.5 rounded-full", i === 1 ? "bg-foreground/50" : "bg-foreground/15")} />
          </div>
          <div className="flex-1 min-w-0 flex flex-col gap-[2px]">
            <div className={cn("h-[5px] rounded-full", row.width, i === 1 ? "bg-foreground/35" : "bg-foreground/12")} />
            <div className={cn("h-[3px] w-8 rounded-full", i === 1 ? "bg-foreground/20" : "bg-foreground/8")} />
          </div>
          {i === 1 && (
            <div className="shv-resume shrink-0 px-1.5 py-[2px] rounded text-[6px] font-bold border border-foreground/25 text-foreground/50 tracking-wide">
              {t("resume")}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function SwarmsVisual() {
  const t = useTranslations("sidebar")
  const agents = [
    { label: "A1", progress: 85, delay: "0s" },
    { label: "A2", progress: 60, delay: "0.15s" },
    { label: "A3", progress: 95, delay: "0.3s" },
  ]
  return (
    <div className="w-full h-full flex flex-col px-3 py-2 gap-1.5">
      <div className="flex gap-1.5 flex-1">
        {agents.map((a, i) => (
          <div
            key={i}
            className="shv-row flex-1 flex flex-col rounded border border-foreground/10 overflow-hidden"
            style={{ animationDelay: a.delay }}
          >
            <div className="flex items-center gap-1 px-1.5 py-[3px] border-b border-foreground/8 bg-foreground/[0.03]">
              <div className="w-1 h-1 rounded-full bg-foreground/20" />
              <div className="w-1 h-1 rounded-full bg-foreground/20" />
              <span className="text-[5px] font-bold text-foreground/30 ml-auto tracking-wider">{a.label}</span>
            </div>
            <div className="flex-1 p-1 flex flex-col justify-end gap-[2px]">
              <div className="h-[2px] w-full bg-foreground/8 rounded-full" />
              <div className="h-[2px] w-3/4 bg-foreground/6 rounded-full" />
              <div className="h-[2px] w-1/2 bg-foreground/10 rounded-full shv-typing" />
            </div>
            <div className="h-[3px] bg-foreground/[0.05]">
              <div
                className="h-full bg-foreground/25 rounded-r-full shv-progress"
                style={{ ["--progress" as string]: `${a.progress}%`, animationDelay: `${0.3 + i * 0.2}s` }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-1.5 shv-fade-up" style={{ animationDelay: "0.6s" }}>
        <div className="flex-1 h-px bg-gradient-to-r from-transparent via-foreground/15 to-foreground/15" />
        <div className="px-2 py-[2px] rounded-full border border-foreground/15 bg-foreground/[0.04] text-[5px] font-bold text-foreground/35 tracking-widest">
          {t("result")}
        </div>
        <div className="flex-1 h-px bg-gradient-to-l from-transparent via-foreground/15 to-foreground/15" />
      </div>
    </div>
  )
}

function GuideVisual() {
  const sections = [
    { w: "w-10", done: true },
    { w: "w-8", done: true },
    { w: "w-12", done: false },
    { w: "w-9", done: false },
  ]
  return (
    <div className="w-full h-full flex px-2.5 py-2 gap-2">
      <div className="w-12 flex flex-col gap-[5px] pt-1 shv-row" style={{ animationDelay: "0s" }}>
        {sections.map((s, i) => (
          <div key={i} className="flex items-center gap-1">
            <div className={cn(
              "w-[6px] h-[6px] rounded-full border shrink-0 flex items-center justify-center",
              s.done ? "border-foreground/30 bg-foreground/15 shv-check" : "border-foreground/12"
            )} style={{ animationDelay: `${0.3 + i * 0.25}s` }}>
              {s.done && <div className="w-[2px] h-[2px] rounded-full bg-foreground/50" />}
            </div>
            <div className={cn("h-[3px] rounded-full", s.w, s.done ? "bg-foreground/20" : "bg-foreground/8")} />
          </div>
        ))}
      </div>
      <div className="w-px bg-foreground/8 self-stretch" />
      <div className="flex-1 flex flex-col gap-1.5 shv-row" style={{ animationDelay: "0.1s" }}>
        <div className="h-[2px] w-full bg-foreground/8 rounded-full overflow-hidden">
          <div className="h-full bg-foreground/25 rounded-full shv-progress" style={{ ["--progress" as string]: "50%", animationDelay: "0.4s" }} />
        </div>
        <div className="flex flex-col gap-1">
          <div className="h-[4px] w-3/4 bg-foreground/15 rounded-full" />
          <div className="h-[3px] w-full bg-foreground/8 rounded-full" />
          <div className="h-[3px] w-5/6 bg-foreground/8 rounded-full" />
        </div>
        <div className="flex flex-col gap-1 mt-0.5">
          <div className="h-[4px] w-1/2 bg-foreground/12 rounded-full" />
          <div className="h-[3px] w-full bg-foreground/6 rounded-full" />
          <div className="h-[3px] w-2/3 bg-foreground/6 rounded-full" />
        </div>
      </div>
    </div>
  )
}

function MachinesVisual() {
  return (
    <div className="w-full h-full flex flex-col px-2.5 py-2 gap-1.5">
      {[
        { name: "Cloud VM", os: "Ubuntu", status: "running" as const },
        { name: "My Desktop", os: "macOS", status: "connected" as const },
        { name: "Dev Server", os: "Ubuntu", status: "stopped" as const },
      ].map((m, i) => (
        <div
          key={i}
          className="shv-row flex items-center gap-2 px-2 py-[5px] rounded-md border border-foreground/8 bg-foreground/[0.02]"
          style={{ animationDelay: `${i * 0.1}s` }}
        >
          <div className="w-[18px] h-[14px] rounded-[2px] border border-foreground/15 bg-foreground/[0.04] flex items-center justify-center shrink-0">
            <div className="w-2 h-[5px] rounded-[1px] bg-foreground/10" />
          </div>
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="text-[6px] font-bold text-foreground/40 leading-none tracking-wide">{m.name}</div>
            <div className="text-[5px] text-foreground/20 leading-none mt-[1px]">{m.os}</div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <div className={cn(
              "w-[5px] h-[5px] rounded-full",
              m.status === "running" && "bg-emerald-500/60 shv-pulse-dot",
              m.status === "connected" && "bg-blue-500/50 shv-pulse-dot",
              m.status === "stopped" && "bg-foreground/15",
            )} />
            <span className={cn(
              "text-[5px] font-semibold tracking-wide uppercase",
              m.status === "stopped" ? "text-foreground/20" : "text-foreground/35"
            )}>
              {m.status}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

function WorkforceVisual() {
  const tasks = [
    { time: "9 AM", label: "Send report", x: "left-[10%]", w: "w-[25%]", done: true },
    { time: "1 PM", label: "Scrape data", x: "left-[40%]", w: "w-[20%]", active: true },
    { time: "6 PM", label: "Backup DB", x: "left-[72%]", w: "w-[22%]", upcoming: true },
  ]
  return (
    <div className="w-full h-full flex flex-col justify-center px-3 py-2 gap-2">
      <div className="relative h-[2px] w-full bg-foreground/10 rounded-full">
        <div className="absolute left-0 top-0 h-full bg-foreground/20 rounded-full shv-progress" style={{ ["--progress" as string]: "55%", animationDelay: "0.2s" }} />
        {["0%", "33%", "66%", "100%"].map((pos, i) => (
          <div key={i} className="absolute top-1/2 -translate-y-1/2 w-[3px] h-[3px] rounded-full bg-foreground/15" style={{ left: pos }} />
        ))}
      </div>
      <div className="relative h-10">
        {tasks.map((t, i) => (
          <div
            key={i}
            className={cn(
              "shv-row absolute top-0 flex flex-col rounded border px-1.5 py-[3px]",
              t.x, t.w,
              t.done && "border-foreground/12 bg-foreground/[0.04]",
              t.active && "border-foreground/20 bg-foreground/[0.06]",
              t.upcoming && "border-dashed border-foreground/10 bg-transparent",
            )}
            style={{ animationDelay: `${0.1 + i * 0.15}s` }}
          >
            <span className={cn("text-[5px] font-bold tracking-wide", t.done ? "text-foreground/25" : "text-foreground/40")}>{t.time}</span>
            <span className={cn("text-[5px] truncate", t.done ? "text-foreground/15" : "text-foreground/25")}>{t.label}</span>
            {t.active && (
              <div className="h-[2px] w-full bg-foreground/10 rounded-full mt-[2px] overflow-hidden">
                <div className="h-full bg-foreground/30 rounded-full shv-progress" style={{ ["--progress" as string]: "60%", animationDelay: "0.5s" }} />
              </div>
            )}
            {t.done && (
              <div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-background border border-foreground/15 flex items-center justify-center shv-check" style={{ animationDelay: "0.5s" }}>
                <svg width="5" height="5" viewBox="0 0 10 10"><path d="M2 5.5L4 7.5L8 3" stroke="currentColor" strokeWidth="1.5" fill="none" className="text-foreground/40" /></svg>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-1 self-end shv-fade-up" style={{ animationDelay: "0.6s" }}>
        <svg width="8" height="8" viewBox="0 0 16 16" className="text-foreground/20">
          <path d="M2 8a6 6 0 0110.5-4M14 8a6 6 0 01-10.5 4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
          <path d="M13 1v3.5h-3.5M3 15v-3.5h3.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-[5px] font-semibold text-foreground/20 tracking-widest">REPEATS DAILY</span>
      </div>
    </div>
  )
}

function CredentialsVisual() {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center px-4 py-2 gap-2">
      <div className="w-full flex flex-col gap-1.5 shv-row" style={{ animationDelay: "0s" }}>
        <div className="flex items-center gap-1 px-2 py-[3px] rounded border border-foreground/10 bg-foreground/[0.03]">
          <svg width="6" height="6" viewBox="0 0 16 16" className="text-foreground/20 shrink-0">
            <rect x="2" y="6" width="12" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
            <path d="M5 6V4.5a3 3 0 016 0V6" stroke="currentColor" strokeWidth="1.5" fill="none" />
          </svg>
          <div className="h-[3px] w-16 bg-foreground/10 rounded-full" />
        </div>
        <div className="flex flex-col gap-[2px]">
          <span className="text-[5px] font-bold text-foreground/25 tracking-wide px-0.5">EMAIL</span>
          <div className="flex items-center px-2 py-[4px] rounded border border-foreground/10 bg-foreground/[0.02]">
            <div className="shv-type-text flex items-center gap-[1px]">
              {Array.from("user@mail.co").map((char, i) => (
                <span
                  key={i}
                  className="text-[6px] text-foreground/40 font-mono shv-type-char"
                  style={{ animationDelay: `${0.3 + i * 0.04}s` }}
                >
                  {char}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-[2px]">
          <span className="text-[5px] font-bold text-foreground/25 tracking-wide px-0.5">PASSWORD</span>
          <div className="flex items-center px-2 py-[4px] rounded border border-foreground/10 bg-foreground/[0.02]">
            <div className="flex items-center gap-[3px]">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="w-[4px] h-[4px] rounded-full bg-foreground/30 shv-type-char"
                  style={{ animationDelay: `${0.8 + i * 0.06}s` }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1.5 shv-fade-up" style={{ animationDelay: "1.4s" }}>
        <div className="w-3 h-3 rounded-full border border-foreground/20 flex items-center justify-center bg-foreground/[0.05]">
          <svg width="6" height="6" viewBox="0 0 10 10"><path d="M2 5.5L4 7.5L8 3" stroke="currentColor" strokeWidth="1.5" fill="none" className="text-foreground/50" /></svg>
        </div>
        <span className="text-[6px] font-semibold text-foreground/30 tracking-wide">Auto-filled by Coasty</span>
      </div>
    </div>
  )
}

const visualComponents: Record<string, React.FC> = {
  history: HistoryVisual,
  swarms: SwarmsVisual,
  guide: GuideVisual,
  machines: MachinesVisual,
  workforce: WorkforceVisual,
  credentials: CredentialsVisual,
}

// ─── Shared popup components ──────────────────────────────────────

function PopupShell({ children, width = "w-72" }: { children: ReactNode; width?: string }) {
  return (
    <div className={cn(width, "rounded-xl overflow-hidden border border-border/60 bg-popover shadow-2xl dark:border-white/[0.06]")}>
      {children}
    </div>
  )
}

function GlassSection({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("mx-3 mb-3 rounded-lg backdrop-blur-[3px] bg-foreground/[0.03] border border-foreground/[0.06] px-3 pt-2.5 pb-2", className)}>
      {children}
    </div>
  )
}

// ─── Live popup components ────────────────────────────────────────

function HistoryLivePopup({ chats }: { chats: { id: string; title: string | null; updated_at: string | null; last_message_preview?: string }[] }) {
  const t = useTranslations("sidebar")
  const recent = chats.slice(0, 5)

  const timeAgo = (d: string | null) => {
    if (!d) return ""
    const ms = Date.now() - new Date(d).getTime()
    if (ms < 3_600_000) return `${Math.max(1, Math.round(ms / 60_000))}m ago`
    if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`
    return `${Math.round(ms / 86_400_000)}d ago`
  }

  return (
    <PopupShell>
      <div className="px-4 pt-4 pb-2">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-semibold text-popover-foreground">{t("tasks", { count: chats.length })}</span>
          <span className="text-[10px] text-muted-foreground">{t("recentActivity")}</span>
        </div>
      </div>
      <GlassSection>
        <div className="space-y-1.5">
          {recent.map((c, i) => (
            <div key={c.id} className={cn(
              "flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors",
              i === 0 ? "bg-foreground/[0.04] border border-foreground/[0.06]" : ""
            )}>
              <div className={cn(
                "w-1.5 h-1.5 rounded-full shrink-0",
                i === 0 ? "bg-blue-400" : "bg-foreground/15"
              )} />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-popover-foreground/70 truncate font-medium">
                  {c.title || "Untitled"}
                </p>
                {c.last_message_preview && (
                  <p className="text-[9px] text-muted-foreground truncate">{c.last_message_preview}</p>
                )}
              </div>
              <span className="text-[9px] text-muted-foreground/60 shrink-0 tabular-nums">{timeAgo(c.updated_at)}</span>
            </div>
          ))}
        </div>
      </GlassSection>
      <Link href="/history" className="block px-4 pb-3 hover:opacity-80 transition-opacity">
        <span className="text-[10px] font-medium text-blue-500 dark:text-blue-400">{t("viewAllHistory")}</span>
      </Link>
    </PopupShell>
  )
}

function SwarmsLivePopup({ swarms }: { swarms: { swarm_id: string; status?: string; created_at: string; prompt?: string; machine_count?: number }[] }) {
  const t = useTranslations("sidebar")
  const recent = swarms.slice(0, 4)

  const statusColor = (s?: string) => {
    if (s === "running") return "bg-violet-500 dark:bg-violet-400 shadow-[0_0_4px_rgba(139,92,246,0.5)]"
    if (s === "completed") return "bg-emerald-500 dark:bg-emerald-400"
    if (s === "failed") return "bg-red-500 dark:bg-red-400"
    return "bg-foreground/20"
  }

  const timeAgo = (d: string) => {
    const ms = Date.now() - new Date(d).getTime()
    if (ms < 3_600_000) return `${Math.max(1, Math.round(ms / 60_000))}m ago`
    if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`
    return `${Math.round(ms / 86_400_000)}d ago`
  }

  const running = swarms.filter(s => s.status === "running").length
  const completed = swarms.filter(s => s.status === "completed").length

  return (
    <PopupShell>
      <div className="px-4 pt-4 pb-2">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-semibold text-popover-foreground">{t("swarmRunsCount", { count: swarms.length })}</span>
          {running > 0 && (
            <span className="text-[10px] text-violet-500 dark:text-violet-400 font-medium">{running} {t("active")}</span>
          )}
        </div>
        <div className="flex gap-3 mt-1.5">
          {running > 0 && <span className="text-[9px] text-muted-foreground">{running} {t("running")}</span>}
          {completed > 0 && <span className="text-[9px] text-muted-foreground">{completed} {t("completed")}</span>}
        </div>
      </div>
      <GlassSection>
        <div className="space-y-1.5">
          {recent.map((s) => (
            <div key={s.swarm_id} className="flex items-center gap-2 px-2 py-1.5 rounded-md">
              <div className={cn("w-1.5 h-1.5 rounded-full shrink-0", statusColor(s.status))} />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-popover-foreground/70 truncate font-medium">
                  {s.prompt ? s.prompt.slice(0, 50) : `Swarm ${s.swarm_id.slice(0, 8)}`}
                </p>
                <p className="text-[9px] text-muted-foreground">
                  {s.machine_count ? `${s.machine_count} machines` : ""}{s.machine_count && s.status ? " · " : ""}{s.status || ""}
                </p>
              </div>
              <span className="text-[9px] text-muted-foreground/60 shrink-0 tabular-nums">{timeAgo(s.created_at)}</span>
            </div>
          ))}
        </div>
      </GlassSection>
      <Link href="/swarms" className="block px-4 pb-3 hover:opacity-80 transition-opacity">
        <span className="text-[10px] font-medium text-violet-500 dark:text-violet-400">{t("viewAllSwarms")}</span>
      </Link>
    </PopupShell>
  )
}

function WorkforceLivePopup({ schedules }: { schedules: { chat_id: string; title: string | null; enabled: boolean; frequency: string; next_run_at: string | null; run_count: number; consecutive_failures: number }[] }) {
  const t = useTranslations("sidebar")
  const recent = schedules.slice(0, 4)
  const active = schedules.filter(s => s.enabled).length
  const totalRuns = schedules.reduce((acc, s) => acc + s.run_count, 0)

  const formatNext = (d: string | null) => {
    if (!d) return t("notScheduled")
    const ms = new Date(d).getTime() - Date.now()
    if (ms < 0) return t("overdue")
    if (ms < 60_000) return t("lessThanMin")
    if (ms < 3_600_000) return t("inMinutes", { count: Math.round(ms / 60_000) })
    if (ms < 86_400_000) return t("inHours", { count: Math.round(ms / 3_600_000) })
    return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" })
  }

  return (
    <PopupShell>
      <div className="px-4 pt-4 pb-2">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-semibold text-popover-foreground">{t("schedulesCount", { count: schedules.length })}</span>
          <span className="text-[10px] text-muted-foreground">{t("totalRuns", { count: totalRuns })}</span>
        </div>
        <div className="flex gap-3 mt-1.5">
          <span className="text-[9px] text-amber-500 dark:text-amber-400/70">{active} {t("active")}</span>
          <span className="text-[9px] text-muted-foreground">{schedules.length - active} {t("paused")}</span>
        </div>
      </div>
      <GlassSection>
        <div className="space-y-1.5">
          {recent.map((s) => (
            <div key={s.chat_id} className="flex items-center gap-2 px-2 py-1.5 rounded-md">
              <div className={cn(
                "w-1.5 h-1.5 rounded-full shrink-0",
                s.enabled ? "bg-amber-500 dark:bg-amber-400" : "bg-foreground/15",
                s.consecutive_failures > 0 && "bg-red-500 dark:bg-red-400"
              )} />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-popover-foreground/70 truncate font-medium">
                  {s.title || "Untitled schedule"}
                </p>
                <p className="text-[9px] text-muted-foreground">{s.frequency} · {s.run_count} runs</p>
              </div>
              <span className={cn(
                "text-[9px] shrink-0 tabular-nums",
                s.enabled ? "text-amber-500/60 dark:text-amber-400/50" : "text-muted-foreground/50"
              )}>
                {s.enabled ? formatNext(s.next_run_at) : t("paused")}
              </span>
            </div>
          ))}
        </div>
      </GlassSection>
      <Link href="/schedules" className="block px-4 pb-3 hover:opacity-80 transition-opacity">
        <span className="text-[10px] font-medium text-amber-500 dark:text-amber-400">{t("viewAllSchedules")}</span>
      </Link>
    </PopupShell>
  )
}

function CredentialsLivePopup({ secrets }: { secrets: { id: string; name: string; service: string; username: string; updatedAt: string }[] }) {
  const t = useTranslations("sidebar")
  const recent = secrets.slice(0, 4)

  const timeAgo = (d: string) => {
    const ms = Date.now() - new Date(d).getTime()
    if (ms < 86_400_000) return t("today")
    if (ms < 172_800_000) return t("yesterday")
    return `${Math.round(ms / 86_400_000)}d ago`
  }

  return (
    <PopupShell>
      <div className="px-4 pt-4 pb-2">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-semibold text-popover-foreground">{t("credentialsCount", { count: secrets.length })}</span>
          <span className="text-[10px] text-muted-foreground">{t("encryptedVault")}</span>
        </div>
      </div>
      <GlassSection>
        <div className="space-y-1.5">
          {recent.map((s) => (
            <div key={s.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md">
              <div className="w-5 h-5 rounded bg-foreground/[0.06] border border-foreground/[0.08] flex items-center justify-center shrink-0">
                <IconKey size={10} stroke={1.5} className="text-rose-500/70 dark:text-rose-400/70" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-popover-foreground/70 truncate font-medium">{s.name || s.service}</p>
                <p className="text-[9px] text-muted-foreground truncate">{s.username}</p>
              </div>
              <span className="text-[9px] text-muted-foreground/50 shrink-0 tabular-nums">{timeAgo(s.updatedAt)}</span>
            </div>
          ))}
        </div>
      </GlassSection>
      <Link href="/secrets" className="block px-4 pb-3 hover:opacity-80 transition-opacity">
        <span className="text-[10px] font-medium text-rose-500 dark:text-rose-400">{t("manageCredentials")}</span>
      </Link>
    </PopupShell>
  )
}

// ─── Nav hover card content ────────────────────────────────────────
function NavHoverContent({ label, info }: { label: string; info: HoverInfo }) {
  const Visual = visualComponents[info.visual]
  return (
    <div className="flex flex-col overflow-hidden -m-4">
      <div className="relative h-[120px] w-full bg-muted/50 border-b border-border/40 overflow-hidden rounded-t-md">
        {Visual && <Visual />}
      </div>
      <div className="p-3.5 pt-3">
        <h4 className="text-[13px] font-semibold text-foreground leading-tight">{label}</h4>
        <p className="text-[11px] text-foreground/45 mt-0.5 leading-tight">{info.description}</p>
        <p className="text-[11.5px] text-foreground/60 mt-2 leading-relaxed">{info.detail}</p>
      </div>
    </div>
  )
}

// ─── NavButton (memoized) ─────────────────────────────────────────
const NavButton = memo(function NavButton({
  icon,
  label,
  tooltip: tooltipText,
  onClick,
  variant = "default",
  id,
  isActive,
  href,
  hoverInfo,
  livePopup,
  onHoverCardOpen,
}: {
  icon: React.ReactNode
  label: string
  tooltip?: string
  onClick?: () => void
  variant?: "default" | "primary"
  id?: string
  isActive?: boolean
  href?: string
  accentColor?: string
  hoverInfo?: HoverInfo
  livePopup?: ReactNode
  onHoverCardOpen?: () => void
}) {
  const { open, isMobile } = useSidebar()
  const expanded = isMobile || open

  const content = (
    <span
      className={cn(
        "group/btn relative flex w-full items-center rounded-lg transition-all duration-200 ease-out",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50",
        expanded ? "gap-2.5 px-2.5 py-[7px]" : "justify-center p-2",
        variant === "primary"
          ? cn(
              "bg-sidebar-primary text-sidebar-primary-foreground",
              "shadow-[0_1px_2px_rgba(0,0,0,0.15),inset_0_1px_0_rgba(255,255,255,0.1)]",
              "hover:shadow-[0_2px_8px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.12)]",
              "hover:brightness-[1.08] active:brightness-95 active:scale-[0.98]"
            )
          : isActive
            ? "bg-sidebar-accent/80 text-sidebar-accent-foreground"
            : "text-foreground/45 hover:text-foreground/80 hover:bg-sidebar-accent/40"
      )}
    >
      {isActive && variant !== "primary" && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-3.5 rounded-r-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.3)]" />
      )}
      <span className={cn(
        "shrink-0 flex items-center justify-center w-4 h-4 transition-colors duration-200",
        isActive ? "text-emerald-500" : variant !== "primary" && "group-hover/btn:text-foreground/70"
      )}>
        {icon}
      </span>
      {expanded && (
        <span className={cn(
          "truncate text-[12.5px] tracking-[-0.01em]",
          isActive ? "font-semibold text-foreground" : "font-medium"
        )}>
          {label}
        </span>
      )}
    </span>
  )

  const linkOrButton = href ? (
    <Link id={id} href={href} className="block w-full" onClick={onClick}>
      {content}
    </Link>
  ) : (
    <button id={id} className="w-full" type="button" onClick={onClick}>
      {content}
    </button>
  )

  // Collapsed: simple tooltip
  if (!expanded) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{linkOrButton}</TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          <div className="flex flex-col">
            <span className="font-medium text-[12px]">{label}</span>
            {tooltipText && (
              <span className="text-[10.5px] text-muted-foreground font-normal">{tooltipText}</span>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    )
  }

  // Expanded with livePopup: data-driven popup
  if (livePopup && variant !== "primary") {
    return (
      <HoverCard
        openDelay={350}
        closeDelay={200}
        onOpenChange={(open) => { if (open && onHoverCardOpen) onHoverCardOpen() }}
      >
        <HoverCardTrigger asChild>
          {linkOrButton}
        </HoverCardTrigger>
        <HoverCardContent
          side="right"
          align="start"
          sideOffset={12}
          className="w-auto p-0 border-0 bg-transparent shadow-none"
        >
          {livePopup}
        </HoverCardContent>
      </HoverCard>
    )
  }

  // Expanded with hoverInfo: visual hover card (fallback)
  if (hoverInfo && variant !== "primary") {
    return (
      <HoverCard
        openDelay={400}
        closeDelay={200}
        onOpenChange={(open) => { if (open && onHoverCardOpen) onHoverCardOpen() }}
      >
        <HoverCardTrigger asChild>
          {linkOrButton}
        </HoverCardTrigger>
        <HoverCardContent
          side="right"
          align="start"
          sideOffset={16}
          className="w-64 p-4 border border-border/50 shadow-xl rounded-xl"
        >
          <NavHoverContent label={label} info={hoverInfo} />
        </HoverCardContent>
      </HoverCard>
    )
  }

  return linkOrButton
})

// ─── Section label ─────────────────────────────────────────────────
function SectionLabel({ children, expanded }: { children: React.ReactNode; expanded: boolean }) {
  if (!expanded) return <div className="mx-auto my-2 w-5 h-px bg-sidebar-border/20 rounded-full" />
  return (
    <div className="text-[10px] font-semibold text-foreground/35 uppercase tracking-[0.08em] mb-1 mt-0.5 px-2.5 select-none">
      {children}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
//  SidebarNavSection — owns machine polling + lazy popup data
//  so state changes here don't re-render the footer
// ═══════════════════════════════════════════════════════════════════
export const SidebarNavSection = memo(function SidebarNavSection({
  user,
  expanded,
  isMobile,
  closeMobileIfNeeded,
  handleNavigation,
}: {
  user: { id: string } | null | undefined
  expanded: boolean
  isMobile: boolean
  closeMobileIfNeeded: () => void
  handleNavigation: (fn: () => void) => void
}) {
  const t = useTranslations("sidebar")
  const router = useRouter()
  const pathname = usePathname()
  const { chats: allChats } = useChats()
  const { stats: machineStats } = useSidebarMachines(user)

  // Lazy-fetch popup data — only fetched on first hover
  const [sidebarSwarms, triggerSwarmsFetch] = useLazyFetch(
    "/api/swarms",
    (d: any) => d.swarms || [],
    [] as { swarm_id: string; status?: string; created_at: string; prompt?: string; machine_count?: number }[]
  )
  const [sidebarSchedules, triggerSchedulesFetch] = useLazyFetch(
    "/api/schedules",
    (d: any) => d.schedules || [],
    [] as { chat_id: string; title: string | null; enabled: boolean; frequency: string; next_run_at: string | null; run_count: number; consecutive_failures: number }[]
  )
  const [sidebarSecrets, triggerSecretsFetch] = useLazyFetch(
    "/api/secrets",
    (d: any) => d.secrets || [],
    [] as { id: string; name: string; service: string; username: string; updatedAt: string }[]
  )

  const isItemActive = (href: string) => {
    if (href === "/") return pathname === "/"
    return pathname?.startsWith(href) || false
  }

  // Memoize live popup JSX so NavButton gets stable props
  const historyPopup = useMemo(
    () => allChats.length > 0 ? <HistoryLivePopup chats={allChats} /> : undefined,
    [allChats]
  )
  const swarmsPopup = useMemo(
    () => sidebarSwarms.length > 0 ? <SwarmsLivePopup swarms={sidebarSwarms} /> : undefined,
    [sidebarSwarms]
  )
  const schedulesPopup = useMemo(
    () => sidebarSchedules.length > 0 ? <WorkforceLivePopup schedules={sidebarSchedules} /> : undefined,
    [sidebarSchedules]
  )
  const secretsPopup = useMemo(
    () => sidebarSecrets.length > 0 ? <CredentialsLivePopup secrets={sidebarSecrets} /> : undefined,
    [sidebarSecrets]
  )

  return (
    <>
      {/* New Task */}
      <div className={cn("relative", expanded ? "pb-1 mb-0.5" : "pb-1 mb-0.5")}>
        <NavButton
          icon={<IconPlus size={16} stroke={2} className="shrink-0" />}
          label={t("newTask")}
          tooltip={t("newTaskDescription")}
          onClick={() => handleNavigation(() => router.push("/"))}
          variant="primary"
        />
      </div>

      {/* Divider */}
      <div className={cn(
        "mx-auto mb-2 transition-all",
        expanded
          ? "w-[calc(100%-1.25rem)] h-px bg-gradient-to-r from-transparent via-sidebar-border/20 to-transparent"
          : "w-5 h-px bg-sidebar-border/15"
      )} />

      {/* Activity */}
      <div className="relative pb-1">
        <SectionLabel expanded={expanded}>{t("activity")}</SectionLabel>
        <div className="space-y-0.5">
          <NavButton
            id="sidebar-history-link"
            icon={<IconClockPlay size={16} stroke={1.5} className="shrink-0" />}
            label={t("taskHistory")}
            tooltip={t("taskHistoryDescription")}
            href="/history"
            isActive={isItemActive("/history")}
            accentColor="text-blue-500"
            onClick={closeMobileIfNeeded}
            livePopup={historyPopup}
            hoverInfo={{
              description: t("taskHistoryPopup.title"),
              detail: t("taskHistoryPopup.description"),
              visual: "history",
            }}
          />
          <NavButton
            id="sidebar-swarms-link"
            icon={<IconBinaryTree size={16} stroke={1.5} className="shrink-0" />}
            label={t("swarmRuns")}
            tooltip={t("swarmRunsDescription")}
            href="/swarms"
            isActive={isItemActive("/swarms")}
            accentColor="text-violet-500"
            onClick={closeMobileIfNeeded}
            livePopup={swarmsPopup}
            onHoverCardOpen={triggerSwarmsFetch}
            hoverInfo={{
              description: t("swarmRunsPopup.title"),
              detail: t("swarmRunsPopup.description"),
              visual: "swarms",
            }}
          />
          <NavButton
            id="sidebar-guide-link"
            icon={<IconBook2 size={16} stroke={1.5} className="shrink-0" />}
            label={t("guide")}
            tooltip={t("guideDescription")}
            href="/guide"
            isActive={isItemActive("/guide")}
            accentColor="text-emerald-500"
            onClick={closeMobileIfNeeded}
            hoverInfo={{
              description: t("guidePopup.title"),
              detail: t("guidePopup.description"),
              visual: "guide",
            }}
          />
          <NavButton
            id="sidebar-discover-link"
            icon={<IconCompass size={16} stroke={1.5} className="shrink-0" />}
            label="Community"
            tooltip="See how people use Coasty"
            href="/discover"
            isActive={isItemActive("/discover")}
            accentColor="text-sky-500"
            onClick={closeMobileIfNeeded}
            hoverInfo={{
              description: "Community Sessions",
              detail: "See what others are automating and get inspired for your next workflow.",
              visual: "guide",
            }}
          />
        </div>
      </div>

      {/* Infrastructure */}
      <div className="relative pb-1 mt-2.5">
        <SectionLabel expanded={expanded}>{t("infrastructure")}</SectionLabel>
        <div className="space-y-0.5">
          {/* My Computers */}
          {expanded ? (
            <button
              id="sidebar-machines-link"
              className={cn(
                "group/btn relative flex w-full items-center rounded-lg transition-all duration-200 ease-out",
                "gap-2.5 px-2.5 py-[7px]",
                isItemActive("/machines")
                  ? "bg-sidebar-accent/80 text-sidebar-accent-foreground"
                  : "text-foreground/45 hover:text-foreground/80 hover:bg-sidebar-accent/40"
              )}
              type="button"
              onClick={() => {
                router.push("/machines")
                closeMobileIfNeeded()
              }}
            >
              {isItemActive("/machines") && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-3.5 rounded-r-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.3)]" />
              )}
              <span className={cn(
                "shrink-0 flex items-center justify-center w-4 h-4 transition-colors duration-200",
                isItemActive("/machines") ? "text-emerald-500" : "group-hover/btn:text-foreground/70"
              )}>
                <IconDeviceDesktop size={16} stroke={1.5} />
              </span>
              <span className={cn(
                "truncate text-[12.5px] tracking-[-0.01em]",
                isItemActive("/machines") ? "font-semibold text-foreground" : "font-medium"
              )}>
                {machineStats.total === 1 ? t("computer") : t("computers")}
              </span>
              {machineStats.total > 0 && (
                <span className="ml-auto flex items-center gap-1.5 shrink-0">
                  {machineStats.running > 0 && (
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.4)]" />
                  )}
                  <span className={cn(
                    "text-[11px] tabular-nums font-medium",
                    isItemActive("/machines") ? "text-foreground/50" : "text-foreground/25"
                  )}>
                    {machineStats.total}
                  </span>
                </span>
              )}
            </button>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  id="sidebar-machines-link"
                  className={cn(
                    "relative flex w-full items-center justify-center p-2 rounded-lg transition-all duration-200",
                    isItemActive("/machines")
                      ? "bg-sidebar-accent/80"
                      : "text-foreground/45 hover:text-foreground/80 hover:bg-sidebar-accent/40"
                  )}
                  onClick={() => router.push("/machines")}
                >
                  <IconDeviceDesktop size={16} stroke={1.5} className={isItemActive("/machines") ? "text-emerald-500" : ""} />
                  {machineStats.running > 0 && (
                    <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.4)]" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold">{machineStats.total}</span>
                  <span className="text-muted-foreground">{machineStats.total === 1 ? t("computer") : t("computers")}</span>
                  {machineStats.running > 0 && (
                    <span className="text-emerald-500">({machineStats.running} {t("active")})</span>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          )}
          <NavButton
            id="sidebar-schedules-link"
            icon={<IconCalendarClock size={16} stroke={1.5} className="shrink-0" />}
            label={t("workforce")}
            tooltip={t("workforceDescription")}
            href="/schedules"
            isActive={isItemActive("/schedules")}
            accentColor="text-amber-500"
            onClick={closeMobileIfNeeded}
            livePopup={schedulesPopup}
            onHoverCardOpen={triggerSchedulesFetch}
            hoverInfo={{
              description: t("workforcePopup.title"),
              detail: t("workforcePopup.description"),
              visual: "workforce",
            }}
          />
          <NavButton
            id="sidebar-secrets-link"
            icon={<IconShieldLock size={16} stroke={1.5} className="shrink-0" />}
            label={t("credentials")}
            tooltip={t("credentialsDescription")}
            href="/secrets"
            isActive={isItemActive("/secrets")}
            accentColor="text-rose-500"
            onClick={closeMobileIfNeeded}
            livePopup={secretsPopup}
            onHoverCardOpen={triggerSecretsFetch}
            hoverInfo={{
              description: t("credentialsPopup.title"),
              detail: t("credentialsPopup.description"),
              visual: "credentials",
            }}
          />
        </div>
      </div>
    </>
  )
})
