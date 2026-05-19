"use client"

import { useState, useCallback, useEffect } from "react"
import { AppInfoTrigger } from "@/app/components/layout/app-info/app-info-trigger"
import { useBreakpoint } from "@/app/hooks/use-breakpoint"
import { CoastyIcon } from "@/components/icons/coasty"
import { APP_NAME } from "@/lib/config"
import { cn } from "@/lib/utils"
import { useUser } from "@/lib/user-store/provider"
import { useChats } from "@/lib/chat-store/chats/provider"
import { useChatSession } from "@/lib/chat-store/session/provider"
import { useProjectNavigator } from "@/lib/project-navigator-store/provider"
import { Info, Desktop, ShareNetwork, Clock } from "@phosphor-icons/react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { HeaderSidebarTrigger } from "./header-sidebar-trigger"
import { toast } from "sonner"
import { ChatVisibilityToggle } from "@/app/components/chat/chat-visibility-toggle"
import { ScheduleDialog } from "@/app/components/schedules/schedule-dialog"
import type { UserMachine } from "@/types/machines.types"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { AnimatedThemeToggler } from "@/components/magicui/animated-theme-toggler"
import { LanguageSwitcherCompact } from "@/components/language-switcher"
import { useGuideStore } from "@/lib/guide-store"
import { useAnnouncementsStore } from "@/lib/announcements-store"
import { AnnouncementsDialog } from "@/app/components/layout/announcements-dialog"
import { BookOpen, Globe, Megaphone } from "lucide-react"
import { useTranslations, useLocale } from "next-intl"

// --- Expanding bar shared styles ---
const actionBtn = cn(
  "relative flex items-center rounded-full h-7 px-2",
  "text-muted-foreground/60 hover:text-foreground",
  "hover:bg-foreground/[0.06] dark:hover:bg-white/[0.08]",
  "transition-all duration-200 cursor-pointer select-none",
)
const activeBtn = "!text-foreground bg-foreground/[0.06] dark:bg-white/[0.08]"
const expandLabel = cn(
  "inline-block overflow-hidden",
  "max-w-0 opacity-0",
  "group-hover/bar:max-w-24 group-hover/bar:opacity-100",
  "transition-all duration-200 ease-in-out delay-0",
  "group-hover/bar:duration-300",
)
const labelText = "pl-1.5 text-[12px] font-medium whitespace-nowrap leading-none"

interface HeaderProps {
  hasSidebar: boolean
}

