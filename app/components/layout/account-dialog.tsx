"use client"

import { cn } from "@/lib/utils"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  User,
  CreditCard,
  Shield,
  Bell,
  Paintbrush,
  Key,
  Database,
  MessageSquare,
  Info,
  Share2,
  Mail,
  Loader2,
  ChevronRight,
  X,
  Globe,
} from "lucide-react"
import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"

import { CombinedAccount } from "@/app/components/layout/settings/general/combined-account"
import { PrivacySection } from "@/app/components/layout/settings/general/privacy-section"
import { PublicChatsSection } from "@/app/components/layout/settings/general/public-chats-section"
import { BillingSection } from "@/app/components/layout/settings/billing/billing-section"
import { ThemeSelection } from "@/app/components/layout/settings/appearance/theme-selection"
import { BackgroundSelection } from "@/app/components/layout/settings/appearance/background-selection"
import { LanguageSelection } from "@/app/components/layout/settings/appearance/language-selection"
import { IntroPreference } from "@/app/components/layout/settings/appearance/intro-preference"
// import { LayoutSettings } from "@/app/components/layout/settings/appearance/layout-settings"
import { FeedbackForm } from "@/components/common/feedback-form"
import { AppInfoContent } from "@/app/components/layout/app-info/app-info-content"
import { useUser } from "@/lib/user-store/provider"
import XIcon from "@/components/icons/x"
import { GithubLogoIcon } from "@phosphor-icons/react"
import { useAccountDialog, type AccountSectionType } from "@/lib/account-dialog-store"

import { Dialog } from "@/components/ui/dialog"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import * as VisuallyHidden from "@radix-ui/react-visually-hidden"

type SectionType = AccountSectionType

function AppearanceSection() {
  return (
    <div className="space-y-10">
      {/* Theme */}
      <div className="space-y-4">
        <h3 className="text-[13px] font-medium text-foreground/70">Theme</h3>
        <ThemeSelection />
      </div>

      {/* Language */}
      <div className="space-y-4">
        <h3 className="text-[13px] font-medium text-foreground/70">Language</h3>
        <LanguageSelection />
      </div>

      {/* Background */}
      <div className="space-y-4">
        <h3 className="text-[13px] font-medium text-foreground/70">Background</h3>
        <BackgroundSelection />
      </div>

      {/* Personalization */}
      <div className="space-y-4">
        <h3 className="text-[13px] font-medium text-foreground/70">Personalization</h3>
        <IntroPreference />
      </div>
    </div>
  )
}

const sections = [
  { id: "account" as SectionType, label: "General", icon: User, description: "Profile and account", component: CombinedAccount },
  { id: "appearance" as SectionType, label: "Appearance", icon: Paintbrush, description: "Theme, language, and background", component: AppearanceSection },
  { id: "billing" as SectionType, label: "Billing", icon: CreditCard, description: "Plans and credits", component: BillingSection },
  { id: "public-chats" as SectionType, label: "Public Chats", icon: Globe, description: "Manage chats shared via public link", component: PublicChatsSection },
  { id: "privacy" as SectionType, label: "Privacy", icon: Shield, description: "Security and data privacy", component: PrivacySection },
  { id: "notifications" as SectionType, label: "Notifications", icon: Bell, description: "Notification preferences", component: null },
  { id: "api-keys" as SectionType, label: "API Keys", icon: Key, description: "Manage your API keys", component: null },
  { id: "data" as SectionType, label: "Data", icon: Database, description: "Export and manage your data", component: null },
  { id: "feedback" as SectionType, label: "Feedback", icon: MessageSquare, description: "Send us your feedback", component: "feedback" as const },
  { id: "about" as SectionType, label: "About", icon: Info, description: "About Coasty", component: "about" as const },
  { id: "social" as SectionType, label: "Connect", icon: Share2, description: "Social links", component: "social" as const },
]

const navGroups = [
  { label: "Settings", ids: ["account", "appearance", "billing", "public-chats", "privacy"] as SectionType[] },
  { label: "Developer", ids: ["notifications", "api-keys", "data"] as SectionType[] },
  { label: "More", ids: ["feedback", "about", "social"] as SectionType[] },
]

