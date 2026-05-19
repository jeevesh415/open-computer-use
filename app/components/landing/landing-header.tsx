"use client"

import Link from "next/link"
import {
  Menu, X, ArrowRight, ChevronDown, ChevronRight, Search, Bug, TrendingUp,
  FileText, Mail, ShoppingCart, Users, BarChart3, Globe, Eye,
  Send, MonitorSmartphone, Monitor, Keyboard, GitCompare,
  BookOpen, Newspaper, Compass, Download, Layers,
} from "lucide-react"
import Image from "next/image"
import { useState, useEffect, useCallback, useRef } from "react"
import { cn } from "@/lib/utils"
import { motion, AnimatePresence } from "framer-motion"
import { useTheme } from "next-themes"
import { useTranslations } from "next-intl"
import { LanguageSwitcherCompact } from "@/components/language-switcher"
import { DEVELOPERS_API_ENABLED } from "@/lib/feature-flags"

/* ─── data ─── */

const useCaseDropdownDef = [
  { slug: "competitor-intel", labelKey: "competitorIntel", icon: Search, stat: "5", statKey: "competitorIntel" },
  { slug: "qa-bug-reports", labelKey: "qaBugReports", icon: Bug, stat: "30+", statKey: "qaBugReports" },
  { slug: "seo-gap-analysis", labelKey: "seoGapAnalysis", icon: TrendingUp, stat: "150+", statKey: "seoGapAnalysis" },
  { slug: "data-extraction", labelKey: "dataExtraction", icon: FileText, stat: "1,000+", statKey: "dataExtraction" },
  { slug: "lead-generation", labelKey: "leadGeneration", icon: Users, stat: "50", statKey: "leadGeneration" },
  { slug: "site-audit", labelKey: "siteAudit", icon: BarChart3, stat: "200+", statKey: "siteAudit" },
  { slug: "ad-intelligence", labelKey: "adIntelligence", icon: Eye, stat: "25+", statKey: "adIntelligence" },
  { slug: "email-outreach", labelKey: "emailOutreach", icon: Send, stat: "50", statKey: "emailOutreach" },
  { slug: "design-review", labelKey: "designReview", icon: MonitorSmartphone, stat: "12", statKey: "designReview" },
  { slug: "price-monitoring", labelKey: "priceMonitoring", icon: ShoppingCart, stat: "200+", statKey: "priceMonitoring" },
  { slug: "market-research", labelKey: "marketResearch", icon: Globe, stat: "40+", statKey: "marketResearch" },
  { slug: "email-campaigns", labelKey: "emailCampaigns", icon: Mail, stat: "100", statKey: "emailCampaigns" },
]

const productDropdownDef = [
  { href: "/computer-use", labelKey: "computerUse", icon: Monitor, stat: "82%", statKey: "computerUse" },
  { href: "/agent-swarms", labelKey: "agentSwarms", icon: Layers, stat: "9", statKey: "agentSwarms" },
  { href: "/compare", labelKey: "compare", icon: GitCompare, stat: "10", statKey: "compare" },
]

const blogDropdownDef = [
  { href: "/blog", labelKey: "allPosts", icon: Newspaper, stat: "50+", statKey: "allPosts" },
  { href: "/guide", labelKey: "guide", icon: BookOpen, stat: "12", statKey: "guide" },
  { href: "/results", labelKey: "demosResults", icon: Eye, stat: "20+", statKey: "demosResults" },
  { href: "/discover", labelKey: "discover", icon: Compass, stat: "1k+", statKey: "discover" },
]

const navItemsDef = [
  { href: "/pricing", labelKey: "pricing", label: "Pricing", external: true },
  ...(DEVELOPERS_API_ENABLED
    ? [{ href: "/api-docs", labelKey: "api", label: "API", external: true }]
    : []),
]

/* ─── spring configs ─── */

const smoothSpring = { type: "spring" as const, stiffness: 400, damping: 30 }

/* ─── dropdown item ─── */

function DropdownItem({
  href,
  icon: Icon,
  label,
  isHovered,
  onHover,
  onClick,
}: {
  href: string
  icon: React.ComponentType<any>
  label: string
  isHovered: boolean
  onHover: () => void
  onClick: () => void
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      onMouseEnter={onHover}
      className="group relative flex items-center gap-2.5 px-2.5 py-2 rounded-[10px] transition-all duration-150"
    >
      {/* hover bg */}
      {isHovered && (
        <motion.span
          layoutId="dropdown-highlight"
          className="absolute inset-0 rounded-[10px] bg-foreground/[0.05] dark:bg-foreground/[0.07]"
          transition={{ type: "spring", stiffness: 500, damping: 35 }}
        />
      )}
      <span className={cn(
        "relative flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-all duration-150",
        isHovered
          ? "bg-foreground/[0.08] dark:bg-foreground/[0.1]"
          : "bg-foreground/[0.03] dark:bg-foreground/[0.04]"
      )}>
        <Icon className={cn(
          "size-3.5 transition-colors duration-150",
          isHovered ? "text-foreground/80" : "text-muted-foreground/40"
        )} strokeWidth={1.8} />
      </span>
      <span className={cn(
        "relative text-[12.5px] font-medium transition-colors duration-150 truncate",
        isHovered ? "text-foreground" : "text-muted-foreground/55"
      )}>
        {label}
      </span>
    </Link>
  )
}

