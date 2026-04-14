"use client"

import { memo } from "react"
import { useTranslations } from "next-intl"
import {
  IconChevronRight,
  IconSettings,
  IconCreditCard,
  IconGift,
  IconVideo,
  IconLogout,
} from "@tabler/icons-react"
import Link from "next/link"
import Image from "next/image"
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
import { useUser } from "@/lib/user-store/provider"
import { AnimatedThemeToggler } from "@/components/magicui/animated-theme-toggler"
import { WindowsIcon, AppleIcon } from "@/components/icons/platform-icons"
import { useAccountDialog } from "@/lib/account-dialog-store"

// ─── Credit health model ──────────────────────────────────────────
type CreditHealth = "healthy" | "low" | "depleted"

function getHealth(balance: number, totalPurchased: number): CreditHealth {
  if (balance <= 0) return "depleted"
  if (balance < 50) return "low"
  if (totalPurchased > 0 && balance / totalPurchased < 0.15) return "low"
  return "healthy"
}

const HEALTH = {
  healthy: {
    dot: "bg-foreground/30",
    text: "text-foreground",
  },
  low: {
    dot: "bg-amber-500 dark:bg-amber-400",
    text: "text-amber-600 dark:text-amber-400",
  },
  depleted: {
    dot: "bg-rose-500 dark:bg-rose-400",
    text: "text-rose-600 dark:text-rose-400",
  },
} as const

