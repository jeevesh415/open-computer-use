"use client"

import { memo, useMemo, useState, useEffect, useCallback, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import { useRouter, usePathname } from "next/navigation"
import {
  IconPlus,
  IconClockPlay,
  IconBinaryTree,
  IconDeviceDesktop,
  IconCalendarClock,
  IconShieldLock,
  IconKey,
  IconStack2,
  IconBrain,
} from "@tabler/icons-react"
import { MemoryDialog } from "@/app/components/layout/settings/general/memory-dialog"
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
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover"
import { useSidebar } from "@/components/ui/sidebar"
import { useChats } from "@/lib/chat-store/chats/provider"
import { useSidebarMachines } from "./hooks/use-sidebar-machines"
import { useLazyFetch } from "./hooks/use-lazy-fetch"
import { DEVELOPERS_API_ENABLED } from "@/lib/feature-flags"

// ─── Types ────────────────────────────────────────────────────────
type HoverInfo = {
  description: string
  detail: string
  visual: "history" | "swarms" | "guide" | "machines" | "workforce" | "credentials" | "developers"
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

function DevelopersVisual() {
  return (
    <div className="w-full h-full flex flex-col px-3 py-2 gap-1.5">
      <div className="flex items-center gap-1.5 shv-row" style={{ animationDelay: "0s" }}>
        <div className="flex items-center gap-1 px-2 py-[4px] rounded border border-foreground/10 bg-foreground/[0.03] flex-1">
          <div className="w-[5px] h-[5px] rounded-full bg-purple-500/50" />
          <div className="h-[3px] w-12 bg-foreground/10 rounded-full" />
          <div className="ml-auto h-[3px] w-6 bg-foreground/[0.06] rounded-full" />
        </div>
      </div>
      <div className="flex items-center gap-1.5 px-1 shv-row" style={{ animationDelay: "0.2s" }}>
        <span className="text-[5px] font-bold text-emerald-500/60 tracking-wide">POST</span>
        <div className="h-[3px] w-20 bg-foreground/10 rounded-full" />
        <span className="text-[5px] text-foreground/20 font-mono ml-auto">5 cr</span>
      </div>
      <div className="flex items-center gap-1.5 px-1 shv-row" style={{ animationDelay: "0.4s" }}>
        <span className="text-[5px] font-bold text-blue-500/60 tracking-wide">GET</span>
        <div className="h-[3px] w-16 bg-foreground/10 rounded-full" />
        <span className="text-[5px] text-foreground/20 font-mono ml-auto">free</span>
      </div>
      <div className="flex items-center gap-1 mt-1 shv-fade-up" style={{ animationDelay: "0.8s" }}>
        <div className="flex-1 px-2 py-[3px] rounded border border-foreground/10 bg-foreground/[0.02]">
          <div className="flex items-center gap-[1px]">
            {Array.from("sk-coasty-live-").map((c, i) => (
              <span key={i} className="text-[5px] text-purple-500/40 font-mono shv-type-char" style={{ animationDelay: `${1 + i * 0.04}s` }}>{c}</span>
            ))}
            {Array.from("...").map((c, i) => (
              <span key={`d${i}`} className="text-[5px] text-foreground/20 font-mono shv-type-char" style={{ animationDelay: `${1.6 + i * 0.05}s` }}>{c}</span>
            ))}
          </div>
        </div>
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
  developers: DevelopersVisual,
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
  accentColor,
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

  // Layout is intentionally identical in both expanded and collapsed
  // states so the icon never shifts during the width transition.
  // With parent px-2 (8) + item px-2 (8) + icon-half (8) = 24, every
  // icon's center sits at sidebar-x=24px in both modes — only the
  // label appears alongside as the rail widens.
  //
  // Fixed h-[30px] (instead of py-[7px]) keeps item height constant
  // regardless of whether the label is present. Without this, the
  // label's natural ~18.75px line-box would push expanded items
  // 2.75px taller than collapsed ones, accumulating vertical drift
  // down the nav.
  const content = (
    <span
      className={cn(
        "group/btn relative flex w-full items-center gap-2.5 px-2 h-[30px] rounded-lg transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50",
        variant === "primary"
          ? cn(
              "bg-sidebar-primary text-sidebar-primary-foreground",
              "shadow-[0_1px_2px_rgba(0,0,0,0.08)]",
              "hover:shadow-[0_2px_6px_rgba(0,0,0,0.12)]",
              "hover:brightness-[1.05] active:brightness-95 active:scale-[0.985]",
              "transition-all duration-200 ease-out"
            )
          : isActive
            ? "bg-foreground/[0.07] text-foreground dark:bg-white/[0.08]"
            : "text-foreground/55 hover:text-foreground/90 hover:bg-foreground/[0.04] dark:hover:bg-white/[0.04]"
      )}
    >
      <span className={cn(
        "shrink-0 flex items-center justify-center w-4 h-4 transition-colors duration-150",
        variant === "primary"
          ? ""
          : isActive
            ? "text-foreground"
            : "group-hover/btn:text-foreground/80"
      )}>
        {icon}
      </span>
      {expanded && (
        <span className="truncate text-[12.5px] font-medium tracking-[-0.01em]">
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

// ─── Section header ────────────────────────────────────────────────
//   Apple Music / Mail style: sentence case (not UPPERCASE), 11.5px
//   medium-weight, low-contrast (foreground/50). The label sits at
//   the *bottom* of a 28px wrapper, so most of the breathing room
//   lives ABOVE the label — separating it from the previous group —
//   while the bottom is tight, pairing the label with its own items.
//
//   Both modes are exactly 28px (h-7) tall — critical for preventing
//   vertical drift between collapsed and expanded. Collapsed mode
//   shows a centered hairline instead of the label so the icon rail
//   still has rhythmic group separators.
//
//   Label left-edge anchored at sidebar-x=16 (parent px-2 + pl-2),
//   the same column as nav icon left-edges. This creates a strict
//   left rail: every section header lines up with the icon column
//   below it, not the label column. Reads like Apple Music.
function SectionHeader({ label, expanded }: { label: string; expanded: boolean }) {
  if (!expanded) {
    return (
      <div aria-hidden className="h-7 flex items-center justify-center">
        <span className="w-5 h-px bg-sidebar-border/15 rounded-full" />
      </div>
    )
  }
  return (
    <div className="h-7 flex items-end px-2 pb-1">
      <span className="text-[11.5px] font-medium text-foreground/50 select-none leading-none">
        {label}
      </span>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
//  ResourceDropdown — disclosure row for Computers · Schedules · Creds
//
//  A 30px "Resources" trigger row with a custom-drawn caret; expands
//  inline to reveal three indented destinations along a gradient rail.
//  Defaults closed so the caret is the affordance; auto-opens when
//  the user is on a child route, and remembers manual toggles in
//  localStorage.
//
//  Details the eye registers without naming:
//   · Caret is hand-drawn at 10px with round caps — Tabler's default
//     has square joins that telegraph "stock icon".
//   · Open state paints a whisper of bg (foreground/[0.025]) behind
//     the trigger so it reads as a container, not a button.
//   · Rail fades top/bottom with a gradient instead of flat 1px line,
//     so its endpoints don't compete with adjacent rows.
//   · Active item paints a 2px caret bar exactly on the rail axis,
//     so the rail visually "lights up" where the user is.
//   · Items animate in with shv-row's slide-from-left, staggered 30ms.
//
//  Collapsed mode gets ResourcesFlyout — a click-popover with the
//  same three destinations in a compact shell.
// ═══════════════════════════════════════════════════════════════════
// A resource row can either navigate to a route OR trigger an action
// (open a dialog/popover). Exactly one of `href` and `onAction` is set;
// when `onAction` is provided we render a button instead of a Link, and
// the row's `active` state typically defaults to false (no URL to match).
type ResourceItem = {
  id: string
  icon: ReactNode
  label: string
  count?: number
  active: boolean
  dot?: boolean
  onNavigate: () => void
} & (
  | { href: string; onAction?: never }
  | { href?: never; onAction: () => void }
)

const RESOURCES_STORAGE_KEY = "coasty:sidebar:resources-open"

function Caret({ open, className }: { open: boolean; className?: string }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      aria-hidden="true"
      className={cn(
        "shrink-0 transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
        open && "rotate-90",
        className
      )}
    >
      <path
        d="M3.75 2.5L6.25 5L3.75 7.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}

function ResourceDropdown({ items, label }: { items: ResourceItem[]; label: string }) {
  const anyActive = items.some((i) => i.active)
  const anyDot = items.some((i) => i.dot)

  // `null` = user hasn't set a preference; fall back to anyActive.
  const [userOpen, setUserOpen] = useState<boolean | null>(null)

  useEffect(() => {
    if (typeof window === "undefined") return
    const saved = window.localStorage.getItem(RESOURCES_STORAGE_KEY)
    if (saved === "true") setUserOpen(true)
    else if (saved === "false") setUserOpen(false)
  }, [])

  const open = userOpen ?? anyActive

  const toggle = useCallback(() => {
    setUserOpen((prev) => {
      const next = !(prev ?? anyActive)
      if (typeof window !== "undefined") {
        window.localStorage.setItem(RESOURCES_STORAGE_KEY, String(next))
      }
      return next
    })
  }, [anyActive])

  // Re-mount the items wrapper on each open so the shv-row stagger replays.
  // Closing still animates smoothly via the outer grid-rows.
  const [mountKey, setMountKey] = useState(0)
  useEffect(() => {
    if (open) setMountKey((k) => k + 1)
  }, [open])

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls="sidebar-resources-panel"
        className={cn(
          "group/trig relative flex w-full items-center gap-2.5 px-2 h-[30px] rounded-lg",
          "transition-[background-color,color] duration-200 ease-out",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50",
          open
            ? "text-foreground/80 bg-foreground/[0.025] dark:bg-white/[0.03]"
            : "text-foreground/55 hover:text-foreground/90 hover:bg-foreground/[0.035] dark:hover:bg-white/[0.035]"
        )}
      >
        <span className="relative shrink-0 flex items-center justify-center w-4 h-4">
          <IconStack2
            size={16}
            stroke={1.5}
            className={cn(
              "transition-colors duration-200",
              open ? "text-foreground/75" : "group-hover/trig:text-foreground/80"
            )}
          />
          {anyDot && !open && (
            <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-emerald-500 ring-[1.5px] ring-sidebar dark:bg-emerald-400" />
          )}
        </span>
        <span className="flex-1 text-left truncate text-[12.5px] font-medium tracking-[-0.01em]">
          {label}
        </span>
        <Caret open={open} className={open ? "text-foreground/55" : "text-foreground/30"} />
      </button>

      <div
        id="sidebar-resources-panel"
        className={cn(
          "grid transition-[grid-template-rows,opacity] ease-[cubic-bezier(0.32,0.72,0,1)]",
          open
            ? "grid-rows-[1fr] opacity-100 duration-300"
            : "grid-rows-[0fr] opacity-0 duration-200"
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div key={mountKey} className="relative pl-4 pr-0 pt-1 pb-0.5 space-y-[1px]">
            {/* Gradient rail — fades at the endpoints so it doesn't
                bleed into the trigger above or the sibling row below. */}
            <div
              className="pointer-events-none absolute left-[15px] top-0 bottom-0 w-px
                         bg-gradient-to-b from-transparent via-foreground/15 to-transparent
                         dark:via-white/[0.09]"
            />
            {items.map((item, i) => {
              // Identical inner row — only the wrapper differs between
              // navigation rows (Link) and action rows (button).
              const inner = (
                <span
                  className={cn(
                    "group/item relative flex w-full items-center gap-2.5 pl-3 pr-2 h-[28px] rounded-md",
                    "transition-[background-color,color] duration-150",
                    item.active
                      ? "bg-foreground/[0.06] text-foreground dark:bg-white/[0.07]"
                      : "text-foreground/55 hover:text-foreground/90 hover:bg-foreground/[0.035] dark:hover:bg-white/[0.035]"
                  )}
                >
                  {/* Active caret bar sits exactly on the rail axis. */}
                  {item.active && (
                    <span className="absolute left-[-1px] top-[7px] bottom-[7px] w-[2px] rounded-full bg-foreground/55" />
                  )}
                  <span className="relative shrink-0 flex items-center justify-center w-4 h-4">
                    {item.icon}
                    {item.dot && (
                      <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-emerald-500 ring-[1.5px] ring-sidebar dark:bg-emerald-400" />
                    )}
                  </span>
                  <span className="flex-1 truncate text-[12px] font-medium tracking-[-0.01em] text-left">
                    {item.label}
                  </span>
                  {typeof item.count === "number" && item.count > 0 && (
                    <span
                      className={cn(
                        "shrink-0 text-[10px] tabular-nums tracking-wide transition-colors",
                        item.active ? "text-foreground/55" : "text-foreground/30 group-hover/item:text-foreground/50"
                      )}
                    >
                      {item.count}
                    </span>
                  )}
                </span>
              )

              // Key, className and style are identical between the
              // navigation row and the action row; we pass key inline
              // (not via spread) so the linter can see it.
              const rowClass = "block w-full shv-row"
              const rowStyle = {
                animationDelay: `${i * 30}ms`,
                animationDuration: "280ms",
              }

              if (item.onAction) {
                return (
                  <button
                    key={item.id}
                    id={item.id}
                    type="button"
                    className={rowClass}
                    style={rowStyle}
                    onClick={() => {
                      item.onAction()
                      item.onNavigate()
                    }}
                  >
                    {inner}
                  </button>
                )
              }
              return (
                <Link
                  key={item.id}
                  id={item.id}
                  href={item.href}
                  className={rowClass}
                  style={rowStyle}
                  onClick={item.onNavigate}
                >
                  {inner}
                </Link>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── ResourcesFlyout ─────────────────────────────────────────────
//   Collapsed-sidebar affordance for the resources group. A single
//   IconStack2 button with an emerald dot if anything is live; on
//   click, a compact popover reveals the same three destinations.
//   Matches the visual language of the inline dropdown so the two
//   modes feel like the same component at different scales.
function ResourcesFlyout({
  items,
  dot,
  anyActive,
}: {
  items: ResourceItem[]
  dot: boolean
  anyActive: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              id="sidebar-resources-collapsed"
              type="button"
              aria-label="Resources"
              className={cn(
                "group/trig relative flex w-full items-center gap-2.5 px-2 h-[30px] rounded-lg",
                "transition-[background-color,color] duration-200 ease-out",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50",
                open || anyActive
                  ? "bg-foreground/[0.06] text-foreground dark:bg-white/[0.07]"
                  : "text-foreground/55 hover:text-foreground/90 hover:bg-foreground/[0.035] dark:hover:bg-white/[0.035]"
              )}
            >
              <span className="relative shrink-0 flex items-center justify-center w-4 h-4">
                <IconStack2 size={16} stroke={1.5} />
                {dot && (
                  <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-emerald-500 ring-[1.5px] ring-sidebar dark:bg-emerald-400" />
                )}
              </span>
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        {!open && (
          <TooltipContent side="right" sideOffset={8}>
            <span className="font-medium text-[12px]">Resources</span>
          </TooltipContent>
        )}
      </Tooltip>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={10}
        className="w-52 p-1 rounded-xl border border-border/60 bg-popover shadow-2xl dark:border-white/[0.06]"
      >
        <div className="px-2.5 pt-2 pb-1.5">
          <span className="text-[10px] font-semibold tracking-[0.08em] uppercase text-muted-foreground">
            Resources
          </span>
        </div>
        <div className="h-px bg-border/40 dark:bg-white/[0.05] mx-1 mb-1" />
        <div className="space-y-[1px]">
          {items.map((item, i) => {
            const inner = (
              <span
                className={cn(
                  "group/row relative flex w-full items-center gap-2.5 px-2 h-[30px] rounded-md",
                  "transition-[background-color,color] duration-150",
                  item.active
                    ? "bg-foreground/[0.06] text-foreground dark:bg-white/[0.07]"
                    : "text-foreground/65 hover:text-foreground hover:bg-foreground/[0.04] dark:hover:bg-white/[0.04]"
                )}
              >
                <span className="relative shrink-0 flex items-center justify-center w-4 h-4">
                  {item.icon}
                  {item.dot && (
                    <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-emerald-500 ring-[1.5px] ring-popover dark:bg-emerald-400" />
                  )}
                </span>
                <span className="flex-1 truncate text-[12px] font-medium tracking-[-0.01em] text-left">
                  {item.label}
                </span>
                {typeof item.count === "number" && item.count > 0 && (
                  <span
                    className={cn(
                      "shrink-0 text-[10px] tabular-nums",
                      item.active ? "text-foreground/55" : "text-foreground/35"
                    )}
                  >
                    {item.count}
                  </span>
                )}
              </span>
            )

            const rowClass = "block w-full shv-row"
            const rowStyle = {
              animationDelay: `${i * 25}ms`,
              animationDuration: "240ms",
            }

            if (item.onAction) {
              return (
                <button
                  key={item.id}
                  type="button"
                  className={rowClass}
                  style={rowStyle}
                  onClick={() => {
                    item.onAction()
                    item.onNavigate()
                    setOpen(false)
                  }}
                >
                  {inner}
                </button>
              )
            }
            return (
              <Link
                key={item.id}
                href={item.href}
                className={rowClass}
                style={rowStyle}
                onClick={() => {
                  item.onNavigate()
                  setOpen(false)
                }}
              >
                {inner}
              </Link>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
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
  const tMemory = useTranslations("memory")
  const router = useRouter()
  const pathname = usePathname()
  const { chats: allChats } = useChats()
  const { stats: machineStats } = useSidebarMachines(user)

  // Memory quick-edit popup state. Opened from the "Memory" entry in
  // the Resources group (both expanded inline and collapsed flyout
  // modes). The dialog component is mounted unconditionally so its
  // mount/unmount lifecycle doesn't fight Radix's portal cleanup.
  const [memoryDialogOpen, setMemoryDialogOpen] = useState<boolean>(false)

  // Lazy-fetch popup data — only fetched on first hover. Schedules and
  // secrets previews are handled inside the Resources dropdown itself,
  // so only history (always shown) and swarms (its own nav row) need
  // lazy fetches here.
  const [sidebarSwarms, triggerSwarmsFetch] = useLazyFetch(
    "/api/swarms",
    (d: { swarms?: { swarm_id: string; status?: string; created_at: string; prompt?: string; machine_count?: number }[] }) => d.swarms || [],
    [] as { swarm_id: string; status?: string; created_at: string; prompt?: string; machine_count?: number }[]
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

      {/* ── Group 1 · Recent work ─────────────────────────────────
          History first (highest frequency return destination),
          then Swarms (its specialized parallel-runs sibling).
          The section header itself separates this group from the
          New Task button — no extra hairline needed. */}
      <SectionHeader label="Recent" expanded={expanded} />
      <div className="space-y-0.5">
        <NavButton
          id="sidebar-history-link"
          icon={<IconClockPlay size={16} stroke={1.5} className="shrink-0" />}
          label={t("taskHistory")}
          tooltip={t("taskHistoryDescription")}
          href="/history"
          isActive={isItemActive("/history")}
          accentColor="text-blue-500 dark:text-blue-400"
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
          accentColor="text-violet-500 dark:text-violet-400"
          onClick={closeMobileIfNeeded}
          livePopup={swarmsPopup}
          onHoverCardOpen={triggerSwarmsFetch}
          hoverInfo={{
            description: t("swarmRunsPopup.title"),
            detail: t("swarmRunsPopup.description"),
            visual: "swarms",
          }}
        />
      </div>

      <SectionHeader label="Workspace" expanded={expanded} />

      {/* ── Group 2 · Resources ───────────────────────────────────
          Expanded: a collapsible "Resources" row with a rotating
          caret that expands inline to show Computers / Schedules /
          Credentials along a gradient rail. Defaults closed so the
          caret is an obvious affordance; auto-opens on child routes
          and remembers manual toggles in localStorage.
          Collapsed: a single IconStack2 button that opens a popover
          flyout with the same three destinations — so no items are
          hidden in the narrow rail. Developers stays as its own
          row below — it's a distinct destination, not a resource. */}
      <div className="space-y-0.5">
        {(() => {
          const resourceItems: ResourceItem[] = [
            {
              id: "sidebar-machines-link",
              icon: <IconDeviceDesktop size={16} stroke={1.5} />,
              label: t(machineStats.total === 1 ? "computer" : "computers"),
              count: machineStats.total,
              href: "/machines",
              active: isItemActive("/machines"),
              dot: machineStats.running > 0,
              onNavigate: closeMobileIfNeeded,
            },
            {
              id: "sidebar-schedules-link",
              icon: <IconCalendarClock size={16} stroke={1.5} />,
              label: t("workforce"),
              href: "/schedules",
              active: isItemActive("/schedules"),
              onNavigate: closeMobileIfNeeded,
            },
            {
              id: "sidebar-secrets-link",
              icon: <IconShieldLock size={16} stroke={1.5} />,
              label: t("credentials"),
              href: "/secrets",
              active: isItemActive("/secrets"),
              onNavigate: closeMobileIfNeeded,
            },
            // Memory — quick-edit popup. Unlike the other resources
            // it has no dedicated route here; clicking opens a sleek
            // dialog with the same editor used in Account → Memory.
            // The full settings page is one click away via the
            // dialog's footer link.
            {
              id: "sidebar-memory-action",
              icon: <IconBrain size={16} stroke={1.5} />,
              // Localized via the dedicated memory namespace so the
              // sidebar label switches with the user's language.
              label: tMemory("sidebarLabel"),
              // No route to highlight; the dialog itself is the
              // affordance. `active` stays false so the rail's caret
              // bar doesn't appear here.
              active: false,
              onAction: () => setMemoryDialogOpen(true),
              onNavigate: closeMobileIfNeeded,
            },
          ]
          const anyResourceActive = resourceItems.some((r) => r.active)
          return expanded ? (
            <ResourceDropdown label="Resources" items={resourceItems} />
          ) : (
            <ResourcesFlyout
              items={resourceItems}
              dot={machineStats.running > 0}
              anyActive={anyResourceActive}
            />
          )
        })()}
        {DEVELOPERS_API_ENABLED && (
          <NavButton
            id="sidebar-developers-link"
            icon={<IconKey size={16} stroke={1.5} className="shrink-0" />}
            label="Developers"
            tooltip="API, MCP & integrations"
            href="/developers"
            isActive={isItemActive("/developers")}
            accentColor="text-purple-500 dark:text-purple-400"
            onClick={closeMobileIfNeeded}
            hoverInfo={{
              description: "Developers",
              detail: "API keys, MCP, SDKs, and everything to integrate computer-use intelligence into your apps.",
              visual: "developers",
            }}
          />
        )}
      </div>

      {/* Memory quick-edit popup — mounted unconditionally so its open
          animation always plays from a stable DOM root. */}
      <MemoryDialog open={memoryDialogOpen} onOpenChange={setMemoryDialogOpen} />
    </>
  )
})