/* ─── dropdown panel ─── */

function DropdownPanel({
  items,
  hoveredIndex,
  setHoveredIndex,
  onClose,
  width,
  labelPrefix,
  statPrefix,
  footerHref,
  footerLabel,
  compact,
  t,
}: {
  items: typeof useCaseDropdownDef | typeof blogDropdownDef | typeof productDropdownDef
  hoveredIndex: number
  setHoveredIndex: (i: number) => void
  onClose: () => void
  width: string
  labelPrefix: string
  statPrefix: string
  footerHref?: string
  footerLabel?: string
  compact?: boolean
  t: ReturnType<typeof useTranslations>
}) {
  const hItem = items[hoveredIndex]
  const HIcon = hItem.icon

  return (
    <motion.div
      initial={{ opacity: 0, y: 6, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 4, scale: 0.98 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        "absolute top-full left-1/2 -translate-x-1/2 mt-3",
        width,
      )}
    >
      {/* connector bridge — prevents hover gap */}
      <div className="absolute -top-3 left-0 right-0 h-3" />

      <div className={cn(
        "relative rounded-2xl overflow-hidden",
        /* outer glow */
        "shadow-[0_0_0_1px_rgba(0,0,0,0.04),0_4px_16px_rgba(0,0,0,0.06),0_12px_40px_rgba(0,0,0,0.04)]",
        "dark:shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_4px_16px_rgba(0,0,0,0.3),0_12px_40px_rgba(0,0,0,0.2)]",
      )}>
        {/* glass bg */}
        <div className="absolute inset-0 bg-white/80 dark:bg-neutral-950/80 backdrop-blur-2xl backdrop-saturate-150" />
        {/* subtle top highlight */}
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/[0.08] to-transparent" />

        <div className="relative p-2">
          <div className="flex gap-2">
            {/* items grid */}
            <div className="flex-1 min-w-0">
              <div className={cn("grid gap-0.5", compact ? "grid-cols-1" : "grid-cols-2")}>
                {items.map((item, i) => {
                  const slug = "slug" in item ? item.slug : undefined
                  const href = "href" in item ? (item as { href: string }).href : `/use-cases/${slug}`
                  return (
                    <DropdownItem
                      key={href}
                      href={href}
                      icon={item.icon}
                      label={t(`${labelPrefix}.${item.labelKey}`)}
                      isHovered={hoveredIndex === i}
                      onHover={() => setHoveredIndex(i)}
                      onClick={onClose}
                    />
                  )
                })}
              </div>

              {/* footer link */}
              {footerHref && footerLabel && (
                <div className="mt-1.5 pt-1.5 border-t border-foreground/[0.05] dark:border-foreground/[0.06]">
                  <Link
                    href={footerHref}
                    onClick={onClose}
                    className="group flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl hover:bg-foreground/[0.04] transition-all duration-150"
                  >
                    <span className="text-[11.5px] font-medium text-muted-foreground/40 group-hover:text-foreground/70 transition-colors">
                      {footerLabel}
                    </span>
                    <ArrowRight className="h-2.5 w-2.5 text-muted-foreground/30 group-hover:text-foreground/60 group-hover:translate-x-0.5 transition-all duration-150" />
                  </Link>
                </div>
              )}
            </div>

            {/* preview panel */}
            {!compact && (
              <div className="w-[150px] shrink-0 rounded-xl bg-gradient-to-br from-foreground/[0.025] to-foreground/[0.05] dark:from-foreground/[0.04] dark:to-foreground/[0.06] flex flex-col items-center justify-center relative overflow-hidden">
                {/* watermark icon */}
                <HIcon
                  className="absolute -right-3 -bottom-3 size-24 text-foreground/[0.04] dark:text-foreground/[0.05]"
                  strokeWidth={0.7}
                />
                <AnimatePresence mode="wait">
                  <motion.div
                    key={hoveredIndex}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.14, ease: "easeOut" }}
                    className="relative text-center px-3"
                  >
                    <span className="text-[28px] font-bold tracking-tight text-foreground/80">
                      {hItem.stat}
                    </span>
                    <p className="text-[10px] font-medium text-muted-foreground/40 mt-0.5 leading-tight">
                      {t(`${statPrefix}.${hItem.statKey}`, { stat: hItem.stat })}
                    </p>
                  </motion.div>
                </AnimatePresence>
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  )
}

