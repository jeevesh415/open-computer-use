"use client"

import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
// HeroParallaxChat removed — demo section is now static
import { Check, Zap, Shield, Globe, Code, Users, Sparkles, ChevronRight, Star, ArrowRight, Bot, Brain, Rocket, X, MessageSquare, FileText, Search, Terminal, Cloud, Cpu, Monitor, HardDrive, Clock, Infinity, Play, Download, CalendarCheck, RefreshCw, GitFork } from "lucide-react"
import { CoastyIcon } from "@/components/icons/coasty"
import Link from "next/link"
import { useState, useEffect, useCallback, useRef } from "react"
import { captureUtmParams } from "@/lib/posthog/analytics"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import { useTheme } from "next-themes"
import { useSearchParams } from "next/navigation"
import { LandingHeader } from "./landing-header"
import { LandingFooter } from "./landing-footer"
import { HeroVideoMatrix } from "./hero-video-matrix"
import { GuideLines, SectionDivider as SharedSectionDivider } from "./guide-lines"
import Beams from "@/components/Beams"
import { motion, AnimatePresence } from "framer-motion"
import Image from "next/image"
import { Caveat } from "next/font/google"

const handwriting = Caveat({
  subsets: ["latin"],
  weight: ["600"],
})

const PLAN_KEYS = ["free", "lite", "starter", "plus", "pro"] as const
const PLAN_DATA = [
  { key: "free" as const, price: "$0", credits: 0, machines: 0, swarm: 0, highlighted: false },
  { key: "lite" as const, price: "$9", credits: 100, machines: 1, swarm: 2, highlighted: false },
  { key: "starter" as const, price: "$19", credits: 200, machines: 1, swarm: 3, highlighted: false },
  { key: "plus" as const, price: "$50", credits: 600, machines: 2, swarm: 6, highlighted: true },
  { key: "pro" as const, price: "$100", credits: 1500, machines: 3, swarm: 9, highlighted: false },
]

const DEMO_SESSION_DATA = [
  { key: "reddit" as const, chatId: "373c1f67-afec-4bd6-adda-3809ecdbdd75" },
  { key: "prospects" as const, chatId: "425d3c49-3a06-41e5-9859-aa00c5b12f3d" },
  { key: "qa" as const, chatId: "7ee3e942-c5dd-4e49-93b6-353bb5273b7e" },
  { key: "email" as const, chatId: "60a0722b-fb98-43d6-a4e7-951d80a22363" },
  { key: "job" as const, chatId: "4ac6f3d2-c273-4a07-bf98-b986d1cbfb88" },
  { key: "hackernews" as const, chatId: "d181de46-b41d-4b87-9648-0374b2b7ec1c" },
]

const WHY_COASTY_KEYS = ["worksLikeHuman", "noScripts", "handlesUnexpected", "runsInIsolation"] as const

const LANDING_NAV_SECTIONS = [
  { id: "benchmark", label: "Benchmark" },
  { id: "why-coasty", label: "Why Coasty" },
  { id: "how-it-works", label: "How It Works" },
  { id: "demo", label: "Demo" },
  { id: "cost", label: "Cost" },
  { id: "features", label: "Features" },
  { id: "pricing", label: "Pricing" },
] as const

const FAQ_KEYS = ["whatIsCoasty", "howDifferent", "whatTasks", "whatAreCredits", "localComputer", "dataSafe"] as const

