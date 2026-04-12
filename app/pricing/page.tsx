"use client"

import { GuideLines } from "@/app/components/landing/guide-lines"
import { Button } from "@/components/ui/button"
import { RainbowButton } from "@/components/magicui/rainbow-button"
import {
  Check,
  Zap,
  ArrowRight,
  HardDrive,
  ChevronDown,
  Monitor,
  Workflow,
  Globe,
  Shield,
  MousePointerClick,
  Search,
  FileText,
  Lock,
  TerminalSquare,
  type LucideIcon,
} from "lucide-react"
import Link from "next/link"
import { useState, useMemo } from "react"
import { cn } from "@/lib/utils"
import { LandingHeader } from "@/app/components/landing/landing-header"
import { LandingFooter } from "@/app/components/landing/landing-footer"
import { motion, AnimatePresence } from "framer-motion"
import { useTranslations } from "next-intl"

// ─── Types ──────────────────────────────────────────────────────────────────

interface Plan {
  id: string
  name: string
  price: number
  tagline: string
  credits: number
  machines: number
  swarm: number
  highlighted: boolean
  badge?: string
  cta: string
  search: boolean
}

interface Feature {
  icon: LucideIcon
  title: string
  subtitle: (plan: Plan) => string
  highlight?: { label: string; color: string; bg: string; border: string }
}

// ─── Static data (non-translatable) ────────────────────────────────────────

const planData = [
  { id: "free", price: 0, credits: 0, machines: 0, swarm: 0, highlighted: false, search: false },
  { id: "lite", price: 9, credits: 100, machines: 1, swarm: 2, highlighted: false, search: false },
  { id: "starter", price: 19, credits: 200, machines: 1, swarm: 3, highlighted: false, search: true },
  { id: "plus", price: 50, credits: 600, machines: 2, swarm: 6, highlighted: true, search: true },
  { id: "pro", price: 100, credits: 1500, machines: 3, swarm: 9, highlighted: false, search: true },
] as const

const featureIcons: LucideIcon[] = [Monitor, Workflow, Shield, Zap, HardDrive, Globe]

const featureHighlights = [
  { color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/20" },
  { color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20" },
  { color: "text-green-600 dark:text-green-400", bg: "bg-green-500/10", border: "border-green-500/20" },
  undefined,
  undefined,
  undefined,
]

const faqKeys = ["credits", "persistent", "swarm", "cancel", "security"] as const

const taskCosts = [8, 12, 5, 6] as const

const ease = [0.22, 1, 0.36, 1] as const

// ─── Animated Visuals ───────────────────────────────────────────────────────

function AgentVisual({ t }: { t: ReturnType<typeof useTranslations<"pricingPage">> }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-5 p-6">
      {/* Mini desktop window */}
      <motion.div
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, ease }}
        className="w-full max-w-[280px] rounded-xl border border-border/60 bg-card/60 overflow-hidden shadow-sm"
      >
        {/* Title bar */}
        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border/40 bg-muted/30">
          <div className="h-2 w-2 rounded-full bg-red-400/60" />
          <div className="h-2 w-2 rounded-full bg-yellow-400/60" />
          <div className="h-2 w-2 rounded-full bg-green-400/60" />
          <span className="text-[10px] text-muted-foreground ml-2">coasty-vm</span>
        </div>
        {/* Desktop content */}
        <div className="p-4 space-y-2.5 relative">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded bg-blue-500/10 flex items-center justify-center"><Globe className="h-3 w-3 text-blue-500" /></div>
            <div className="h-2.5 w-20 rounded-full bg-muted/60" />
          </div>
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded bg-orange-500/10 flex items-center justify-center"><FileText className="h-3 w-3 text-orange-500" /></div>
            <div className="h-2.5 w-16 rounded-full bg-muted/60" />
          </div>
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded bg-green-500/10 flex items-center justify-center"><TerminalSquare className="h-3 w-3 text-green-500" /></div>
            <div className="h-2.5 w-24 rounded-full bg-muted/60" />
          </div>
          {/* Animated cursor */}
          <motion.div
            className="absolute"
            initial={{ top: 16, left: 20, opacity: 0 }}
            animate={{
              top: [16, 44, 72, 44],
              left: [20, 80, 40, 80],
              opacity: 1,
            }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          >
            <MousePointerClick className="h-4 w-4 text-primary drop-shadow-sm" />
          </motion.div>
        </div>
      </motion.div>
      <motion.p
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.3 }}
        className="text-xs text-muted-foreground text-center max-w-[200px]"
      >
        {t("animations.agentDescription")}
      </motion.p>
    </div>
  )
}

