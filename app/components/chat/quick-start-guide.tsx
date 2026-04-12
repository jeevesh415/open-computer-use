"use client"

import Link from "next/link"
import { AnimatePresence, motion } from "motion/react"
import { useState, useEffect, useCallback, useMemo } from "react"
import {
  Monitor,
  KeyRound,
  MessageSquareText,
  Smartphone,
  Workflow,
  CalendarDays,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  X,
  Check,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Caveat } from "next/font/google"
import { CreateMachineDialog } from "@/app/components/machines/create-machine-dialog"

const handwriting = Caveat({ subsets: ["latin"], weight: ["600"] })
import type { UserMachine } from "@/types/machines.types"
import { useTranslations } from "next-intl"
import { useGuideStore } from "@/lib/guide-store"

/* ─── Types ──────────────────────────────────────────────────────────── */

interface QuickStartGuideProps {
  userName?: string
  selectedVMId: string | null
  isUserAuthenticated: boolean
  hasCredentials: boolean | null
}

type Tone = "ready" | "pending" | "optional" | "neutral"
type SlideId = "quickstart" | "desktop" | "swarms" | "schedules"

const selectableStatuses = new Set(["running", "creating", "starting", "stopped"])

interface StepData {
  icon: LucideIcon
  label: string
  tone: Tone
  href?: string
  onClick?: () => void
}

interface SlideData {
  id: SlideId
  tab: string
  tabIcon: LucideIcon
  items: StepData[] | ((ctx: SlideContext) => StepData[])
  cta?: { text: string; href: string }
}

interface SlideContext {
  hasMachine: boolean
  hasAvailable: boolean
  hasCredentials: boolean | null
  onCreateMachine: () => void
}

/* ─── Tone colors ────────────────────────────────────────────────────── */

const toneDot: Record<Tone, string> = {
  ready: "bg-emerald-500/70",
  pending: "bg-amber-500/70",
  optional: "bg-foreground/15",
  neutral: "bg-foreground/10",
}

/* ─── Slide definitions ──────────────────────────────────────────────── */

function buildSlides(t: ReturnType<typeof useTranslations>): SlideData[] {
  return [
    {
      id: "quickstart",
      tab: t("tabs.start"),
      tabIcon: Check,
      items: (ctx) => [
        {
          icon: Monitor,
          label: ctx.hasMachine ? t("items.computerReady") : ctx.hasAvailable ? t("items.pickComputer") : t("items.createComputer"),
          tone: ctx.hasMachine ? "ready" : "pending",
          onClick: ctx.hasAvailable ? undefined : ctx.onCreateMachine,
        },
        {
          icon: KeyRound,
          label: ctx.hasCredentials ? t("items.loginsSaved") : t("items.addLogins"),
          tone: ctx.hasCredentials ? "ready" : "optional",
          href: "/secrets",
        },
        {
          icon: MessageSquareText,
          label: t("items.askAnything"),
          tone: ctx.hasMachine ? "ready" : "neutral",
        },
      ],
    },
    {
      id: "desktop",
      tab: t("tabs.desktop"),
      tabIcon: Monitor,
      items: [
        { icon: Monitor, label: t("items.macWindows"), tone: "ready" },
        { icon: Smartphone, label: t("items.mobileRemote"), tone: "optional" },
      ],
      cta: { text: t("cta.downloadApp"), href: "/download" },
    },
    {
      id: "swarms",
      tab: t("tabs.swarms"),
      tabIcon: Workflow,
      items: [
        { icon: Workflow, label: t("items.manyAgents"), tone: "ready" },
        { icon: MessageSquareText, label: t("items.onePrompt"), tone: "neutral" },
      ],
      cta: { text: t("cta.trySwarms"), href: "/swarms" },
    },
    {
      id: "schedules",
      tab: t("tabs.schedules"),
      tabIcon: CalendarDays,
      items: [
        { icon: CalendarDays, label: t("items.setCadence"), tone: "optional" },
        { icon: Workflow, label: t("items.autoRuns"), tone: "ready" },
      ],
      cta: { text: t("cta.setUp"), href: "/schedules" },
    },
  ]
}

/* ─── Main ───────────────────────────────────────────────────────────── */