function SidebarNavItem({
  section,
  isActive,
  onClick,
}: {
  section: (typeof sections)[number]
  isActive: boolean
  onClick: () => void
}) {
  const Icon = section.icon
  const isDisabled = !section.component
  return (
    <button
      onClick={onClick}
      disabled={isDisabled}
      className={cn(
        "relative w-full flex items-center gap-2.5 px-2 py-[6px] rounded-md text-left transition-colors duration-100",
        isActive
          ? "text-foreground bg-foreground/[0.06] dark:bg-white/[0.08]"
          : "text-muted-foreground/60 hover:text-foreground hover:bg-foreground/[0.03] dark:hover:bg-white/[0.04]",
        isDisabled && "opacity-25 cursor-not-allowed hover:bg-transparent hover:text-muted-foreground/60"
      )}
    >
      <Icon className={cn("h-[14px] w-[14px] shrink-0", isActive ? "text-foreground/80" : "text-muted-foreground/40")} strokeWidth={isActive ? 2 : 1.75} />
      <span className={cn("text-[13px] leading-none", isActive ? "font-medium" : "font-normal")}>{section.label}</span>
      {isDisabled && (
        <span className="ml-auto text-[9px] font-medium text-muted-foreground/25">
          Soon
        </span>
      )}
    </button>
  )
}

function ComingSoonPlaceholder({ icon: Icon, label }: { icon: React.ComponentType<any>; label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 px-4 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-foreground/[0.03] dark:bg-white/[0.04] mb-5">
        <Icon className="h-5 w-5 text-muted-foreground/25" />
      </div>
      <p className="text-sm font-medium text-foreground/40 mb-1">{label}</p>
      <p className="text-[13px] text-muted-foreground/30 max-w-[240px] leading-relaxed">
        This section is coming in a future update.
      </p>
    </div>
  )
}

const validSections: SectionType[] = ["account", "billing", "privacy", "notifications", "appearance", "api-keys", "data", "feedback", "about", "social", "public-chats"]