export function LandingPage() {
  const [selectedFaq, setSelectedFaq] = useState<number | null>(null)
  const [isMobile, setIsMobile] = useState(false)
  const [mounted, setMounted] = useState(false)
  const { resolvedTheme } = useTheme()
  const t = useTranslations()
  const tc = useTranslations("common")

  const searchParams = useSearchParams()

  // Capture referral code and UTM params from URL
  useEffect(() => {
    const ref = searchParams.get("ref")
    if (ref) {
      localStorage.setItem("coasty_referral_code", ref)
      const url = new URL(window.location.href)
      url.searchParams.delete("ref")
      window.history.replaceState({}, "", url.toString())
    }
    captureUtmParams()
  }, [searchParams])

  // Detect mobile — single mount effect that batches all initial state
  useEffect(() => {
    const isSmallDevice = window.innerWidth < 768
    setIsMobile(isSmallDevice)
    setMounted(true)

    const onResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Animation variants — no motion on mobile (instant reveal)
  const sectionViewport = { once: true, amount: isMobile ? 0.05 : 0.1 }

  const containerVariants = isMobile
    ? { hidden: { opacity: 1 }, visible: { opacity: 1 } }
    : {
        hidden: { opacity: 0 },
        visible: {
          opacity: 1,
          transition: { staggerChildren: 0.1, delayChildren: 0.1 }
        }
      }

  const itemVariants = isMobile
    ? { hidden: { opacity: 1, y: 0 }, visible: { opacity: 1, y: 0 } }
    : {
        hidden: { opacity: 0, y: 30 },
        visible: {
          opacity: 1,
          y: 0,
          transition: { duration: 0.5, ease: "easeOut" as const }
        }
      }

  // ── Global section navigation: continuous scroll progress ──
  // Caches document-relative flow positions on mount/resize by temporarily
  // removing sticky so offsetTop chain gives the true layout position.
  const [scrollProgress, setScrollProgress] = useState(0)
  const activeLandingSection = Math.round(scrollProgress)

  useEffect(() => {
    const sectionEls = LANDING_NAV_SECTIONS
      .map(s => document.getElementById(s.id))
      .filter(Boolean) as HTMLElement[]
    if (!sectionEls.length) return

    let sectionTops: number[] = []

    const measurePositions = () => {
      // Remove sticky from all sections at once (single reflow)
      const originals = sectionEls.map(el => {
        const orig = el.style.position
        el.style.position = 'relative'
        return orig
      })
      // Walk offsetParent chain for document-relative positions
      sectionTops = sectionEls.map(el => {
        let top = 0
        let node: HTMLElement | null = el
        while (node) {
          top += node.offsetTop
          node = node.offsetParent as HTMLElement | null
        }
        return top
      })
      // Restore (single reflow)
      sectionEls.forEach((el, i) => { el.style.position = originals[i] })
    }

    const onScroll = () => {
      const trigger = window.scrollY + window.innerHeight * 0.35
      let progress = 0
      for (let i = sectionTops.length - 1; i >= 0; i--) {
        if (sectionTops[i] <= trigger) {
          if (i < sectionTops.length - 1) {
            const span = sectionTops[i + 1] - sectionTops[i]
            const frac = span > 0 ? Math.min(1, (trigger - sectionTops[i]) / span) : 0
            progress = i + frac
          } else {
            progress = i
          }
          break
        }
      }
      setScrollProgress(progress)

      // Scroll-driven card stacking: leaving cards recede with eased fade
      if (window.innerWidth >= 768) {
        for (let ci = 0; ci < sectionEls.length; ci++) {
          const cardEl = sectionEls[ci]
          const covered = Math.max(0, Math.min(1, progress - ci))
          if (covered > 0) {
            // Cubic ease-in: card stays pristine for ~50% of scroll, then gracefully exits
            const e = covered * covered * covered
            const s = 1 - e * 0.06            // 1.0 → 0.94
            const ty = e * -20                // 0px → -20px (recedes upward)
            const b = e * 3.5                 // 0 → 3.5px depth blur
            const bright = 1 - e * 0.15       // 1.0 → 0.85 dimming
            const sat = 1 - e * 0.25          // 1.0 → 0.75 desaturate
            const o = 1 - e * 0.4             // 1.0 → 0.6 fade
            cardEl.style.transform = `scale(${s}) translateY(${ty}px)`
            cardEl.style.opacity = `${o}`
            cardEl.style.filter = `blur(${b}px) brightness(${bright}) saturate(${sat})`
          } else {
            cardEl.style.transform = ''
            cardEl.style.opacity = ''
            cardEl.style.filter = ''
          }
        }
      }
    }

    const onResize = () => {
      measurePositions()
      onScroll()
      // Reset transforms when switching to mobile
      if (window.innerWidth < 768) {
        for (const el of sectionEls) {
          el.style.transform = ''
          el.style.opacity = ''
          el.style.filter = ''
        }
      }
    }

    measurePositions()
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
      for (const el of sectionEls) {
        el.style.transform = ''
        el.style.opacity = ''
        el.style.filter = ''
      }
    }
  }, [mounted])

  const scrollToLandingSection = useCallback((index: number) => {
    const el = document.getElementById(LANDING_NAV_SECTIONS[index]?.id)
    if (!el) return
    const original = el.style.position
    el.style.position = 'relative'
    let top = 0
    let node: HTMLElement | null = el
    while (node) {
      top += node.offsetTop
      node = node.offsetParent as HTMLElement | null
    }
    el.style.position = original
    window.scrollTo({ top: Math.max(0, top - 90), behavior: 'smooth' })
  }, [])

  // ── Shared card interaction handlers (mouse-tracking gradient) ──
  const handleCardMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100
    e.currentTarget.style.setProperty('--mouse-x', `${x}%`)
    e.currentTarget.style.setProperty('--mouse-y', `${y}%`)
  }, [])

  const handleCardMouseLeave = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.currentTarget.style.setProperty('--mouse-x', '50%')
    e.currentTarget.style.setProperty('--mouse-y', '50%')
  }, [])

  const SectionDivider = SharedSectionDivider

  return (
    <>
      <div className="min-h-screen bg-background relative">

      <div id="guide-lines-wrap">
        <GuideLines />
      </div>

      {/* Beams background — covers full viewport including behind navbar, inverted in light mode */}
      <div id="beams-bg" className={cn("fixed inset-0 z-0 pointer-events-none", mounted && resolvedTheme !== "dark" && "invert")} aria-hidden="true">
        <div className="mx-auto h-full max-w-7xl px-4 sm:px-6 relative">
          <div className="absolute inset-y-0 left-4 sm:left-6 right-4 sm:right-6 overflow-hidden [mask-image:radial-gradient(ellipse_80%_80%_at_50%_45%,black_0%,black_30%,transparent_75%)] sm:[mask-image:radial-gradient(ellipse_100%_90%_at_50%_45%,black_0%,black_40%,transparent_85%)]">
            <Beams
              beamWidth={3}
              beamHeight={30}
              beamNumber={20}
              lightColor="#ffffff"
              speed={2}
              noiseIntensity={1.75}
              scale={0.2}
              rotation={30}
            />
          </div>
        </div>
      </div>

      {/* Fixed header */}
      <div id="landing-header-wrap">
        <LandingHeader />
      </div>

      {/* Hero Section — cinematic zoom-out video matrix */}
      <HeroVideoMatrix isMobile={isMobile} />

      {/* Main content */}
      <main className="relative">

        {/* First content after hero — fades in as a group after the matrix dissolves */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.15 }}
          transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
        >
          <SectionDivider />

          {/* Social Proof Bar */}
          <section className={cn(
            "py-16",
            isMobile ? "px-7" : "px-10"
          )}>
            <div className="max-w-5xl mx-auto">
              <div className={cn(
                "grid text-center",
                isMobile ? "grid-cols-2 gap-6" : "grid-cols-4 gap-0"
              )}>
                {(["osworld", "tools", "schedule", "setup"] as const).map((key, i) => {
                  const stat = { value: t(`stats.${key}.value`), label: t(`stats.${key}.label`), sublabel: t(`stats.${key}.sublabel`) }
                  return (
                  <div key={stat.label} className={cn(
                    !isMobile && i > 0 && "border-l border-border/30"
                  )}>
                    <div className={cn(
                      "font-bold tracking-tight text-foreground",
                      isMobile ? "text-2xl" : "text-3xl"
                    )}>
                      {stat.value}
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">{stat.label}</div>
                    <div className="text-xs text-muted-foreground/50 mt-0.5">{stat.sublabel}</div>
                  </div>
                  )
                })}
              </div>
            </div>
          </section>
        </motion.div>

        <SectionDivider />

        {/* ══════════════════════════════════════════════════════════════
            Guided Sections: Sticky Left Nav + Right Card Stack
            Wraps Why Coasty → Pricing inside a two-column layout
            that sits within the guide lines (max-w-7xl).
            On mobile: single column, no sidebar.
           ══════════════════════════════════════════════════════════════ */}
        <div className={cn(
          "max-w-7xl mx-auto",
          isMobile ? "" : "flex gap-0 px-6 sm:px-10 lg:px-12"
        )}>

          {/* ── LEFT: Sticky section navigator ── */}
          {!isMobile && (() => {
            const count = LANDING_NAV_SECTIONS.length
            const rowH = 18
            const gap = 28
            const stride = rowH + gap
            const trackH = (count - 1) * stride
            const progress = count > 1 ? Math.min(1, scrollProgress / (count - 1)) : 0
            // Soft-edge mask: solid up to progress point, then fades out
            const pct = progress * 100
            const softMask = `linear-gradient(to bottom, black ${Math.max(0, pct - 6)}%, transparent ${Math.min(100, pct + 2)}%)`

            return (
            <div className="w-44 flex-shrink-0">
              <div className="sticky top-0 h-screen flex flex-col justify-center">
                <nav className="relative text-foreground">

                  {/* ── Track + Progress ── */}
                  <div
                    className="absolute pointer-events-none"
                    style={{
                      left: 6,
                      top: rowH / 2,
                      height: trackH,
                    }}
                  >
                    {/* Background rail */}
                    <div
                      className="absolute bg-foreground/[0.05] dark:bg-foreground/[0.03]"
                      style={{ left: 0, top: 0, width: 1, height: '100%' }}
                    />
                    {/* Progress glow (wide, ambient) */}
                    <div
                      className="absolute bg-foreground/[0.03] dark:bg-foreground/[0.025]"
                      style={{
                        left: -2,
                        top: 0,
                        width: 5,
                        height: '100%',
                        borderRadius: 3,
                        maskImage: softMask,
                        WebkitMaskImage: softMask,
                      }}
                    />
                    {/* Progress core line */}
                    <div
                      className="absolute bg-foreground/[0.18] dark:bg-foreground/[0.12]"
                      style={{
                        left: 0,
                        top: 0,
                        width: 1,
                        height: '100%',
                        maskImage: softMask,
                        WebkitMaskImage: softMask,
                      }}
                    />
                  </div>


                  {/* ── Section rows ── */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap }}>
                    {LANDING_NAV_SECTIONS.map((section, i) => {
                      const isActive = activeLandingSection === i
                      const isPast = i <= activeLandingSection
                      return (
                        <button
                          key={section.id}
                          onClick={() => scrollToLandingSection(i)}
                          className="flex items-center cursor-pointer group"
                          style={{ height: rowH, paddingLeft: 24 }}
                        >
                          <span
                            className={cn(
                              "text-[12.5px] font-medium leading-none whitespace-nowrap transition-all duration-500",
                              isActive
                                ? "text-foreground"
                                : isPast
                                  ? "text-foreground/35 dark:text-foreground/25"
                                  : "text-foreground/[0.18] dark:text-foreground/[0.12] group-hover:text-foreground/35 dark:group-hover:text-foreground/25"
                            )}
                            style={{ letterSpacing: '0.01em' }}
                          >
                            {section.label}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </nav>
              </div>
            </div>
            )
          })()}

          {/* ── RIGHT: Sections as sticky card stack ── */}
          <div className={cn(
            isMobile ? "" : "flex-1 min-w-0 pb-[40vh] pl-8 pr-8 lg:pl-10 lg:pr-10"
          )}>

        {/* OSWorld Benchmark Section */}
        <section
          id="benchmark"
          className={cn(
            isMobile
              ? "py-16 px-7"
              : "sticky rounded-2xl border border-border/20 bg-background lp-card-glass lp-section-card px-8 lg:px-10 pt-10 pb-8 mb-6 will-change-[transform,opacity,filter] h-[calc(100vh-8rem)] overflow-hidden origin-top"
          )}
          style={!isMobile ? { top: '5.5rem', zIndex: 1 } : undefined}
        >
          <motion.div
            variants={containerVariants}
            initial="hidden"
            whileInView="visible"
            viewport={sectionViewport}
            className="max-w-5xl mx-auto"
          >
            <motion.div variants={itemVariants} className="text-center mb-6">
              <h2 className={cn(
                "font-bold tracking-tight",
                isMobile ? "text-3xl" : "text-3xl sm:text-4xl"
              )}>
                {t("benchmark.title")}
              </h2>
              <p className={cn(
                "text-muted-foreground mt-2 max-w-lg mx-auto",
                isMobile ? "text-sm" : "text-sm"
              )}>
                {t("benchmark.subtitle")}
              </p>
            </motion.div>

            {/* Legend */}
            <motion.div variants={itemVariants} className="flex items-center justify-center gap-4 sm:gap-6 mb-4">
              <div className="flex items-center gap-1.5">
                <div className="h-2.5 w-2.5 rounded-full bg-sky-500/70" />
                <span className="text-xs text-muted-foreground">{t("benchmark.agenticFramework")}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-2.5 w-2.5 rounded-full bg-muted-foreground/30" />
                <span className="text-xs text-muted-foreground">{t("benchmark.foundationModel")}</span>
              </div>
            </motion.div>

            <motion.div variants={itemVariants} className={cn(isMobile ? "space-y-3" : "space-y-1.5")}>
              {[
                { name: "Coasty", org: "Ours", score: 82.0, highlight: true, type: "framework" as const },
                { name: "Agent S3", org: "Simular · Opus 4.5 + GPT-5", score: 72.6, type: "framework" as const },
                { name: "Agent S3", org: "Simular · GPT-5", score: 69.9, type: "framework" as const },
                { name: "UiPath Screen Agent", org: "UiPath · Opus 4.5", score: 67.1, type: "framework" as const },
                { name: "Agent S3", org: "Simular · Opus 4.5", score: 66.0, type: "framework" as const },
                { name: "Kimi K2.5", org: "Moonshot AI", score: 63.3, type: "model" as const },
                { name: "Claude Sonnet 4.5", org: "Anthropic", score: 62.9, type: "model" as const },
                { name: "Seed-1.8", org: "ByteDance", score: 61.9, type: "model" as const },
                { name: "Claude Sonnet 4.5", org: "Anthropic · 50 steps", score: 58.1, type: "model" as const },
              ].map((entry, i) => (
                <motion.div
                  key={i}
                  initial={isMobile ? { opacity: 1, x: 0 } : { opacity: 0, x: -20 }}
                  animate={isMobile ? { opacity: 1, x: 0 } : undefined}
                  whileInView={isMobile ? undefined : { opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={isMobile ? { duration: 0 } : { delay: i * 0.06, duration: 0.4 }}
                  className={cn(
                    isMobile ? "flex flex-col gap-1" : "flex items-center gap-3",
                    entry.highlight && "py-1"
                  )}
                >
                  {/* Label: stacked above bar on mobile, side-by-side on desktop */}
                  <div className={cn(
                    isMobile
                      ? "flex items-center justify-between text-xs"
                      : "flex-shrink-0 text-right w-44 text-sm"
                  )}>
                    <span className={cn(
                      "font-medium inline-flex items-center gap-1.5",
                      isMobile ? "justify-start" : "justify-end",
                      entry.highlight ? "text-primary" : "text-foreground"
                    )}>
                      {entry.highlight && mounted && (
                        <Image
                          src={resolvedTheme === "dark" ? "/logo_light.svg" : "/logo_dark.svg"}
                          alt="Coasty"
                          width={16}
                          height={16}
                          className={cn(isMobile ? "h-3.5 w-3.5" : "h-4 w-4")}
                        />
                      )}
                      {entry.name}
                      {isMobile && (
                        <span className="text-muted-foreground font-normal ml-1">{entry.org}</span>
                      )}
                    </span>
                    {isMobile && (
                      <span className={cn(
                        "font-semibold tabular-nums",
                        entry.highlight ? "text-primary" : "text-foreground"
                      )}>
                        {entry.score}%
                      </span>
                    )}
                    {!isMobile && (
                      <span className="text-muted-foreground block text-xs">{entry.org}</span>
                    )}
                  </div>
                  {/* Bar */}
                  <div className={cn(
                    "relative rounded-md bg-muted/50 overflow-hidden",
                    isMobile ? "w-full" : "flex-1",
                    entry.highlight
                      ? cn(isMobile ? "h-8" : "h-8", "shadow-[0_0_20px_rgba(59,130,246,0.3)] ring-1 ring-blue-500/30")
                      : cn(isMobile ? "h-6" : "h-6")
                  )}>
                    {/* Bar fill */}
                    {isMobile ? (
                      <div
                        className={cn(
                          "absolute inset-y-0 left-0 rounded-md overflow-hidden",
                          entry.highlight
                            ? "bg-[#0c2d3e]"
                            : entry.type === "framework"
                              ? "bg-sky-500/25"
                              : "bg-muted-foreground/20"
                        )}
                        style={{ width: `${(entry.score / 82) * 100}%` }}
                      >
                        {entry.highlight && (
                          <div
                            className="absolute inset-0"
                            style={{
                              background: "linear-gradient(90deg, #2563eb, #0891b2, #0d9488)",
                            }}
                          />
                        )}
                      </div>
                    ) : (
                      <motion.div
                        initial={{ width: 0 }}
                        whileInView={{ width: `${(entry.score / 82) * 100}%` }}
                        viewport={{ once: true }}
                        transition={{ delay: i * 0.06 + 0.2, duration: 0.7, ease: "easeOut" }}
                        className={cn(
                          "absolute inset-y-0 left-0 rounded-md overflow-hidden",
                          entry.highlight
                            ? "bg-[#0c2d3e]"
                            : entry.type === "framework"
                              ? "bg-sky-500/25"
                              : "bg-muted-foreground/20"
                        )}
                      >
                        {/* Smoke layers inside the bar — desktop only */}
                        {entry.highlight && (
                          <>
                            <div
                              className="absolute inset-[-40%]"
                              style={{
                                background: "radial-gradient(circle 120px at 20% 50%, #2563eb, transparent), radial-gradient(circle 100px at 80% 50%, #0891b2, transparent)",
                                animation: "coasty-smoke-1 4s ease-in-out infinite alternate",
                              }}
                            />
                            <div
                              className="absolute inset-[-40%]"
                              style={{
                                background: "radial-gradient(circle 90px at 55% 30%, #0d9488, transparent), radial-gradient(circle 110px at 35% 70%, #1d4ed8, transparent)",
                                animation: "coasty-smoke-2 5s ease-in-out infinite alternate",
                              }}
                            />
                            <div
                              className="absolute inset-[-40%]"
                              style={{
                                background: "radial-gradient(circle 100px at 70% 60%, #0e7490, transparent), radial-gradient(circle 80px at 10% 40%, #3b82f6, transparent)",
                                animation: "coasty-smoke-3 3.5s ease-in-out infinite alternate",
                              }}
                            />
                          </>
                        )}
                      </motion.div>
                    )}
                    {/* Score label inside bar — desktop only (mobile shows it in the header row) */}
                    {!isMobile && (
                      <span className={cn(
                        "absolute right-2 top-1/2 -translate-y-1/2 font-semibold tabular-nums z-10 text-sm",
                        entry.highlight ? "text-white" : "text-foreground"
                      )}>
                        {entry.score}%
                      </span>
                    )}
                  </div>
                </motion.div>
              ))}
            </motion.div>
          </motion.div>
        </section>


        {/* Why Coasty Section */}
        <section
          id="why-coasty"
          className={cn(
            isMobile
              ? "py-16 px-7"
              : "sticky rounded-2xl border border-border/20 bg-background lp-card-glass lp-section-card px-8 lg:px-10 pt-10 pb-8 mb-6 will-change-[transform,opacity,filter] h-[calc(100vh-8rem)] overflow-hidden origin-top"
          )}
          style={!isMobile ? { top: '5.5rem', zIndex: 2 } : undefined}
        >
          <motion.div
            variants={containerVariants}
            initial="hidden"
            whileInView="visible"
            viewport={sectionViewport}
          >
            {/* CSS animations for visual cards (used across multiple sections) */}
            <style dangerouslySetInnerHTML={{ __html: `
              @keyframes lp-scan-line { 0% { top: 10% } 100% { top: 85% } }
              @keyframes lp-check-pop { 0% { transform: scale(0); opacity: 0 } 60% { transform: scale(1.2); opacity: 1 } 100% { transform: scale(1); opacity: 1 } }
              @keyframes lp-float { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-3px) } }
              @keyframes lp-click-ring { 0% { transform: scale(0.8); opacity: 0 } 50% { transform: scale(1); opacity: 1 } 100% { transform: scale(1.8); opacity: 0 } }
              @keyframes lp-cursor-blink { 0%, 100% { opacity: 1 } 50% { opacity: 0 } }
              @keyframes lp-typing { 0%, 100% { width: 0 } 30%, 70% { width: 100% } }
              @keyframes lp-step-fill { 0% { transform: scaleX(0) } 100% { transform: scaleX(1) } }
              @keyframes lp-msg-appear { 0% { opacity: 0; transform: translateY(6px) } 100% { opacity: 1; transform: translateY(0) } }
              @keyframes lp-dot-pulse { 0%, 100% { opacity: 0.3 } 50% { opacity: 1 } }
              @keyframes lp-progress { 0% { width: 0% } 100% { width: var(--progress, 75%) } }
              @keyframes lp-retry-loop { 0%, 20% { opacity: 1 } 25%, 45% { opacity: 0.3 } 50%, 70% { opacity: 1 } 75%, 100% { opacity: 0.3 } }
              @keyframes lp-screenshot-flash { 0%, 90% { opacity: 0 } 95% { opacity: 0.3 } 100% { opacity: 0 } }
              @keyframes lp-bar-grow { 0% { width: 0 } 100% { width: var(--w, 60%) } }
              @keyframes lp-swarm-stagger-1 { 0% { width: 0 } 100% { width: 85% } }
              @keyframes lp-swarm-stagger-2 { 0% { width: 0 } 100% { width: 65% } }
              @keyframes lp-swarm-stagger-3 { 0% { width: 0 } 100% { width: 40% } }
              /* Premium card layered shadow */
              .lp-card-glass { box-shadow: 0 0 0 1px rgba(0,0,0,0.03), 0 2px 8px -2px rgba(0,0,0,0.06), 0 20px 50px -16px rgba(0,0,0,0.1); }
              .dark .lp-card-glass { box-shadow: 0 0 0 1px rgba(255,255,255,0.035), 0 2px 8px -2px rgba(0,0,0,0.2), 0 20px 50px -16px rgba(0,0,0,0.3); }
              /* Card glass edge highlight + ambient top glow */
              @media (min-width: 768px) {
                .lp-section-card::before {
                  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 1px;
                  background: linear-gradient(90deg, transparent 5%, rgba(0,0,0,0.05) 30%, rgba(0,0,0,0.07) 50%, rgba(0,0,0,0.05) 70%, transparent 95%);
                  z-index: 20; pointer-events: none;
                }
                .dark .lp-section-card::before {
                  background: linear-gradient(90deg, transparent 5%, rgba(255,255,255,0.06) 30%, rgba(255,255,255,0.1) 50%, rgba(255,255,255,0.06) 70%, transparent 95%);
                }
                .lp-section-card::after {
                  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 200px;
                  background: radial-gradient(ellipse 70% 100% at 50% 0%, rgba(0,0,0,0.012), transparent);
                  z-index: 0; pointer-events: none; border-radius: 16px 16px 0 0;
                }
                .dark .lp-section-card::after {
                  background: radial-gradient(ellipse 70% 100% at 50% 0%, rgba(255,255,255,0.02), transparent);
                }
              }
            `}} />

            {/* Section header */}
            <motion.div variants={itemVariants} className="text-center mb-8">
              <p className={cn(
                "text-muted-foreground/60 font-medium uppercase tracking-[0.15em] mb-2",
                isMobile ? "text-[10px]" : "text-xs"
              )}>
                {t("whyCoasty.sectionLabel")}
              </p>
              <h2 className={cn(
                "font-bold tracking-tight",
                isMobile ? "text-3xl" : "text-4xl sm:text-5xl"
              )}>
                {t("whyCoasty.title")}
              </h2>
            </motion.div>

            {/* ── Cards: 2-col grid with staggered cascade + mouse-tracking gradient ── */}
            <div className={cn(
              "grid gap-4",
              isMobile ? "grid-cols-1" : "grid-cols-2"
            )}>
              {WHY_COASTY_KEYS.map((key, i) => (
                <motion.div
                  key={key}
                  initial={isMobile ? { opacity: 1, x: 0 } : { opacity: 0, x: i % 2 === 0 ? -40 : 40 }}
                  whileInView={isMobile ? { opacity: 1, x: 0 } : { opacity: 1, x: 0 }}
                  viewport={{ once: true, amount: 0.3 }}
                  transition={isMobile ? { duration: 0 } : { duration: 0.65, ease: [0.22, 1, 0.36, 1], delay: i * 0.08 }}
                  onMouseMove={!isMobile ? handleCardMouseMove : undefined}
                  onMouseLeave={!isMobile ? handleCardMouseLeave : undefined}
                  className={cn(
                    "relative rounded-2xl border overflow-hidden transition-all duration-500 group",
                    "border-border/40 hover:border-border/60 hover:shadow-lg hover:shadow-primary/[0.04]",
                    isMobile ? "p-5" : "p-6",
                  )}
                  style={{ '--mouse-x': '50%', '--mouse-y': '50%' } as React.CSSProperties}
                >
                    {/* Mouse-tracking radial gradient overlay */}
                    <div
                      className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
                      style={{
                        background: 'radial-gradient(600px circle at var(--mouse-x) var(--mouse-y), rgba(59, 130, 246, 0.07), transparent 40%)'
                      }}
                    />

                    <div className="relative z-10">
                      {/* Micro-illustration */}
                      <div className={cn("flex items-center justify-center mb-3", isMobile ? "h-16" : "h-16")}>
                        {/* Card 0: Works like a human — scan + click */}
                        {i === 0 && (
                          <div className="flex items-center gap-3">
                            <div className="relative w-[80px] h-[48px] rounded-lg border border-foreground/10 bg-foreground/[0.02] overflow-hidden">
                              <div className="space-y-1 p-2">
                                <div className="h-[3px] w-[80%] rounded-full bg-foreground/10" />
                                <div className="h-[3px] w-[60%] rounded-full bg-foreground/10" />
                                <div className="h-[3px] w-[70%] rounded-full bg-foreground/10" />
                                <div className="h-[3px] w-[50%] rounded-full bg-foreground/10" />
                              </div>
                              <div
                                className="absolute left-0 right-0 h-px bg-foreground/25"
                                style={{ animation: "lp-scan-line 3s ease-in-out infinite" }}
                              />
                            </div>
                            <ArrowRight className="size-3 text-foreground/20" />
                            <div className="relative w-6 h-6 rounded-lg border border-foreground/20 flex items-center justify-center">
                              <Monitor className="size-3 text-foreground/30" />
                              <div
                                className="absolute inset-0 rounded-lg border border-foreground/20"
                                style={{ animation: "lp-click-ring 2s ease-out infinite" }}
                              />
                            </div>
                          </div>
                        )}

                        {/* Card 1: No scripts — typing → done */}
                        {i === 1 && (
                          <div className="flex items-center gap-3">
                            <div className="rounded-lg border border-foreground/10 bg-foreground/[0.03] px-3 py-2 overflow-hidden">
                              <div className="relative">
                                <span className="text-[10px] text-foreground/40 font-mono whitespace-nowrap" style={{ animation: "lp-typing 4s ease-in-out infinite", display: "inline-block", overflow: "hidden" }}>
                                  do this task for me
                                </span>
                                <span className="text-[10px] text-foreground/50" style={{ animation: "lp-cursor-blink 1s step-end infinite" }}>|</span>
                              </div>
                            </div>
                            <ArrowRight className="size-3 text-foreground/20" />
                            <div
                              className="flex items-center gap-1 text-foreground/40"
                              style={{ animation: "lp-check-pop 0.5s ease forwards 1.5s", opacity: 0 }}
                            >
                              <Check className="size-4" />
                              <span className="text-xs font-medium">done</span>
                            </div>
                          </div>
                        )}

                        {/* Card 2: Handles unexpected — CAPTCHA → adapts → success */}
                        {i === 2 && (
                          <div className="flex items-center gap-2.5">
                            <div className="rounded-lg border border-foreground/15 bg-foreground/[0.03] px-2.5 py-1.5">
                              <span className="text-[10px] text-foreground/30 font-medium">CAPTCHA</span>
                            </div>
                            <span
                              className="text-xs text-foreground/20"
                              style={{ animation: "lp-float 2s ease-in-out infinite" }}
                            >→</span>
                            <div className="rounded-lg border border-foreground/15 bg-foreground/[0.03] px-2.5 py-1.5">
                              <span className="text-[10px] text-foreground/30 font-medium">adapts</span>
                            </div>
                            <span className="text-xs text-foreground/20">→</span>
                            <div
                              className="h-5 w-5 rounded-full border border-foreground/20 flex items-center justify-center"
                              style={{ animation: "lp-check-pop 0.5s ease forwards 2s", opacity: 0 }}
                            >
                              <Check className="size-3 text-foreground/40" />
                            </div>
                          </div>
                        )}

                        {/* Card 3: Runs in isolation — sandboxed VM */}
                        {i === 3 && (
                          <div className="relative w-[60px] h-[44px] rounded-lg border border-dashed border-foreground/15 flex items-center justify-center">
                            <div className="w-8 h-6 rounded border border-foreground/10 bg-foreground/[0.03] flex items-center justify-center">
                              <Monitor className="size-3 text-foreground/20" />
                            </div>
                            <div className="absolute -top-2 -right-2 w-5 h-5 rounded-full border border-foreground/15 bg-background flex items-center justify-center">
                              <Shield className="size-2.5 text-foreground/30" />
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Title + description */}
                      <p className={cn("font-semibold text-foreground", isMobile ? "text-base" : "text-lg")}>
                        {t(`whyCoasty.${key}.title`)}
                      </p>
                      <p className="text-sm text-muted-foreground/50 mt-0.5">{t(`whyCoasty.${key}.description`)}</p>
                    </div>
                  </motion.div>
                ))}
            </div>
          </motion.div>
        </section>


        {/* How It Works Section */}
        <section
          id="how-it-works"
          className={cn(
            isMobile
              ? "py-16 px-7"
              : "sticky rounded-2xl border border-border/20 bg-background lp-card-glass lp-section-card px-8 lg:px-10 pt-10 pb-8 mb-6 will-change-[transform,opacity,filter] h-[calc(100vh-8rem)] overflow-hidden origin-top"
          )}
          style={!isMobile ? { top: '5.5rem', zIndex: 3 } : undefined}
        >
          <motion.div
            variants={containerVariants}
            initial="hidden"
            whileInView="visible"
            viewport={sectionViewport}
            className="max-w-5xl mx-auto"
          >
            <motion.div variants={itemVariants} className="text-center mb-8">
              <h2 className={cn(
                "font-bold tracking-tight",
                isMobile ? "text-3xl" : "text-3xl sm:text-4xl"
              )}>
                {t("howItWorks.title")}
              </h2>
            </motion.div>

            <div className={cn(
              "grid gap-4",
              isMobile ? "grid-cols-1" : "grid-cols-3"
            )}>
              {/* Step 1: Describe — typing animation */}
              <motion.div
                initial={isMobile ? { opacity: 1, x: 0 } : { opacity: 0, x: -40 }}
                whileInView={isMobile ? { opacity: 1, x: 0 } : { opacity: 1, x: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={isMobile ? { duration: 0 } : { duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                onMouseMove={!isMobile ? handleCardMouseMove : undefined}
                onMouseLeave={!isMobile ? handleCardMouseLeave : undefined}
                className="relative rounded-2xl border border-border/40 bg-card/30 p-5 overflow-hidden group"
                style={{ '--mouse-x': '50%', '--mouse-y': '50%' } as React.CSSProperties}
              >
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" style={{ background: 'radial-gradient(600px circle at var(--mouse-x) var(--mouse-y), rgba(59, 130, 246, 0.07), transparent 40%)' }} />
                {!isMobile && (
                  <div className="absolute top-1/2 -right-2.5 text-foreground/15 z-10">
                    <ArrowRight className="size-4" />
                  </div>
                )}
                <div className="relative z-10">
                  <div className={cn("flex items-center justify-center mb-4", isMobile ? "h-20" : "h-22")}>
                    <div className="w-full max-w-[200px] rounded-lg border border-foreground/10 bg-foreground/[0.02] p-3">
                      <div className="flex items-center gap-1.5 mb-2">
                        <div className="h-1.5 w-1.5 rounded-full bg-foreground/15" />
                        <div className="h-1.5 w-1.5 rounded-full bg-foreground/15" />
                        <div className="h-1.5 w-1.5 rounded-full bg-foreground/15" />
                      </div>
                      <div className="relative overflow-hidden">
                        <span
                          className="text-[10px] text-foreground/40 font-mono whitespace-nowrap inline-block overflow-hidden"
                          style={{ animation: "lp-typing 5s ease-in-out infinite" }}
                        >
                          Research 100 leads on LinkedIn...
                        </span>
                        <span className="text-[10px] text-foreground/50" style={{ animation: "lp-cursor-blink 1s step-end infinite" }}>|</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-foreground/[0.06] text-[10px] font-bold text-foreground/50">1</span>
                    <p className={cn("font-semibold text-foreground", isMobile ? "text-base" : "text-lg")}>{t("howItWorks.step1.title")}</p>
                  </div>
                  <p className="text-sm text-muted-foreground/50 pl-7">{t("howItWorks.step1.description")}</p>
                </div>
              </motion.div>

              {/* Step 2: Agent works — mini browser with actions */}
              <motion.div
                initial={isMobile ? { opacity: 1, y: 0 } : { opacity: 0, y: 40 }}
                whileInView={isMobile ? { opacity: 1, y: 0 } : { opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={isMobile ? { duration: 0 } : { duration: 0.6, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
                onMouseMove={!isMobile ? handleCardMouseMove : undefined}
                onMouseLeave={!isMobile ? handleCardMouseLeave : undefined}
                className="relative rounded-2xl border border-border/40 bg-card/30 p-5 overflow-hidden group"
                style={{ '--mouse-x': '50%', '--mouse-y': '50%' } as React.CSSProperties}
              >
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" style={{ background: 'radial-gradient(600px circle at var(--mouse-x) var(--mouse-y), rgba(59, 130, 246, 0.07), transparent 40%)' }} />
                {!isMobile && (
                  <div className="absolute top-1/2 -right-2.5 text-foreground/15 z-10">
                    <ArrowRight className="size-4" />
                  </div>
                )}
                <div className="relative z-10">
                  <div className={cn("flex items-center justify-center mb-4", isMobile ? "h-20" : "h-22")}>
                    <div className="w-full max-w-[200px] rounded-lg border border-foreground/10 bg-foreground/[0.02] overflow-hidden">
                      {/* Browser bar */}
                      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-foreground/[0.06]">
                        <div className="h-1 w-1 rounded-full bg-foreground/15" />
                        <div className="h-1 w-1 rounded-full bg-foreground/15" />
                        <div className="h-1 w-1 rounded-full bg-foreground/15" />
                        <div className="ml-1 h-3 flex-1 rounded bg-foreground/[0.04]" />
                      </div>
                      {/* Page content with scan line */}
                      <div className="relative p-2 space-y-1.5">
                        <div className="h-[3px] w-[90%] rounded-full bg-foreground/10" />
                        <div className="h-[3px] w-[70%] rounded-full bg-foreground/10" />
                        <div className="h-[3px] w-[80%] rounded-full bg-foreground/10" />
                        <div className="h-[3px] w-[55%] rounded-full bg-foreground/10" />
                        <div className="h-[3px] w-[75%] rounded-full bg-foreground/10" />
                        <div
                          className="absolute left-0 right-0 h-px bg-foreground/20"
                          style={{ animation: "lp-scan-line 2.5s ease-in-out infinite" }}
                        />
                        {/* Click ring */}
                        <div className="absolute top-3 right-4">
                          <div
                            className="h-3 w-3 rounded-full border border-foreground/20"
                            style={{ animation: "lp-click-ring 2s ease-out infinite 1s" }}
                          />
                        </div>
                        {/* Screenshot flash */}
                        <div
                          className="absolute inset-0 bg-foreground/10 rounded"
                          style={{ animation: "lp-screenshot-flash 3s ease infinite" }}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-foreground/[0.06] text-[10px] font-bold text-foreground/50">2</span>
                    <p className={cn("font-semibold text-foreground", isMobile ? "text-base" : "text-lg")}>{t("howItWorks.step2.title")}</p>
                  </div>
                  <p className="text-sm text-muted-foreground/50 pl-7">{t("howItWorks.step2.description")}</p>
                </div>
              </motion.div>

              {/* Step 3: Done — results appearing */}
              <motion.div
                initial={isMobile ? { opacity: 1, x: 0 } : { opacity: 0, x: 40 }}
                whileInView={isMobile ? { opacity: 1, x: 0 } : { opacity: 1, x: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={isMobile ? { duration: 0 } : { duration: 0.6, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
                onMouseMove={!isMobile ? handleCardMouseMove : undefined}
                onMouseLeave={!isMobile ? handleCardMouseLeave : undefined}
                className="rounded-2xl border border-border/40 bg-card/30 p-5 overflow-hidden group relative"
                style={{ '--mouse-x': '50%', '--mouse-y': '50%' } as React.CSSProperties}
              >
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" style={{ background: 'radial-gradient(600px circle at var(--mouse-x) var(--mouse-y), rgba(59, 130, 246, 0.07), transparent 40%)' }} />
                <div className="relative z-10">
                  <div className={cn("flex items-center justify-center mb-4", isMobile ? "h-20" : "h-22")}>
                    <div className="w-full max-w-[200px] space-y-2">
                      {/* Result items appearing */}
                      {[t("howItWorks.step3.results.taskCompleted"), t("howItWorks.step3.results.leadsFound"), t("howItWorks.step3.results.addedToCrm")].map((text, i) => (
                        <div
                          key={text}
                          className="flex items-center gap-2 rounded-lg border border-foreground/[0.06] bg-foreground/[0.02] px-2.5 py-1.5"
                          style={{ animation: `lp-msg-appear 0.4s ease forwards ${0.5 + i * 0.4}s`, opacity: 0 }}
                        >
                          <div
                            className="h-3 w-3 rounded-full border border-foreground/20 flex items-center justify-center flex-shrink-0"
                            style={{ animation: `lp-check-pop 0.3s ease forwards ${0.8 + i * 0.4}s`, opacity: 0 }}
                          >
                            <Check className="size-2 text-foreground/40" />
                          </div>
                          <span className="text-[10px] text-foreground/40">{text}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-foreground/[0.06] text-[10px] font-bold text-foreground/50">3</span>
                    <p className={cn("font-semibold text-foreground", isMobile ? "text-base" : "text-lg")}>{t("howItWorks.step3.title")}</p>
                  </div>
                  <p className="text-sm text-muted-foreground/50 pl-7">{t("howItWorks.step3.description")}</p>
                </div>
              </motion.div>
            </div>
          </motion.div>
        </section>


        {/* Demo Section */}
        <section
          id="demo"
          className={cn(
            isMobile
              ? "py-16 px-7"
              : "sticky rounded-2xl border border-border/20 bg-background lp-card-glass lp-section-card px-8 lg:px-10 pt-10 pb-8 mb-6 will-change-[transform,opacity,filter] h-[calc(100vh-8rem)] overflow-hidden origin-top"
          )}
          style={!isMobile ? { top: '5.5rem', zIndex: 4 } : undefined}
        >
          <motion.div
            variants={containerVariants}
            initial="hidden"
            whileInView="visible"
            viewport={sectionViewport}
            className="max-w-5xl mx-auto"
          >
            <motion.div variants={itemVariants} className="text-center mb-8">
              <h2 className={cn(
                "font-bold tracking-tight",
                isMobile ? "text-3xl" : "text-3xl sm:text-4xl"
              )}>
                {t("demo.title")}
              </h2>
              <p className={cn(
                "text-muted-foreground mt-2 max-w-lg mx-auto",
                isMobile ? "text-sm" : "text-sm"
              )}>
                {t("demo.subtitle")}
              </p>
            </motion.div>

            <div className={cn(
              "grid gap-3",
              isMobile ? "grid-cols-1" : "grid-cols-2 lg:grid-cols-3"
            )}>
              {DEMO_SESSION_DATA.map((demo, demoIdx) => (
                <motion.div
                  key={demo.chatId}
                  initial={isMobile ? { opacity: 1, x: 0 } : { opacity: 0, x: demoIdx % 2 === 0 ? -30 : 30 }}
                  whileInView={isMobile ? { opacity: 1, x: 0 } : { opacity: 1, x: 0 }}
                  viewport={{ once: true, amount: 0.2 }}
                  transition={isMobile ? { duration: 0 } : { duration: 0.55, ease: [0.22, 1, 0.36, 1], delay: demoIdx * 0.05 }}
                  onMouseMove={!isMobile ? handleCardMouseMove : undefined}
                  onMouseLeave={!isMobile ? handleCardMouseLeave : undefined}
                  style={{ '--mouse-x': '50%', '--mouse-y': '50%' } as React.CSSProperties}
                >
                <Link
                  href={`/share/${demo.chatId}`}
                  target="_blank"
                  className="group relative block h-full"
                >
                  <div className={cn(
                    "relative h-full rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm overflow-hidden",
                    "transition-all duration-300",
                    "hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5",
                    "hover:-translate-y-0.5",
                    isMobile ? "p-5" : "p-4"
                  )}>
                    {/* Mouse-tracking gradient */}
                    <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" style={{ background: 'radial-gradient(400px circle at var(--mouse-x) var(--mouse-y), rgba(59, 130, 246, 0.07), transparent 40%)' }} />

                    <div className="relative h-full flex flex-col gap-2.5">
                      {/* Tag */}
                      <div className="flex items-center justify-between">
                        <span className="inline-flex items-center gap-1.5 text-[9px] font-medium uppercase tracking-widest text-muted-foreground/70">
                          <span className="h-1 w-1 rounded-full bg-emerald-500" />
                          {t(`demo.sessions.${demo.key}.tag`)}
                        </span>
                        <ArrowRight className="h-3 w-3 text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-0.5 transition-all duration-200" />
                      </div>

                      {/* Title */}
                      <h3 className={cn(
                        "font-semibold tracking-tight text-foreground group-hover:text-primary transition-colors duration-200 leading-snug",
                        isMobile ? "text-base" : "text-sm"
                      )}>
                        {t(`demo.sessions.${demo.key}.title`)}
                      </h3>

                      {/* Description */}
                      <p className={cn(
                        "text-muted-foreground leading-relaxed flex-1",
                        isMobile ? "text-sm" : "text-xs"
                      )}>
                        {t(`demo.sessions.${demo.key}.description`)}
                      </p>

                      {/* Footer */}
                      <div className="flex items-center gap-1.5 pt-1">
                        <Play className="h-2.5 w-2.5 text-muted-foreground/50" />
                        <span className="text-[11px] text-muted-foreground/50">{tc("watchSession")}</span>
                      </div>
                    </div>
                  </div>
                </Link>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </section>


        {/* Cost Comparison */}
        <section
          id="cost"
          className={cn(
            isMobile
              ? "py-16 px-7"
              : "sticky rounded-2xl border border-border/20 bg-background lp-card-glass lp-section-card px-8 lg:px-10 pt-10 pb-8 mb-6 will-change-[transform,opacity,filter] h-[calc(100vh-8rem)] overflow-hidden origin-top"
          )}
          style={!isMobile ? { top: '5.5rem', zIndex: 5 } : undefined}
        >
          <motion.div
            variants={containerVariants}
            initial="hidden"
            whileInView="visible"
            viewport={sectionViewport}
            className="max-w-5xl mx-auto"
          >
            <motion.div variants={itemVariants} className="text-center mb-8">
              <h2 className={cn(
                "font-bold tracking-tight",
                isMobile ? "text-3xl" : "text-3xl sm:text-4xl"
              )}>
                {t("comparison.title")}
              </h2>
              <p className={cn(
                "text-muted-foreground mt-2 max-w-lg mx-auto",
                isMobile ? "text-sm" : "text-sm"
              )}>
                {t("comparison.subtitle")}
              </p>
            </motion.div>

            <div className={cn(
              "grid",
              isMobile ? "grid-cols-1 gap-4" : "grid-cols-2 gap-5"
            )}>
              {/* Hiring column */}
              <motion.div
                initial={isMobile ? { opacity: 1, x: 0 } : { opacity: 0, x: -50 }}
                whileInView={isMobile ? { opacity: 1, x: 0 } : { opacity: 1, x: 0 }}
                viewport={{ once: true, amount: 0.2 }}
                transition={isMobile ? { duration: 0 } : { duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
                onMouseMove={!isMobile ? handleCardMouseMove : undefined}
                onMouseLeave={!isMobile ? handleCardMouseLeave : undefined}
                className="relative rounded-2xl border border-border/30 bg-card/20 overflow-hidden group"
                style={{ '--mouse-x': '50%', '--mouse-y': '50%' } as React.CSSProperties}
              >
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" style={{ background: 'radial-gradient(600px circle at var(--mouse-x) var(--mouse-y), rgba(59, 130, 246, 0.05), transparent 40%)' }} />
                  <div className={cn("border-b border-border/20", isMobile ? "px-5 pt-5 pb-4" : "px-8 pt-8 pb-6")}>
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted/50">
                        <Users className="h-5 w-5 text-muted-foreground/60" />
                      </div>
                      <div>
                        <h3 className={cn("font-semibold text-foreground", isMobile ? "text-sm" : "text-base")}>{t("comparison.manual.title")}</h3>
                        <p className="text-xs text-muted-foreground/50 mt-0.5">{t("comparison.manual.subtitle")}</p>
                      </div>
                    </div>
                  </div>
                  <div className={cn(isMobile ? "px-5 py-4" : "px-8 py-6")}>
                    {(["timePerTask", "availability", "setupTime", "errorRate", "scaling", "auditTrail"] as const).map((key) => {
                      const row = { label: t(`comparison.rows.${key}`), value: t(`comparison.manualValues.${key}`), negative: true }
                      return (
                      <div key={row.label} className={cn(
                        "flex items-center justify-between py-3",
                        "border-b border-border/10 last:border-0"
                      )}>
                        <span className={cn("text-muted-foreground/70", isMobile ? "text-xs" : "text-sm")}>{row.label}</span>
                        <div className="flex items-center gap-2">
                          <span className={cn("font-medium text-foreground/50", isMobile ? "text-xs" : "text-sm")}>{row.value}</span>
                          {row.negative && <X className="h-3.5 w-3.5 text-destructive/40" />}
                        </div>
                      </div>
                      )
                    })}
                  </div>
                </motion.div>

                {/* Coasty column */}
                <motion.div
                  initial={isMobile ? { opacity: 1, x: 0 } : { opacity: 0, x: 50 }}
                  whileInView={isMobile ? { opacity: 1, x: 0 } : { opacity: 1, x: 0 }}
                  viewport={{ once: true, amount: 0.2 }}
                  transition={isMobile ? { duration: 0 } : { duration: 0.65, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
                  onMouseMove={!isMobile ? handleCardMouseMove : undefined}
                  onMouseLeave={!isMobile ? handleCardMouseLeave : undefined}
                  className="relative rounded-2xl border border-primary/25 overflow-hidden shadow-lg shadow-primary/5 group"
                  style={{ '--mouse-x': '50%', '--mouse-y': '50%' } as React.CSSProperties}
                >
                  <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none z-10" style={{ background: 'radial-gradient(600px circle at var(--mouse-x) var(--mouse-y), rgba(59, 130, 246, 0.06), transparent 40%)' }} />
                  {/* Subtle gradient background */}
                  <div className="absolute inset-0 bg-gradient-to-b from-primary/[0.06] via-primary/[0.02] to-transparent" />
                  {/* Top accent line */}
                  <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent" />

                  <div className={cn("relative border-b border-primary/15", isMobile ? "px-5 pt-5 pb-4" : "px-8 pt-8 pb-6")}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 border border-primary/15">
                          {mounted && (
                            <Image
                              src={resolvedTheme === "dark" ? "/logo_light.svg" : "/logo_dark.svg"}
                              alt="Coasty"
                              width={22}
                              height={22}
                              className="h-[22px] w-[22px] object-contain"
                            />
                          )}
                        </div>
                        <div>
                          <h3 className={cn("font-semibold text-foreground", isMobile ? "text-sm" : "text-base")}>{t("comparison.coasty.title")}</h3>
                          <p className="text-xs text-muted-foreground/50 mt-0.5">{t("comparison.coasty.subtitle")}</p>
                        </div>
                      </div>
                      <span className="rounded-full bg-primary/10 border border-primary/20 px-2.5 py-1 text-[10px] font-semibold text-primary uppercase tracking-wider">{tc("recommended")}</span>
                    </div>
                  </div>
                  <div className={cn("relative", isMobile ? "px-5 py-4" : "px-8 py-6")}>
                    {(["timePerTask", "availability", "setupTime", "errorRate", "scaling", "auditTrail"] as const).map((key) => {
                      const row = { label: t(`comparison.rows.${key}`), value: t(`comparison.coastyValues.${key}`) }
                      return (
                      <div key={row.label} className={cn(
                        "flex items-center justify-between py-3",
                        "border-b border-primary/8 last:border-0"
                      )}>
                        <span className={cn("text-muted-foreground/70", isMobile ? "text-xs" : "text-sm")}>{row.label}</span>
                        <div className="flex items-center gap-2">
                          <span className={cn("font-semibold text-primary", isMobile ? "text-xs" : "text-sm")}>{row.value}</span>
                          <Check className="h-3.5 w-3.5 text-primary" />
                        </div>
                      </div>
                      )
                    })}
                  </div>
                </motion.div>
              </div>

            <motion.div variants={itemVariants} className="flex justify-center mt-12">
              <div className={cn(
                "inline-flex items-center gap-4 rounded-full border border-border/40 bg-muted/20 backdrop-blur-sm",
                isMobile ? "px-4 py-2.5" : "px-6 py-3"
              )}>
                <span className={cn("text-muted-foreground", isMobile ? "text-xs" : "text-sm")}>
                  {t("comparison.bottomBar.automateTasksThat")} <span className="font-bold text-foreground">{t("comparison.bottomBar.hoursManually")}</span>
                </span>
                <span className="h-4 w-px bg-border/50" />
                <span className={cn("text-muted-foreground", isMobile ? "text-xs" : "text-sm")}>
                  {t("comparison.bottomBar.startingAt")} <span className="font-bold text-primary">$0/mo</span>
                </span>
              </div>
            </motion.div>
          </motion.div>
        </section>


        {/* Features Section */}
        <section
          id="features"
          className={cn(
            isMobile
              ? "py-16 px-7"
              : "sticky rounded-2xl border border-border/20 bg-background lp-card-glass lp-section-card px-8 lg:px-10 pt-10 pb-8 mb-6 will-change-[transform,opacity,filter] h-[calc(100vh-8rem)] overflow-hidden origin-top"
          )}
          style={!isMobile ? { top: '5.5rem', zIndex: 6 } : undefined}
        >
          <motion.div
            variants={containerVariants}
            initial="hidden"
            whileInView="visible"
            viewport={sectionViewport}
            className="max-w-5xl mx-auto"
          >
            <motion.div variants={itemVariants} className="text-center mb-8">
              <h2 className={cn(
                "font-bold tracking-tight",
                isMobile ? "text-3xl" : "text-3xl sm:text-4xl"
              )}>
                {t("features.title")}
              </h2>
            </motion.div>

            <div className={cn(
              "grid gap-4",
              isMobile ? "grid-cols-1" : "grid-cols-2 lg:grid-cols-3"
            )}>
              {/* Self-Correcting — retry loop visual */}
              <motion.div
                variants={itemVariants}
                onMouseMove={!isMobile ? handleCardMouseMove : undefined}
                onMouseLeave={!isMobile ? handleCardMouseLeave : undefined}
                className="relative rounded-2xl border border-border/40 bg-card/30 p-5 hover:border-border/60 hover:shadow-lg hover:shadow-primary/[0.04] transition-all duration-500 overflow-hidden group"
                style={{ '--mouse-x': '50%', '--mouse-y': '50%' } as React.CSSProperties}
              >
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" style={{ background: 'radial-gradient(600px circle at var(--mouse-x) var(--mouse-y), rgba(59, 130, 246, 0.07), transparent 40%)' }} />
                <div className={cn("flex items-center justify-center mb-4", isMobile ? "h-14" : "h-16")}>
                  <div className="flex items-center gap-2">
                    <div className="rounded border border-foreground/10 bg-foreground/[0.03] px-2 py-1">
                      <span className="text-[9px] text-foreground/30 font-mono" style={{ animation: "lp-retry-loop 4s ease infinite" }}>click</span>
                    </div>
                    <span className="text-[9px] text-foreground/15">→</span>
                    <div className="rounded border border-foreground/10 bg-foreground/[0.03] px-2 py-1">
                      <span className="text-[9px] text-foreground/30 font-mono" style={{ animation: "lp-retry-loop 4s ease 1s infinite" }}>retry</span>
                    </div>
                    <span className="text-[9px] text-foreground/15">→</span>
                    <div
                      className="h-4 w-4 rounded-full border border-foreground/20 flex items-center justify-center"
                      style={{ animation: "lp-check-pop 0.5s ease forwards 2s", opacity: 0 }}
                    >
                      <Check className="size-2.5 text-foreground/40" />
                    </div>
                  </div>
                </div>
                <p className={cn("font-semibold text-foreground", isMobile ? "text-sm" : "text-base")}>{t("features.selfCorrecting.title")}</p>
                <p className="text-xs text-muted-foreground/50 mt-0.5">{t("features.selfCorrecting.description")}</p>
              </motion.div>

              {/* Audit Trail — screenshot stack visual */}
              <motion.div
                variants={itemVariants}
                onMouseMove={!isMobile ? handleCardMouseMove : undefined}
                onMouseLeave={!isMobile ? handleCardMouseLeave : undefined}
                className="relative rounded-2xl border border-border/40 bg-card/30 p-5 hover:border-border/60 hover:shadow-lg hover:shadow-primary/[0.04] transition-all duration-500 overflow-hidden group"
                style={{ '--mouse-x': '50%', '--mouse-y': '50%' } as React.CSSProperties}
              >
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" style={{ background: 'radial-gradient(600px circle at var(--mouse-x) var(--mouse-y), rgba(59, 130, 246, 0.07), transparent 40%)' }} />
                <div className={cn("flex items-center justify-center mb-4", isMobile ? "h-14" : "h-16")}>
                  <div className="relative w-[80px] h-[40px]">
                    {/* Stacked screenshots */}
                    {[0, 1, 2].map((i) => (
                      <div
                        key={i}
                        className="absolute rounded border border-foreground/10 bg-foreground/[0.03]"
                        style={{
                          width: 50, height: 30,
                          left: i * 12, top: i * 3,
                          animation: `lp-msg-appear 0.3s ease forwards ${0.3 + i * 0.2}s`,
                          opacity: 0,
                        }}
                      >
                        <div className="p-1 space-y-0.5">
                          <div className="h-[2px] w-[70%] bg-foreground/10" />
                          <div className="h-[2px] w-[50%] bg-foreground/10" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <p className={cn("font-semibold text-foreground", isMobile ? "text-sm" : "text-base")}>{t("features.auditTrail.title")}</p>
                <p className="text-xs text-muted-foreground/50 mt-0.5">{t("features.auditTrail.description")}</p>
              </motion.div>

              {/* Schedule — clock with ticks visual */}
              <motion.div
                variants={itemVariants}
                onMouseMove={!isMobile ? handleCardMouseMove : undefined}
                onMouseLeave={!isMobile ? handleCardMouseLeave : undefined}
                className="relative rounded-2xl border border-border/40 bg-card/30 p-5 hover:border-border/60 hover:shadow-lg hover:shadow-primary/[0.04] transition-all duration-500 overflow-hidden group"
                style={{ '--mouse-x': '50%', '--mouse-y': '50%' } as React.CSSProperties}
              >
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" style={{ background: 'radial-gradient(600px circle at var(--mouse-x) var(--mouse-y), rgba(59, 130, 246, 0.07), transparent 40%)' }} />
                <div className={cn("flex items-center justify-center mb-4", isMobile ? "h-14" : "h-16")}>
                  <div className="flex items-center gap-3">
                    <div className="relative w-10 h-10 rounded-full border border-foreground/15 flex items-center justify-center">
                      <div className="h-3 w-px bg-foreground/25 origin-bottom" style={{ animation: "lp-float 3s ease-in-out infinite" }} />
                      <div className="absolute h-2 w-px bg-foreground/15 origin-bottom rotate-90" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-1" style={{ animation: "lp-dot-pulse 2s ease infinite" }}>
                        <div className="h-1.5 w-1.5 rounded-full bg-foreground/20" />
                        <span className="text-[8px] text-foreground/30 font-mono">9:00 AM</span>
                      </div>
                      <div className="flex items-center gap-1" style={{ animation: "lp-dot-pulse 2s ease 0.5s infinite" }}>
                        <div className="h-1.5 w-1.5 rounded-full bg-foreground/20" />
                        <span className="text-[8px] text-foreground/30 font-mono">2:00 PM</span>
                      </div>
                      <div className="flex items-center gap-1" style={{ animation: "lp-dot-pulse 2s ease 1s infinite" }}>
                        <div className="h-1.5 w-1.5 rounded-full bg-foreground/20" />
                        <span className="text-[8px] text-foreground/30 font-mono">11:00 PM</span>
                      </div>
                    </div>
                  </div>
                </div>
                <p className={cn("font-semibold text-foreground", isMobile ? "text-sm" : "text-base")}>{t("features.schedule.title")}</p>
                <p className="text-xs text-muted-foreground/50 mt-0.5">{t("features.schedule.description")}</p>
              </motion.div>

              {/* Sandboxed — VM isolation visual */}
              <motion.div
                variants={itemVariants}
                onMouseMove={!isMobile ? handleCardMouseMove : undefined}
                onMouseLeave={!isMobile ? handleCardMouseLeave : undefined}
                className="relative rounded-2xl border border-border/40 bg-card/30 p-5 hover:border-border/60 hover:shadow-lg hover:shadow-primary/[0.04] transition-all duration-500 overflow-hidden group"
                style={{ '--mouse-x': '50%', '--mouse-y': '50%' } as React.CSSProperties}
              >
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" style={{ background: 'radial-gradient(600px circle at var(--mouse-x) var(--mouse-y), rgba(59, 130, 246, 0.07), transparent 40%)' }} />
                <div className={cn("flex items-center justify-center mb-4", isMobile ? "h-14" : "h-16")}>
                  <div className="flex items-center gap-2">
                    <div className="relative w-10 h-8 rounded border border-dashed border-foreground/15 flex items-center justify-center">
                      <Monitor className="size-3 text-foreground/20" />
                      <div className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 rounded-full border border-foreground/15 bg-background flex items-center justify-center">
                        <Shield className="size-2 text-foreground/30" />
                      </div>
                    </div>
                    <span className="text-[8px] text-foreground/15">×</span>
                    <div className="relative w-10 h-8 rounded border border-dashed border-foreground/15 flex items-center justify-center">
                      <Monitor className="size-3 text-foreground/20" />
                      <div className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 rounded-full border border-foreground/15 bg-background flex items-center justify-center">
                        <Shield className="size-2 text-foreground/30" />
                      </div>
                    </div>
                  </div>
                </div>
                <p className={cn("font-semibold text-foreground", isMobile ? "text-sm" : "text-base")}>{t("features.sandboxed.title")}</p>
                <p className="text-xs text-muted-foreground/50 mt-0.5">{t("features.sandboxed.description")}</p>
              </motion.div>

              {/* #1 Benchmark — bar chart visual */}
              <motion.div
                variants={itemVariants}
                onMouseMove={!isMobile ? handleCardMouseMove : undefined}
                onMouseLeave={!isMobile ? handleCardMouseLeave : undefined}
                className="relative rounded-2xl border border-border/40 bg-card/30 p-5 hover:border-border/60 hover:shadow-lg hover:shadow-primary/[0.04] transition-all duration-500 overflow-hidden group"
                style={{ '--mouse-x': '50%', '--mouse-y': '50%' } as React.CSSProperties}
              >
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" style={{ background: 'radial-gradient(600px circle at var(--mouse-x) var(--mouse-y), rgba(59, 130, 246, 0.07), transparent 40%)' }} />
                <div className={cn("flex items-center justify-center mb-4", isMobile ? "h-14" : "h-16")}>
                  <div className="w-[100px] space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <div className="h-2 rounded-full bg-foreground/20" style={{ animation: "lp-bar-grow 1.5s ease forwards", "--w": "100%" } as React.CSSProperties} />
                      <span className="text-[7px] text-foreground/40 font-bold whitespace-nowrap">82%</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="h-2 rounded-full bg-foreground/10" style={{ animation: "lp-bar-grow 1.5s ease forwards 0.2s", "--w": "72%" } as React.CSSProperties} />
                      <span className="text-[7px] text-foreground/25 whitespace-nowrap">73%</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="h-2 rounded-full bg-foreground/[0.07]" style={{ animation: "lp-bar-grow 1.5s ease forwards 0.4s", "--w": "60%" } as React.CSSProperties} />
                      <span className="text-[7px] text-foreground/25 whitespace-nowrap">62%</span>
                    </div>
                  </div>
                </div>
                <p className={cn("font-semibold text-foreground", isMobile ? "text-sm" : "text-base")}>{t("features.benchmark.title")}</p>
                <p className="text-xs text-muted-foreground/50 mt-0.5">{t("features.benchmark.description")}</p>
              </motion.div>

              {/* Swarms — parallel bars visual */}
              <motion.div
                variants={itemVariants}
                onMouseMove={!isMobile ? handleCardMouseMove : undefined}
                onMouseLeave={!isMobile ? handleCardMouseLeave : undefined}
                className="relative rounded-2xl border border-border/40 bg-card/30 p-5 hover:border-border/60 hover:shadow-lg hover:shadow-primary/[0.04] transition-all duration-500 overflow-hidden group"
                style={{ '--mouse-x': '50%', '--mouse-y': '50%' } as React.CSSProperties}
              >
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" style={{ background: 'radial-gradient(600px circle at var(--mouse-x) var(--mouse-y), rgba(59, 130, 246, 0.07), transparent 40%)' }} />
                <div className={cn("flex items-center justify-center mb-4", isMobile ? "h-14" : "h-16")}>
                  <div className="w-[100px] space-y-1.5">
                    {[
                      { label: "Agent 1", anim: "lp-swarm-stagger-1" },
                      { label: "Agent 2", anim: "lp-swarm-stagger-2" },
                      { label: "Agent 3", anim: "lp-swarm-stagger-3" },
                    ].map((a) => (
                      <div key={a.label} className="flex items-center gap-1.5">
                        <span className="text-[7px] text-foreground/25 w-[32px] text-right flex-shrink-0">{a.label}</span>
                        <div className="flex-1 h-2 rounded-full bg-foreground/[0.04] overflow-hidden">
                          <div
                            className="h-full rounded-full bg-foreground/15"
                            style={{ animation: `${a.anim} 3s ease-in-out infinite alternate` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <p className={cn("font-semibold text-foreground", isMobile ? "text-sm" : "text-base")}>{t("features.swarms.title")}</p>
                <p className="text-xs text-muted-foreground/50 mt-0.5">{t("features.swarms.description")}</p>
              </motion.div>
            </div>
          </motion.div>
        </section>


        {/* Pricing Section — simplified overview */}
        <section
          id="pricing"
          className={cn(
            isMobile
              ? "py-16 px-7"
              : "sticky rounded-2xl border border-border/20 bg-background lp-card-glass lp-section-card px-8 lg:px-10 pt-10 pb-8 mb-6 will-change-[transform,opacity,filter] h-[calc(100vh-8rem)] overflow-hidden origin-top"
          )}
          style={!isMobile ? { top: '5.5rem', zIndex: 7 } : undefined}
        >
          <motion.div
            variants={containerVariants}
            initial="hidden"
            whileInView="visible"
            viewport={sectionViewport}
            className="max-w-5xl mx-auto"
          >
            {/* Header */}
            <motion.div variants={itemVariants} className="text-center mb-8">
              <h2 className={cn(
                "font-bold tracking-tight",
                isMobile ? "text-3xl" : "text-3xl sm:text-4xl"
              )}>
                {t("pricing.title")}
              </h2>
              <p className={cn(
                "text-muted-foreground mt-2 max-w-lg mx-auto",
                isMobile ? "text-sm" : "text-sm"
              )}>
                {t("pricing.subtitle")}
              </p>
            </motion.div>

            {/* Plan cards — 5-col grid */}
            <div className={cn(
              "grid gap-3",
              isMobile ? "grid-cols-1" : "grid-cols-2 lg:grid-cols-5"
            )}>
              {PLAN_DATA.map((plan, planIdx) => (
                <motion.div
                  key={plan.key}
                  initial={isMobile ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
                  whileInView={isMobile ? { opacity: 1, y: 0 } : { opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.2 }}
                  transition={isMobile ? { duration: 0 } : { duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: planIdx * 0.07 }}
                  onMouseMove={!isMobile ? handleCardMouseMove : undefined}
                  onMouseLeave={!isMobile ? handleCardMouseLeave : undefined}
                  className={cn(
                    "relative rounded-xl border p-5 flex flex-col group",
                    plan.highlighted
                      ? "border-foreground/20 bg-foreground/[0.03]"
                      : "border-border/50 hover:border-border/70"
                  )}
                  style={{ '--mouse-x': '50%', '--mouse-y': '50%' } as React.CSSProperties}
                >
                  <div className="absolute inset-0 rounded-xl overflow-hidden opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" style={{ background: 'radial-gradient(400px circle at var(--mouse-x) var(--mouse-y), rgba(59, 130, 246, 0.07), transparent 40%)' }} />
                  {plan.highlighted && (
                    <span className="absolute -top-2.5 left-4 rounded-full bg-foreground text-background px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
                      {t(`pricing.plans.${plan.key}.badge`)}
                    </span>
                  )}

                  <div className="mb-4">
                    <h3 className="text-sm font-semibold text-foreground">{t(`pricing.plans.${plan.key}.name`)}</h3>
                    <div className="mt-2 flex items-baseline gap-1">
                      <span className="text-3xl font-bold tracking-tight">{plan.price}</span>
                      <span className="text-sm text-muted-foreground">/{tc("month")}</span>
                    </div>
                    <p className="mt-1.5 text-xs text-muted-foreground">{t(`pricing.plans.${plan.key}.description`)}</p>
                  </div>

                  {/* Key details */}
                  <div className="space-y-1.5 mb-4 flex-1">
                    {plan.credits > 0 && (
                      <p className="text-xs text-muted-foreground">{tc("creditsPerMonth", { count: plan.credits.toLocaleString() })}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {plan.machines === 0 ? t("pricing.vmTemporary") : plan.key === "lite" ? t("pricing.vmDeletedAfterInactivity") : plan.machines > 1 ? t("pricing.vmAlwaysOnPlural", { count: plan.machines }) : t("pricing.vmAlwaysOn", { count: plan.machines })}
                    </p>
                    {plan.swarm > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {tc("agentsInParallel", { count: plan.swarm })}
                      </p>
                    )}
                  </div>

                  <Button
                    className="w-full"
                    variant={plan.highlighted ? "default" : "outline"}
                    size="sm"
                    asChild
                  >
                    <Link href={plan.price === "$0" ? "/auth" : "/pricing"}>
                      {plan.price === "$0" ? tc("startFree") : t(`pricing.plans.${plan.key}.cta`)}
                      <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                    </Link>
                  </Button>
                </motion.div>
              ))}
            </div>

          </motion.div>
        </section>

          </div>{/* end RIGHT card stack */}
        </div>{/* end Guided Sections flex wrapper */}

        <SectionDivider />

        {/* FAQ Section */}
        <section id="faq" className={cn(
          "py-20",
          isMobile ? "px-7" : "px-10"
        )}>
          <motion.div
            variants={containerVariants}
            initial="hidden"
            whileInView="visible"
            viewport={sectionViewport}
            className="max-w-5xl mx-auto"
          >
            <motion.div variants={itemVariants} className="text-center mb-12">
              <h2 className={cn(
                "font-bold tracking-tight",
                isMobile ? "text-3xl" : "text-4xl sm:text-5xl"
              )}>
                {t("faq.title")}
              </h2>
              <p className={cn(
                "text-muted-foreground mt-4 max-w-lg mx-auto",
                isMobile ? "text-sm" : "text-base"
              )}>
                {t("faq.subtitle")}
              </p>
            </motion.div>
            
            <div className="space-y-4">
              {FAQ_KEYS.map((faqKey, index) => (
                <motion.div
                  key={index}
                  variants={itemVariants}
                  {...(!isMobile && { whileHover: { scale: 1.01 } })}
                  transition={{ duration: 0.2 }}
                >
                  <Card
                    className="cursor-pointer border-muted/50 hover:border-primary/50 transition-all"
                    onClick={() => setSelectedFaq(selectedFaq === index ? null : index)}
                  >
                    <CardHeader>
                      <div className="flex justify-between items-center">
                        <CardTitle className={cn("pr-4", isMobile ? "text-base" : "text-lg")}>
                          {t(`faq.items.${faqKey}.question`)}
                        </CardTitle>
                        <motion.div
                          animate={{ rotate: selectedFaq === index ? 90 : 0 }}
                          transition={{ duration: 0.2 }}
                        >
                          <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
                        </motion.div>
                      </div>
                      <AnimatePresence>
                        {selectedFaq === index && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.3 }}
                          >
                            <CardDescription className="mt-4 text-base">
                              {t(`faq.items.${faqKey}.answer`)}
                            </CardDescription>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </CardHeader>
                  </Card>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </section>

        <SectionDivider />

        {/* Footer */}
        <LandingFooter />
      </main>
      </div>
    </>
  )
}