export function QuickStartGuide({
  userName,
  selectedVMId,
  isUserAuthenticated,
  hasCredentials,
}: QuickStartGuideProps) {
  const [machines, setMachines] = useState<UserMachine[]>([])
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [active, setActive] = useState(0)
  const t = useTranslations("quickStart")
  const slides = useMemo(() => buildSlides(t), [t])
  const total = slides.length

  const prev = useCallback(() => setActive((p) => (p - 1 + total) % total), [total])
  const next = useCallback(() => setActive((p) => (p + 1) % total), [total])

  const fetchMachines = useCallback(async () => {
    if (!isUserAuthenticated) return
    try {
      const res = await fetch("/api/machines")
      if (!res.ok) return
      const data = await res.json()
      setMachines(
        (data.machines || []).filter((m: UserMachine) => {
          if (m.settings?.provider === "electron") return true
          if (m.settings?.isLocal && m.settings?.provider !== "docker") return false
          return selectableStatuses.has(m.status)
        })
      )
    } catch { /* silent */ }
  }, [isUserAuthenticated])

  useEffect(() => {
    fetchMachines()
    const iv = setInterval(fetchMachines, 10000)
    return () => clearInterval(iv)
  }, [fetchMachines])

  const hasMachine = Boolean(selectedVMId)
  const hasAvailable = machines.length > 0
  const slide = slides[active]

  const ctx: SlideContext = useMemo(() => ({
    hasMachine,
    hasAvailable,
    hasCredentials,
    onCreateMachine: () => setShowCreateDialog(true),
  }), [hasMachine, hasAvailable, hasCredentials])

  const items = typeof slide.items === "function" ? slide.items(ctx) : slide.items

  return (
    <>
      <div className="mx-auto w-full max-w-[22rem] px-2">
        {/* Greeting */}
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className="text-center mb-3"
        >
          <h2 className={cn("text-xl sm:text-2xl text-primary -rotate-[0.8deg]", handwriting.className)}>
            {userName ? t("greetingName", { name: userName }) : t("greetingDefault")}
          </h2>
          <p className="text-[10px] text-muted-foreground/50 mt-0.5 tracking-wide">
            {t("subtitle")}
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
          className="relative"
        >
          {/* Close */}
          <button
            type="button"
            onClick={useGuideStore.getState().toggle}
            className="absolute -top-1.5 -right-1 z-10 flex size-5 items-center justify-center rounded-full border border-foreground/[0.06] bg-background/80 text-foreground/25 hover:text-foreground/50 hover:border-foreground/15 transition-all duration-150"
          >
            <X className="size-2.5" strokeWidth={2.5} />
          </button>

          {/* Card */}
          <div className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.015] dark:bg-white/[0.02] overflow-hidden">

            {/* Tab bar */}
            <div className="flex items-center border-b border-foreground/[0.04]">
              {slides.map((s, i) => {
                const TabIcon = s.tabIcon
                const isActive = i === active
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setActive(i)}
                    className={cn(
                      "flex-1 flex items-center justify-center gap-1.5 py-2 text-[10px] font-medium tracking-wide transition-all duration-200 relative",
                      isActive
                        ? "text-foreground/70"
                        : "text-foreground/25 hover:text-foreground/40",
                    )}
                  >
                    <TabIcon className="size-3" strokeWidth={1.6} />
                    <span className="hidden sm:inline">{s.tab}</span>
                    {isActive && (
                      <motion.div
                        layoutId="guide-tab-indicator"
                        className="absolute bottom-0 inset-x-3 h-px bg-foreground/20"
                        transition={{ type: "spring", stiffness: 400, damping: 30 }}
                      />
                    )}
                  </button>
                )
              })}
            </div>

            {/* Steps */}
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={slide.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="px-3 py-2"
              >
                <div className="flex flex-col gap-0.5">
                  {items.map((item) => {
                    const Icon = item.icon
                    const Wrapper = item.href ? Link : item.onClick ? "button" : "div"
                    const wrapperProps = item.href
                      ? { href: item.href }
                      : item.onClick
                        ? { type: "button" as const, onClick: item.onClick }
                        : {}
                    return (
                      <Wrapper
                        key={item.label}
                        {...(wrapperProps as any)}
                        className={cn(
                          "group flex items-center gap-2.5 py-1.5 px-2 rounded-lg transition-all duration-150",
                          (item.href || item.onClick) && "cursor-pointer hover:bg-foreground/[0.03]",
                        )}
                      >
                        <div className={cn("size-1 rounded-full shrink-0", toneDot[item.tone])} />
                        <Icon className="size-3.5 text-foreground/25 shrink-0" strokeWidth={1.5} />
                        <span className="text-[11.5px] text-foreground/55 font-medium leading-tight flex-1 text-left truncate">
                          {item.label}
                        </span>
                        {(item.href || item.onClick) && (
                          <ArrowRight className="size-2.5 text-foreground/15 opacity-0 group-hover:opacity-100 transition-opacity duration-150 shrink-0" />
                        )}
                      </Wrapper>
                    )
                  })}
                </div>

                {/* CTA */}
                {slide.cta && (
                  <Link
                    href={slide.cta.href}
                    className="flex items-center justify-center gap-1 mt-1.5 rounded-lg border border-foreground/[0.05] bg-foreground/[0.02] hover:bg-foreground/[0.04] hover:border-foreground/[0.08] py-1.5 text-[10px] font-medium text-foreground/35 hover:text-foreground/55 transition-all duration-200"
                  >
                    {slide.cta.text}
                    <ArrowRight className="size-2.5" />
                  </Link>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </motion.div>
      </div>

      <CreateMachineDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onMachineCreated={fetchMachines}
      />
    </>
  )
}
