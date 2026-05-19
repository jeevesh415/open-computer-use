"use client"

import { LandingHeader } from "@/app/components/landing/landing-header"
import { LandingFooter } from "@/app/components/landing/landing-footer"
import { cn } from "@/lib/utils"
import Link from "next/link"
import { useState, useEffect, useCallback, useRef } from "react"
import { useTranslations } from "next-intl"
import { motion, AnimatePresence, useInView } from "framer-motion"
import {
  ArrowRight,
  Check,
  Zap,
  Clock,
  Monitor,
  GitFork,
  Play,
  RotateCcw,
  ChevronRight,
  Layers,
  Target,
  TrendingUp,
  Shield,
  BarChart3,
  Cpu,
  Send,
  Merge,
  ChevronDown,
  Eye,
} from "lucide-react"

// ==========================================================================
// Shared UI atoms — kept tiny and local so the page reads as one piece
// ==========================================================================

function PrimaryButton({
  href,
  children,
  className,
}: {
  href: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex h-10 items-center gap-2 rounded-full bg-foreground px-5 text-sm font-medium text-background transition-colors hover:bg-foreground/85",
        className,
      )}
    >
      {children}
    </Link>
  )
}

function GhostButton({
  href,
  external,
  children,
  className,
}: {
  href: string
  external?: boolean
  children: React.ReactNode
  className?: string
}) {
  const cls = cn(
    "inline-flex h-10 items-center gap-1.5 rounded-full border border-border bg-background/60 px-5 text-sm font-medium text-foreground backdrop-blur-sm transition-colors hover:bg-muted",
    className,
  )
  if (external) {
    return (
      <a href={href} className={cls}>
        {children}
      </a>
    )
  }
  return (
    <Link href={href} className={cls}>
      {children}
    </Link>
  )
}

function MonoTag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/60 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground backdrop-blur-sm">
      {children}
    </span>
  )
}

function SectionHeader({
  title,
  subtitle,
  isMobile,
}: {
  title: string
  subtitle?: string
  isMobile: boolean
}) {
  return (
    <div className="mb-10 text-center sm:mb-14">
      <h2
        className={cn(
          "font-semibold tracking-tight text-foreground",
          isMobile ? "text-[26px] leading-[1.1]" : "text-3xl sm:text-4xl",
        )}
      >
        {title}
      </h2>
      {subtitle ? (
        <p
          className={cn(
            "mx-auto mt-3 max-w-xl text-muted-foreground",
            isMobile ? "text-sm" : "text-base",
          )}
        >
          {subtitle}
        </p>
      ) : null}
    </div>
  )
}

// ==========================================================================
// Hero Video Player
// ==========================================================================

const HERO_VIDEO_ID = "IBydvwkJcCQ"

function HeroVideoPlayer() {
  const containerRef = useRef<HTMLDivElement>(null)
  const inView = useInView(containerRef, { once: true, amount: 0.3 })
  const [isPlaying, setIsPlaying] = useState(false)

  return (
    <div
      ref={containerRef}
      className="group relative cursor-pointer"
      onClick={() => setIsPlaying(true)}
    >
      {/* Soft monochrome ambient ring */}
      <div className="pointer-events-none absolute -inset-px rounded-[20px] bg-gradient-to-b from-foreground/[0.04] to-transparent" />
      <div className="pointer-events-none absolute -inset-4 rounded-[28px] bg-gradient-to-b from-foreground/[0.025] via-transparent to-transparent blur-xl" />

      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 20 }}
        animate={inView ? { opacity: 1, scale: 1, y: 0 } : {}}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        className={cn(
          "relative overflow-hidden rounded-2xl",
          "bg-neutral-950",
          "ring-1 ring-foreground/[0.06] dark:ring-foreground/[0.06]",
          "shadow-[0_8px_40px_-12px_rgba(0,0,0,0.12),0_20px_60px_-20px_rgba(0,0,0,0.18)]",
          "dark:shadow-[0_8px_40px_-12px_rgba(0,0,0,0.5),0_20px_60px_-20px_rgba(0,0,0,0.6)]",
        )}
      >
        <div className="relative w-full" style={{ paddingTop: "56.25%" }}>
          {!isPlaying ? (
            <>
              <div className="absolute inset-0">
                <img
                  src={`https://img.youtube.com/vi/${HERO_VIDEO_ID}/maxresdefault.jpg`}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-black/10 to-black/20" />
              </div>

              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={inView ? { opacity: 1, scale: 1 } : {}}
                transition={{ delay: 0.3, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                className="absolute inset-0 flex items-center justify-center"
              >
                <button
                  type="button"
                  className={cn(
                    "relative size-[72px] rounded-full sm:size-20",
                    "bg-white/90 backdrop-blur-xl dark:bg-white/85",
                    "shadow-[0_8px_32px_rgba(0,0,0,0.12),0_2px_8px_rgba(0,0,0,0.08)]",
                    "flex items-center justify-center",
                    "transition-all duration-300 group-hover:scale-[1.06] active:scale-[0.96]",
                    "hover:shadow-[0_12px_48px_rgba(0,0,0,0.18),0_4px_12px_rgba(0,0,0,0.1)]",
                  )}
                >
                  <Play className="ml-1 size-7 text-neutral-900 sm:size-8" fill="currentColor" />
                </button>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={inView ? { opacity: 1, y: 0 } : {}}
                transition={{ delay: 0.5, duration: 0.5 }}
                className="absolute inset-x-0 bottom-0 p-5 sm:p-6"
              >
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/10 px-3 py-1.5 backdrop-blur-md">
                    <span className="relative size-2">
                      <span className="absolute inset-0 animate-pulse rounded-full bg-white/80" />
                      <span className="absolute inset-0 rounded-full bg-white" />
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/90">
                      Demo
                    </span>
                  </div>
                  <span className="text-sm font-medium text-white/60">
                    Watch agent swarms in action
                  </span>
                </div>
              </motion.div>
            </>
          ) : (
            <iframe
              className="absolute inset-0 h-full w-full"
              src={`https://www.youtube-nocookie.com/embed/${HERO_VIDEO_ID}?rel=0&modestbranding=1&showinfo=0&autoplay=1`}
              title="Agent Swarms Demo"
              allowFullScreen
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              style={{ border: "none" }}
            />
          )}
        </div>
      </motion.div>
    </div>
  )
}

