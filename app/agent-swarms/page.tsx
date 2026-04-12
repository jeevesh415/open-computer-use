"use client"

import { LandingHeader } from "@/app/components/landing/landing-header"
import { LandingFooter } from "@/app/components/landing/landing-footer"
import { GuideLines } from "@/app/components/landing/guide-lines"
import { Button } from "@/components/ui/button"
import { RainbowButton } from "@/components/magicui/rainbow-button"
import { AuroraText } from "@/components/ui/aurora-text"
import { cn } from "@/lib/utils"
import Link from "next/link"
import { useState, useEffect, useCallback, useRef, useId, useMemo } from "react"
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
  Terminal as TerminalIcon,
  Globe,
  Eye,
  Sparkles,
} from "lucide-react"

// ==========================================================================
// Hero Video Player — Apple-style inline video showcase
// ==========================================================================

const HERO_VIDEO_ID = "IBydvwkJcCQ"

function HeroVideoPlayer() {
  const containerRef = useRef<HTMLDivElement>(null)
  const inView = useInView(containerRef, { once: true, amount: 0.3 })
  const [isPlaying, setIsPlaying] = useState(false)

  return (
    <div
      ref={containerRef}
      className="relative group cursor-pointer"
      onClick={() => setIsPlaying(true)}
    >
      {/* Ambient glow */}
      <div className="absolute -inset-px rounded-[20px] bg-gradient-to-b from-white/[0.08] to-transparent dark:from-white/[0.04] pointer-events-none" />
      <div className="absolute -inset-4 rounded-[28px] bg-gradient-to-b from-amber-500/[0.03] via-transparent to-blue-500/[0.02] blur-xl pointer-events-none" />

      {/* Video container */}
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 20 }}
        animate={inView ? { opacity: 1, scale: 1, y: 0 } : {}}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        className={cn(
          "relative rounded-2xl overflow-hidden",
          "bg-neutral-950",
          "ring-1 ring-white/[0.08] dark:ring-white/[0.05]",
          "shadow-[0_8px_40px_-12px_rgba(0,0,0,0.15),0_20px_60px_-20px_rgba(0,0,0,0.2)]",
          "dark:shadow-[0_8px_40px_-12px_rgba(0,0,0,0.5),0_20px_60px_-20px_rgba(0,0,0,0.6)]",
        )}
      >
        {/* 16:9 aspect ratio */}
        <div className="relative w-full" style={{ paddingTop: "56.25%" }}>
          {!isPlaying ? (
            <>
              {/* Thumbnail with gradient overlay */}
              <div className="absolute inset-0">
                <img
                  src={`https://img.youtube.com/vi/${HERO_VIDEO_ID}/maxresdefault.jpg`}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-black/10 to-black/20" />
              </div>

              {/* Center play button — large, frosted glass */}
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={inView ? { opacity: 1, scale: 1 } : {}}
                transition={{ delay: 0.3, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                className="absolute inset-0 flex items-center justify-center"
              >
                <motion.button
                  whileHover={{ scale: 1.06 }}
                  whileTap={{ scale: 0.96 }}
                  className={cn(
                    "relative size-[72px] sm:size-20 rounded-full",
                    "bg-white/90 dark:bg-white/85 backdrop-blur-xl",
                    "shadow-[0_8px_32px_rgba(0,0,0,0.12),0_2px_8px_rgba(0,0,0,0.08)]",
                    "flex items-center justify-center",
                    "transition-shadow duration-300",
                    "hover:shadow-[0_12px_48px_rgba(0,0,0,0.18),0_4px_12px_rgba(0,0,0,0.1)]",
                  )}
                >
                  <Play className="size-7 sm:size-8 text-neutral-900 ml-1" fill="currentColor" />
                </motion.button>
              </motion.div>

              {/* Bottom label — "Watch the demo" */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={inView ? { opacity: 1, y: 0 } : {}}
                transition={{ delay: 0.5, duration: 0.5 }}
                className="absolute bottom-0 inset-x-0 p-5 sm:p-6"
              >
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 backdrop-blur-md border border-white/10">
                    <span className="relative size-2">
                      <span className="absolute inset-0 rounded-full bg-red-500 animate-pulse" />
                      <span className="absolute inset-0 rounded-full bg-red-500" />
                    </span>
                    <span className="text-[11px] font-medium text-white/90 tracking-wide">DEMO</span>
                  </div>
                  <span className="text-sm text-white/60 font-medium">Watch agent swarms in action</span>
                </div>
              </motion.div>
            </>
          ) : (
            <iframe
              className="absolute inset-0 w-full h-full"
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
// Interactive Demo (refined)
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

// Screen configs for each machine's mini desktop
const screenConfigs = [
  {
    url: "salesforce.com/pricing", color: "#00A1E0", typingText: "enterprise CRM pricing",
    brand: "Salesforce", tab: "Pricing",
    tiers: [{ name: "Essentials", price: "$25" }, { name: "Professional", price: "$80" }, { name: "Enterprise", price: "$165" }],
    features: ["Contact Mgmt", "Opportunity Tracking", "Reports & Dashboards", "API Access"],
  },
  {
    url: "hubspot.com/products", color: "#FF7A59", typingText: "hubspot free vs paid",
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
    url: "zoho.com/crm/editions", color: "#E42527", typingText: "zoho crm comparison",
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

  const statusColor = isDone ? "text-emerald-500" : isActive ? "text-amber-500" : isBooting ? "text-blue-400" : "text-muted-foreground/25"

  // Typing animation
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
        // Continue with periodic key presses for ongoing activity
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
        "relative rounded-xl border p-3 backdrop-blur-sm transition-all duration-500 overflow-hidden",
        isDone ? "border-emerald-500/20 bg-emerald-500/[0.03]"
        : isActive ? "border-amber-500/15 bg-amber-500/[0.02]"
        : isBooting ? "border-blue-400/15 bg-blue-500/[0.02]"
        : "border-border/30 bg-card/20"
      )}
    >
      {/* Machine header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <div className={cn(
            "size-5 rounded-md flex items-center justify-center border transition-colors duration-300",
            isDone ? "bg-emerald-500/10 border-emerald-500/20" :
            isActive ? "bg-amber-500/10 border-amber-500/20" :
            "bg-muted/20 border-border/40"
          )}>
            <Monitor className={cn("size-2.5", statusColor)} />
          </div>
          <span className="text-xs font-medium">{machine.label}</span>
        </div>
        <span className={cn("text-[9px] font-mono tabular-nums tracking-wide", statusColor)}>
          {isDone ? "DONE" : isActive ? `${Math.round(machine.progress)}%` : isBooting ? "INIT" : "IDLE"}
        </span>
      </div>

      {/* ── Mini Desktop Screen ── */}
      <div className={cn(
        "relative rounded-lg overflow-hidden mb-2 transition-all duration-500 border",
        "aspect-[16/11]",
        isActive ? "bg-[#0d0d1a] border-amber-500/10" :
        isDone ? "bg-[#0d0d1a] border-emerald-500/15" :
        isBooting ? "bg-[#0d0d1a]/80 border-blue-400/10" :
        "bg-[#0d0d1a]/40 border-white/[0.04]"
      )}>
        {/* Browser chrome — tab bar */}
        <div className="bg-[#1e1e3a]/90 border-b border-white/[0.03]">
          <div className="flex items-center px-1 pt-[3px] gap-[2px]">
            <div className="flex gap-[3px] px-1 py-[2px]">
              <div className="size-[4px] rounded-full bg-[#ff5f57]/50" />
              <div className="size-[4px] rounded-full bg-[#febc2e]/50" />
              <div className="size-[4px] rounded-full bg-[#28c840]/50" />
            </div>
            {/* Active tab */}
            <div className="flex items-center gap-[3px] bg-[#0d0d1a] rounded-t-[3px] px-1.5 py-[2px] border-t border-x border-white/[0.06] -mb-px relative z-[1]">
              <div className="size-[4px] rounded-[1px]" style={{ backgroundColor: config.color + "80" }} />
              <span className="text-[4px] text-white/50 font-medium truncate max-w-[40px]">{config.brand}</span>
              <span className="text-[4px] text-white/15 ml-[1px]">&times;</span>
            </div>
            {/* Inactive tab */}
            <div className="flex items-center gap-[2px] px-1 py-[2px] opacity-40">
              <div className="size-[3px] rounded-full bg-white/20" />
              <span className="text-[3.5px] text-white/25 truncate">{config.tab}</span>
            </div>
            <div className="text-[5px] text-white/10 ml-[2px]">+</div>
          </div>
          {/* URL bar */}
          <div className="flex items-center gap-[3px] px-1.5 py-[2.5px] bg-[#0d0d1a]">
            {/* Nav arrows */}
            <div className="flex gap-[2px]">
              <span className="text-[5px] text-white/12">&larr;</span>
              <span className="text-[5px] text-white/12">&rarr;</span>
              <span className="text-[5px] text-white/12">&#8635;</span>
            </div>
            {/* URL field */}
            <div className="flex-1 bg-white/[0.05] rounded-[3px] px-1.5 py-[2px] flex items-center gap-[3px] border border-white/[0.03]">
              <svg className="size-[4px] text-white/20 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5">
                <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <span className="text-[4.5px] text-white/30 font-mono truncate">{config.url}</span>
            </div>
          </div>
        </div>

        {/* Screen content — unique per CRM */}
        <motion.div
          className="relative p-[5px] flex flex-col gap-[4px] overflow-hidden"
          animate={isActive ? { y: [0, -5, -2, -8, -3, 0] } : { y: 0 }}
          transition={isActive ? { duration: 12, repeat: Infinity, ease: "easeInOut" } : { duration: 0.3 }}
        >
          {/* Site nav bar */}
          <div className="flex items-center gap-[4px] pb-[3px] border-b border-white/[0.04]">
            <div className="size-[6px] rounded-[1.5px] flex-shrink-0" style={{ backgroundColor: config.color + "50" }} />
            <span className="text-[4px] font-semibold text-white/35 tracking-wide truncate">{config.brand}</span>
            <div className="ml-auto flex gap-[5px]">
              {["Pricing", "Features", "Reviews"].map((nav) => (
                <span key={nav} className="text-[3.5px] text-white/15 hover:text-white/25">{nav}</span>
              ))}
            </div>
          </div>

          {/* Hero section with brand color */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={(isActive || isDone) ? { opacity: 1 } : { opacity: isBooting ? 0.15 : 0.08 }}
            transition={{ delay: isActive ? 0.2 : 0, duration: 0.4 }}
            className="rounded-[3px] px-[5px] py-[4px]"
            style={{ backgroundColor: config.color + "0c", borderLeft: `1.5px solid ${config.color}30` }}
          >
            <div className="h-[3px] w-[60%] rounded-full bg-white/15 mb-[2px]" />
            <div className="h-[2px] w-[80%] rounded-full bg-white/[0.06]" />
          </motion.div>

          {/* Search bar with typing */}
          <div className="flex items-center rounded-[3px] bg-white/[0.06] px-[4px] py-[3px] gap-[3px] border border-white/[0.04]">
            <svg className="size-[5px] text-white/20 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
            </svg>
            <span className="text-[4px] text-white/40 font-mono truncate leading-none flex-1">
              {typedText || (isBooting ? "" : "Search...")}
              {isActive && <span className="animate-pulse text-white/60">|</span>}
            </span>
          </div>

          {/* Pricing tier cards */}
          <motion.div
            className="grid grid-cols-3 gap-[3px]"
            initial={{ opacity: 0, y: 4 }}
            animate={(isActive || isDone) ? { opacity: 1, y: 0 } : {}}
            transition={{ delay: isActive ? 0.8 : 0, duration: 0.5 }}
          >
            {config.tiers.map((tier, k) => (
              <div
                key={k}
                className="rounded-[2.5px] p-[3px] border overflow-hidden"
                style={{
                  borderColor: k === 1 ? config.color + "35" : "rgba(255,255,255,0.04)",
                  backgroundColor: k === 1 ? config.color + "0a" : "rgba(255,255,255,0.02)",
                }}
              >
                {/* Popular badge on middle tier */}
                {k === 1 && (
                  <div className="rounded-[1px] px-[2px] py-[0.5px] mb-[2px] -mx-[1px] -mt-[1px] text-center"
                    style={{ backgroundColor: config.color + "25" }}>
                    <span className="text-[2.5px] font-bold text-white/50 uppercase tracking-wider">{t("popular")}</span>
                  </div>
                )}
                <div className="text-[3px] text-white/25 mb-[1px] truncate">{tier.name}</div>
                <div className="text-[5px] font-bold text-white/50 mb-[2px]" style={k === 1 ? { color: config.color + "bb" } : {}}>
                  {tier.price}
                  <span className="text-[2.5px] text-white/15 font-normal">/mo</span>
                </div>
                <div className="h-px w-full bg-white/[0.04] mb-[2px]" />
                {/* Mini feature checkmarks */}
                {[0, 1].map(f => (
                  <div key={f} className="flex items-center gap-[2px] mb-[1px]">
                    <div className="size-[3px] rounded-full flex-shrink-0" style={{ backgroundColor: config.color + "40" }} />
                    <div className="h-[1.5px] rounded-full bg-white/[0.06]" style={{ width: `${55 + f * 20}%` }} />
                  </div>
                ))}
              </div>
            ))}
          </motion.div>

          {/* Feature comparison table */}
          <motion.div
            className="rounded-[2.5px] border border-white/[0.03] overflow-hidden"
            initial={{ opacity: 0 }}
            animate={(isActive || isDone) ? { opacity: 1 } : {}}
            transition={{ delay: isActive ? 1.5 : 0, duration: 0.4 }}
          >
            {/* Table header */}
            <div className="flex items-center px-[3px] py-[2px] bg-white/[0.03] border-b border-white/[0.03]">
              <span className="text-[3px] text-white/20 flex-1">Feature</span>
              {config.tiers.map((t, k) => (
                <span key={k} className="text-[2.5px] text-white/15 w-[18%] text-center truncate">{t.name.substring(0, 3)}</span>
              ))}
            </div>
            {/* Feature rows */}
            {config.features.map((feat, f) => (
              <motion.div
                key={f}
                initial={{ opacity: 0, x: -3 }}
                animate={(isActive || isDone) ? { opacity: 1, x: 0 } : {}}
                transition={{ delay: isActive ? 1.8 + f * 0.25 : 0, duration: 0.25 }}
                className={cn("flex items-center px-[3px] py-[1.5px]", f % 2 === 0 && "bg-white/[0.015]")}
              >
                <span className="text-[3px] text-white/20 flex-1 truncate">{feat}</span>
                {config.tiers.map((_, k) => (
                  <div key={k} className="w-[18%] flex justify-center">
                    {(f <= k + 1) ? (
                      <div className="size-[3px] rounded-full" style={{ backgroundColor: config.color + "50" }} />
                    ) : (
                      <div className="size-[3px] rounded-full bg-white/[0.06]" />
                    )}
                  </div>
                ))}
              </motion.div>
            ))}
          </motion.div>

          {/* Review score bar */}
          <motion.div
            className="flex items-center gap-[3px] px-[3px] py-[2px] rounded-[2px] bg-white/[0.025]"
            initial={{ opacity: 0 }}
            animate={(isActive || isDone) ? { opacity: 1 } : {}}
            transition={{ delay: isActive ? 2.8 : 0, duration: 0.3 }}
          >
            <div className="flex gap-[1px]">
              {[1, 2, 3, 4].map(s => (
                <div key={s} className="size-[3px] rounded-[0.5px]" style={{ backgroundColor: config.color + "50" }} />
              ))}
              <div className="size-[3px] rounded-[0.5px] bg-white/[0.08]" />
            </div>
            <span className="text-[3px] text-white/20">{t("avgRating", { rating: "4.2" })}</span>
            <div className="h-[2px] flex-1 rounded-full bg-white/[0.04] overflow-hidden ml-[2px]">
              <div className="h-full rounded-full" style={{ width: "84%", backgroundColor: config.color + "35" }} />
            </div>
          </motion.div>
        </motion.div>

        {/* Animated cursor */}
        {(isActive || isBooting) && (
          <motion.div
            className="absolute pointer-events-none z-10"
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
            {/* Cursor arrow */}
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
            {/* Click ripple */}
            {isActive && (
              <motion.div
                className="absolute -left-2 -top-2 size-5 rounded-full"
                style={{ borderColor: config.color + "50", borderWidth: 1.5 }}
                animate={{ scale: [0.3, 1.5], opacity: [0.7, 0] }}
                transition={{ duration: 1, repeat: Infinity, repeatDelay: 0.8 }}
              />
            )}
          </motion.div>
        )}

        {/* Scrollbar */}
        {isActive && (
          <div className="absolute right-[1px] top-[15%] bottom-[10%] w-[3px] rounded-full bg-white/[0.06] overflow-hidden">
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
            className="absolute inset-0 bg-emerald-500/[0.06] backdrop-blur-[1px] flex items-center justify-center"
          >
            <motion.div
              initial={{ scale: 0, rotate: -20 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", duration: 0.5, bounce: 0.4 }}
              className="size-7 rounded-full bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center shadow-[0_0_12px_rgba(16,185,129,0.15)]"
            >
              <Check className="size-3.5 text-emerald-400" />
            </motion.div>
          </motion.div>
        )}

        {/* Screen glow when active */}
        {isActive && (
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute -bottom-4 inset-x-0 h-8 blur-xl" style={{ backgroundColor: config.color + "08" }} />
          </div>
        )}
      </div>

      {/* ── Input Devices (Keyboard + Mouse) ── */}
      <div className={cn(
        "flex gap-1.5 mb-2 transition-opacity duration-300",
        isActive ? "opacity-100" : isDone ? "opacity-35" : "opacity-15"
      )}>
        {/* Mini Keyboard */}
        <div className="flex-1 rounded-md bg-muted/20 dark:bg-white/[0.025] border border-border/15 dark:border-white/[0.04] p-[3px] pb-[4px]">
          {KB_ROWS.map((row, ri) => (
            <div key={ri} className="flex gap-[1.5px] justify-center mb-[1.5px]" style={{ paddingLeft: ri * 1.5 }}>
              {row.map(key => {
                const isPressed = activeKey === key
                return (
                  <div
                    key={key}
                    className={cn(
                      "rounded-[1.5px] text-[3.5px] font-mono flex items-center justify-center leading-none transition-all duration-[60ms]",
                      "size-[8px] sm:size-[9px]",
                      isPressed
                        ? "text-white scale-[1.15] shadow-[0_0_6px_rgba(245,158,11,0.4)]"
                        : "bg-muted/30 dark:bg-white/[0.05] text-muted-foreground/25 dark:text-white/15"
                    )}
                    style={isPressed ? { backgroundColor: config.color + "60" } : undefined}
                  >
                    {key}
                  </div>
                )
              })}
            </div>
          ))}
          {/* Space bar row */}
          <div className="flex gap-[1.5px] justify-center items-center mt-[1.5px]">
            <div className={cn(
              "h-[7px] sm:h-[8px] rounded-[1.5px] transition-all duration-[60ms]",
              "w-[38px] sm:w-[44px]",
              activeKey === " "
                ? "shadow-[0_0_6px_rgba(245,158,11,0.4)]"
                : "bg-muted/30 dark:bg-white/[0.05]"
            )} style={activeKey === " " ? { backgroundColor: config.color + "60" } : undefined} />
            <div className="size-[8px] sm:size-[9px] rounded-[1.5px] bg-muted/30 dark:bg-white/[0.05] text-[3px] font-mono flex items-center justify-center text-muted-foreground/20 dark:text-white/10">
              ↵
            </div>
          </div>
        </div>

        {/* Mini Mouse */}
        <div className="w-[22px] sm:w-[26px] rounded-md bg-muted/20 dark:bg-white/[0.025] border border-border/15 dark:border-white/[0.04] p-[3px] flex flex-col items-center justify-center gap-[3px]">
          {/* Mouse body */}
          <div className="relative w-[12px] sm:w-[14px] h-[18px] sm:h-[20px] rounded-[7px] border border-muted-foreground/10 dark:border-white/[0.08] overflow-hidden bg-muted/15 dark:bg-white/[0.03]">
            {/* Two buttons */}
            <div className="absolute top-0 left-0 right-0 h-[45%] flex">
              <div className="flex-1 border-r border-muted-foreground/[0.06] dark:border-white/[0.04]" />
              <div className="flex-1" />
            </div>
            {/* Scroll wheel */}
            <motion.div
              className="absolute top-[3px] left-1/2 -translate-x-1/2 w-[2px] h-[5px] rounded-full bg-muted-foreground/15 dark:bg-white/[0.12]"
              animate={isActive ? { y: [0, 1, -1, 0] } : { y: 0 }}
              transition={isActive ? { duration: 1.5, repeat: Infinity, ease: "easeInOut" } : { duration: 0.2 }}
            />
            {/* Button separator line */}
            <div className="absolute top-[45%] left-0 right-0 h-px bg-muted-foreground/[0.06] dark:bg-white/[0.04]" />
            {/* Click highlight */}
            {isActive && (
              <motion.div
                className="absolute top-0 left-0 w-1/2 h-[45%] rounded-tl-[7px]"
                style={{ backgroundColor: config.color + "30" }}
                animate={{ opacity: [0, 0.8, 0] }}
                transition={{ duration: 1.8, repeat: Infinity, delay: index * 0.4 }}
              />
            )}
          </div>
          {/* Scroll direction indicator */}
          {isActive && (
            <motion.div
              animate={{ y: [0, 1.5, -1.5, 0] }}
              transition={{ duration: 2, repeat: Infinity }}
            >
              <ChevronDown className="size-[7px] text-muted-foreground/20 dark:text-white/15" />
            </motion.div>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-[2px] rounded-full bg-foreground/[0.04] overflow-hidden mb-2">
        <motion.div
          className={cn("h-full rounded-full", isDone ? "bg-emerald-500" : "bg-amber-500")}
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
                stepDone ? "text-foreground/50" : stepActive ? "text-foreground font-medium" : "text-muted-foreground/15"
              )}
            >
              {stepDone ? (
                <Check className="size-2.5 text-emerald-500 flex-shrink-0" />
              ) : stepActive ? (
                <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }} className="flex-shrink-0">
                  <RotateCcw className="size-2.5 text-amber-500" />
                </motion.div>
              ) : (
                <div className="size-2.5 rounded-full border border-foreground/[0.06] flex-shrink-0" />
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

export default function AgentSwarmsPage() {
  const t = useTranslations("agentSwarms")
  const { machines, phase, elapsed, start, reset } = useSwarmDemo()
  const [isMobile, setIsMobile] = useState(false)
  const [mounted, setMounted] = useState(false)
  const heroRef = useRef<HTMLDivElement>(null)
  const heroInView = useInView(heroRef, { once: true })

  useEffect(() => {
    setIsMobile(window.innerWidth < 768)
    setMounted(true)
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
    <div className="min-h-screen bg-background relative">
      <GuideLines />
      <LandingHeader />

      <main className={cn("relative", isMobile ? "pt-16" : "pt-20")}>

        {/* ── Hero ── */}
        <section
          ref={heroRef}
          className={cn(
            "relative flex flex-col items-center justify-center overflow-hidden",
            isMobile ? "px-4 pt-10 pb-8" : "px-6 pt-24 pb-6"
          )}
        >

          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="relative z-10 w-full max-w-3xl mx-auto text-center"
          >
            <motion.div variants={itemVariants} className="mb-4">
              <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/15 bg-amber-500/[0.04] px-3.5 py-1 text-[11px] font-medium text-amber-600 dark:text-amber-400/80 tracking-wide">
                <GitFork className="size-3" />
                {t("badge")}
              </span>
            </motion.div>

            <motion.h1
              variants={itemVariants}
              className={cn(
                "font-bold tracking-tight leading-[1.08]",
                isMobile ? "text-3xl" : "text-5xl sm:text-[3.5rem]"
              )}
            >
              {t("heroTitle1")}{" "}
              <AuroraText
                colors={["#f59e0b", "#f97316", "#ef4444", "#f59e0b"]}
                speed={1.5}
                className={cn(
                  "font-bold tracking-tight",
                  isMobile ? "text-3xl" : "text-5xl sm:text-[3.5rem]"
                )}
              >
                {t("heroTitle2")}
              </AuroraText>
              <br />
              {t("heroTitle3")}
            </motion.h1>

            <motion.p
              variants={itemVariants}
              className={cn(
                "text-muted-foreground mt-4 max-w-lg mx-auto leading-relaxed",
                isMobile ? "text-sm" : "text-[17px]"
              )}
            >
              {t("heroDescription")}
            </motion.p>

            <motion.div
              variants={itemVariants}
              className="flex items-center justify-center gap-3 mt-7"
            >
              <RainbowButton className="gap-2" asChild>
                <Link href="/auth">
                  {t("trySwarmMode")}
                  <ArrowRight className="size-4" />
                </Link>
              </RainbowButton>
              <Button variant="outline" className="rounded-full" asChild>
                <a href="#demo">
                  {t("seeInAction")}
                  <ChevronDown className="size-3.5 ml-1" />
                </a>
              </Button>
            </motion.div>
          </motion.div>
        </section>

        {/* ── Hero Video Demo ── */}
        <section className={cn("relative", isMobile ? "px-4 pb-12" : "px-6 pb-16 pt-4")}>
          <div className="max-w-5xl mx-auto">
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
            className="max-w-4xl mx-auto"
          >
            <motion.div variants={itemVariants} className="text-center mb-14">
              <h2 className={cn("font-bold tracking-tight", isMobile ? "text-2xl" : "text-3xl sm:text-4xl")}>
                {t("threeSteps")}
              </h2>
            </motion.div>

            <div className={cn("grid gap-px bg-border/30 rounded-2xl overflow-hidden border border-border/30", isMobile ? "grid-cols-1" : "grid-cols-3")}>
              {[
                { step: "01", title: t("steps.typePrompt.title"), desc: t("steps.typePrompt.desc"), icon: Send, color: "text-blue-500", bg: "bg-blue-500/6" },
                { step: "02", title: t("steps.machinesSpinUp.title"), desc: t("steps.machinesSpinUp.desc"), icon: Cpu, color: "text-amber-500", bg: "bg-amber-500/6" },
                { step: "03", title: t("steps.resultsStream.title"), desc: t("steps.resultsStream.desc"), icon: Merge, color: "text-emerald-500", bg: "bg-emerald-500/6" },
              ].map((s) => (
                <motion.div
                  key={s.step}
                  variants={itemVariants}
                  className="bg-background p-6 sm:p-8"
                >
                  <div className={cn("inline-flex items-center justify-center size-10 rounded-xl mb-4", s.bg)}>
                    <s.icon className={cn("size-5", s.color)} />
                  </div>
                  <div className="text-[10px] font-mono text-muted-foreground/35 mb-2 tracking-widest uppercase">{s.step}</div>
                  <h3 className="text-base font-semibold mb-1.5">{s.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{s.desc}</p>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </section>

        {/* ── Interactive Demo ── */}
        <section id="demo" className={cn("py-20 relative", isMobile ? "px-7" : "px-10")}>

          <motion.div
            variants={containerVariants}
            initial="hidden"
            whileInView="visible"
            viewport={sectionViewport}
            className="max-w-6xl mx-auto relative z-10"
          >
            <motion.div variants={itemVariants} className="text-center mb-10">
              <h2 className={cn("font-bold tracking-tight", isMobile ? "text-2xl" : "text-3xl sm:text-4xl")}>
                {t("seeInAction")}
              </h2>
              <p className={cn("text-muted-foreground mt-2", isMobile ? "text-sm" : "text-base")}>
                {t("demoDescription", { count: 5 })}
              </p>
            </motion.div>

            <motion.div variants={itemVariants}>
              {/* Prompt bar */}
              <div className="rounded-xl border border-border/30 bg-card/30 backdrop-blur-sm p-4 mb-5">
                <div className="flex items-center gap-4">
                  <div className="flex-shrink-0 size-9 rounded-lg bg-amber-500/10 border border-amber-500/15 flex items-center justify-center">
                    <GitFork className="size-4 text-amber-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[10px] font-mono text-amber-500/60 tracking-wide">{t("swarm")}</span>
                      <span className="text-[10px] text-muted-foreground/30">{t("machineCount", { count: 5 })}</span>
                    </div>
                    <p className="text-sm font-medium leading-relaxed truncate">{demoPrompt}</p>
                  </div>
                  <div className="flex-shrink-0">
                    {phase === "idle" && (
                      <Button
                        size="sm"
                        className="gap-1.5 bg-amber-500 hover:bg-amber-600 text-white border-0 rounded-lg shadow-sm"
                        onClick={start}
                      >
                        <Play className="size-3" />
                        {t("run")}
                      </Button>
                    )}
                    {phase === "running" && (
                      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500/[0.06] border border-amber-500/10">
                        <span className="text-xs font-mono text-amber-500 tabular-nums">
                          {(elapsed * 0.4).toFixed(1)}s
                        </span>
                        <span className="relative size-2">
                          <span className="absolute inset-0 rounded-full bg-amber-500 animate-ping opacity-30" />
                          <span className="absolute inset-0 rounded-full bg-amber-500" />
                        </span>
                      </div>
                    )}
                    {phase === "done" && (
                      <Button size="sm" variant="outline" className="gap-1.5 rounded-lg" onClick={reset}>
                        <RotateCcw className="size-3" />
                        {t("reset")}
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              {/* Machine grid */}
              <div className={cn("grid gap-3", isMobile ? "grid-cols-1" : "grid-cols-2 lg:grid-cols-3 xl:grid-cols-5")}>
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
                    className="mt-5 rounded-xl border border-emerald-500/15 bg-emerald-500/[0.03] p-5 text-center"
                  >
                    <div className="flex items-center justify-center gap-2 mb-1">
                      <Check className="size-4 text-emerald-500" />
                      <span className="font-semibold text-sm text-emerald-600 dark:text-emerald-400">
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
            className="max-w-3xl mx-auto"
          >
            <motion.div variants={itemVariants} className="text-center mb-10">
              <h2 className={cn("font-bold tracking-tight", isMobile ? "text-2xl" : "text-3xl sm:text-4xl")}>
                {t("seqVsSwarm")}
              </h2>
            </motion.div>

            <motion.div variants={itemVariants}>
              <div className="rounded-xl border border-border/30 overflow-hidden">
                {/* Table header */}
                {!isMobile && (
                  <div className="grid grid-cols-[1fr_100px_100px_72px] text-[11px] font-mono uppercase tracking-wider text-muted-foreground/40 bg-muted/20 dark:bg-muted/10 px-5 py-2.5 border-b border-border/20">
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
                      i < comparisons.length - 1 && "border-b border-border/15"
                    )}
                  >
                    <div className={cn(
                      "grid items-center",
                      isMobile
                        ? "grid-cols-1 gap-1.5 p-4"
                        : "grid-cols-[1fr_100px_100px_72px] px-5 py-3.5"
                    )}>
                      <div className="text-sm font-medium">{t(row.labelKey)}</div>
                      <div className={cn(
                        "text-muted-foreground/40 line-through decoration-muted-foreground/15",
                        isMobile ? "text-xs" : "text-sm text-center"
                      )}>
                        {row.sequential}
                      </div>
                      <div className={cn(
                        "font-semibold text-amber-500",
                        isMobile ? "text-xs" : "text-sm text-center"
                      )}>
                        {row.swarm}
                      </div>
                      <div className={cn(
                        "font-bold text-emerald-500",
                        isMobile ? "text-sm" : "text-sm text-center"
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
        <section className={cn("py-20 relative", isMobile ? "px-7" : "px-10")}>
          <motion.div
            variants={containerVariants}
            initial="hidden"
            whileInView="visible"
            viewport={sectionViewport}
            className="max-w-4xl mx-auto relative z-10"
          >
            <motion.div variants={itemVariants} className="text-center mb-10">
              <h2 className={cn("font-bold tracking-tight", isMobile ? "text-2xl" : "text-3xl sm:text-4xl")}>
                {t("builtForParallel")}
              </h2>
            </motion.div>

            <div className={cn("grid gap-3", isMobile ? "grid-cols-1" : "grid-cols-2 lg:grid-cols-3")}>
              {useCaseItems.map((uc) => (
                <motion.div
                  key={uc.key}
                  variants={itemVariants}
                  className="group rounded-xl border border-border/25 bg-card/15 p-5 transition-all duration-300 hover:border-border/40 hover:bg-card/30"
                >
                  <div className="flex items-center justify-center size-9 rounded-lg bg-amber-500/8 border border-amber-500/10 mb-3 group-hover:bg-amber-500/12 transition-colors">
                    <uc.icon className="size-4 text-amber-500" />
                  </div>
                  <h3 className="font-semibold text-sm mb-1">{t(`${uc.key}.title`)}</h3>
                  <p className="text-[13px] text-muted-foreground leading-relaxed">{t(`${uc.key}.desc`)}</p>
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
            className="max-w-4xl mx-auto"
          >
            <div className={cn(
              "grid gap-px bg-border/20 rounded-xl overflow-hidden border border-border/20",
              isMobile ? "grid-cols-1" : "grid-cols-2 lg:grid-cols-3"
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
                    <f.icon className="size-4 text-amber-500/70 mt-0.5 flex-shrink-0" />
                    <div>
                      <h3 className="text-sm font-medium mb-0.5">{t(`${f.key}.title`)}</h3>
                      <p className="text-[12px] text-muted-foreground leading-relaxed">{t(`${f.key}.desc`)}</p>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </section>

        {/* ── CTA ── */}
        <section className={cn("py-24 relative", isMobile ? "px-7" : "px-10")}>

          <motion.div
            variants={containerVariants}
            initial="hidden"
            whileInView="visible"
            viewport={sectionViewport}
            className="max-w-2xl mx-auto text-center relative z-10"
          >
            <motion.h2 variants={itemVariants} className={cn("font-bold tracking-tight", isMobile ? "text-2xl" : "text-3xl sm:text-4xl")}>
              {t("readyCta")}
            </motion.h2>

            <motion.p variants={itemVariants} className={cn("text-muted-foreground mt-3 max-w-md mx-auto", isMobile ? "text-sm" : "text-base")}>
              {t("includedWithPaid")}
            </motion.p>

            <motion.div variants={itemVariants} className="flex items-center justify-center gap-3 mt-7">
              <RainbowButton className="gap-2" asChild>
                <Link href="/auth">
                  {t("getStarted")}
                  <ArrowRight className="size-4" />
                </Link>
              </RainbowButton>
              <Button variant="outline" className="rounded-full gap-1.5" asChild>
                <Link href="/#pricing">
                  {t("viewPricing")}
                  <ChevronRight className="size-3.5" />
                </Link>
              </Button>
            </motion.div>

            {/* Compact plan indicators */}
            <motion.div variants={itemVariants} className={cn("mt-10 flex items-center justify-center gap-6", isMobile && "flex-col gap-3")}>
              {[
                { plan: "Starter", price: "$19", machines: "2 machines" },
                { plan: "Plus", price: "$50", machines: "4 machines" },
                { plan: "Pro", price: "$100", machines: "6 machines" },
              ].map(p => (
                <div key={p.plan} className="flex items-baseline gap-2">
                  <span className="text-sm font-semibold">{p.plan}</span>
                  <span className="text-xl font-bold">{p.price}</span>
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