function CreditsVisual({ plan, t }: { plan: Plan; t: ReturnType<typeof useTranslations<"pricingPage">> }) {
  const taskLabels = [
    t("animations.fillForm"),
    t("animations.searchExtract"),
    t("animations.uploadReport"),
    t("animations.navigateSite"),
  ]

  const tasks = taskLabels.map((label, i) => ({ label, cost: taskCosts[i] }))

  return (
    <div className="h-full flex flex-col items-center justify-center gap-5 p-6">
      {/* Credit counter */}
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, ease }}
        className="text-center"
      >
        <motion.span
          key={plan.credits}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-5xl font-bold tracking-tight text-foreground"
        >
          {plan.credits === 0 ? t("plans.free.name") : plan.credits.toLocaleString()}
        </motion.span>
        <p className="text-sm text-muted-foreground mt-1">{plan.credits === 0 ? t("features.monthlyCredits.payAsYouGo") : t("animations.creditsPerMonth")}</p>
      </motion.div>

      {/* Animated task list showing credit usage */}
      <div className="w-full max-w-[240px] space-y-2">
        {tasks.map((task, i) => (
          <motion.div
            key={task.label}
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.15 + i * 0.1, duration: 0.35, ease }}
            className="flex items-center justify-between rounded-lg bg-muted/30 border border-border/30 px-3 py-2"
          >
            <div className="flex items-center gap-2">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.3 + i * 0.1, type: "spring", stiffness: 400 }}
                className="h-1.5 w-1.5 rounded-full bg-primary"
              />
              <span className="text-xs text-foreground">{task.label}</span>
            </div>
            <span className="text-[11px] text-muted-foreground tabular-nums">{task.cost} {t("animations.cr")}</span>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