/* ─── drawer helpers ─── */

// Path-active matcher used by the mobile drawer rows. Exact match for "/"
// (otherwise it'd light up for every page); for everything else, treat any
// nested route as active too so e.g. /use-cases/competitor-intel highlights
// the "Use Cases" row in the drawer.
function isPathActive(href: string, currentPath: string): boolean {
  if (href === "/") return currentPath === "/" || currentPath === ""
  return currentPath === href || currentPath.startsWith(href + "/")
}

// A single row in the mobile drawer — typography-first, hairline-quiet.
// The fixed-position chevron prevents layout shift on hover (a chevron
// that grows into existence is more nervous than one that just changes
// alpha). `delay` lets the parent stagger the rows in as the drawer
// settles, so the eye is led down the list rather than smacked with all
// 10 items at once.
function DrawerRow({
  href,
  label,
  onClick,
  active,
  delay = 0,
}: {
  href: string
  label: string
  onClick: () => void
  active?: boolean
  delay?: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 14 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay, duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
    >
      <Link
        href={href}
        onClick={onClick}
        className={cn(
          "group flex items-center justify-between px-3 py-3 rounded-lg transition-colors duration-150",
          active
            ? "bg-foreground/[0.05] text-foreground"
            : "text-foreground/75 hover:text-foreground hover:bg-foreground/[0.03] active:bg-foreground/[0.06]",
        )}
      >
        <span className="text-[15px] font-medium tracking-[-0.01em]">
          {label}
        </span>
        <ChevronRight
          className={cn(
            "h-4 w-4 transition-colors duration-150",
            active
              ? "text-foreground/40"
              : "text-foreground/15 group-hover:text-foreground/35",
          )}
          strokeWidth={1.8}
        />
      </Link>
    </motion.div>
  )
}

// Tiny uppercase label used to delineate sections in the drawer. Quiet
// enough that the eye scans past it as scaffolding, loud enough that the
// section break is unambiguous.
function DrawerSectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pt-2 pb-1.5">
      <span className="text-[10px] font-semibold tracking-[0.16em] uppercase text-foreground/30">
        {children}
      </span>
    </div>
  )
}

/* ─── main component ─── */