// ==========================================================================
// Interactive Demo
// ==========================================================================

interface DemoMachine {
  id: number
  label: string
  status: "idle" | "booting" | "running" | "done"
  progress: number
  steps: string[]
  currentStep: number
}

const demoPrompt = "Research the top 5 CRM tools — compare pricing, features, integrations, and user reviews"

const demoMachines: DemoMachine[] = [
  { id: 1, label: "Salesforce", status: "idle", progress: 0, currentStep: -1, steps: ["Opening pricing page", "Extracting plan tiers", "Checking integrations", "Scraping G2 reviews", "Compiling findings"] },
  { id: 2, label: "HubSpot", status: "idle", progress: 0, currentStep: -1, steps: ["Navigating to HubSpot", "Comparing plan tiers", "Listing integrations", "Reading Capterra reviews", "Compiling findings"] },
  { id: 3, label: "Pipedrive", status: "idle", progress: 0, currentStep: -1, steps: ["Loading pricing page", "Cataloging features", "Reviewing Zapier integrations", "Pulling TrustRadius scores", "Compiling findings"] },
  { id: 4, label: "Zoho CRM", status: "idle", progress: 0, currentStep: -1, steps: ["Visiting Zoho site", "Extracting editions", "Mapping ecosystem", "Checking G2 sentiment", "Compiling findings"] },
  { id: 5, label: "Close", status: "idle", progress: 0, currentStep: -1, steps: ["Opening Close page", "Documenting features", "Checking API docs", "Reading testimonials", "Compiling findings"] },
]

// Per-CRM brand accents — these are real product brand colors, not page theming.
// Kept at low opacity inside the mini desktop so they read as identification,
// not as ornament.
const screenConfigs = [
  {
    url: "salesforce.com/pricing", color: "#00A1E0", typingText: "enterprise CRM pricing",
    brand: "Salesforce", tab: "Pricing",
    tiers: [{ name: "Essentials", price: "$25" }, { name: "Professional", price: "$80" }, { name: "Enterprise", price: "$165" }],
    features: ["Contact Mgmt", "Opportunity Tracking", "Reports & Dashboards", "API Access"],
  },
  {
    url: "hubspot.com/products", color: "#7c8794", typingText: "hubspot free vs paid",
    brand: "HubSpot", tab: "Products",
    tiers: [{ name: "Free", price: "$0" }, { name: "Starter", price: "$20" }, { name: "Pro", price: "$890" }],
    features: ["Email Marketing", "Forms & Landing", "Ad Management", "Live Chat"],
  },
  {
    url: "pipedrive.com/features", color: "#2BC47D", typingText: "pipeline management",
    brand: "Pipedrive", tab: "Features",
    tiers: [{ name: "Essential", price: "$14" }, { name: "Advanced", price: "$34" }, { name: "Pro", price: "$49" }],
    features: ["Deal Pipeline", "Email Sync", "Automations", "Revenue Insights"],
  },
  {
    url: "zoho.com/crm/editions", color: "#9da3ad", typingText: "zoho crm comparison",
    brand: "Zoho CRM", tab: "Editions",
    tiers: [{ name: "Standard", price: "$14" }, { name: "Professional", price: "$23" }, { name: "Enterprise", price: "$40" }],
    features: ["Lead Scoring", "Workflow Rules", "Advanced Analytics", "Zia AI Assistant"],
  },
  {
    url: "close.com/pricing", color: "#6E5CFF", typingText: "close crm api docs",
    brand: "Close", tab: "Pricing",
    tiers: [{ name: "Startup", price: "$29" }, { name: "Professional", price: "$99" }, { name: "Business", price: "$149" }],
    features: ["Built-in Calling", "Email Sequences", "Pipeline View", "Custom Reports"],
  },
]

const cursorPaths = [
  { x: [50, 35, 35, 65, 65, 45, 50], y: [25, 38, 38, 55, 72, 82, 25] },
  { x: [45, 60, 60, 30, 30, 75, 45], y: [28, 40, 40, 58, 76, 58, 28] },
  { x: [55, 30, 30, 70, 70, 40, 55], y: [22, 44, 44, 58, 72, 85, 22] },
  { x: [40, 70, 70, 35, 35, 60, 40], y: [26, 42, 42, 62, 78, 48, 26] },
  { x: [60, 40, 40, 55, 55, 30, 60], y: [20, 45, 45, 60, 74, 68, 20] },
]

const KB_ROWS = [
  ["Q","W","E","R","T","Y","U","I","O"],
  ["A","S","D","F","G","H","J","K"],
  ["Z","X","C","V","B","N","M"],
]

