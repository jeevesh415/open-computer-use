"use client"

import { useState, useEffect } from "react"
import { useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import { LandingHeader } from "@/app/components/landing/landing-header"
import { LandingFooter } from "@/app/components/landing/landing-footer"
import { LayoutApp } from "@/app/components/layout/layout-app"
import { motion, AnimatePresence } from "framer-motion"
import {
  BookOpen,
  RocketLaunch,
  ChatText,
  Desktop,
  Key,
  Lightning,
  Monitor,
  CreditCard,
  VideoCamera,
  UsersThree,
} from "@phosphor-icons/react"

import { OverviewTab } from "./tabs/overview"
import { GettingStartedTab } from "./tabs/getting-started"
import { ChatTasksTab } from "./tabs/chat-tasks"
import { MachinesTab } from "./tabs/machines"
import { CredentialsTab } from "./tabs/credentials"
import { SwarmModeTab } from "./tabs/swarm-mode"
import { WorkforceTab } from "./tabs/workforce"
import { DesktopAppTab } from "./tabs/desktop-app"
import { BillingTab } from "./tabs/billing"
import { APITab } from "./tabs/api"
import { DEVELOPERS_API_ENABLED } from "@/lib/feature-flags"

/* ─── tab config ─── */

const ALL_TABS = [
  { id: "overview", labelKey: "tabs.overview", shortLabel: "Overview", icon: BookOpen },
  { id: "getting-started", labelKey: "tabs.gettingStarted", shortLabel: "Start", icon: RocketLaunch },
  { id: "chat-tasks", labelKey: "tabs.chatTasks", shortLabel: "Chat", icon: ChatText },
  { id: "machines", labelKey: "tabs.machines", shortLabel: "Machines", icon: Desktop },
  { id: "credentials", labelKey: "tabs.credentials", shortLabel: "Creds", icon: Key },
  { id: "swarm-mode", labelKey: "tabs.swarmMode", shortLabel: "Swarm", icon: Lightning },
  { id: "workforce", labelKey: "tabs.workforce", shortLabel: "Workforce", icon: UsersThree },
  { id: "desktop-app", labelKey: "tabs.desktopApp", shortLabel: "Desktop", icon: Monitor },
  { id: "billing", labelKey: "tabs.billing", shortLabel: "Billing", icon: CreditCard },
  { id: "api", labelKey: "", shortLabel: "API", icon: Lightning },
] as const

type TabId = (typeof ALL_TABS)[number]["id"]

// Filter at module load — DEVELOPERS_API_ENABLED is a compile-time constant.
const tabConfig = ALL_TABS.filter(
  (t) => DEVELOPERS_API_ENABLED || t.id !== "api",
)

const tabIds = new Set<string>(tabConfig.map((t) => t.id))
function isValidTabId(value: string | null): value is TabId {
  return value !== null && tabIds.has(value)
}

/* ─── animation ─── */

const tabContent = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.25, 0.1, 0.25, 1] as const } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.15 } },
}

/* ─── tab content renderer ─── */

function TabContent({ activeTab, inApp }: { activeTab: TabId; inApp: boolean }) {
  switch (activeTab) {
    case "overview":
      return <OverviewTab inApp={inApp} />
    case "getting-started":
      return <GettingStartedTab inApp={inApp} />
    case "chat-tasks":
      return <ChatTasksTab inApp={inApp} />
    case "machines":
      return <MachinesTab inApp={inApp} />
    case "credentials":
      return <CredentialsTab inApp={inApp} />
    case "swarm-mode":
      return <SwarmModeTab inApp={inApp} />
    case "workforce":
      return <WorkforceTab inApp={inApp} />
    case "desktop-app":
      return <DesktopAppTab inApp={inApp} />
    case "billing":
      return <BillingTab inApp={inApp} />
    case "api":
      return <APITab inApp={inApp} />
  }
}

/* ─── tab navigation ─── */