export function LandingHeader({
  animateBrandFromIntro = false,
}: {
  animateBrandFromIntro?: boolean
}) {
  const [scrolled, setScrolled] = useState(false)
  const [activeSection, setActiveSection] = useState("hero")
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [useCasesOpen, setUseCasesOpen] = useState(false)
  const [hoveredUseCase, setHoveredUseCase] = useState(0)
  const [productsOpen, setProductsOpen] = useState(false)
  const [hoveredProduct, setHoveredProduct] = useState(0)
  const productsDropdownTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [blogOpen, setBlogOpen] = useState(false)
  const [hoveredBlogItem, setHoveredBlogItem] = useState(0)
  const blogDropdownTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dropdownTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [currentPath, setCurrentPath] = useState("")
  const t = useTranslations("header")

  useEffect(() => {
    setMounted(true)
    setCurrentPath(window.location.pathname)
  }, [])

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth >= 1024) setMobileMenuOpen(false)
    }
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  useEffect(() => {
    document.body.style.overflow = mobileMenuOpen ? "hidden" : ""
    return () => { document.body.style.overflow = "" }
  }, [mobileMenuOpen])

  const closeMobileMenu = useCallback(() => setMobileMenuOpen(false), [])

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 10)

      if (currentPath === "/" || currentPath === "") {
        const sections = navItemsDef
          .filter((item) => !item.external)
          .map((item) => item.href.substring(2))
        const scrollPosition = window.scrollY + 100

        for (let i = sections.length - 1; i >= 0; i--) {
          const section = document.getElementById(sections[i])
          if (section && section.offsetTop <= scrollPosition) {
            setActiveSection(sections[i])
            break
          }
        }
      }
    }
    window.addEventListener("scroll", handleScroll)
    return () => window.removeEventListener("scroll", handleScroll)
  }, [currentPath])

  const handleNavClick = (
    e: React.MouseEvent<HTMLAnchorElement>,
    href: string,
    external?: boolean,
  ) => {
    if (external) {
      setMobileMenuOpen(false)
      return
    }
    if (currentPath !== "/" && currentPath !== "") {
      setMobileMenuOpen(false)
      return
    }
    e.preventDefault()
    const targetId = href.substring(2)
    const el = document.getElementById(targetId)
    if (el) {
      const offset = 80
      window.scrollTo({
        top: el.getBoundingClientRect().top + window.pageYOffset - offset,
        behavior: "smooth",
      })
    }
    setMobileMenuOpen(false)
  }

  /* helpers */
  const isUseCaseActive = currentPath.startsWith("/use-cases")
  const isProductActive =
    currentPath.startsWith("/computer-use") ||
    currentPath.startsWith("/agent-swarms") ||
    currentPath.startsWith("/compare")
  const isBlogActive =
    currentPath.startsWith("/blog") ||
    currentPath.startsWith("/results") ||
    currentPath.startsWith("/guide")

  return (
    <>
      {/* ━━━ header ━━━ */}
      <motion.header
        initial={{ y: -100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        // `top` reads the `--top-banner-h` custom property set by the
        // optional TopAnnouncementBanner. Defaults to 0 when the banner is
        // absent or dismissed, so the header sits flush with the viewport
        // edge as before.
        style={{ top: "var(--top-banner-h, 0px)" }}
        className={cn(
          "fixed left-0 right-0 z-50 transition-[top,padding] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
          scrolled ? "py-2" : "py-2.5 sm:py-3.5",
        )}
      >
        <div className="mx-auto max-w-7xl px-7 sm:px-10 lg:px-12">
          <div
            className={cn(
              "relative mx-auto transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
              scrolled ? "max-w-5xl" : "",
            )}
          >
            {/* ── Chrome layers ─────────────────────────────────────────
                Premium pill: a tinted glass body, a subtle ring, an inner
                top sheen, a top highlight hairline, and a bottom hairline.
                Each layer is a separate sibling so opacities and shadows
                can interpolate independently between rest and scrolled. */}

            {/* Glass body — split treatment between mobile and desktop so the
                navbar is *guaranteed* visible on both.
                  • Mobile (< 640px): solid-ish backgrounds — `bg-white/75`
                    light, `dark:bg-neutral-900/75` dark. iOS Safari's
                    backdrop-filter is flaky and the static cursor murmuration
                    behind the bar shines straight through low-alpha tints.
                    Solid colors guarantee separation regardless of GPU
                    composition. neutral-900 in dark mode is a notch lighter
                    than the near-black page bg, so the pill reads as a card
                    above the page rather than a hole in it. backdrop-blur
                    is also dropped on mobile — it's a perf cost (the
                    murmuration animates behind the bar) and pointless once
                    the body is mostly opaque.
                  • Desktop (sm+): the original premium glass treatment —
                    `bg-foreground/[0.025–0.05]` with `backdrop-blur-xl`. The
                    foreground-derived alpha auto-flips per mode. */}
            <div
              className={cn(
                "absolute inset-0 rounded-2xl pointer-events-none",
                "sm:backdrop-blur-xl sm:backdrop-saturate-150",
                "transition-[background-color] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
                scrolled
                  ? "bg-white/90 dark:bg-neutral-900/85 sm:bg-foreground/[0.04] sm:dark:bg-foreground/[0.05]"
                  : "bg-white/75 dark:bg-neutral-900/75 sm:bg-foreground/[0.025] sm:dark:bg-foreground/[0.03]",
              )}
            />
            {/* Inner top sheen — a soft 1/2-height gradient that fades
                downward, gives the glass a "lit from above" quality.
                Held inside a clipping wrapper so its box can't bleed past
                the rounded corners. */}
            <div className="absolute inset-0 rounded-2xl overflow-hidden pointer-events-none">
              <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/[0.06] dark:from-white/[0.04] to-transparent" />
            </div>
            {/* Ring — single hairline border that intensifies on scroll.
                Foreground-based so it adapts to both modes by definition.
                Mobile gets a noticeably stronger ring to define the pill
                edges crisply against the busy hero backdrop. */}
            <div
              className={cn(
                "absolute inset-0 rounded-2xl pointer-events-none",
                "transition-[box-shadow] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
                scrolled
                  ? "ring-1 ring-foreground/[0.18] dark:ring-foreground/[0.20] sm:ring-foreground/[0.08] sm:dark:ring-foreground/[0.10]"
                  : "ring-1 ring-foreground/[0.12] dark:ring-foreground/[0.14] sm:ring-foreground/[0.04] sm:dark:ring-foreground/[0.06]",
              )}
            />
            {/* Top edge highlight — a 1px gradient line painted on top of
                the ring, simulating a lit upper edge. Brighter in light
                mode (white sheen) and present-but-restrained in dark. */}
            <div className="absolute inset-x-0 top-0 h-px rounded-t-2xl pointer-events-none bg-gradient-to-r from-transparent via-white/70 dark:via-white/[0.18] to-transparent" />
            {/* Bottom hairline — a thin foreground-tinted line that sets
                the lower edge of the pill, completing the architectural
                "two horizontal rails + glass body" look. */}
            <div
              className={cn(
                "absolute inset-x-0 bottom-0 h-px rounded-b-2xl pointer-events-none bg-gradient-to-r from-transparent to-transparent",
                "transition-[--tw-gradient-via-color] duration-500",
                scrolled
                  ? "via-foreground/[0.10] dark:via-foreground/[0.08]"
                  : "via-foreground/[0.05] dark:via-foreground/[0.04]",
              )}
            />
            {/* Outer drop shadow — only on scroll. Layered with three offsets
                (close + medium + far) so the shadow feels like depth, not
                a single soft blob. Dark mode uses pure black at higher alpha
                because the surrounding bg is dark and lower alpha would
                disappear. */}
            <div
              aria-hidden
              className={cn(
                "absolute inset-0 rounded-2xl pointer-events-none -z-10",
                "transition-[box-shadow,opacity] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
                scrolled
                  ? "opacity-100 shadow-[0_1px_3px_rgba(0,0,0,0.05),0_8px_20px_-6px_rgba(0,0,0,0.07),0_24px_48px_-16px_rgba(0,0,0,0.10)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.5),0_8px_20px_-6px_rgba(0,0,0,0.55),0_24px_48px_-16px_rgba(0,0,0,0.6)]"
                  : "opacity-0",
              )}
            />

            {/* nav content */}
            <nav
              className={cn(
                "relative flex items-center justify-between transition-all duration-500 gap-2 lg:gap-3",
                scrolled ? "px-4 py-2 sm:px-5" : "px-4 py-2.5 sm:px-6 sm:py-3",
              )}
            >
              {/* ── logo ── */}
              <Link href="/" className="flex items-center gap-2.5 group flex-shrink-0">
                <motion.div
                  layoutId={animateBrandFromIntro ? "landing-brand-logo" : undefined}
                  whileTap={{ scale: 0.96 }}
                  transition={{ duration: 0.15 }}
                  className={cn(
                    "relative transition-all duration-500 flex-shrink-0 group-hover:scale-[1.04]",
                    scrolled ? "h-7 w-7 sm:h-8 sm:w-8" : "h-8 w-8 sm:h-9 sm:w-9",
                  )}
                >
                  {mounted && (
                    <Image
                      src={resolvedTheme === "dark" ? "/logo_light.svg" : "/logo_dark.svg"}
                      alt="Coasty Logo"
                      width={36}
                      height={36}
                      className="w-full h-full object-contain"
                      priority
                    />
                  )}
                </motion.div>
                <motion.span
                  layoutId={animateBrandFromIntro ? "landing-brand-text" : undefined}
                  className={cn(
                    "font-semibold text-foreground transition-all duration-500 whitespace-nowrap tracking-[-0.02em]",
                    scrolled ? "text-[15px] sm:text-base" : "text-base sm:text-lg",
                  )}
                >
                  Coasty
                </motion.span>
              </Link>

              {/* ── desktop nav ── */}
              <ul className="hidden lg:flex items-center gap-0.5 relative flex-1 justify-center">
                {/* Use Cases dropdown */}
                <li
                  className="relative"
                  onMouseEnter={() => {
                    if (dropdownTimeoutRef.current) clearTimeout(dropdownTimeoutRef.current)
                    setUseCasesOpen(true)
                  }}
                  onMouseLeave={() => {
                    dropdownTimeoutRef.current = setTimeout(() => setUseCasesOpen(false), 200)
                  }}
                >
                  <Link
                    href="/use-cases"
                    className={cn(
                      "relative flex items-center gap-1 whitespace-nowrap px-3 py-1.5",
                      "text-[13px] font-medium tracking-[-0.01em] rounded-lg transition-all duration-200",
                      isUseCaseActive
                        ? "text-foreground"
                        : "text-foreground/45 hover:text-foreground/80",
                    )}
                  >
                    {t("useCases")}
                    <ChevronDown className={cn(
                      "h-3 w-3 opacity-50 transition-transform duration-200",
                      useCasesOpen && "rotate-180",
                    )} />
                    {isUseCaseActive && (
                      <motion.span
                        layoutId="nav-active-indicator"
                        className="absolute inset-0 rounded-lg bg-foreground/[0.06] dark:bg-foreground/[0.08]"
                        transition={smoothSpring}
                      />
                    )}
                  </Link>

                  <AnimatePresence>
                    {useCasesOpen && (
                      <DropdownPanel
                        items={useCaseDropdownDef}
                        hoveredIndex={hoveredUseCase}
                        setHoveredIndex={setHoveredUseCase}
                        onClose={() => setUseCasesOpen(false)}
                        width="w-[600px]"
                        labelPrefix="useCaseItems"
                        statPrefix="useCaseStats"
                        footerHref="/use-cases"
                        footerLabel="View all use cases"
                        t={t}
                      />
                    )}
                  </AnimatePresence>
                </li>

                {/* Products dropdown */}
                <li
                  className="relative"
                  onMouseEnter={() => {
                    if (productsDropdownTimeoutRef.current) clearTimeout(productsDropdownTimeoutRef.current)
                    setProductsOpen(true)
                  }}
                  onMouseLeave={() => {
                    productsDropdownTimeoutRef.current = setTimeout(() => setProductsOpen(false), 200)
                  }}
                >
                  <button
                    className={cn(
                      "relative flex items-center gap-1 whitespace-nowrap px-3 py-1.5",
                      "text-[13px] font-medium tracking-[-0.01em] rounded-lg transition-all duration-200",
                      isProductActive
                        ? "text-foreground"
                        : "text-foreground/45 hover:text-foreground/80",
                    )}
                  >
                    {t("products")}
                    <ChevronDown className={cn(
                      "h-3 w-3 opacity-50 transition-transform duration-200",
                      productsOpen && "rotate-180",
                    )} />
                    {isProductActive && (
                      <motion.span
                        layoutId="nav-active-indicator"
                        className="absolute inset-0 rounded-lg bg-foreground/[0.06] dark:bg-foreground/[0.08]"
                        transition={smoothSpring}
                      />
                    )}
                  </button>

                  <AnimatePresence>
                    {productsOpen && (
                      <DropdownPanel
                        items={productDropdownDef}
                        hoveredIndex={hoveredProduct}
                        setHoveredIndex={setHoveredProduct}
                        onClose={() => setProductsOpen(false)}
                        width="w-[260px]"
                        compact
                        labelPrefix="productItems"
                        statPrefix="productStats"
                        t={t}
                      />
                    )}
                  </AnimatePresence>
                </li>

                {/* regular nav items */}
                {navItemsDef.map((item) => {
                  const isActive = item.external
                    ? currentPath === item.href
                    : (currentPath === "/" || currentPath === "") &&
                      activeSection === item.href.substring(2)

                  const cls = cn(
                    "relative block whitespace-nowrap px-3 py-1.5",
                    "text-[13px] font-medium tracking-[-0.01em] rounded-lg transition-all duration-200",
                    isActive
                      ? "text-foreground"
                      : "text-foreground/45 hover:text-foreground/80",
                  )

                  return (
                    <li key={item.labelKey} className="relative">
                      {item.external ? (
                        <Link href={item.href} className={cls}>
                          {item.label}
                          {isActive && (
                            <motion.span
                              layoutId="nav-active-indicator"
                              className="absolute inset-0 rounded-lg bg-foreground/[0.06] dark:bg-foreground/[0.08]"
                              transition={smoothSpring}
                            />
                          )}
                        </Link>
                      ) : (
                        <a
                          href={item.href}
                          onClick={(e) => handleNavClick(e, item.href, item.external)}
                          className={cls}
                        >
                          {item.label}
                          {isActive && (
                            <motion.span
                              layoutId="nav-active-indicator"
                              className="absolute inset-0 rounded-lg bg-foreground/[0.06] dark:bg-foreground/[0.08]"
                              transition={smoothSpring}
                            />
                          )}
                        </a>
                      )}
                    </li>
                  )
                })}

                {/* Blog dropdown */}
                <li
                  className="relative"
                  onMouseEnter={() => {
                    if (blogDropdownTimeoutRef.current) clearTimeout(blogDropdownTimeoutRef.current)
                    setBlogOpen(true)
                  }}
                  onMouseLeave={() => {
                    blogDropdownTimeoutRef.current = setTimeout(() => setBlogOpen(false), 200)
                  }}
                >
                  <Link
                    href="/blog"
                    className={cn(
                      "relative flex items-center gap-1 whitespace-nowrap px-3 py-1.5",
                      "text-[13px] font-medium tracking-[-0.01em] rounded-lg transition-all duration-200",
                      isBlogActive
                        ? "text-foreground"
                        : "text-foreground/45 hover:text-foreground/80",
                    )}
                  >
                    {t("blog")}
                    <ChevronDown className={cn(
                      "h-3 w-3 opacity-50 transition-transform duration-200",
                      blogOpen && "rotate-180",
                    )} />
                    {isBlogActive && (
                      <motion.span
                        layoutId="nav-active-indicator"
                        className="absolute inset-0 rounded-lg bg-foreground/[0.06] dark:bg-foreground/[0.08]"
                        transition={smoothSpring}
                      />
                    )}
                  </Link>

                  <AnimatePresence>
                    {blogOpen && (
                      <DropdownPanel
                        items={blogDropdownDef}
                        hoveredIndex={hoveredBlogItem}
                        setHoveredIndex={setHoveredBlogItem}
                        onClose={() => setBlogOpen(false)}
                        width="w-[540px]"
                        labelPrefix="blogItems"
                        statPrefix="blogStats"
                        footerHref="/blog"
                        footerLabel="View all posts"
                        t={t}
                      />
                    )}
                  </AnimatePresence>
                </li>
              </ul>

              {/* ── desktop right ── */}
              <div className="hidden lg:flex items-center gap-0.5 flex-shrink-0">
                <Link
                  href="/download"
                  className={cn(
                    "inline-flex items-center justify-center rounded-lg transition-all duration-200 text-foreground/40 hover:text-foreground/70 hover:bg-foreground/[0.05]",
                    scrolled ? "h-7 w-7 p-1.5" : "h-9 w-9 p-2",
                  )}
                  title="Download Desktop App"
                >
                  <Download className={cn(scrolled ? "h-3.5 w-3.5" : "h-4 w-4")} strokeWidth={1.8} />
                </Link>
                <LanguageSwitcherCompact />
                <div className="w-px h-4 bg-foreground/[0.08] mx-0.5" />
                <Link
                  href="/auth"
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-xl font-medium transition-all duration-200 whitespace-nowrap",
                    "text-[13px] tracking-[-0.01em]",
                    "bg-foreground text-background",
                    "hover:opacity-90 active:scale-[0.97]",
                    "shadow-[0_1px_2px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.1)]",
                    "dark:shadow-[0_1px_2px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.06)]",
                    scrolled ? "px-3 py-1" : "px-4 py-2",
                  )}
                >
                  {t("getStarted")}
                  <ArrowRight className="h-3 w-3" />
                </Link>
              </div>

              {/* ── mobile controls ── */}
              <div className="flex items-center gap-1 lg:hidden">
                <LanguageSwitcherCompact />
                <button
                  className={cn(
                    "inline-flex items-center justify-center rounded-lg h-9 w-9 transition-all duration-200",
                    "text-foreground/50 hover:text-foreground hover:bg-foreground/[0.05] active:bg-foreground/[0.08]",
                  )}
                  onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                >
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.span
                      key={mobileMenuOpen ? "close" : "open"}
                      initial={{ opacity: 0, rotate: -90, scale: 0.8 }}
                      animate={{ opacity: 1, rotate: 0, scale: 1 }}
                      exit={{ opacity: 0, rotate: 90, scale: 0.8 }}
                      transition={{ duration: 0.15 }}
                    >
                      {mobileMenuOpen ? (
                        <X className="h-[18px] w-[18px]" strokeWidth={1.5} />
                      ) : (
                        <Menu className="h-[18px] w-[18px]" strokeWidth={1.5} />
                      )}
                    </motion.span>
                  </AnimatePresence>
                </button>
              </div>
            </nav>
          </div>
        </div>
      </motion.header>

      {/* ━━━ mobile drawer ━━━
          Modal side sheet pulled in from the right. Sits ABOVE the page
          header (z-[60] vs z-50) so the drawer reads as its own page,
          not as a panel hanging off the nav — the page header behind it
          would otherwise show through and create a duplicated logo.
          Structure: fixed-height header, scrollable nav body sectioned
          into Product / Resources, pinned-bottom CTA. No accordions —
          each item is a single tap; deeper exploration happens on the
          destination page (e.g. /use-cases lays out all 12 use cases
          with breathing room a 320px-wide drawer could never afford). */}
      <AnimatePresence>
        {mobileMenuOpen && (() => {
          // Two flat sections, ordered by intent. Product = what we sell
          // (highest commercial intent at the top); Resources = secondary
          // material the visitor reaches for after deciding to evaluate.
          const productLinks = [
            { href: "/use-cases", label: t("useCases") },
            { href: "/computer-use", label: t("productItems.computerUse") },
            { href: "/agent-swarms", label: t("productItems.agentSwarms") },
            { href: "/compare", label: t("productItems.compare") },
            { href: "/pricing", label: "Pricing" },
          ]
          const resourceLinks = [
            { href: "/blog", label: t("blog") },
            { href: "/guide", label: t("blogItems.guide") },
            ...(DEVELOPERS_API_ENABLED
              ? [{ href: "/api-docs", label: "API" }]
              : []),
            { href: "/download", label: t("download") },
          ]
          // 35ms stagger keeps the cascade brisk — at 10 rows that's a
          // 315ms tail, finishing inside the drawer's own 320ms slide.
          const STAGGER = 0.035
          const HEAD_DELAY = 0.05

          return (
            <>
              {/* backdrop — dims the page beneath; tap to dismiss. The
                  blur is deliberately light (2px) — heavier blur looks
                  expensive on phones and the dim alone reads as modal. */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="fixed inset-0 z-[55] bg-black/35 dark:bg-black/55 backdrop-blur-[2px] lg:hidden"
                onClick={closeMobileMenu}
              />

              {/* drawer — 88vw with a 360px cap. Wide enough that rows
                  feel comfortable on phablets, narrow enough that ~12vw
                  of dimmed page stays visible on small phones so the
                  modal layer is unmistakable. */}
              <motion.aside
                initial={{ x: "100%" }}
                animate={{ x: 0 }}
                exit={{ x: "100%" }}
                transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                className="fixed inset-y-0 right-0 z-[60] w-[88vw] max-w-[360px] lg:hidden"
              >
                <div
                  className={cn(
                    "relative h-full flex flex-col overflow-hidden",
                    "bg-white dark:bg-neutral-950",
                    "shadow-[-12px_0_48px_rgba(0,0,0,0.12)] dark:shadow-[-12px_0_48px_rgba(0,0,0,0.5)]",
                  )}
                >
                  {/* leading-edge hairline — the drawer's left rail */}
                  <div className="absolute inset-y-0 left-0 w-px bg-foreground/[0.08]" />

                  {/* drawer header — fixed height so the body height
                      math (flex-1 + bottom CTA) stays predictable. */}
                  <header className="relative flex items-center justify-between pl-5 pr-2.5 h-[60px] flex-shrink-0 border-b border-foreground/[0.05]">
                    <Link
                      href="/"
                      onClick={closeMobileMenu}
                      className="flex items-center gap-2.5"
                    >
                      {mounted && (
                        <Image
                          src={resolvedTheme === "dark" ? "/logo_light.svg" : "/logo_dark.svg"}
                          alt="Coasty"
                          width={26}
                          height={26}
                          className="h-[26px] w-[26px] object-contain"
                        />
                      )}
                      <span className="font-semibold text-[15px] tracking-[-0.02em] text-foreground">
                        Coasty
                      </span>
                    </Link>
                    <button
                      onClick={closeMobileMenu}
                      aria-label="Close menu"
                      className="inline-flex items-center justify-center rounded-lg h-9 w-9 text-foreground/45 hover:text-foreground hover:bg-foreground/[0.05] active:bg-foreground/[0.10] transition-all duration-150"
                    >
                      <X className="h-[18px] w-[18px]" strokeWidth={1.5} />
                    </button>
                  </header>

                  {/* nav body — scrollable in the unlikely event the
                      viewport is short (landscape phones, browsers with
                      tall toolbars). Two sections, hairline-divided. */}
                  <nav className="relative flex-1 overflow-y-auto px-2 py-3">
                    <DrawerSectionLabel>Product</DrawerSectionLabel>
                    {productLinks.map((link, i) => (
                      <DrawerRow
                        key={link.href}
                        href={link.href}
                        label={link.label}
                        onClick={closeMobileMenu}
                        active={isPathActive(link.href, currentPath)}
                        delay={HEAD_DELAY + i * STAGGER}
                      />
                    ))}

                    <div className="mx-3 my-3 h-px bg-foreground/[0.05]" />

                    <DrawerSectionLabel>Resources</DrawerSectionLabel>
                    {resourceLinks.map((link, i) => (
                      <DrawerRow
                        key={link.href}
                        href={link.href}
                        label={link.label}
                        onClick={closeMobileMenu}
                        active={isPathActive(link.href, currentPath)}
                        delay={HEAD_DELAY + (productLinks.length + i) * STAGGER}
                      />
                    ))}
                  </nav>

                  {/* CTA — pinned bottom, the drawer's single signature
                      element. Everything above is quiet typography so
                      the eye is led down to this. Bottom padding adds a
                      safe-area-ish gap from the screen edge. */}
                  <div className="relative flex-shrink-0 px-4 pt-3 pb-5 border-t border-foreground/[0.05]">
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        delay: HEAD_DELAY + (productLinks.length + resourceLinks.length) * STAGGER,
                        duration: 0.32,
                        ease: [0.22, 1, 0.36, 1],
                      }}
                    >
                      <Link
                        href="/auth"
                        onClick={closeMobileMenu}
                        className={cn(
                          "flex items-center justify-center gap-2 w-full rounded-xl h-12",
                          "text-[15px] font-semibold tracking-[-0.01em]",
                          "bg-foreground text-background",
                          "hover:opacity-95 active:scale-[0.98]",
                          "shadow-[0_1px_3px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.1)]",
                          "dark:shadow-[0_1px_3px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.06)]",
                          "transition-all duration-150",
                        )}
                      >
                        {t("getStarted")}
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </motion.div>
                  </div>
                </div>
              </motion.aside>
            </>
          )
        })()}
      </AnimatePresence>
    </>
  )
}
