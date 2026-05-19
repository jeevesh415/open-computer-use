"use client"

import { memo } from "react"
import Link from "next/link"
import { useRouter, usePathname } from "next/navigation"
import { useTranslations } from "next-intl"
import { motion } from "framer-motion"
import { useTheme } from "next-themes"
import {
  type Icon as TablerIcon,
  IconPlus,
  IconClockPlay,
  IconBinaryTree,
  IconBook2,
  IconCompass,
  IconDeviceDesktop,
  IconCalendarClock,
  IconShieldLock,
  IconLogout,
  IconSettings,
  IconGift,
  IconVideo,
  IconSun,
  IconMoon,
  IconInfinity,
} from "@tabler/icons-react"
import { CoastyIcon } from "@/components/icons/coasty"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
} from "@/components/ui/hover-card"
import { cn } from "@/lib/utils"
import { useUser } from "@/lib/user-store/provider"
import { useCredits } from "@/lib/hooks/use-credits"
import { useSubscription } from "@/lib/hooks/use-subscription"
import { useAccountDialog } from "@/lib/account-dialog-store"
import { useSidebarMachines } from "@/app/components/layout/sidebar/hooks/use-sidebar-machines"

// ─── Types ────────────────────────────────────────────────────────
type NavItemDef = {
  id: string
  icon: TablerIcon
  label: string
  href: string
  badge?: number | null
}