function useSwarmDemo() {
  const [machines, setMachines] = useState<DemoMachine[]>(demoMachines.map(m => ({ ...m })))
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle")
  const [elapsed, setElapsed] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const tickRef = useRef(0)

  const reset = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    setMachines(demoMachines.map(m => ({ ...m })))
    setPhase("idle")
    setElapsed(0)
    tickRef.current = 0
  }, [])

  const start = useCallback(() => {
    reset()
    setPhase("running")
    const speeds = demoMachines.map(() => 0.7 + Math.random() * 0.6)

    intervalRef.current = setInterval(() => {
      tickRef.current += 1
      setElapsed(tickRef.current)

      setMachines(prev => {
        const next = prev.map((m, i) => {
          if (m.status === "done") return m
          const speed = speeds[i]
          const tick = tickRef.current

          if (tick <= 3) return { ...m, status: "booting" as const }

          const runTick = tick - 3
          const stepDuration = 4
          const adjustedStep = Math.floor((runTick * speed) / stepDuration)
          const clampedStep = Math.min(adjustedStep, m.steps.length - 1)
          const progress = Math.min(((runTick * speed) / (m.steps.length * stepDuration)) * 100, 100)

          if (progress >= 100) {
            return { ...m, status: "done" as const, progress: 100, currentStep: m.steps.length - 1 }
          }
          return { ...m, status: "running" as const, progress, currentStep: clampedStep }
        })

        if (next.every(m => m.status === "done")) {
          if (intervalRef.current) clearInterval(intervalRef.current)
          setPhase("done")
        }
        return next
      })
    }, 400)
  }, [reset])

  useEffect(() => () => { if (intervalRef.current) clearInterval(intervalRef.current) }, [])

  return { machines, phase, elapsed, start, reset }
}