// ─── Avatar hover-card menu ───────────────────────────────────────
//   Progressive disclosure: at-rest the footer shows just identity.
//   Everything else (account, billing, referral, talk-to-us, sign out)
//   lives one hover away.
function AvatarMenu({
  user,
  onAction,
}: {
  user: { display_name?: string | null; email?: string | null; profile_image?: string | null } | null | undefined
  onAction: () => void
}) {
  const t = useTranslations("sidebar")
  const openDialog = useAccountDialog((s) => s.open)
  const { signOut } = useUser()
  const displayName = user?.display_name || user?.email?.split("@")[0] || t("user")

  type Item =
    | { kind: "button"; icon: typeof IconSettings; label: string; onClick: () => void }
    | { kind: "link"; icon: typeof IconSettings; label: string; href: string }
    | { kind: "external"; icon: typeof IconSettings; label: string; href: string }

  const items: Item[] = [
    { kind: "button", icon: IconSettings, label: t("account"), onClick: () => { openDialog("account"); onAction() } },
    { kind: "button", icon: IconCreditCard, label: t("credits.buy"), onClick: () => { openDialog("billing"); onAction() } },
    { kind: "link", icon: IconGift, label: t("inviteEarn"), href: "/referral" },
    { kind: "external", icon: IconVideo, label: t("talkToUs"), href: "https://cal.com/coasty/15min" },
  ]

  const rowClass =
    "w-full flex items-center gap-2.5 px-2 py-[7px] rounded-md text-left transition-colors duration-100 text-muted-foreground/75 hover:text-foreground hover:bg-foreground/[0.04] dark:hover:bg-white/[0.04]"

  return (
    <div className="w-60 rounded-xl overflow-hidden border border-border/60 bg-popover shadow-2xl dark:border-white/[0.06]">
      <div className="px-3.5 pt-3.5 pb-3 flex items-center gap-3 border-b border-border/30 dark:border-white/[0.05]">
        <Avatar className="h-9 w-9 ring-1 ring-border/40">
          <AvatarImage src={user?.profile_image || undefined} />
          <AvatarFallback className="bg-foreground/[0.06] text-foreground text-[11px] font-semibold">
            {displayName[0].toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-[12.5px] font-semibold text-foreground truncate leading-tight">
            {displayName}
          </span>
          {user?.email && (
            <span className="text-[10.5px] text-muted-foreground/70 truncate mt-0.5">
              {user.email}
            </span>
          )}
        </div>
      </div>

      <div className="p-1.5">
        {items.map((item, i) => {
          const Icon = item.icon
          const inner = (
            <>
              <Icon size={14} stroke={1.5} className="shrink-0" />
              <span className="text-[12px] font-medium flex-1 truncate">{item.label}</span>
            </>
          )
          if (item.kind === "link") {
            return (
              <Link key={i} href={item.href} onClick={onAction} className={rowClass}>
                {inner}
              </Link>
            )
          }
          if (item.kind === "external") {
            return (
              <a
                key={i}
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={onAction}
                className={rowClass}
              >
                {inner}
              </a>
            )
          }
          return (
            <button key={i} type="button" onClick={item.onClick} className={rowClass}>
              {inner}
            </button>
          )
        })}
      </div>

      <div className="p-1.5 border-t border-border/30 dark:border-white/[0.05]">
        <button
          type="button"
          onClick={() => {
            signOut()
            onAction()
          }}
          className="w-full flex items-center gap-2.5 px-2 py-[7px] rounded-md text-left transition-colors duration-100 text-muted-foreground/75 hover:text-rose-500 dark:hover:text-rose-400 hover:bg-rose-500/[0.06]"
        >
          <IconLogout size={14} stroke={1.5} className="shrink-0" />
          <span className="text-[12px] font-medium">Sign out</span>
        </button>
      </div>
    </div>
  )
}

// ─── Desktop app hover-card popup ─────────────────────────────────
function DesktopAppPopup({ onAction }: { onAction?: () => void }) {
  const t = useTranslations("sidebar")
  return (
    <Link
      href="/download"
      onClick={onAction}
      className="block w-72 rounded-xl overflow-hidden border border-border/60 bg-popover shadow-2xl dark:border-white/[0.06] group/popup"
    >
      <div className="relative h-[148px] overflow-hidden">
        <Image
          src="/demo-screenshot.png"
          alt="Coasty Desktop"
          width={576}
          height={296}
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-3.5">
          <p className="text-[12px] font-semibold text-white leading-tight">
            {t("desktopApp.controlRemotely")}
          </p>
          <p className="text-[10.5px] text-white/55 leading-snug mt-1">
            {t("desktopApp.controlDescription")}
          </p>
        </div>
      </div>
      <div className="px-3.5 py-2.5 flex items-center justify-between border-t border-border/30 dark:border-white/[0.05]">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
            <WindowsIcon width={9} height={9} className="opacity-70" />
            {t("desktopApp.windows")}
          </span>
          <span className="inline-flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
            <AppleIcon width={9} height={9} className="opacity-70" />
            {t("desktopApp.macos")}
          </span>
        </div>
        <span className="text-[10.5px] font-medium text-blue-500 dark:text-blue-400 group-hover/popup:underline">
          {t("desktopApp.download")}
        </span>
      </div>
    </Link>
  )
}

// ═══════════════════════════════════════════════════════════════════
//  SidebarFooterSection
//  ─────────────────────
//  Three hairline-separated rows. No cards. No decorative backgrounds.
//  A single 2px vertical bar on the left edge represents credit health
//  as ambient art. Everything secondary lives in the avatar hover menu.
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

  const balance = credits?.balance ?? 0
  const totalPurchased = credits?.total_purchased ?? 0
  const health = getHealth(balance, totalPurchased)
  const c = HEALTH[health]

  const displayName = user?.display_name || user?.email?.split("@")[0] || t("user")

  // ─── Collapsed icon rail ───────────────────────────────────────
  if (!expanded) {
    return (
      <div className="flex flex-col items-center gap-1 px-1.5 pt-3 pb-2">
        {user && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => openAccountDialog("billing")}
                className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-foreground/[0.04] transition-colors"
              >
                <span className={cn("h-1.5 w-1.5 rounded-full", c.dot)} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              <span className="font-semibold tabular-nums">{balance.toLocaleString()}</span>
              <span className="text-muted-foreground ml-1">{t("credits.creditsLeft")}</span>
            </TooltipContent>
          </Tooltip>
        )}

        {user && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => openAccountDialog()}
                className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-foreground/[0.04] transition-colors"
              >
                <Avatar className="h-6 w-6 ring-1 ring-border/40">
                  <AvatarImage src={user?.profile_image || undefined} />
                  <AvatarFallback className="bg-foreground/[0.06] text-foreground text-[9px] font-semibold">
                    {displayName[0].toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              {displayName}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    )
  }

  // ─── Expanded ──────────────────────────────────────────────────
  // Parent px-2.5 (10px) is intentional: combined with the identity
  // button's `-mx-1 px-1` (net 0 offset), the avatar's left edge lands
  // at sidebar-x=10, making its center at sidebar-x=24 — exactly the
  // same axis as every nav icon and header logo above. Without this,
  // the avatar would shift 2px right when collapsing→expanding.
  return (
    <div className="pt-3 pb-2.5 px-2.5">
      {/* ── Row 1: Credits — the hero element ── */}
      {user && (
        <button
          type="button"
          onClick={() => {
            openAccountDialog("billing")
            if (isMobile) closeMobileIfNeeded()
          }}
          className="group block w-full text-left rounded-md px-1 py-1 -mx-1 transition-colors hover:bg-foreground/[0.025]"
        >
          <div className="flex items-baseline justify-between mb-[5px]">
            <span className="text-[9.5px] font-medium uppercase tracking-[0.1em] text-foreground/35">
              {t("credits.remaining")}
            </span>
            <span className={cn("h-1 w-1 rounded-full transition-colors", c.dot)} />
          </div>
          <div className="flex items-baseline gap-2">
            <span
              className={cn(
                "text-[28px] font-semibold tabular-nums tracking-[-0.025em] leading-none transition-colors",
                c.text
              )}
            >
              {balance.toLocaleString()}
            </span>
            {totalPurchased > 0 && totalPurchased > balance && (
              <span className="text-[10px] text-foreground/30 tabular-nums leading-none">
                / {totalPurchased.toLocaleString()}
              </span>
            )}
          </div>
        </button>
      )}

      {/* ── Row 2: Desktop App ── */}
      <HoverCard openDelay={300} closeDelay={200}>
        <HoverCardTrigger asChild>
          <Link
            href="/download"
            onClick={closeMobileIfNeeded}
            className={cn(
              "group/dl mt-3 pt-3 flex items-center gap-2",
              "border-t border-border/30 dark:border-white/[0.05]",
              "text-foreground/45 hover:text-foreground/85 transition-colors"
            )}
          >
            <svg
              width={14}
              height={14}
              viewBox="0 0 24 24"
              fill="none"
              className="shrink-0 text-foreground/35 group-hover/dl:text-foreground/70 transition-colors"
            >
              {/* monitor frame */}
              <rect
                x="2"
                y="3"
                width="20"
                height="14"
                rx="2.5"
                stroke="currentColor"
                strokeWidth="1.6"
              />
              {/* stand */}
              <path
                d="M8 21h8M12 17v4"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
              {/* download arrow */}
              <path
                d="M12 7.5v4.5m0 0l-2-2m2 2l2-2"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="text-[11.5px] font-medium flex-1 truncate">
              {t("desktopApp.getDesktopApp")}
            </span>
            <IconChevronRight
              size={12}
              stroke={1.75}
              className="shrink-0 text-foreground/25 group-hover/dl:text-foreground/55 group-hover/dl:translate-x-[1px] transition-all duration-200"
            />
          </Link>
        </HoverCardTrigger>
        <HoverCardContent
          side="right"
          align="end"
          sideOffset={12}
          className="w-auto p-0 border-0 bg-transparent shadow-none"
        >
          <DesktopAppPopup onAction={closeMobileIfNeeded} />
        </HoverCardContent>
      </HoverCard>

      {/* ── Row 3: Identity ── */}
      <div className="mt-2.5 pt-2.5 flex items-center gap-1 border-t border-border/30 dark:border-white/[0.05]">
        {user ? (
          <HoverCard openDelay={250} closeDelay={150}>
            <HoverCardTrigger asChild>
              <button
                type="button"
                onClick={() => openAccountDialog()}
                className="flex items-center gap-2.5 flex-1 min-w-0 rounded-md px-1 py-1 -mx-1 transition-colors hover:bg-foreground/[0.03]"
              >
                <Avatar className="h-7 w-7 shrink-0 ring-1 ring-border/40">
                  <AvatarImage src={user?.profile_image || undefined} />
                  <AvatarFallback className="bg-foreground/[0.06] text-foreground text-[10px] font-semibold">
                    {displayName[0].toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="text-[12.5px] font-medium text-foreground/85 truncate flex-1 text-left">
                  {displayName}
                </span>
              </button>
            </HoverCardTrigger>
            <HoverCardContent
              side="right"
              align="end"
              sideOffset={12}
              className="w-auto p-0 border-0 bg-transparent shadow-none"
            >
              <AvatarMenu user={user} onAction={closeMobileIfNeeded} />
            </HoverCardContent>
          </HoverCard>
        ) : (
          <div className="flex-1" />
        )}
        <AnimatedThemeToggler
          className={cn(
            "flex h-7 w-7 items-center justify-center shrink-0 rounded-md",
            "text-foreground/35 hover:text-foreground/75",
            "hover:bg-foreground/[0.04]",
            "transition-colors duration-150 cursor-pointer"
          )}
        />
      </div>
    </div>
  )
})