// ═══════════════════════════════════════════════════════════════════
//  AppTopBar — horizontal navigation pill
//  ──────────────────────────────────────
//  Floating glass pill that mirrors the landing page's top nav
//  architecture: a max-w-7xl container with a backdrop-blurred glass
//  shell, hairline ring border, and top-edge gradient highlight.
//  Nav items group by spacing (no vertical dividers inside the pill)
//  and the active item slides between positions via framer-motion's
//  layoutId. Labels collapse to icon-only below `lg` so the pill
//  degrades gracefully at 640-1024px viewports (below 640px the app
//  falls back to the vertical sidebar entirely).
// ═══════════════════════════════════════════════════════════════════
export const AppTopBar = memo(function AppTopBar() {
  const router = useRouter()
  const pathname = usePathname()
  const t = useTranslations("sidebar")
  const { user } = useUser()
  const openAccountDialog = useAccountDialog((s) => s.open)
  const { stats: machineStats } = useSidebarMachines(user)

  const isItemActive = (href: string) => {
    if (href === "/") return pathname === "/"
    return pathname?.startsWith(href) || false
  }

  const recentItems: NavItemDef[] = [
    { id: "history", icon: IconClockPlay, label: t("taskHistory"), href: "/history" },
    { id: "swarms", icon: IconBinaryTree, label: t("swarmRuns"), href: "/swarms" },
  ]

  const workspaceItems: NavItemDef[] = [
    {
      id: "machines",
      icon: IconDeviceDesktop,
      label: machineStats.total === 1 ? t("computer") : t("computers"),
      href: "/machines",
      badge: machineStats.total > 0 ? machineStats.total : null,
    },
    { id: "schedules", icon: IconCalendarClock, label: t("workforce"), href: "/schedules" },
    { id: "secrets", icon: IconShieldLock, label: t("credentials"), href: "/secrets" },
  ]
  // Note: Guide, Community, and Credits live in the avatar popup
  // (IdentityMenu) — they're not in the topbar's primary nav row.
  // The topbar focuses on "what you do" (recent work + workspace),
  // while the popup carries identity, billing, help, and preferences.

  return (
    <header className="absolute top-0 left-0 right-0 z-40 pt-2 px-3 sm:px-5 pointer-events-none">
      <div className="relative mx-auto max-w-7xl pointer-events-auto">
        {/* ── Glass shell ── */}
        <div
          className={cn(
            "absolute inset-0 rounded-xl",
            "backdrop-blur-2xl backdrop-saturate-[1.8]",
            "bg-white/65 dark:bg-neutral-950/60",
            "shadow-[0_1px_3px_rgba(0,0,0,0.06),0_6px_24px_rgba(0,0,0,0.06)]",
            "dark:shadow-[0_1px_3px_rgba(0,0,0,0.3),0_6px_24px_rgba(0,0,0,0.2)]"
          )}
        />
        {/* ── Border ring ── */}
        <div
          aria-hidden
          className="absolute inset-0 rounded-xl pointer-events-none ring-1 ring-black/[0.08] dark:ring-white/[0.1]"
        />
        {/* ── Top edge highlight ── */}
        <div
          aria-hidden
          className={cn(
            "absolute inset-x-0 top-0 h-px rounded-t-xl pointer-events-none",
            "bg-gradient-to-r from-transparent via-white/70 dark:via-white/[0.12] to-transparent"
          )}
        />

        {/* Three-column grid: [1fr | auto | 1fr]. Side columns are forced
            to identical widths so the center column is mathematically
            centered regardless of brand or avatar widths. */}
        <nav className="relative grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-2.5 py-1.5 sm:px-3">
          {/* ── Left column: Brand ── */}
          <div className="flex items-center min-w-0 justify-self-start">
            <Link
              href="/"
              className={cn(
                "flex h-7 items-center gap-1.5 px-1.5 rounded-md shrink-0",
                "transition-colors duration-150",
                "hover:bg-foreground/[0.04] dark:hover:bg-white/[0.04]",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
              )}
              title="Coasty"
            >
              <CoastyIcon className="h-[18px] w-[18px] shrink-0 text-sidebar-primary" />
              <span className="text-[13px] font-semibold text-foreground tracking-[-0.02em] leading-none whitespace-nowrap">
                Coasty
              </span>
            </Link>
          </div>

          {/* ── Center column: New Task + Recent + Workspace ── */}
          <div className="flex items-center gap-1 justify-self-center">
            {/* New Task primary CTA */}
            <button
              type="button"
              onClick={() => router.push("/")}
              className={cn(
                "flex h-7 items-center gap-1.5 px-2.5 rounded-md shrink-0",
                "bg-sidebar-primary text-sidebar-primary-foreground",
                "shadow-[0_1px_2px_rgba(0,0,0,0.08)]",
                "hover:shadow-[0_2px_6px_rgba(0,0,0,0.12)]",
                "hover:brightness-[1.05] active:brightness-95 active:scale-[0.985]",
                "transition-all duration-200 ease-out",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
              )}
            >
              <IconPlus size={12} stroke={2.25} className="shrink-0" />
              <span className="text-[12px] font-semibold leading-none whitespace-nowrap">
                {t("newTask")}
              </span>
            </button>

            {/* Group 1 · Recent */}
            <NavGroup className="ml-3">
              {recentItems.map((item) => (
                <NavItem key={item.id} {...item} isActive={isItemActive(item.href)} />
              ))}
            </NavGroup>

            {/* Group 2 · Workspace */}
            <NavGroup className="ml-3">
              {workspaceItems.map((item) => (
                <NavItem key={item.id} {...item} isActive={isItemActive(item.href)} />
              ))}
            </NavGroup>
          </div>

          {/* ── Right column: Identity ──
              The popup carries: credits card · Account · Invite & Earn ·
              Talk to us · Guide · Community · Theme · Sign out. */}
          <div className="flex items-center justify-self-end min-w-0">
          {user && (
            <HoverCard openDelay={250} closeDelay={150}>
              <HoverCardTrigger asChild>
                <button
                  type="button"
                  onClick={() => openAccountDialog()}
                  className={cn(
                    "flex h-7 items-center gap-1.5 pl-1 pr-2 rounded-md shrink-0",
                    "transition-colors duration-150",
                    "hover:bg-foreground/[0.04] dark:hover:bg-white/[0.04]",
                    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
                  )}
                >
                  <Avatar className="h-5 w-5 shrink-0 ring-1 ring-black/[0.08] dark:ring-white/[0.1]">
                    <AvatarImage src={user?.profile_image || undefined} />
                    <AvatarFallback className="bg-foreground/[0.06] text-foreground text-[9px] font-semibold">
                      {(user?.display_name || user?.email || "U")[0].toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="hidden sm:inline text-[12px] font-medium text-foreground/85 truncate max-w-[110px] leading-none">
                    {user?.display_name || user?.email?.split("@")[0] || t("user")}
                  </span>
                </button>
              </HoverCardTrigger>
              <HoverCardContent
                side="bottom"
                align="end"
                sideOffset={8}
                className="w-auto p-0 border-0 bg-transparent shadow-none"
              >
                <IdentityMenu user={user} />
              </HoverCardContent>
            </HoverCard>
          )}
          </div>
        </nav>
      </div>
    </header>
  )
})

// ─── NavGroup — flex row of items with framer shared layoutId ──────
function NavGroup({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center gap-0.5 shrink-0", className)}>
      {children}
    </div>
  )
}

// ─── NavItem ───────────────────────────────────────────────────────
//   Landing-nav vocabulary: text-[13px] font-medium tracking-[-0.01em]
//   rounded-lg. Inactive is `text-foreground/45`, active uses a
//   framer-motion `layoutId="app-topbar-active"` pill that slides
//   between items as you navigate. Labels collapse below `lg`.
function NavItem({
  icon: Icon,
  label,
  href,
  isActive,
  badge,
}: NavItemDef & { isActive: boolean }) {
  return (
    <Link
      href={href}
      className={cn(
        "relative flex h-7 items-center gap-1.5 px-2 rounded-md",
        "text-[12px] font-medium tracking-[-0.01em] leading-none",
        "transition-colors duration-200",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50",
        isActive
          ? "text-foreground"
          : "text-foreground/45 hover:text-foreground/80"
      )}
    >
      {isActive && (
        <motion.span
          layoutId="app-topbar-active"
          className="absolute inset-0 rounded-md bg-foreground/[0.06] dark:bg-white/[0.08]"
          transition={{ type: "spring", stiffness: 380, damping: 32 }}
        />
      )}
      <Icon
        size={12}
        stroke={1.75}
        className="relative shrink-0"
      />
      <span className="relative hidden lg:inline whitespace-nowrap">{label}</span>
      {badge != null && badge > 0 && (
        <span
          className={cn(
            "relative text-[10px] tabular-nums font-semibold leading-none",
            isActive ? "text-foreground/60" : "text-foreground/35"
          )}
        >
          {badge}
        </span>
      )}
    </Link>
  )
}

// ─── Identity hover-card menu ──────────────────────────────────────
//   The hub for everything that isn't primary navigation: identity,
//   credits, account actions, help/community, theme, sign out.
//
//   Composition (top → bottom):
//     1. Header — avatar + name + email
//     2. Credits card — eyebrow label + big tabular balance + status
//        dot (emerald healthy → amber low → rose depleted). The whole
//        card is the click target → opens the billing dialog.
//     3. Menu items — Account, Invite & Earn, Talk to us, Guide,
//        Community, Theme (dark/light toggle showing what clicking
//        will SWITCH TO).
//     4. Sign out — hairline-separated destructive action.
function IdentityMenu({
  user,
}: {
  user: { display_name?: string | null; email?: string | null; profile_image?: string | null } | null | undefined
}) {
  const t = useTranslations("sidebar")
  const openDialog = useAccountDialog((s) => s.open)
  const { signOut } = useUser()
  const { credits } = useCredits()
  const { isUnlimitedPlan } = useSubscription()
  const { resolvedTheme, setTheme } = useTheme()
  const isDark = resolvedTheme === "dark"
  const displayName = user?.display_name || user?.email?.split("@")[0] || t("user")

  // ─── Credit health (matches sidebar footer vocabulary) ──
  // Unlimited plan: skip the health logic — balance is a sentinel that
  // would always read "healthy" anyway, but the visual must say "Unlimited".
  const balance = credits?.balance ?? 0
  const totalPurchased = credits?.total_purchased ?? 0
  const isDepleted = !isUnlimitedPlan && balance <= 0
  const isLow = !isUnlimitedPlan && !isDepleted && balance < 50
  const dotClass = isUnlimitedPlan
    ? "bg-amber-500 dark:bg-amber-400"
    : isDepleted
      ? "bg-rose-500 dark:bg-rose-400"
      : isLow
        ? "bg-amber-500 dark:bg-amber-400"
        : "bg-emerald-500/70 dark:bg-emerald-400/70"
  const numberClass = isUnlimitedPlan
    ? "text-amber-600 dark:text-amber-400"
    : isDepleted
      ? "text-rose-500 dark:text-rose-400"
      : isLow
        ? "text-amber-600 dark:text-amber-400"
        : "text-foreground"

  type Item =
    | { kind: "button"; icon: TablerIcon; label: string; onClick: () => void }
    | { kind: "link"; icon: TablerIcon; label: string; href: string }
    | { kind: "external"; icon: TablerIcon; label: string; href: string }

  const items: Item[] = [
    { kind: "button", icon: IconSettings, label: t("account"), onClick: () => openDialog("account") },
    { kind: "link", icon: IconGift, label: t("inviteEarn"), href: "/referral" },
    { kind: "external", icon: IconVideo, label: t("talkToUs"), href: "https://cal.com/coasty/15min" },
    { kind: "link", icon: IconBook2, label: t("guide"), href: "/guide" },
    { kind: "link", icon: IconCompass, label: "Community", href: "/discover" },
  ]

  const rowClass =
    "w-full flex items-center gap-2.5 px-2 py-[7px] rounded-md text-left transition-colors duration-100 text-muted-foreground/75 hover:text-foreground hover:bg-foreground/[0.04] dark:hover:bg-white/[0.04]"

  return (
    <div className="w-64 rounded-xl overflow-hidden border border-border/60 bg-popover shadow-2xl dark:border-white/[0.06]">
      {/* ── Header: avatar + name + email ── */}
      <div className="px-3.5 pt-3.5 pb-3 flex items-center gap-3">
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

      {/* ── Credits card — VIP stat ── */}
      <div className="px-3 pb-3">
        <button
          type="button"
          onClick={() => openDialog("billing")}
          className={cn(
            "group/credits w-full rounded-lg px-3 py-2.5 text-left transition-colors duration-150",
            "border focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50",
            isDepleted || isLow
              ? "border-amber-500/20 bg-amber-500/[0.04] hover:bg-amber-500/[0.07]"
              : "border-border/40 bg-foreground/[0.02] hover:bg-foreground/[0.04] hover:border-border/60"
          )}
        >
          <div className="flex items-baseline justify-between mb-1">
            <span className="text-[9.5px] font-medium uppercase tracking-[0.1em] text-foreground/40">
              {isLow || isDepleted ? t("credits.runningLow") : t("credits.remaining")}
            </span>
            <span className={cn("h-1 w-1 rounded-full transition-colors", dotClass)} />
          </div>
          <div className="flex items-baseline justify-between gap-2">
            {isUnlimitedPlan ? (
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 text-[22px] font-semibold leading-none tracking-[-0.025em] transition-colors",
                  numberClass
                )}
              >
                <IconInfinity size={26} stroke={2.4} />
                <span>Unlimited</span>
              </span>
            ) : (
              <>
                <span
                  className={cn(
                    "text-[22px] font-semibold tabular-nums leading-none tracking-[-0.025em] transition-colors",
                    numberClass
                  )}
                >
                  {balance.toLocaleString()}
                </span>
                {totalPurchased > 0 && totalPurchased > balance && (
                  <span className="text-[10px] text-foreground/30 tabular-nums leading-none">
                    / {totalPurchased.toLocaleString()}
                  </span>
                )}
              </>
            )}
          </div>
        </button>
      </div>

      {/* ── Menu items ── */}
      <div className="p-1.5 border-t border-border/30 dark:border-white/[0.05]">
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
              <Link key={i} href={item.href} className={rowClass}>
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

        {/* Theme row — shows what clicking will switch to */}
        <button
          type="button"
          onClick={() => setTheme(isDark ? "light" : "dark")}
          className={rowClass}
        >
          {isDark ? (
            <IconSun size={14} stroke={1.5} className="shrink-0" />
          ) : (
            <IconMoon size={14} stroke={1.5} className="shrink-0" />
          )}
          <span className="text-[12px] font-medium flex-1 truncate">
            {isDark ? "Light mode" : "Dark mode"}
          </span>
        </button>
      </div>

      {/* ── Sign out — hairline-separated destructive action ── */}
      <div className="p-1.5 border-t border-border/30 dark:border-white/[0.05]">
        <button
          type="button"
          onClick={() => signOut()}
          className="w-full flex items-center gap-2.5 px-2 py-[7px] rounded-md text-left transition-colors duration-100 text-muted-foreground/75 hover:text-rose-500 dark:hover:text-rose-400 hover:bg-rose-500/[0.06]"
        >
          <IconLogout size={14} stroke={1.5} className="shrink-0" />
          <span className="text-[12px] font-medium">Sign out</span>
        </button>
      </div>
    </div>
  )
}