function DemoMachineCard({ machine, index }: { machine: DemoMachine; index: number }) {
  const t = useTranslations("agentSwarms")
  const config = screenConfigs[index]
  const waypoints = cursorPaths[index]
  const isActive = machine.status === "running"
  const isBooting = machine.status === "booting"
  const isDone = machine.status === "done"

  const statusColor = isDone
    ? "text-emerald-500"
    : isActive
      ? "text-foreground"
      : isBooting
        ? "text-muted-foreground"
        : "text-muted-foreground/40"

  const [typedText, setTypedText] = useState("")
  const [activeKey, setActiveKey] = useState("")
  const keyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activityRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (machine.status !== "running") {
      setTypedText(isDone ? config.typingText : "")
      setActiveKey("")
      if (activityRef.current) { clearInterval(activityRef.current); activityRef.current = null }
      return
    }
    const text = config.typingText
    let i = 0
    const interval = setInterval(() => {
      if (i < text.length) {
        setTypedText(text.substring(0, i + 1))
        const c = text[i].toUpperCase()
        if (/[A-Z]/.test(c)) {
          setActiveKey(c)
          if (keyTimeoutRef.current) clearTimeout(keyTimeoutRef.current)
          keyTimeoutRef.current = setTimeout(() => setActiveKey(""), 80)
        }
        i++
      } else {
        clearInterval(interval)
        const chars = text.toUpperCase().replace(/[^A-Z]/g, "").split("")
        let j = 0
        activityRef.current = setInterval(() => {
          setActiveKey(chars[j % chars.length])
          if (keyTimeoutRef.current) clearTimeout(keyTimeoutRef.current)
          keyTimeoutRef.current = setTimeout(() => setActiveKey(""), 80)
          j++
        }, 300 + index * 40)
      }
    }, 100 + index * 12)
    return () => {
      clearInterval(interval)
      if (activityRef.current) { clearInterval(activityRef.current); activityRef.current = null }
      if (keyTimeoutRef.current) clearTimeout(keyTimeoutRef.current)
    }
  }, [machine.status, config.typingText, index, isDone])

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "relative overflow-hidden rounded-xl border p-3 backdrop-blur-sm transition-colors duration-500",
        isDone
          ? "border-emerald-500/25 bg-emerald-500/[0.02]"
          : isActive
            ? "border-foreground/15 bg-foreground/[0.015]"
            : isBooting
              ? "border-border bg-card/30"
              : "border-border/40 bg-card/15",
      )}
    >
      {/* Machine header */}
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <div className={cn(
            "flex size-5 items-center justify-center rounded-md border transition-colors duration-300",
            isDone
              ? "border-emerald-500/25 bg-emerald-500/10"
              : isActive
                ? "border-foreground/15 bg-foreground/[0.04]"
                : "border-border/60 bg-muted/30",
          )}>
            <Monitor className={cn("size-2.5", statusColor)} />
          </div>
          <span className="text-xs font-medium">{machine.label}</span>
        </div>
        <span className={cn("font-mono text-[9px] tabular-nums tracking-wide", statusColor)}>
          {isDone ? "DONE" : isActive ? `${Math.round(machine.progress)}%` : isBooting ? "INIT" : "IDLE"}
        </span>
      </div>

      {/* Mini Desktop Screen */}
      <div className={cn(
        "relative mb-2 aspect-[16/11] overflow-hidden rounded-lg border transition-colors duration-500",
        isActive
          ? "border-foreground/10 bg-[#0d0d1a]"
          : isDone
            ? "border-emerald-500/15 bg-[#0d0d1a]"
            : isBooting
              ? "border-foreground/5 bg-[#0d0d1a]/80"
              : "border-foreground/[0.04] bg-[#0d0d1a]/40",
      )}>
        {/* Browser chrome */}
        <div className="border-b border-white/[0.03] bg-[#1e1e3a]/90">
          <div className="flex items-center gap-[2px] px-1 pt-[3px]">
            <div className="flex gap-[3px] px-1 py-[2px]">
              <div className="size-[4px] rounded-full bg-white/15" />
              <div className="size-[4px] rounded-full bg-white/15" />
              <div className="size-[4px] rounded-full bg-white/15" />
            </div>
            <div className="relative z-[1] -mb-px flex items-center gap-[3px] rounded-t-[3px] border-x border-t border-white/[0.06] bg-[#0d0d1a] px-1.5 py-[2px]">
              <div className="size-[4px] rounded-[1px]" style={{ backgroundColor: config.color + "80" }} />
              <span className="max-w-[40px] truncate text-[4px] font-medium text-white/50">{config.brand}</span>
              <span className="ml-[1px] text-[4px] text-white/15">&times;</span>
            </div>
            <div className="flex items-center gap-[2px] px-1 py-[2px] opacity-40">
              <div className="size-[3px] rounded-full bg-white/20" />
              <span className="truncate text-[3.5px] text-white/25">{config.tab}</span>
            </div>
            <div className="ml-[2px] text-[5px] text-white/10">+</div>
          </div>
          <div className="flex items-center gap-[3px] bg-[#0d0d1a] px-1.5 py-[2.5px]">
            <div className="flex gap-[2px]">
              <span className="text-[5px] text-white/12">&larr;</span>
              <span className="text-[5px] text-white/12">&rarr;</span>
              <span className="text-[5px] text-white/12">&#8635;</span>
            </div>
            <div className="flex flex-1 items-center gap-[3px] rounded-[3px] border border-white/[0.03] bg-white/[0.05] px-1.5 py-[2px]">
              <svg className="size-[4px] flex-shrink-0 text-white/20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5">
                <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <span className="truncate font-mono text-[4.5px] text-white/30">{config.url}</span>
            </div>
          </div>
        </div>

        {/* Screen content */}
        <motion.div
          className="relative flex flex-col gap-[4px] overflow-hidden p-[5px]"
          animate={isActive ? { y: [0, -5, -2, -8, -3, 0] } : { y: 0 }}
          transition={isActive ? { duration: 12, repeat: Infinity, ease: "easeInOut" } : { duration: 0.3 }}
        >
          <div className="flex items-center gap-[4px] border-b border-white/[0.04] pb-[3px]">
            <div className="size-[6px] flex-shrink-0 rounded-[1.5px]" style={{ backgroundColor: config.color + "50" }} />
            <span className="truncate text-[4px] font-semibold tracking-wide text-white/35">{config.brand}</span>
            <div className="ml-auto flex gap-[5px]">
              {["Pricing", "Features", "Reviews"].map((nav) => (
                <span key={nav} className="text-[3.5px] text-white/15">{nav}</span>
              ))}
            </div>
          </div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={(isActive || isDone) ? { opacity: 1 } : { opacity: isBooting ? 0.15 : 0.08 }}
            transition={{ delay: isActive ? 0.2 : 0, duration: 0.4 }}
            className="rounded-[3px] px-[5px] py-[4px]"
            style={{ backgroundColor: config.color + "0c", borderLeft: `1.5px solid ${config.color}30` }}
          >
            <div className="mb-[2px] h-[3px] w-[60%] rounded-full bg-white/15" />
            <div className="h-[2px] w-[80%] rounded-full bg-white/[0.06]" />
          </motion.div>

          <div className="flex items-center gap-[3px] rounded-[3px] border border-white/[0.04] bg-white/[0.06] px-[4px] py-[3px]">
            <svg className="size-[5px] flex-shrink-0 text-white/20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
            </svg>
            <span className="flex-1 truncate font-mono text-[4px] leading-none text-white/40">
              {typedText || (isBooting ? "" : "Search...")}
              {isActive && <span className="animate-pulse text-white/60">|</span>}
            </span>
          </div>

          <motion.div
            className="grid grid-cols-3 gap-[3px]"
            initial={{ opacity: 0, y: 4 }}
            animate={(isActive || isDone) ? { opacity: 1, y: 0 } : {}}
            transition={{ delay: isActive ? 0.8 : 0, duration: 0.5 }}
          >
            {config.tiers.map((tier, k) => (
              <div
                key={k}
                className="overflow-hidden rounded-[2.5px] border p-[3px]"
                style={{
                  borderColor: k === 1 ? config.color + "35" : "rgba(255,255,255,0.04)",
                  backgroundColor: k === 1 ? config.color + "0a" : "rgba(255,255,255,0.02)",
                }}
              >
                {k === 1 && (
                  <div className="-mx-[1px] -mt-[1px] mb-[2px] rounded-[1px] px-[2px] py-[0.5px] text-center"
                    style={{ backgroundColor: config.color + "25" }}>
                    <span className="text-[2.5px] font-bold uppercase tracking-wider text-white/50">{t("popular")}</span>
                  </div>
                )}
                <div className="mb-[1px] truncate text-[3px] text-white/25">{tier.name}</div>
                <div className="mb-[2px] text-[5px] font-bold text-white/50" style={k === 1 ? { color: config.color + "bb" } : {}}>
                  {tier.price}
                  <span className="text-[2.5px] font-normal text-white/15">/mo</span>
                </div>
                <div className="mb-[2px] h-px w-full bg-white/[0.04]" />
                {[0, 1].map(f => (
                  <div key={f} className="mb-[1px] flex items-center gap-[2px]">
                    <div className="size-[3px] flex-shrink-0 rounded-full" style={{ backgroundColor: config.color + "40" }} />
                    <div className="h-[1.5px] rounded-full bg-white/[0.06]" style={{ width: `${55 + f * 20}%` }} />
                  </div>
                ))}
              </div>
            ))}
          </motion.div>
        </motion.div>

        {/* Animated cursor */}
        {(isActive || isBooting) && (
          <motion.div
            className="pointer-events-none absolute z-10"
            animate={isActive ? {
              left: waypoints.x.map(v => `${v}%`),
              top: waypoints.y.map(v => `${v}%`),
            } : { left: "50%", top: "50%" }}
            transition={{
              duration: 6,
              repeat: Infinity,
              ease: "easeInOut",
              times: waypoints.x.map((_: number, i: number) => i / (waypoints.x.length - 1)),
            }}
          >
            <svg width="10" height="13" viewBox="0 0 14 18" className="drop-shadow-[0_1px_3px_rgba(0,0,0,0.5)]">
              <path
                d="M2 1L2 14.5L5.8 10.7L9.5 17L11.5 16L7.8 9.2L12.5 9.2L2 1Z"
                fill="white"
                fillOpacity="0.95"
                stroke="black"
                strokeWidth="0.8"
                strokeOpacity="0.2"
              />
            </svg>
            {isActive && (
              <motion.div
                className="absolute -left-2 -top-2 size-5 rounded-full"
                style={{ borderColor: "rgba(255,255,255,0.35)", borderWidth: 1 }}
                animate={{ scale: [0.3, 1.5], opacity: [0.6, 0] }}
                transition={{ duration: 1, repeat: Infinity, repeatDelay: 0.8 }}
              />
            )}
          </motion.div>
        )}

        {/* Scrollbar */}
        {isActive && (
          <div className="absolute right-[1px] top-[15%] bottom-[10%] w-[3px] overflow-hidden rounded-full bg-white/[0.06]">
            <motion.div
              className="w-full rounded-full bg-white/20"
              style={{ position: "absolute" }}
              animate={{ height: ["25%", "18%", "30%", "25%"], top: ["5%", "35%", "25%", "55%"] }}
              transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
            />
          </div>
        )}

        {/* Done overlay */}
        {isDone && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 flex items-center justify-center bg-emerald-500/[0.04] backdrop-blur-[1px]"
          >
            <motion.div
              initial={{ scale: 0, rotate: -20 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", duration: 0.5, bounce: 0.4 }}
              className="flex size-7 items-center justify-center rounded-full border border-emerald-500/25 bg-emerald-500/15"
            >
              <Check className="size-3.5 text-emerald-400" />
            </motion.div>
          </motion.div>
        )}
      </div>

      {/* Input devices */}
      <div className={cn(
        "mb-2 flex gap-1.5 transition-opacity duration-300",
        isActive ? "opacity-100" : isDone ? "opacity-35" : "opacity-15",
      )}>
        {/* Keyboard */}
        <div className="flex-1 rounded-md border border-border/40 bg-muted/20 p-[3px] pb-[4px] dark:border-white/[0.04] dark:bg-white/[0.025]">
          {KB_ROWS.map((row, ri) => (
            <div key={ri} className="mb-[1.5px] flex justify-center gap-[1.5px]" style={{ paddingLeft: ri * 1.5 }}>
              {row.map(key => {
                const isPressed = activeKey === key
                return (
                  <div
                    key={key}
                    className={cn(
                      "flex items-center justify-center rounded-[1.5px] font-mono leading-none transition-all duration-[60ms]",
                      "size-[8px] text-[3.5px] sm:size-[9px]",
                      isPressed
                        ? "scale-[1.15] text-white"
                        : "bg-muted/30 text-muted-foreground/25 dark:bg-white/[0.05] dark:text-white/15",
                    )}
                    style={isPressed ? {
                      backgroundColor: config.color + "60",
                      boxShadow: `0 0 6px ${config.color}40`,
                    } : undefined}
                  >
                    {key}
                  </div>
                )
              })}
            </div>
          ))}
          <div className="mt-[1.5px] flex items-center justify-center gap-[1.5px]">
            <div className={cn(
              "rounded-[1.5px] transition-all duration-[60ms]",
              "h-[7px] w-[38px] sm:h-[8px] sm:w-[44px]",
              activeKey === " " ? "" : "bg-muted/30 dark:bg-white/[0.05]",
            )} style={activeKey === " " ? {
              backgroundColor: config.color + "60",
              boxShadow: `0 0 6px ${config.color}40`,
            } : undefined} />
            <div className="flex size-[8px] items-center justify-center rounded-[1.5px] bg-muted/30 font-mono text-[3px] text-muted-foreground/20 dark:bg-white/[0.05] dark:text-white/10 sm:size-[9px]">
              ↵
            </div>
          </div>
        </div>

        {/* Mouse */}
        <div className="flex w-[22px] flex-col items-center justify-center gap-[3px] rounded-md border border-border/40 bg-muted/20 p-[3px] dark:border-white/[0.04] dark:bg-white/[0.025] sm:w-[26px]">
          <div className="relative h-[18px] w-[12px] overflow-hidden rounded-[7px] border border-muted-foreground/10 bg-muted/15 dark:border-white/[0.08] dark:bg-white/[0.03] sm:h-[20px] sm:w-[14px]">
            <div className="absolute inset-x-0 top-0 flex h-[45%]">
              <div className="flex-1 border-r border-muted-foreground/[0.06] dark:border-white/[0.04]" />
              <div className="flex-1" />
            </div>
            <motion.div
              className="absolute left-1/2 top-[3px] h-[5px] w-[2px] -translate-x-1/2 rounded-full bg-muted-foreground/15 dark:bg-white/[0.12]"
              animate={isActive ? { y: [0, 1, -1, 0] } : { y: 0 }}
              transition={isActive ? { duration: 1.5, repeat: Infinity, ease: "easeInOut" } : { duration: 0.2 }}
            />
            <div className="absolute inset-x-0 top-[45%] h-px bg-muted-foreground/[0.06] dark:bg-white/[0.04]" />
            {isActive && (
              <motion.div
                className="absolute left-0 top-0 h-[45%] w-1/2 rounded-tl-[7px]"
                style={{ backgroundColor: config.color + "30" }}
                animate={{ opacity: [0, 0.8, 0] }}
                transition={{ duration: 1.8, repeat: Infinity, delay: index * 0.4 }}
              />
            )}
          </div>
          {isActive && (
            <motion.div
              animate={{ y: [0, 1.5, -1.5, 0] }}
              transition={{ duration: 2, repeat: Infinity }}
            >
              <ChevronDown className="size-[7px] text-muted-foreground/25 dark:text-white/15" />
            </motion.div>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-2 h-[2px] overflow-hidden rounded-full bg-foreground/[0.05]">
        <motion.div
          className={cn(
            "h-full rounded-full",
            isDone ? "bg-emerald-500" : "bg-foreground",
          )}
          initial={{ width: 0 }}
          animate={{ width: `${machine.progress}%` }}
          transition={{ duration: 0.3, ease: "easeOut" }}
        />
      </div>

      {/* Steps */}
      <div className="space-y-[3px]">
        {machine.steps.map((step, i) => {
          const stepDone = machine.currentStep > i || isDone
          const stepActive = machine.currentStep === i && isActive
          return (
            <div
              key={i}
              className={cn(
                "flex items-center gap-1.5 text-[10px] transition-all duration-200",
                stepDone ? "text-foreground/55" : stepActive ? "font-medium text-foreground" : "text-muted-foreground/20",
              )}
            >
              {stepDone ? (
                <Check className="size-2.5 flex-shrink-0 text-emerald-500" />
              ) : stepActive ? (
                <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }} className="flex-shrink-0">
                  <RotateCcw className="size-2.5 text-foreground" />
                </motion.div>
              ) : (
                <div className="size-2.5 flex-shrink-0 rounded-full border border-foreground/10" />
              )}
              <span className="truncate">{step}</span>
            </div>
          )
        })}
      </div>
    </motion.div>
  )
}