function TabNav({ activeTab, onTabChange }: { activeTab: TabId; onTabChange: (id: TabId) => void }) {
  const t = useTranslations("guide")
  return (
    <div className="rounded-2xl border border-foreground/[0.06] bg-background/60 dark:bg-background/40 backdrop-blur-2xl p-1.5 shadow-sm">
      <nav
        className="flex flex-wrap justify-center gap-0.5"
        role="tablist"
      >
        {tabConfig.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => onTabChange(tab.id)}
              className={cn(
                "relative flex items-center justify-center gap-1.5 rounded-xl px-2.5 py-2 sm:px-3.5 sm:py-2 text-[11px] sm:text-[12.5px] font-medium transition-all duration-200",
                isActive
                  ? "bg-foreground/[0.08] dark:bg-foreground/[0.12] text-foreground"
                  : "text-muted-foreground/50 hover:text-foreground/80 hover:bg-foreground/[0.04]"
              )}
            >
              <Icon
                size={14}
                weight={isActive ? "fill" : "duotone"}
                className="shrink-0"
              />
              <span className="hidden sm:inline truncate">{tab.labelKey ? t(tab.labelKey) : tab.shortLabel}</span>
              <span className="sm:hidden truncate">{tab.shortLabel}</span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}

/* ─── guide content ─── */

function GuideContent({ inApp }: { inApp: boolean }) {
  const t = useTranslations("guide")
  const searchParams = useSearchParams()
  const tabParam = searchParams.get("tab")
  const [activeTab, setActiveTab] = useState<TabId>(
    isValidTabId(tabParam) ? tabParam : "overview"
  )

  // Sync with URL param changes (e.g. clicking guide links from other pages)
  useEffect(() => {
    if (isValidTabId(tabParam) && tabParam !== activeTab) {
      setActiveTab(tabParam)
    }
  }, [tabParam]) // eslint-disable-line react-hooks/exhaustive-deps

  if (inApp) {
    return (
      <div className="h-full overflow-y-auto overflow-x-hidden scrollbar-invisible relative">
        {/* Ambient background — matches machines/history/secrets pages */}
        <div className="pointer-events-none fixed inset-0 overflow-hidden">
          <div
            className="absolute -top-[30%] -right-[15%] h-[60%] w-[50%] rounded-full opacity-[0.02] dark:opacity-[0.04] blur-[120px]"
            style={{ background: "radial-gradient(circle, currentColor, transparent 70%)" }}
          />
          <div
            className="absolute -bottom-[20%] -left-[10%] h-[50%] w-[40%] rounded-full opacity-[0.015] dark:opacity-[0.035] blur-[100px]"
            style={{ background: "radial-gradient(circle, currentColor, transparent 70%)" }}
          />
        </div>

        <div className="container mx-auto p-4 sm:p-6 lg:p-8 max-w-7xl space-y-6 relative z-10">
          {/* Header — matches machines/history/secrets style */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] as const }}
            className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4"
          >
            <div>
              <h1 className="text-2xl sm:text-3xl font-medium tracking-tight">{t("pageTitle")}</h1>
              <p className="text-muted-foreground text-sm mt-1.5">
                {t("pageSubtitle")}
              </p>
            </div>
          </motion.div>

          {/* Tab navigation */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.05, ease: [0.22, 1, 0.36, 1] as const }}
            className="sticky top-0 z-20 py-3"
          >
            <TabNav activeTab={activeTab} onTabChange={setActiveTab} />
          </motion.div>

          {/* Tab content */}
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              variants={tabContent}
              initial="hidden"
              animate="show"
              exit="exit"
            >
              <TabContent activeTab={activeTab} inApp={inApp} />
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    )
  }

  // Public / landing page version
  return (
    <div className="min-h-screen bg-background relative">
      <LandingHeader />

      <div className="pt-28 sm:pt-32 pb-24">
        <div className="mx-auto px-7 sm:px-10 max-w-5xl">
          {/* ── header ── */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.25, 0.1, 0.25, 1] as const }}
            className="mb-8"
          >
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/60 mb-3">
              {t("completeGuide")}
            </p>
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-foreground leading-[1.1] tracking-tight">
              {t("completeGuideSubtitle")}
            </h1>
            <p className="text-sm sm:text-base text-muted-foreground/70 mt-2 max-w-2xl leading-relaxed">
              {t("completeGuideDescription")}
            </p>
            <a
              href="https://cal.com/coasty/15min"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 mt-4 h-9 px-4 rounded-xl border border-border/60 text-sm font-medium text-muted-foreground/70 hover:text-foreground hover:border-border transition-all"
            >
              <VideoCamera size={15} weight="duotone" />
              {t("talkToCofounders")}
            </a>
          </motion.div>

          {/* ── tab navigation ── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1, ease: [0.25, 0.1, 0.25, 1] as const }}
            className="sticky top-[56px] z-20 py-3"
          >
            <TabNav activeTab={activeTab} onTabChange={setActiveTab} />
          </motion.div>

          {/* ── tab content ── */}
          <div className="mt-8">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                variants={tabContent}
                initial="hidden"
                animate="show"
                exit="exit"
              >
                <TabContent activeTab={activeTab} inApp={inApp} />
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>

      <LandingFooter />
    </div>
  )
}

/* ─── page wrapper ─── */

export function GuideClient({ inApp }: { inApp: boolean }) {
  if (inApp) {
    return (
      <LayoutApp>
        <GuideContent inApp />
      </LayoutApp>
    )
  }

  return <GuideContent inApp={false} />
}
