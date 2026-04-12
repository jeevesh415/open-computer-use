"use client"

import { memo, useMemo, useRef, useState, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import {
  IconVideo,
  IconGift,
} from "@tabler/icons-react"
import Link from "next/link"
import Image from "next/image"
import { Download } from "lucide-react"
import { cn } from "@/lib/utils"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
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
import { useCredits } from "@/lib/hooks/use-credits"
import { AnimatedThemeToggler } from "@/components/magicui/animated-theme-toggler"
import { WindowsIcon, AppleIcon } from "@/components/icons/platform-icons"
import { useAccountDialog } from "@/lib/account-dialog-store"

// ─── Credits sparkline background ───────────────────────────────────
const CreditsSparkBg = memo(function CreditsSparkBg({
  balance,
  totalUsed,
  className,
}: {
  balance: number
  totalUsed: number
  className?: string
}) {
  const { d, areaD } = useMemo(() => {
    const total = balance + totalUsed
    const pct = total > 0 ? balance / total : 1
    const w = 200
    const h = 40
    const pad = 2
    const points = 8
    const values: number[] = []

    for (let i = 0; i < points; i++) {
      const t = i / (points - 1)
      const base =
        pct + (1 - pct) * (1 - t) * (0.6 + 0.4 * Math.sin(t * Math.PI))
      const jitter =
        Math.sin(t * Math.PI * 3) * 0.06 +
        Math.cos(t * Math.PI * 1.5) * 0.04
      values.push(Math.min(1, Math.max(0.05, base + jitter)))
    }

    const getX = (i: number) => pad + (i / (points - 1)) * (w - pad * 2)
    const getY = (v: number) => h - pad - v * (h - pad * 2)

    let d = `M ${getX(0)} ${getY(values[0])}`
    for (let i = 1; i < points; i++) {
      const cpx1 = getX(i - 1) + (getX(i) - getX(i - 1)) / 3
      const cpx2 = getX(i) - (getX(i) - getX(i - 1)) / 3
      d += ` C ${cpx1} ${getY(values[i - 1])}, ${cpx2} ${getY(values[i])}, ${getX(i)} ${getY(values[i])}`
    }

    const areaD = d + ` L ${getX(points - 1)} ${h} L ${getX(0)} ${h} Z`
    return { d, areaD }
  }, [balance, totalUsed])

  return (
    <svg
      className={cn("absolute inset-0 w-full h-full", className)}
      viewBox="0 0 200 40"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id="spark-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.12" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="spark-line" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.1" />
          <stop offset="50%" stopColor="currentColor" stopOpacity="0.3" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.15" />
        </linearGradient>
      </defs>
      <path d={areaD} fill="url(#spark-fill)" />
      <path d={d} fill="none" stroke="url(#spark-line)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
})

// ─── Credits usage graph popup ─────────────────────────────────────
function CreditsUsageGraph({
  balance,
  totalUsed,
  totalPurchased,
  isLow,
}: {
  balance: number
  totalUsed: number
  totalPurchased: number
  isLow: boolean
}) {
  const t = useTranslations("sidebar")
  const total = balance + totalUsed
  const usedPct = total > 0 ? totalUsed / total : 0

  const days = t.raw("days") as string[]
  const weights = [0.18, 0.16, 0.2, 0.14, 0.12, 0.08, 0.12]
  const fallbackWeights = [0.35, 0.25, 0.45, 0.3, 0.2, 0.15, 0.28]
  const maxWeight = Math.max(...weights)
  const barValues = weights.map((w, i) =>
    totalUsed > 0 ? w / maxWeight : fallbackWeights[i]
  )

  const barMaxH = 52

  const accentColor = isLow ? "text-orange-500 dark:text-orange-400" : "text-emerald-500 dark:text-emerald-400"
  const accentBg = isLow ? "bg-orange-500 dark:bg-orange-400" : "bg-emerald-500 dark:bg-emerald-400"
  const accentFill = isLow
    ? "from-orange-500/30 to-orange-500/5 dark:from-orange-400/30 dark:to-orange-400/5"
    : "from-emerald-500/30 to-emerald-500/5 dark:from-emerald-400/30 dark:to-emerald-400/5"

  return (
    <div className="w-72 rounded-xl overflow-hidden border border-border/60 bg-popover shadow-2xl dark:border-white/[0.06]">
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-baseline justify-between mb-3">
          <div>
            <span className={cn("text-xl font-bold tabular-nums", isLow ? "text-orange-500 dark:text-orange-400" : "text-popover-foreground")}>
              {balance.toLocaleString()}
            </span>
            <span className="text-[10px] text-muted-foreground ml-1.5 font-medium">{t("credits.creditsLeft")}</span>
          </div>
          {totalPurchased > 0 && (
            <span className="text-[10px] text-muted-foreground/60 tabular-nums">
              of {totalPurchased.toLocaleString()}
            </span>
          )}
        </div>

        <div className="h-1.5 w-full bg-foreground/[0.06] rounded-full overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all duration-500", accentBg, "opacity-60")}
            style={{ width: `${Math.max(2, usedPct * 100)}%` }}
          />
        </div>
        <div className="flex justify-between mt-1.5">
          <span className="text-[9px] text-muted-foreground">{t("credits.usedLabel", { count: totalUsed.toLocaleString() })}</span>
          <span className={cn("text-[9px]", isLow ? "text-orange-500/60 dark:text-orange-400/60" : "text-muted-foreground")}>
            {t("credits.consumed", { percent: (usedPct * 100).toFixed(0) })}
          </span>
        </div>
      </div>

      <div className="mx-3 mb-3 rounded-lg backdrop-blur-[3px] bg-foreground/[0.03] border border-foreground/[0.06] px-3 pt-2.5 pb-2">
        <p className="text-[9px] text-muted-foreground font-medium uppercase tracking-wider mb-2">{t("credits.usageThisWeek")}</p>

        <div className="flex items-end gap-[6px]" style={{ height: `${barMaxH}px` }}>
          {barValues.map((v, i) => {
            const h = Math.max(3, Math.round(v * barMaxH))
            return (
              <div key={i} className="flex-1 relative rounded-sm overflow-hidden" style={{ height: `${h}px` }}>
                <div className={cn("absolute inset-0 rounded-sm bg-gradient-to-t", accentFill)} />
                <div className={cn("absolute bottom-0 inset-x-0 h-[2px] rounded-full", accentBg, "opacity-50")} />
              </div>
            )
          })}
        </div>

        <div className="flex gap-[6px] mt-1.5">
          {days.map((d, i) => (
            <span key={i} className="flex-1 text-center text-[8px] text-muted-foreground/60 font-medium">
              {d}
            </span>
          ))}
        </div>
      </div>

      <button onClick={() => useAccountDialog.getState().open("billing")} className="block w-full text-left px-4 pb-3 hover:opacity-80 transition-opacity">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">10 credits / minute of usage</span>
          <span className={cn("text-[10px] font-medium", accentColor)}>
            View billing →
          </span>
        </div>
      </button>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
//  SidebarFooterSection — owns credits state
//  so credits changes don't re-render the nav section
// ═══════════════════════════════════════════════════════════════════
export const SidebarFooterSection = memo(function SidebarFooterSection({
  user,
  expanded,
  isMobile,
  closeMobileIfNeeded,
}: {
  user: { id: string; display_name?: string | null; email?: string | null; profile_image?: string | null } | null | undefined
  expanded: boolean
  isMobile: boolean
  closeMobileIfNeeded: () => void
}) {
  const t = useTranslations("sidebar")
  const openAccountDialog = useAccountDialog((s) => s.open)
  const { credits } = useCredits()
  const [avatarWobble, setAvatarWobble] = useState(false)
  const avatarHoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const getGreeting = () => {
    const h = new Date().getHours()
    if (h < 5) return "Night owl"
    if (h < 12) return "Good morning"
    if (h < 17) return "Good afternoon"
    if (h < 21) return "Good evening"
    return "Night owl"
  }

  const balance = credits?.balance || 0
  const totalUsed = credits?.total_used || 0
  const totalPurchased = credits?.total_purchased || 0
  const isLow = balance > 0 && balance < 50

  return (
    <div className={cn("flex flex-col", expanded ? "p-2 pt-2.5 gap-1.5" : "p-1.5 pt-2 gap-1.5")}>
      {/* Desktop App Download */}
      {expanded ? (
        <HoverCard openDelay={300} closeDelay={200}>
          <HoverCardTrigger asChild>
            <Link
              href="/download"
              className="group/dl relative flex w-full flex-col rounded-xl overflow-hidden transition-all duration-300 hover:shadow-[0_2px_12px_rgba(0,0,0,0.15)] active:scale-[0.98] ring-1 ring-white/[0.06] hover:ring-white/[0.12]"
              onClick={closeMobileIfNeeded}
            >
              <div className="relative w-full h-[72px] overflow-hidden">
                <Image
                  src="/demo-screenshot.png"
                  alt="Coasty Desktop"
                  width={400}
                  height={100}
                  className="w-full h-full object-cover object-center scale-[1.05] transition-transform duration-500 group-hover/dl:scale-[1.12]"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/10" />
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.04] to-transparent translate-x-[-100%] group-hover/dl:translate-x-[100%] transition-transform duration-700" />
              </div>
              <div className="absolute inset-x-0 bottom-0 px-2.5 py-2 flex items-end justify-between gap-2">
                <div className="min-w-0">
                  <span className="text-[11.5px] font-semibold text-white/90 leading-tight block drop-shadow-sm">
                    {t("desktopApp.getDesktopApp")}
                  </span>
                  <div className="flex items-center gap-1.5 mt-[3px]">
                    <span className="inline-flex items-center gap-1 text-[8.5px] text-white/45 font-medium">
                      <WindowsIcon width={7} height={7} className="opacity-60" />
                      {t("desktopApp.windows")}
                    </span>
                    <span className="text-white/15 text-[7px]">|</span>
                    <span className="inline-flex items-center gap-1 text-[8.5px] text-white/45 font-medium">
                      <AppleIcon width={7} height={7} className="opacity-60" />
                      {t("desktopApp.macos")}
                    </span>
                  </div>
                </div>
                <span className="shrink-0 flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.12] backdrop-blur-sm border border-white/[0.1] transition-all duration-300 group-hover/dl:bg-white/[0.2] group-hover/dl:scale-105">
                  <Download size={13} strokeWidth={2.2} className="text-white/80 transition-transform duration-300 group-hover/dl:translate-y-[1px]" />
                </span>
              </div>
            </Link>
          </HoverCardTrigger>
          <HoverCardContent
            side="right"
            align="end"
            sideOffset={12}
            className="w-72 p-0 border-0 bg-transparent shadow-none overflow-hidden rounded-xl"
          >
            <div className="relative rounded-xl overflow-hidden">
              <Image
                src="/demo-screenshot.png"
                alt="Coasty Desktop App"
                width={728}
                height={408}
                className="w-full h-auto"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/30 to-black/10" />
              <div className="absolute inset-0 flex flex-col justify-end p-3.5">
                <div className="rounded-lg backdrop-blur-[3px] bg-white/[0.04] border border-white/[0.06] px-3 py-2.5">
                  <p className="text-[11px] font-semibold text-white/90 leading-tight">
                    {t("desktopApp.controlRemotely")}
                  </p>
                  <p className="text-[10px] text-white/50 leading-snug mt-1">
                    {t("desktopApp.controlDescription")}
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="inline-flex items-center gap-1 text-[9px] text-white/50">
                      <WindowsIcon width={9} height={9} className="opacity-60" />
                      {t("desktopApp.windows")}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[9px] text-white/50">
                      <AppleIcon width={9} height={9} className="opacity-60" />
                      {t("desktopApp.macos")}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </HoverCardContent>
        </HoverCard>
      ) : null}

      {/* Credits */}
      {user && (
        <HoverCard openDelay={350} closeDelay={200}>
          <HoverCardTrigger asChild>
            {expanded ? (
              <button
                className={cn(
                  "group relative flex w-full items-center gap-3 rounded-lg border transition-all duration-200 overflow-hidden",
                  "hover:shadow-[0_1px_4px_rgba(0,0,0,0.06)] active:scale-[0.995]",
                  "px-3 py-2",
                  isLow
                    ? "border-orange-500/20 bg-orange-500/[0.03] hover:border-orange-500/30"
                    : "border-sidebar-border/30 bg-sidebar-accent/15 hover:border-sidebar-border/50"
                )}
                type="button"
                onClick={() => {
                  openAccountDialog("billing")
                  if (isMobile) closeMobileIfNeeded()
                }}
              >
                <CreditsSparkBg
                  balance={balance}
                  totalUsed={totalUsed}
                  className={cn(
                    "pointer-events-none",
                    isLow ? "text-orange-500" : "text-sidebar-primary/60"
                  )}
                />
                <div className="relative flex flex-col items-start flex-1 min-w-0">
                  <span className={cn(
                    "text-[15px] font-semibold tabular-nums leading-tight",
                    isLow ? "text-orange-500" : "text-foreground"
                  )}>
                    {balance.toLocaleString()}
                  </span>
                  <span className="text-[9.5px] text-foreground/35 font-medium">
                    {isLow ? t("credits.runningLow") : t("credits.remaining")}
                  </span>
                </div>
                <span className={cn(
                  "relative text-[9.5px] font-medium px-2 py-0.5 rounded transition-colors shrink-0",
                  "bg-sidebar-primary/8 text-sidebar-primary/80 group-hover:bg-sidebar-primary/15"
                )}>
                  {t("credits.buy")}
                </span>
              </button>
            ) : (
              <button
                className={cn(
                  "relative flex w-full items-center justify-center p-2 rounded-lg border transition-all duration-200 overflow-hidden",
                  "hover:shadow-[0_1px_4px_rgba(0,0,0,0.06)]",
                  isLow
                    ? "border-orange-500/20 bg-orange-500/[0.03]"
                    : "border-sidebar-border/30 bg-sidebar-accent/15"
                )}
                onClick={() => openAccountDialog("billing")}
              >
                <CreditsSparkBg
                  balance={balance}
                  totalUsed={totalUsed}
                  className={cn(
                    "pointer-events-none",
                    isLow ? "text-orange-500" : "text-sidebar-primary"
                  )}
                />
              </button>
            )}
          </HoverCardTrigger>
          <HoverCardContent
            side="right"
            align="end"
            sideOffset={12}
            className="w-auto p-0 border-0 bg-transparent shadow-none"
          >
            <CreditsUsageGraph
              balance={balance}
              totalUsed={totalUsed}
              totalPurchased={totalPurchased}
              isLow={isLow}
            />
          </HoverCardContent>
        </HoverCard>
      )}

      {/* Quick links — pill row, always single-line, full text on hover */}
      {expanded && (
        <div className="flex items-center gap-1.5 px-0.5">
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <a
                href="https://cal.com/coasty/15min"
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  "flex-1 min-w-0 flex items-center justify-center gap-1.5 rounded-full py-[5px] px-2.5",
                  "text-[11px] font-medium whitespace-nowrap transition-all duration-200",
                  "border border-sidebar-border/20 bg-sidebar-accent/10",
                  "text-foreground/40 hover:text-foreground/70 hover:bg-sidebar-accent/30 hover:border-sidebar-border/30"
                )}
              >
                <IconVideo size={13} stroke={1.5} className="shrink-0" />
                <span className="truncate">{t("talkToUs")}</span>
              </a>
            </TooltipTrigger>
            <TooltipContent
              side="top"
              sideOffset={6}
              className="animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-1 duration-200 px-3 py-1.5 text-xs font-medium"
            >
              {t("talkToUs")}
            </TooltipContent>
          </Tooltip>
          {user && (
            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <Link
                  href="/referral"
                  className={cn(
                    "flex-1 min-w-0 flex items-center justify-center gap-1.5 rounded-full py-[5px] px-2.5",
                    "text-[11px] font-medium whitespace-nowrap transition-all duration-200",
                    "border border-sidebar-border/20 bg-sidebar-accent/10",
                    "text-foreground/40 hover:text-foreground/70 hover:bg-sidebar-accent/30 hover:border-sidebar-border/30"
                  )}
                >
                  <IconGift size={13} stroke={1.5} className="shrink-0" />
                  <span className="truncate">{t("inviteEarn")}</span>
                </Link>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                sideOffset={6}
                className="animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-1 duration-200 px-3 py-1.5 text-xs font-medium"
              >
                {t("inviteEarn")}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      )}

      {/* Divider */}
      <div className={cn(
        "transition-all",
        expanded
          ? "w-[calc(100%-0.5rem)] mx-auto h-px bg-gradient-to-r from-transparent via-sidebar-border/20 to-transparent"
          : "w-5 mx-auto h-px bg-sidebar-border/15 rounded-full"
      )} />

      {/* User Account + Theme */}
      {expanded ? (
        <div className="flex items-center gap-1 w-full">
          <button
            onClick={() => openAccountDialog()}
            onMouseEnter={() => {
              avatarHoverTimer.current = setTimeout(() => setAvatarWobble(true), 3000)
            }}
            onMouseLeave={() => {
              clearTimeout(avatarHoverTimer.current)
              setAvatarWobble(false)
            }}
            className={cn(
              "flex items-center gap-2.5 px-2.5 py-2 flex-1 min-w-0 rounded-lg transition-all duration-200 ease-out",
              "hover:bg-sidebar-accent/40"
            )}
          >
            <Avatar className={cn(
              "h-7 w-7 flex-shrink-0 ring-1 ring-sidebar-border/20 transition-all",
              avatarWobble && "animate-wiggle"
            )}>
              <AvatarImage src={user?.profile_image || undefined} />
              <AvatarFallback className="bg-sidebar-accent/60 text-foreground text-[10px] font-semibold">
                {(user?.display_name || user?.email || "U")[0].toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col min-w-0 flex-1 text-left">
              <span className="text-[12.5px] font-medium truncate text-foreground/80">
                {user?.display_name || user?.email?.split("@")[0] || t("user")}
              </span>
              <span className="text-[10px] text-foreground/30 truncate">
                {getGreeting()}
              </span>
            </div>
          </button>
          <AnimatedThemeToggler
            className={cn(
              "flex items-center justify-center h-7 w-7 shrink-0 rounded-lg",
              "text-foreground/30 hover:text-foreground/70",
              "hover:bg-sidebar-accent/40",
              "transition-all duration-200 cursor-pointer",
            )}
          />
        </div>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => openAccountDialog()}
              className="flex w-full items-center justify-center p-1.5 rounded-lg hover:bg-sidebar-accent/40 transition-all duration-200"
            >
              <Avatar className="h-6 w-6 flex-shrink-0 ring-1 ring-sidebar-border/20">
                <AvatarImage src={user?.profile_image || undefined} />
                <AvatarFallback className="bg-sidebar-accent/60 text-foreground text-[9px] font-semibold">
                  {(user?.display_name || user?.email || "U")[0].toUpperCase()}
                </AvatarFallback>
              </Avatar>
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            {user?.display_name || user?.email?.split("@")[0] || t("account")}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  )
})