// ==========================================================================
// Data
// ==========================================================================

const comparisons = [
  { labelKey: "speedExamples.crmResearch" as const, sequential: "~50 min", swarm: "~10 min", speedup: "5x" },
  { labelKey: "speedExamples.qaPages" as const, sequential: "~40 min", swarm: "~8 min", speedup: "5x" },
  { labelKey: "speedExamples.leadEnrichment" as const, sequential: "~3 hours", swarm: "~30 min", speedup: "6x" },
  { labelKey: "speedExamples.priceMonitoring" as const, sequential: "~25 min", swarm: "~5 min", speedup: "5x" },
]

const useCaseItems = [
  { icon: BarChart3, key: "useCases.marketResearch" as const },
  { icon: Target, key: "useCases.leadGeneration" as const },
  { icon: Shield, key: "useCases.qaTesting" as const },
  { icon: Layers, key: "useCases.contentSocial" as const },
  { icon: TrendingUp, key: "useCases.dataExtraction" as const },
  { icon: Clock, key: "useCases.scheduledRuns" as const },
]

// ==========================================================================
// Page
// ==========================================================================

export function AgentSwarmsContent() {
  const t = useTranslations("agentSwarms")
  const { machines, phase, elapsed, start, reset } = useSwarmDemo()
  const [isMobile, setIsMobile] = useState(false)
  const heroRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setIsMobile(window.innerWidth < 768)
    const onResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  const sectionViewport = { once: true, amount: isMobile ? 0.05 : 0.1 }

  const containerVariants = isMobile
    ? { hidden: { opacity: 1 }, visible: { opacity: 1 } }
    : { hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.07, delayChildren: 0.08 } } }

  const itemVariants = isMobile
    ? { hidden: { opacity: 1, y: 0 }, visible: { opacity: 1, y: 0 } }
    : { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const } } }

  return (
    <div className="relative min-h-screen bg-background">
      <LandingHeader />

      <main className={cn("relative", isMobile ? "pt-16" : "pt-20")} suppressHydrationWarning>
        {/* ── Hero ── */}
        <section
          ref={heroRef}
          className={cn(
            "relative flex flex-col items-center justify-center overflow-hidden",
            isMobile ? "px-4 pt-10 pb-8" : "px-6 pt-24 pb-6",
          )}
        >
          {/* Dotted radial backdrop — single signature element for the hero */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 opacity-60 [background:radial-gradient(circle_at_center,color-mix(in_oklch,var(--foreground)_10%,transparent)_1px,transparent_1.5px)] [background-size:24px_24px] [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)]"
          />

          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="relative z-10 mx-auto w-full max-w-3xl text-center"
          >
            <motion.div variants={itemVariants} className="mb-5">
              <MonoTag>
                <GitFork className="size-3" />
                {t("badge")}
              </MonoTag>
            </motion.div>

            <motion.h1
              variants={itemVariants}
              className={cn(
                "font-semibold tracking-tight leading-[1.05] text-balance",
                isMobile ? "text-[34px]" : "text-5xl sm:text-[3.5rem]",
              )}
            >
              {t("heroTitle1")}{" "}
              <span className="italic font-normal text-foreground/75">
                {t("heroTitle2")}
              </span>
              <br />
              {t("heroTitle3")}
            </motion.h1>

            <motion.p
              variants={itemVariants}
              className={cn(
                "mx-auto mt-5 max-w-lg leading-relaxed text-muted-foreground",
                isMobile ? "text-sm" : "text-[17px]",
              )}
            >
              {t("heroDescription")}
            </motion.p>

            <motion.div
              variants={itemVariants}
              className="mt-8 flex flex-wrap items-center justify-center gap-3"
            >
              <PrimaryButton href="/auth">
                {t("trySwarmMode")}
                <ArrowRight className="size-4" />
              </PrimaryButton>
              <GhostButton href="#demo" external>
                {t("seeInAction")}
                <ChevronDown className="size-3.5" />
              </GhostButton>
            </motion.div>
          </motion.div>
        </section>

        {/* ── Hero Video ── */}
        <section className={cn("relative", isMobile ? "px-4 pb-12" : "px-6 pb-16 pt-4")}>
          <div className="mx-auto max-w-5xl">
            <HeroVideoPlayer />
          </div>
        </section>

        {/* ── How It Works ── */}
        <section className={cn("py-20", isMobile ? "px-7" : "px-10")}>
          <motion.div
            variants={containerVariants}
            initial="hidden"
            whileInView="visible"
            viewport={sectionViewport}
            className="mx-auto max-w-4xl"
          >
            <motion.div variants={itemVariants}>
              <SectionHeader title={t("threeSteps")} isMobile={isMobile} />
            </motion.div>

            <div className={cn(
              "grid gap-px overflow-hidden rounded-2xl border border-border bg-border/40",
              isMobile ? "grid-cols-1" : "grid-cols-3",
            )}>
              {[
                { step: "01", title: t("steps.typePrompt.title"), desc: t("steps.typePrompt.desc"), icon: Send },
                { step: "02", title: t("steps.machinesSpinUp.title"), desc: t("steps.machinesSpinUp.desc"), icon: Cpu },
                { step: "03", title: t("steps.resultsStream.title"), desc: t("steps.resultsStream.desc"), icon: Merge },
              ].map((s) => (
                <motion.div
                  key={s.step}
                  variants={itemVariants}
                  className="bg-background p-6 sm:p-8"
                >
                  <div className="mb-4 inline-flex size-10 items-center justify-center rounded-xl border border-border bg-muted/40">
                    <s.icon className="size-5 text-foreground" />
                  </div>
                  <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/50">
                    {s.step}
                  </div>
                  <h3 className="mb-1.5 text-base font-semibold">{s.title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">{s.desc}</p>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </section>

        {/* ── Interactive Demo ── */}
        <section id="demo" className={cn("relative py-20", isMobile ? "px-7" : "px-10")}>
          <motion.div
            variants={containerVariants}
            initial="hidden"
            whileInView="visible"
            viewport={sectionViewport}
            className="relative z-10 mx-auto max-w-6xl"
          >
            <motion.div variants={itemVariants}>
              <SectionHeader
                title={t("seeInAction")}
                subtitle={t("demoDescription", { count: 5 })}
                isMobile={isMobile}
              />
            </motion.div>

            <motion.div variants={itemVariants}>
              {/* Prompt bar */}
              <div className="mb-5 rounded-xl border border-border bg-card/40 p-4 backdrop-blur-sm">
                <div className="flex items-center gap-4">
                  <div className="flex size-9 flex-shrink-0 items-center justify-center rounded-lg border border-border bg-muted/50">
                    <GitFork className="size-4 text-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-0.5 flex items-center gap-2">
                      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                        {t("swarm")}
                      </span>
                      <span className="text-[10px] text-muted-foreground/40">
                        {t("machineCount", { count: 5 })}
                      </span>
                    </div>
                    <p className="truncate text-sm font-medium leading-relaxed">{demoPrompt}</p>
                  </div>
                  <div className="flex-shrink-0">
                    {phase === "idle" && (
                      <button
                        onClick={start}
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-foreground px-4 text-sm font-medium text-background transition-colors hover:bg-foreground/85"
                      >
                        <Play className="size-3" fill="currentColor" />
                        {t("run")}
                      </button>
                    )}
                    {phase === "running" && (
                      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-1.5">
                        <span className="font-mono text-xs tabular-nums text-foreground">
                          {(elapsed * 0.4).toFixed(1)}s
                        </span>
                        <span className="relative size-2">
                          <span className="absolute inset-0 animate-ping rounded-full bg-foreground/30 opacity-50" />
                          <span className="absolute inset-0 rounded-full bg-foreground/60" />
                        </span>
                      </div>
                    )}
                    {phase === "done" && (
                      <button
                        onClick={reset}
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                      >
                        <RotateCcw className="size-3" />
                        {t("reset")}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Machine grid */}
              <div className={cn(
                "grid gap-3",
                isMobile ? "grid-cols-1" : "grid-cols-2 lg:grid-cols-3 xl:grid-cols-5",
              )}>
                {machines.map((m, i) => (
                  <DemoMachineCard key={m.id} machine={m} index={i} />
                ))}
              </div>

              {/* Completion */}
              <AnimatePresence>
                {phase === "done" && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="mt-5 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.02] p-5 text-center"
                  >
                    <div className="mb-1 flex items-center justify-center gap-2">
                      <Check className="size-4 text-emerald-500" />
                      <span className="text-sm font-semibold text-foreground">
                        {t("allCompleted", { count: 5 })}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {t("speedComparison", { swarmTime: "10", seqTime: "50", multiplier: "5" })}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          </motion.div>
        </section>

        {/* ── Speed Comparison ── */}
        <section className={cn("py-20", isMobile ? "px-7" : "px-10")}>
          <motion.div
            variants={containerVariants}
            initial="hidden"
            whileInView="visible"
            viewport={sectionViewport}
            className="mx-auto max-w-3xl"
          >
            <motion.div variants={itemVariants}>
              <SectionHeader title={t("seqVsSwarm")} isMobile={isMobile} />
            </motion.div>

            <motion.div variants={itemVariants}>
              <div className="overflow-hidden rounded-xl border border-border">
                {!isMobile && (
                  <div className="grid grid-cols-[1fr_100px_100px_72px] border-b border-border bg-muted/30 px-5 py-2.5 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/60">
                    <span>{t("tableHeaders.task")}</span>
                    <span className="text-center">{t("tableHeaders.before")}</span>
                    <span className="text-center">{t("tableHeaders.swarm")}</span>
                    <span className="text-center">{t("tableHeaders.speed")}</span>
                  </div>
                )}
                {comparisons.map((row, i) => (
                  <motion.div
                    key={row.labelKey}
                    initial={isMobile ? {} : { opacity: 0, x: -12 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.06, duration: 0.35 }}
                    className={cn(
                      "bg-background",
                      i < comparisons.length - 1 && "border-b border-border/60",
                    )}
                  >
                    <div className={cn(
                      "grid items-center",
                      isMobile
                        ? "grid-cols-1 gap-1.5 p-4"
                        : "grid-cols-[1fr_100px_100px_72px] px-5 py-3.5",
                    )}>
                      <div className="text-sm font-medium">{t(row.labelKey)}</div>
                      <div className={cn(
                        "text-muted-foreground/45 line-through decoration-muted-foreground/20",
                        isMobile ? "text-xs" : "text-sm text-center",
                      )}>
                        {row.sequential}
                      </div>
                      <div className={cn(
                        "font-semibold text-foreground",
                        isMobile ? "text-xs" : "text-sm text-center",
                      )}>
                        {row.swarm}
                      </div>
                      <div className={cn(
                        "font-bold text-emerald-500",
                        isMobile ? "text-sm" : "text-sm text-center",
                      )}>
                        {row.speedup}
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        </section>

        {/* ── Use Cases ── */}
        <section className={cn("relative py-20", isMobile ? "px-7" : "px-10")}>
          <motion.div
            variants={containerVariants}
            initial="hidden"
            whileInView="visible"
            viewport={sectionViewport}
            className="relative z-10 mx-auto max-w-4xl"
          >
            <motion.div variants={itemVariants}>
              <SectionHeader title={t("builtForParallel")} isMobile={isMobile} />
            </motion.div>

            <div className={cn(
              "grid gap-3",
              isMobile ? "grid-cols-1" : "grid-cols-2 lg:grid-cols-3",
            )}>
              {useCaseItems.map((uc) => (
                <motion.div
                  key={uc.key}
                  variants={itemVariants}
                  className="group rounded-xl border border-border bg-card/20 p-5 transition-colors duration-300 hover:bg-card/40"
                >
                  <div className="mb-3 flex size-9 items-center justify-center rounded-lg border border-border bg-muted/40 transition-colors group-hover:bg-muted/60">
                    <uc.icon className="size-4 text-foreground" />
                  </div>
                  <h3 className="mb-1 text-sm font-semibold">{t(`${uc.key}.title`)}</h3>
                  <p className="text-[13px] leading-relaxed text-muted-foreground">{t(`${uc.key}.desc`)}</p>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </section>

        {/* ── Key Features Strip ── */}
        <section className={cn("py-16", isMobile ? "px-7" : "px-10")}>
          <motion.div
            variants={containerVariants}
            initial="hidden"
            whileInView="visible"
            viewport={sectionViewport}
            className="mx-auto max-w-4xl"
          >
            <div className={cn(
              "grid gap-px overflow-hidden rounded-xl border border-border bg-border/40",
              isMobile ? "grid-cols-1" : "grid-cols-2 lg:grid-cols-3",
            )}>
              {[
                { key: "featureStrip.trueIsolation" as const, icon: Shield },
                { key: "featureStrip.tripleMachineLimit" as const, icon: Zap },
                { key: "featureStrip.liveTreeView" as const, icon: Eye },
                { key: "featureStrip.autoAggregation" as const, icon: Merge },
                { key: "featureStrip.shareableRuns" as const, icon: GitFork },
                { key: "featureStrip.fullySandboxed" as const, icon: Shield },
              ].map((f) => (
                <motion.div key={f.key} variants={itemVariants} className="bg-background p-5">
                  <div className="flex items-start gap-3">
                    <f.icon className="mt-0.5 size-4 flex-shrink-0 text-muted-foreground" />
                    <div>
                      <h3 className="mb-0.5 text-sm font-medium">{t(`${f.key}.title`)}</h3>
                      <p className="text-[12px] leading-relaxed text-muted-foreground">{t(`${f.key}.desc`)}</p>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </section>

        {/* ── CTA ── */}
        <section className={cn("relative py-24", isMobile ? "px-7" : "px-10")}>
          <motion.div
            variants={containerVariants}
            initial="hidden"
            whileInView="visible"
            viewport={sectionViewport}
            className="relative z-10 mx-auto max-w-2xl text-center"
          >
            <motion.h2
              variants={itemVariants}
              className={cn(
                "font-semibold tracking-tight text-balance",
                isMobile ? "text-[26px]" : "text-3xl sm:text-4xl",
              )}
            >
              {t("readyCta")}
            </motion.h2>

            <motion.p
              variants={itemVariants}
              className={cn(
                "mx-auto mt-3 max-w-md text-muted-foreground",
                isMobile ? "text-sm" : "text-base",
              )}
            >
              {t("includedWithPaid")}
            </motion.p>

            <motion.div
              variants={itemVariants}
              className="mt-8 flex flex-wrap items-center justify-center gap-3"
            >
              <PrimaryButton href="/auth">
                {t("getStarted")}
                <ArrowRight className="size-4" />
              </PrimaryButton>
              <GhostButton href="/#pricing">
                {t("viewPricing")}
                <ChevronRight className="size-3.5" />
              </GhostButton>
            </motion.div>

            <motion.div
              variants={itemVariants}
              className={cn(
                "mt-10 flex items-center justify-center gap-6",
                isMobile && "flex-col gap-3",
              )}
            >
              {[
                { plan: "Starter", price: "$19", machines: "1 machine" },
                { plan: "Unlimited", price: "$249", machines: "2 machines" },
              ].map(p => (
                <div key={p.plan} className="flex items-baseline gap-2">
                  <span className="text-sm font-semibold">{p.plan}</span>
                  <span className="text-xl font-bold tabular-nums">{p.price}</span>
                  <span className="text-[11px] text-muted-foreground">{p.machines}</span>
                </div>
              ))}
            </motion.div>
          </motion.div>
        </section>

        <LandingFooter />
      </main>
    </div>
  )
}