export function Header({ hasSidebar }: HeaderProps) {
  const isMobile = useBreakpoint(768)
  const { user } = useUser()
  const { refresh, getChatById } = useChats()
  const { chatId } = useChatSession()
  const { isOpen: isNavigatorOpen, toggleNavigator, selectedVMId } = useProjectNavigator()
  const isLoggedIn = !!user
  const pathname = usePathname()
  const t = useTranslations("appHeader")
  const locale = useLocale()

  // Guide store (homepage)
  const guideDismissed = useGuideStore((s) => s.dismissed)
  const guideToggle = useGuideStore((s) => s.toggle)
  const guideHydrate = useGuideStore((s) => s.hydrate)
  useEffect(() => { guideHydrate() }, [guideHydrate])

  // Announcements store (homepage)
  const announcementsHydrate = useAnnouncementsStore((s) => s.hydrate)
  const unreadCount = useAnnouncementsStore((s) => s.unreadCount)
  useEffect(() => { announcementsHydrate() }, [announcementsHydrate])

  // Schedule dialog state
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [scheduleMachines, setScheduleMachines] = useState<UserMachine[]>([])

  // Controlled dialog states
  const [shareOpen, setShareOpen] = useState(false)
  const [langOpen, setLangOpen] = useState(false)
  const [announcementsOpen, setAnnouncementsOpen] = useState(false)

  const openScheduleDialog = useCallback(async () => {
    try {
      const res = await fetch("/api/machines")
      if (res.ok) {
        const data = await res.json()
        setScheduleMachines(data.machines || [])
      }
    } catch {
      setScheduleMachines([])
    }
    setScheduleOpen(true)
  }, [])

  const currentChat = chatId ? getChatById(chatId) : null
  const isCollaborativeRoom = currentChat?.collaborative === true

  return (
    <>
      <header className="h-app-header bg-background pointer-events-none absolute top-0 right-0 left-0 z-40">
        <div className="relative mx-auto flex h-full max-w-full items-center justify-between px-2 sm:px-4 lg:px-6 xl:px-8">
          <div className="flex w-full items-center justify-between min-w-0">
            {/* Left */}
            <div className="-ml-0.5 flex items-center gap-1 sm:gap-2 lg:-ml-2.5 min-w-0 flex-shrink-0">
              <div className="flex items-center gap-1 sm:gap-2 min-w-0">
                {!hasSidebar && (
                  <Link
                    href="/"
                    className="pointer-events-auto inline-flex items-center text-lg sm:text-xl font-medium tracking-tight min-w-0"
                  >
                    <CoastyIcon className="mr-1 size-4 flex-shrink-0" />
                    <span className="hidden sm:inline truncate">{APP_NAME}</span>
                  </Link>
                )}
                {hasSidebar && isMobile && <HeaderSidebarTrigger />}
              </div>
            </div>

            {/* Right — unified expanding bar */}
            <div className="pointer-events-auto flex items-center justify-end gap-1.5 min-w-0 shrink-0">
              <div
                className={cn(
                  "group/bar flex items-center rounded-full p-0.5 gap-0.5",
                  "bg-foreground/[0.02] dark:bg-white/[0.03]",
                  "border border-transparent",
                  "transition-all duration-300 ease-out",
                  "hover:bg-foreground/[0.05] dark:hover:bg-white/[0.06]",
                  "hover:border-border/20 dark:hover:border-white/[0.06]",
                  "hover:shadow-sm",
                )}
              >
                {/* ── Chat actions (when in a chat) ── */}
                {isLoggedIn && chatId && (
                  <>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button type="button" className={actionBtn} onClick={openScheduleDialog}>
                          <Clock className="size-3.5 shrink-0" weight="bold" />
                          <span className={cn(expandLabel, "group-hover/bar:delay-[0ms]")}>
                            <span className={labelText}>{t("assign")}</span>
                          </span>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{t("assignDescription")}</TooltipContent>
                    </Tooltip>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className={cn(actionBtn, isNavigatorOpen && activeBtn)}
                          onClick={toggleNavigator}
                        >
                          <Desktop className="size-3.5 shrink-0" />
                          <span className={cn(expandLabel, "group-hover/bar:delay-[40ms]")}>
                            <span className={labelText}>{t("computer")}</span>
                          </span>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {isNavigatorOpen ? t("hideComputer") : t("showComputer")}
                      </TooltipContent>
                    </Tooltip>

                    {!isCollaborativeRoom && currentChat && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className={cn(actionBtn, currentChat.public && activeBtn)}
                            onClick={() => setShareOpen(true)}
                          >
                            <ShareNetwork
                              className="size-3.5 shrink-0"
                              weight={currentChat.public ? "fill" : "regular"}
                            />
                            <span className={cn(expandLabel, "group-hover/bar:delay-[80ms]")}>
                              <span className={labelText}>Share</span>
                            </span>
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {currentChat.public ? "Manage sharing" : "Share this chat"}
                        </TooltipContent>
                      </Tooltip>
                    )}

                    {/* Separator */}
                    <div className="w-px h-3.5 bg-border/0 group-hover/bar:bg-border/25 transition-colors duration-500 mx-0.5" />
                  </>
                )}

                {/* ── Guide toggle (homepage, logged in) ── */}
                {isLoggedIn && !chatId && pathname === "/" && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className={cn(actionBtn, !guideDismissed && activeBtn)}
                        onClick={guideToggle}
                      >
                        <BookOpen className="size-3.5 shrink-0" strokeWidth={1.75} />
                        <span className={cn(expandLabel, "group-hover/bar:delay-[0ms]")}>
                          <span className={labelText}>Guide</span>
                        </span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {guideDismissed ? "Show guide" : "Hide guide"}
                    </TooltipContent>
                  </Tooltip>
                )}

                {/* ── What's New (homepage, logged in) ── */}
                {isLoggedIn && !chatId && pathname === "/" && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className={cn(actionBtn, announcementsOpen && activeBtn)}
                        onClick={() => setAnnouncementsOpen(true)}
                      >
                        <span className="relative">
                          <Megaphone className="size-3.5 shrink-0" strokeWidth={1.75} />
                          {unreadCount > 0 && (
                            <span className="absolute -top-1 -right-1 flex size-2">
                              <span className="absolute inline-flex size-full animate-ping rounded-full bg-blue-400 opacity-60" />
                              <span className="relative inline-flex size-2 rounded-full bg-blue-500" />
                            </span>
                          )}
                        </span>
                        <span className={cn(expandLabel, "group-hover/bar:delay-[40ms]")}>
                          <span className={labelText}>New</span>
                        </span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>What&apos;s new</TooltipContent>
                  </Tooltip>
                )}

                {/* ── Info (not logged in) ── */}
                {!isLoggedIn && (
                  <AppInfoTrigger
                    trigger={
                      <button type="button" className={actionBtn} aria-label={`About ${APP_NAME}`}>
                        <Info className="size-3.5 shrink-0" />
                        <span className={cn(expandLabel, "group-hover/bar:delay-[0ms]")}>
                          <span className={labelText}>About</span>
                        </span>
                      </button>
                    }
                  />
                )}

                {/* ── Language ── */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" className={actionBtn} onClick={() => setLangOpen(true)}>
                      <Globe className="size-3.5 shrink-0" strokeWidth={2} />
                      <span
                        className={cn(
                          expandLabel,
                          isLoggedIn && chatId
                            ? "group-hover/bar:delay-[120ms]"
                            : isLoggedIn && !chatId && pathname === "/"
                              ? "group-hover/bar:delay-[80ms]"
                              : "group-hover/bar:delay-[40ms]",
                        )}
                      >
                        <span className="pl-1.5 text-[11px] font-semibold whitespace-nowrap leading-none uppercase tracking-wider">
                          {locale}
                        </span>
                      </span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Language</TooltipContent>
                </Tooltip>

                {/* ── Theme (only when no sidebar available) ── */}
                {!isLoggedIn && (
                  <AnimatedThemeToggler
                    className={cn(
                      "relative flex items-center justify-center rounded-full h-7 w-7",
                      "text-muted-foreground/60 hover:text-foreground",
                      "hover:bg-foreground/[0.06] dark:hover:bg-white/[0.08]",
                      "transition-all duration-200 cursor-pointer",
                    )}
                  />
                )}

              </div>

              {/* Login CTA */}
              {!isLoggedIn && (
                <Link
                  href="/auth"
                  className="text-muted-foreground hover:text-foreground text-sm transition-colors shrink-0 ml-1"
                >
                  {t("login")}
                </Link>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* What's New dialog (controlled) */}
      <AnnouncementsDialog open={announcementsOpen} onOpenChange={setAnnouncementsOpen} />

      {/* Language modal (controlled) */}
      <LanguageSwitcherCompact open={langOpen} onOpenChange={setLangOpen} />

      {/* Share dialog (controlled) */}
      {chatId && !isCollaborativeRoom && currentChat && (
        <ChatVisibilityToggle
          chatId={chatId}
          initialPublic={currentChat.public || false}
          onVisibilityChange={() => refresh()}
          open={shareOpen}
          onOpenChange={setShareOpen}
        />
      )}

      {/* Schedule dialog */}
      {chatId && (
        <ScheduleDialog
          open={scheduleOpen}
          onOpenChange={setScheduleOpen}
          chatId={chatId}
          chatTitle={currentChat?.title || undefined}
          machines={scheduleMachines}
          defaultMachineId={selectedVMId}
          onScheduleCreated={() => {
            toast.success(t("employeeHired"))
            refresh()
          }}
          onScheduleDeleted={() => {
            toast.success(t("employeeRemoved"))
            refresh()
          }}
        />
      )}
    </>
  )
}