function MachinesVisual({ plan, t }: { plan: Plan; t: ReturnType<typeof useTranslations<"pricingPage">> }) {
  const count = plan.machines === 0 ? 1 : plan.machines
  const isTemp = plan.machines === 0

  return (
    <div className="h-full flex flex-col items-center justify-center gap-5 p-6">
      {/* Machine cards */}
      <div className="flex items-end gap-3">
        {Array.from({ length: count }).map((_, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: i * 0.12, duration: 0.45, ease }}
            className={cn(
              "w-[80px] rounded-xl border overflow-hidden",
              isTemp
                ? "border-border/50 bg-muted/20"
                : "border-orange-500/30 bg-orange-500/[0.04]"
            )}
          >
            {/* Mini title bar */}
            <div className={cn(
              "flex items-center gap-1 px-2 py-1.5 border-b",
              isTemp ? "border-border/30 bg-muted/20" : "border-orange-500/15 bg-orange-500/[0.06]"
            )}>
              <div className={cn("h-1.5 w-1.5 rounded-full", isTemp ? "bg-muted-foreground/30" : "bg-orange-500/60")} />
              <span className="text-[8px] text-muted-foreground">{t("animations.vm", { num: i + 1 })}</span>
            </div>
            {/* Files / bars */}
            <div className="p-2 space-y-1.5">
              {[60, 45, 70].map((w, j) => (
                <motion.div
                  key={j}
                  initial={{ width: 0 }}
                  animate={{ width: `${w}%` }}
                  transition={{ delay: 0.3 + i * 0.12 + j * 0.06, duration: 0.4, ease }}
                  className={cn(
                    "h-1.5 rounded-full",
                    isTemp ? "bg-muted-foreground/15" : "bg-orange-500/20"
                  )}
                />
              ))}
            </div>
            {/* Status */}
            <div className={cn(
              "px-2 py-1.5 border-t flex items-center gap-1",
              isTemp ? "border-border/30" : "border-orange-500/15"
            )}>
              <motion.div
                className={cn("h-1.5 w-1.5 rounded-full", isTemp ? "bg-muted-foreground/40" : "bg-green-500")}
                animate={isTemp ? {} : { opacity: [1, 0.4, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
              />
              <span className="text-[8px] text-muted-foreground">{isTemp ? t("animations.twoHrLimit") : t("animations.alwaysOn")}</span>
            </div>
          </motion.div>
        ))}

        {/* Empty machine slots */}
        {!isTemp && plan.machines < 3 && Array.from({ length: 3 - plan.machines }).map((_, i) => (
          <motion.div
            key={`empty-${i}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5, duration: 0.3 }}
            className="w-[80px] h-[88px] rounded-xl border border-dashed border-border/40 flex items-center justify-center"
          >
            <span className="text-[9px] text-muted-foreground/40">Upgrade</span>
          </motion.div>
        ))}
      </div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4, duration: 0.3 }}
        className="text-xs text-muted-foreground text-center"
      >
        {isTemp ? t("animations.tempVmDescription") : t("animations.persistentVmDescription")}
      </motion.p>
    </div>
  )
}

function SwarmVisual({ plan, t }: { plan: Plan; t: ReturnType<typeof useTranslations<"pricingPage">> }) {
  const count = plan.swarm

  if (count === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 p-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, ease }}
          className="relative"
        >
          <div className="h-14 w-14 rounded-full bg-muted/40 border border-border/50 flex items-center justify-center">
            <Workflow className="h-6 w-6 text-muted-foreground/40" />
          </div>
        </motion.div>
        <p className="text-xs text-muted-foreground text-center">{t("animations.sequentialOnly")}</p>
      </div>
    )
  }

  // Arrange agents in a flowing grid
  const cols = count <= 4 ? count : Math.ceil(count / 2)
  const rows = count <= 4 ? 1 : 2

  return (
    <div className="h-full flex flex-col items-center justify-center gap-5 p-6">
      {/* Central task node */}
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3, ease }}
        className="flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/[0.06] px-3 py-1.5"
      >
        <Zap className="h-3 w-3 text-amber-500" />
        <span className="text-xs font-medium text-foreground">{t("animations.yourTask")}</span>
      </motion.div>

      {/* Connection lines */}
      <motion.div
        initial={{ scaleY: 0 }}
        animate={{ scaleY: 1 }}
        transition={{ delay: 0.15, duration: 0.25, ease }}
        className="h-4 w-px bg-amber-500/30 origin-top"
      />

      {/* Agent grid */}
      <div className="flex flex-col items-center gap-2">
        {Array.from({ length: rows }).map((_, row) => {
          const startIdx = row * cols
          const rowCount = Math.min(cols, count - startIdx)
          return (
            <div key={row} className="flex items-center gap-2">
              {Array.from({ length: rowCount }).map((_, col) => {
                const idx = startIdx + col
                return (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, scale: 0, y: -8 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    transition={{ delay: 0.25 + idx * 0.05, type: "spring", stiffness: 300, damping: 20 }}
                    className="relative"
                  >
                    <div className="h-10 w-10 rounded-lg bg-amber-500/10 border border-amber-500/25 flex items-center justify-center">
                      <Monitor className="h-4 w-4 text-amber-500" />
                    </div>
                    {/* Pulsing activity dot */}
                    <motion.div
                      className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-green-500 border-2 border-background"
                      animate={{ scale: [1, 1.3, 1] }}
                      transition={{ delay: idx * 0.2, duration: 1.5, repeat: Infinity }}
                    />
                  </motion.div>
                )
              })}
            </div>
          )
        })}
      </div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5, duration: 0.3 }}
        className="text-xs text-muted-foreground text-center"
      >
        {t("animations.agentsWorking", { count })}
      </motion.p>
    </div>
  )
}

function SearchVisual({ plan, t }: { plan: Plan; t: ReturnType<typeof useTranslations<"pricingPage">> }) {
  const results = ["quarterly earnings report.pdf", "market analysis 2026", "competitor pricing data"]

  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 p-6">
      {/* Search bar */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease }}
        className="w-full max-w-[260px] rounded-xl border border-border/60 bg-card/60 overflow-hidden"
      >
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border/30">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: "70%" }}
            transition={{ delay: 0.2, duration: 0.6, ease }}
            className="h-2 rounded-full bg-primary/30"
          />
        </div>

        {/* Results */}
        <div className="p-2 space-y-1.5">
          {results.map((result, i) => (
            <motion.div
              key={result}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: plan.search ? 1 : (i === 0 ? 1 : 0.3), x: 0 }}
              transition={{ delay: 0.4 + i * 0.12, duration: 0.35, ease }}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 bg-muted/20"
            >
              <div className="h-1.5 w-1.5 rounded-full bg-green-500/60 flex-shrink-0" />
              <span className="text-[10px] text-foreground truncate">{result}</span>
            </motion.div>
          ))}
          {!plan.search && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.7, duration: 0.3 }}
              className="text-center py-1"
            >
              <span className="text-[9px] text-muted-foreground/50">{t("animations.upgradeForExtraction")}</span>
            </motion.div>
          )}
        </div>
      </motion.div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5, duration: 0.3 }}
        className="text-xs text-muted-foreground text-center"
      >
        {plan.search ? t("animations.searchDescription") : t("animations.basicSearchIncluded")}
      </motion.p>
    </div>
  )
}

function SecurityVisual({ t }: { t: ReturnType<typeof useTranslations<"pricingPage">> }) {
  const layers = [
    { icon: Lock, label: t("animations.e2eEncryption"), color: "text-blue-500", bg: "bg-blue-500/10", border: "border-blue-500/20" },
    { icon: Shield, label: t("animations.sandboxedVm"), color: "text-green-500", bg: "bg-green-500/10", border: "border-green-500/20" },
    { icon: Monitor, label: t("animations.destroyedAfterUse"), color: "text-orange-500", bg: "bg-orange-500/10", border: "border-orange-500/20" },
  ]

  return (
    <div className="h-full flex flex-col items-center justify-center gap-5 p-6">
      <div className="space-y-2.5 w-full max-w-[240px]">
        {layers.map((layer, i) => (
          <motion.div
            key={layer.label}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.12, duration: 0.4, ease }}
            className={cn("flex items-center gap-3 rounded-xl border px-4 py-3", layer.bg, layer.border)}
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.15 + i * 0.12, type: "spring", stiffness: 400 }}
            >
              <layer.icon className={cn("h-4 w-4", layer.color)} />
            </motion.div>
            <span className="text-sm font-medium text-foreground">{layer.label}</span>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 + i * 0.12, duration: 0.2 }}
              className="ml-auto"
            >
              <Check className="h-3.5 w-3.5 text-green-500" />
            </motion.div>
          </motion.div>
        ))}
      </div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5, duration: 0.3 }}
        className="text-xs text-muted-foreground text-center"
      >
        {t("animations.everyPlan")}
      </motion.p>
    </div>
  )
}

// ─── Visual selector ────────────────────────────────────────────────────────

function FeatureVisual({ featureIndex, plan, t }: { featureIndex: number; plan: Plan; t: ReturnType<typeof useTranslations<"pricingPage">> }) {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={`${featureIndex}-${plan.id}`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="h-full"
      >
        {featureIndex === 0 && <AgentVisual t={t} />}
        {featureIndex === 1 && <SwarmVisual plan={plan} t={t} />}
        {featureIndex === 2 && <SecurityVisual t={t} />}
        {featureIndex === 3 && <CreditsVisual plan={plan} t={t} />}
        {featureIndex === 4 && <MachinesVisual plan={plan} t={t} />}
        {featureIndex === 5 && <SearchVisual plan={plan} t={t} />}
      </motion.div>
    </AnimatePresence>
  )
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function PricingPage() {
  const t = useTranslations("pricingPage")
  const [selectedPlan, setSelectedPlan] = useState(3)
  const [activeFeature, setActiveFeature] = useState(0)
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null)

  const plans: Plan[] = useMemo(() => planData.map((p) => ({
    ...p,
    name: t(`plans.${p.id}.name` as any),
    tagline: t(`plans.${p.id}.tagline` as any),
    cta: t(`plans.${p.id}.cta` as any),
    badge: p.id === "plus" ? t("plans.plus.badge") : undefined,
  })), [t])

  const featureList: Feature[] = useMemo(() => [
    {
      icon: featureIcons[0],
      title: t("features.computerAgent.name"),
      subtitle: () => t("features.computerAgent.description"),
      highlight: { label: t("features.computerAgent.badge"), ...featureHighlights[0]! },
    },
    {
      icon: featureIcons[1],
      title: t("features.swarmMode.name"),
      subtitle: (p: Plan) => p.swarm === 0 ? t("features.swarmMode.sequential") : t("features.swarmMode.parallel", { count: p.swarm }),
      highlight: { label: t("features.swarmMode.badge"), ...featureHighlights[1]! },
    },
    {
      icon: featureIcons[2],
      title: t("features.security.name"),
      subtitle: () => t("features.security.description"),
      highlight: { label: t("features.security.badge"), ...featureHighlights[2]! },
    },
    {
      icon: featureIcons[3],
      title: t("features.monthlyCredits.name"),
      subtitle: (p: Plan) => p.credits === 0 ? t("features.monthlyCredits.payAsYouGo") : t("features.monthlyCredits.creditsPerMonth", { count: p.credits.toLocaleString() }),
    },
    {
      icon: featureIcons[4],
      title: t("features.persistentMachines.name"),
      subtitle: (p: Plan) => p.machines === 0 ? t("features.persistentMachines.temporary") : p.id === "lite" ? t("features.persistentMachines.deletedAfterInactivity") : p.machines > 1 ? t("features.persistentMachines.alwaysOnPlural", { count: p.machines }) : t("features.persistentMachines.alwaysOn", { count: p.machines }),
    },
    {
      icon: featureIcons[5],
      title: t("features.webSearch.name"),
      subtitle: (p: Plan) => p.search ? t("features.webSearch.advanced") : t("features.webSearch.basic"),
    },
  ], [t])

  const faqs = useMemo(() => faqKeys.map((key) => ({
    q: t(`faqs.${key}.q` as any),
    a: t(`faqs.${key}.a` as any),
  })), [t])

  const plan = plans[selectedPlan]
  const price = plan.price

  return (
    <div className="min-h-screen bg-background text-foreground relative">
      <GuideLines />
      <LandingHeader />

      {/* ─── Hero ──────────────────────────────────────────────────────── */}
      <section className="relative pt-32 sm:pt-36 md:pt-40 pb-4 overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(var(--primary-rgb),0.08),transparent)]" />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease }}
          className="relative max-w-3xl mx-auto px-7 sm:px-10 text-center"
        >
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight leading-[1.08]">
            {t("hero.title1")}{" "}
            <span className="text-muted-foreground">{t("hero.title2")}</span>
          </h1>
          <p className="mt-4 text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed">
            {t("hero.subtitle")}
          </p>
        </motion.div>
      </section>

      {/* ─── Plan Tabs + Split Feature Explorer ──────────────────────── */}
      <section className="py-10 sm:py-14 px-7 sm:px-10">
        <div className="max-w-5xl mx-auto">

          {/* Plan tabs */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.4, ease }}
            className="relative flex items-center rounded-2xl border border-border/60 bg-card/40 p-1.5 mb-6"
          >
            {plans.map((p, i) => (
              <button
                key={p.id}
                onClick={() => setSelectedPlan(i)}
                className={cn(
                  "relative flex-1 flex flex-col items-center gap-0.5 py-3 sm:py-3.5 rounded-xl text-center transition-colors duration-200 z-10",
                  selectedPlan === i ? "text-foreground" : "text-muted-foreground hover:text-foreground/70"
                )}
              >
                {p.badge && (
                  <span className="absolute -top-1 left-1/2 -translate-x-1/2 rounded-full bg-primary px-2 py-0.5 text-[9px] font-semibold text-primary-foreground uppercase tracking-wider leading-none">
                    {p.badge}
                  </span>
                )}
                <span className="text-sm sm:text-base font-semibold">{p.name}</span>
                <span className="text-xs text-muted-foreground tabular-nums">${p.price}{t("perMonth")}</span>
                {selectedPlan === i && (
                  <motion.div
                    layoutId="plan-tab-bg"
                    className="absolute inset-0 rounded-xl bg-muted/60 border border-border/60 -z-10"
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  />
                )}
              </button>
            ))}
          </motion.div>

          {/* Main content — split layout */}
          <AnimatePresence mode="wait">
            <motion.div
              key={plan.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3, ease }}
            >
              <div className={cn(
                "rounded-2xl border overflow-hidden",
                plan.highlighted
                  ? "border-primary/30 bg-gradient-to-b from-primary/[0.04] to-transparent"
                  : "border-border/60 bg-card/40"
              )}>
                {/* Price header */}
                <div className="px-6 sm:px-8 pt-6 sm:pt-8 pb-5 border-b border-border/30">
                  <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">{plan.tagline}</p>
                      <div className="flex items-baseline gap-1.5">
                        <motion.span
                          key={plan.id}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="text-5xl sm:text-6xl font-bold tracking-tight"
                        >
                          ${price}
                        </motion.span>
                        <span className="text-lg text-muted-foreground">{t("perMonth")}</span>
                      </div>
                    </div>
                    {plan.highlighted ? (
                      <RainbowButton className="h-11 px-8 text-sm sm:text-base flex-shrink-0" asChild>
                        <Link href="/auth">{plan.cta}<ArrowRight className="ml-2 h-4 w-4" /></Link>
                      </RainbowButton>
                    ) : (
                      <Button className={cn("h-11 px-8 flex-shrink-0", plan.price > 0 && "hover:bg-primary hover:text-primary-foreground")} variant={plan.price === 0 ? "default" : "outline"} asChild>
                        <Link href="/auth">{plan.cta}<ArrowRight className="ml-2 h-4 w-4" /></Link>
                      </Button>
                    )}
                  </div>
                </div>

                {/* Split: features left, visual right */}
                <div className="flex flex-col lg:flex-row">
                  {/* Feature list — left */}
                  <div className="flex-1 p-4 sm:p-6 lg:border-r border-border/30">
                    <div className="space-y-0.5">
                      {featureList.map((feature, i) => {
                        const hl = feature.highlight
                        const active = activeFeature === i
                        return (
                          <button
                            key={feature.title}
                            onMouseEnter={() => setActiveFeature(i)}
                            onClick={() => setActiveFeature(i)}
                            className={cn(
                              "w-full flex items-center gap-3 rounded-xl px-3.5 py-3 text-left transition-all duration-200 border",
                              active
                                ? hl ? `${hl.bg} ${hl.border}` : "bg-muted/50 border-transparent"
                                : "border-transparent hover:bg-muted/25"
                            )}
                          >
                            <div className={cn(
                              "h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors duration-200",
                              hl ? `${hl.bg} ${hl.color}` : active ? "bg-primary/10 text-primary" : "bg-muted/40 text-muted-foreground"
                            )}>
                              <feature.icon className="h-4 w-4" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <h3 className={cn(
                                  "text-sm font-medium transition-colors duration-200",
                                  active ? "text-foreground" : "text-foreground/80"
                                )}>
                                  {feature.title}
                                </h3>
                                {hl && (
                                  <span className={cn(
                                    "text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full leading-none",
                                    hl.bg, hl.color
                                  )}>
                                    {hl.label}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground truncate">{feature.subtitle(plan)}</p>
                            </div>
                            {/* Active indicator bar */}
                            <div className={cn(
                              "w-0.5 h-6 rounded-full transition-colors duration-200",
                              active
                                ? hl ? hl.bg.replace("/10", "/40") : "bg-primary"
                                : hl ? hl.bg.replace("/10", "/20") : "bg-transparent"
                            )} />
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* Animated visual — right */}
                  <div className="flex-1 min-h-[320px] lg:min-h-[380px] border-t lg:border-t-0 border-border/30 flex items-center justify-center bg-muted/[0.02]">
                    <FeatureVisual featureIndex={activeFeature} plan={plan} t={t} />
                  </div>
                </div>

                <div className="px-6 sm:px-8 py-3 border-t border-border/30 text-center">
                  <p className="text-xs text-muted-foreground">
                    {plan.price === 0 ? t("footer.noCreditCardRequired") : t("footer.cancelAnytimeNoContracts")}
                  </p>
                </div>
              </div>
            </motion.div>
          </AnimatePresence>

          {/* Enterprise */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.4, ease }}
            className="mt-4 rounded-2xl border border-border/40 bg-card/30 p-5 sm:p-6"
          >
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="text-center sm:text-left">
                <h3 className="font-semibold">{t("enterprise.title")}</h3>
                <p className="text-sm text-muted-foreground mt-1">{t("enterprise.description")}</p>
              </div>
              <Button variant="outline" size="sm" className="gap-2 flex-shrink-0" asChild>
                <Link href="mailto:founders@coasty.ai">{t("enterprise.cta")}<ArrowRight className="h-3.5 w-3.5" /></Link>
              </Button>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ─── FAQ ───────────────────────────────────────────────────────── */}
      <section className="py-14 sm:py-20 px-7 sm:px-10">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5, ease }}
          className="max-w-2xl mx-auto"
        >
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-center mb-8">{t("questions")}</h2>
          <div className="space-y-2">
            {faqs.map((faq, i) => (
              <div key={i} className="rounded-xl border border-border/50 overflow-hidden transition-colors duration-200 hover:border-border/80">
                <button
                  onClick={() => setExpandedFaq(expandedFaq === i ? null : i)}
                  className="w-full flex items-center justify-between p-4 sm:p-5 text-left hover:bg-muted/20 transition-colors duration-200"
                >
                  <span className="text-sm sm:text-[15px] font-medium text-foreground pr-4">{faq.q}</span>
                  <ChevronDown className={cn("h-4 w-4 text-muted-foreground flex-shrink-0 transition-transform duration-200", expandedFaq === i && "rotate-180")} />
                </button>
                <AnimatePresence initial={false}>
                  {expandedFaq === i && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] as const }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 sm:px-5 pb-4 sm:pb-5">
                        <p className="text-sm text-muted-foreground leading-relaxed">{faq.a}</p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </div>
        </motion.div>
      </section>

      {/* ─── Final CTA ─────────────────────────────────────────────────── */}
      <section className="py-16 sm:py-24 px-7 sm:px-10">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5, ease }}
          className="max-w-2xl mx-auto text-center"
        >
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">{t("footer.title")}</h2>
          <p className="text-muted-foreground mt-4 text-lg">{t("footer.subtitle")}</p>
          <div className="mt-8 flex flex-col items-center gap-4">
            <RainbowButton size="lg" className="text-base px-10 h-13 sm:h-14 sm:text-lg sm:px-12" asChild>
              <Link href="/auth">{t("plans.free.cta")}<ArrowRight className="ml-2 h-4 w-4 sm:h-5 sm:w-5" /></Link>
            </RainbowButton>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><Check className="h-3 w-3 text-primary" /> {t("footer.noCreditCard")}</span>
              <span className="flex items-center gap-1.5"><Check className="h-3 w-3 text-primary" /> {t("footer.cancelAnytime")}</span>
            </div>
          </div>
        </motion.div>
      </section>

      <LandingFooter />
    </div>
  )
}