export function AccountDialog() {
  const { isOpen, section, close, setSection, _syncFromUrl } = useAccountDialog()
  const { user, isLoading } = useUser()
  const [mobileView, setMobileView] = useState<"menu" | "content">("content")
  const router = useRouter()

  const activeSection = section
  const activeConfig = sections.find((s) => s.id === activeSection)
  const ActiveComponent = activeConfig?.component

  const handleSectionChange = useCallback(
    (sectionId: SectionType) => {
      setSection(sectionId)
      setMobileView("content")
    },
    [setSection]
  )

  // Wrapper around store close that also handles real Next.js navigation
  // when the user was on the actual /account or /credits route
  const handleClose = useCallback(() => {
    const state = useAccountDialog.getState()
    const didPush = state._didPushState
    const prevPath = state._previousPath || "/"

    close() // sets isOpen: false, cleans up, calls history.back() if didPush

    if (!didPush) {
      // User was on actual /account or /credits route — need real Next.js navigation
      router.replace(prevPath)
    }
  }, [close, router])

  // Handle browser back/forward navigation
  useEffect(() => {
    const handlePopState = () => {
      // Always read latest state to avoid stale closure issues
      const { isOpen: currentlyOpen } = useAccountDialog.getState()

      const path = window.location.pathname
      if (path === "/account") {
        // We're on /account — sync section from URL
        const params = new URLSearchParams(window.location.search)
        const sec = params.get("section") as SectionType | null
        _syncFromUrl(sec && validSections.includes(sec) ? sec : "account")
      } else if (currentlyOpen) {
        // Navigated away from /account — close dialog without further URL manipulation
        useAccountDialog.setState({ isOpen: false, _previousPath: null, _didPushState: false })
        document.body.style.pointerEvents = ""
      }
    }

    window.addEventListener("popstate", handlePopState)
    return () => window.removeEventListener("popstate", handlePopState)
  }, [_syncFromUrl])

  // If the page loads on /account, open the dialog
  useEffect(() => {
    if (typeof window === "undefined") return
    const path = window.location.pathname
    if (path === "/account" && !isOpen) {
      const params = new URLSearchParams(window.location.search)
      const sec = params.get("section") as SectionType | null
      // Save the referring page as "/" since we loaded directly on /account
      useAccountDialog.setState({ _previousPath: "/" })
      _syncFromUrl(sec && validSections.includes(sec) ? sec : "account")
    }
  // Only run once on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reset mobile view when dialog opens
  useEffect(() => {
    if (isOpen) setMobileView("content")
  }, [isOpen])

  // Safety cleanup: ensure pointer-events is restored when dialog unmounts or closes
  useEffect(() => {
    if (!isOpen) {
      document.body.style.pointerEvents = ""
    }
  }, [isOpen])

  if (!user && !isLoading) return null

  const userInitial = user?.display_name?.charAt(0)?.toUpperCase() ?? "?"

  function renderSectionContent() {
    if (activeConfig?.component === "feedback") {
      return (
        <div className="rounded-xl border border-border/30 bg-card/20 overflow-hidden">
          <FeedbackForm authUserId={user?.id} onClose={close} />
        </div>
      )
    }
    if (activeConfig?.component === "about") {
      return <AppInfoContent />
    }
    if (activeConfig?.component === "social") {
      const socialLinks = [
        { href: "https://x.com/llmhub_dev", icon: XIcon, label: "X (Twitter)", sub: "@llmhub_dev", external: true },
        { href: "https://github.com/coasty-ai", icon: GithubLogoIcon, label: "GitHub", sub: "coasty-ai", external: true },
        { href: "mailto:founders@coasty.ai", icon: Mail, label: "Email", sub: "founders@coasty.ai", external: false },
      ]
      return (
        <div className="space-y-1">
          {socialLinks.map(({ href, icon: Icon, label, sub, external }) => (
            <a
              key={href}
              href={href}
              {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              className="group flex items-center gap-3.5 px-3 py-2.5 rounded-lg hover:bg-foreground/[0.03] dark:hover:bg-white/[0.04] transition-colors"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-md shrink-0 bg-foreground/[0.04] dark:bg-white/[0.06]">
                <Icon className="h-3.5 w-3.5 text-foreground/50" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium leading-tight">{label}</p>
                <p className="text-[11px] text-muted-foreground/35 mt-0.5">{sub}</p>
              </div>
              <ChevronRight className="h-3 w-3 text-muted-foreground/15 group-hover:text-muted-foreground/40 transition-colors shrink-0" />
            </a>
          ))}
        </div>
      )
    }
    if (typeof ActiveComponent === "function") {
      return <ActiveComponent />
    }
    return <ComingSoonPlaceholder icon={activeConfig!.icon} label={activeConfig!.label} />
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[10000] bg-black/50 dark:bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 duration-150" />
        <DialogPrimitive.Content
          className={cn(
            "fixed top-[50%] left-[50%] z-[10001] translate-x-[-50%] translate-y-[-50%]",
            "w-[94vw] max-w-[960px] h-[82vh] max-h-[700px]",
            "bg-popover rounded-xl",
            "border border-border/50 dark:border-white/[0.08]",
            "shadow-xl shadow-black/[0.08] dark:shadow-black/40",
            "overflow-hidden",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-[0.98] data-[state=open]:zoom-in-[0.98]",
            "duration-150"
          )}
          onCloseAutoFocus={(e) => {
            e.preventDefault()
            document.body.style.pointerEvents = ""
          }}
        >
          <VisuallyHidden.Root>
            <DialogPrimitive.Title>Settings</DialogPrimitive.Title>
          </VisuallyHidden.Root>

          {isLoading ? (
            <div className="w-full h-full flex items-center justify-center">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground/30" />
            </div>
          ) : (
            <div className="flex h-full">
              {/* ─── Sidebar ─────────────────────────────────────────── */}
              <aside className="hidden md:flex w-[200px] flex-shrink-0 flex-col border-r border-border/40 dark:border-white/[0.06] bg-muted/[0.015] dark:bg-white/[0.01]">
                {/* User profile — flat, no card */}
                <div className="px-4 pt-5 pb-3">
                  <div className="flex items-center gap-2.5">
                    <Avatar className="h-7 w-7 shrink-0">
                      <AvatarImage src={user?.profile_image || undefined} className="object-cover" />
                      <AvatarFallback className="bg-foreground/[0.04] dark:bg-white/[0.06] text-[11px] font-medium text-foreground/50">
                        {userInitial}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium leading-tight truncate text-foreground/90">{user?.display_name || user?.email?.split("@")[0] || "User"}</p>
                    </div>
                  </div>
                </div>

                {/* Nav groups */}
                <div className="flex-1 px-2.5 pb-3 space-y-4 overflow-y-auto">
                  {navGroups.map((group) => {
                    const groupSections = sections.filter((s) => group.ids.includes(s.id))
                    return (
                      <div key={group.label}>
                        <p className="text-[10px] font-medium tracking-[0.05em] uppercase text-muted-foreground/30 px-2 mb-1">
                          {group.label}
                        </p>
                        <div className="space-y-px">
                          {groupSections.map((s) => (
                            <SidebarNavItem
                              key={s.id}
                              section={s}
                              isActive={activeSection === s.id}
                              onClick={() => handleSectionChange(s.id)}
                            />
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </aside>

              {/* ─── Mobile nav (< md) ─────────────────────────────── */}
              <div className="md:hidden flex flex-col h-full w-full">
                {mobileView === "menu" ? (
                  <div className="flex-1 overflow-y-auto px-4 py-5 space-y-5">
                    <div className="flex items-center justify-between">
                      <h2 className="text-[15px] font-semibold">Settings</h2>
                      <button onClick={handleClose} className="p-1.5 -mr-1 rounded-md hover:bg-foreground/[0.04] text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    {navGroups.map((group) => {
                      const groupSections = sections.filter((s) => group.ids.includes(s.id))
                      return (
                        <div key={group.label}>
                          <p className="text-[10px] font-medium tracking-[0.05em] uppercase text-muted-foreground/35 mb-2 px-0.5">
                            {group.label}
                          </p>
                          <div className="rounded-lg border border-border/30 dark:border-white/[0.06] divide-y divide-border/20 dark:divide-white/[0.04] overflow-hidden">
                            {groupSections.map((s) => {
                              const Icon = s.icon
                              const isDisabled = !s.component
                              return (
                                <button
                                  key={s.id}
                                  onClick={() => !isDisabled && handleSectionChange(s.id)}
                                  disabled={isDisabled}
                                  className={cn(
                                    "w-full flex items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-foreground/[0.02]",
                                    isDisabled && "opacity-30 cursor-not-allowed"
                                  )}
                                >
                                  <Icon className="h-[15px] w-[15px] text-muted-foreground/40 shrink-0" strokeWidth={1.75} />
                                  <div className="flex-1 min-w-0">
                                    <div className="text-[13px] font-medium leading-tight">{s.label}</div>
                                    <div className="text-[11px] text-muted-foreground/40 truncate mt-0.5">{s.description}</div>
                                  </div>
                                  {isDisabled ? (
                                    <span className="text-[10px] text-muted-foreground/25">Soon</span>
                                  ) : (
                                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/20 shrink-0" />
                                  )}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="flex-1 overflow-y-auto">
                    <div className="sticky top-0 z-10 flex items-center gap-2 px-4 py-3 bg-popover/95 backdrop-blur-md border-b border-border/15 dark:border-white/[0.04]">
                      <button
                        onClick={() => setMobileView("menu")}
                        className="text-[13px] text-muted-foreground/50 hover:text-foreground flex items-center gap-1 transition-colors"
                      >
                        <ChevronRight className="h-3 w-3 rotate-180" />
                        Back
                      </button>
                      <span className="text-[13px] font-medium">{activeConfig?.label}</span>
                      <button onClick={handleClose} className="ml-auto p-1 rounded-md hover:bg-foreground/[0.04] text-muted-foreground/40 transition-colors">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="p-5">
                      {renderSectionContent()}
                    </div>
                  </div>
                )}
              </div>

              {/* ─── Content area (desktop) ──────────────────────── */}
              <div className="hidden md:flex flex-col flex-1 min-w-0 h-full">
                {/* Header bar — clean, minimal */}
                <div className="flex items-center justify-between px-8 pt-6 pb-4">
                  <div>
                    <h2 className="text-[15px] font-semibold text-foreground/90 leading-none">
                      {activeConfig?.label}
                    </h2>
                    {activeConfig?.description && (
                      <p className="text-[13px] text-muted-foreground/40 mt-1.5">
                        {activeConfig.description}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={handleClose}
                    className="p-1.5 -mr-1 rounded-md hover:bg-foreground/[0.04] dark:hover:bg-white/[0.06] text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* Thin separator */}
                <div className="mx-8 h-px bg-border/30 dark:bg-white/[0.04]" />

                {/* Scrollable content */}
                <AnimatePresence mode="wait">
                  <motion.div
                    key={activeSection}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15, ease: "easeOut" }}
                    className="flex-1 overflow-y-auto px-8 py-6"
                  >
                    {renderSectionContent()}
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </Dialog>
  )
}
