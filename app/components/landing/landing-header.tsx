"use client"

import Link from "next/link"
import {
  Menu, X, ArrowRight, ChevronDown, Search, Bug, TrendingUp,
  FileText, Mail, ShoppingCart, Users, BarChart3, Globe, Eye,
  Send, MonitorSmartphone, Monitor, Keyboard, GitCompare,
  BookOpen, Newspaper, Compass, Download, Layers,
} from "lucide-react"
import Image from "next/image"
import { useState, useEffect, useCallback, useRef } from "react"
import { cn } from "@/lib/utils"
import { motion, AnimatePresence } from "framer-motion"
import { AnimatedThemeToggler } from "@/components/magicui/animated-theme-toggler"
import { useTheme } from "next-themes"
import { useTranslations } from "next-intl"
import { LanguageSwitcherCompact } from "@/components/language-switcher"

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
]

const navItemsDef = [
  { href: "/discover", labelKey: "discover", external: true },
  { href: "/pricing", labelKey: "pricing", external: true },
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

/* ─── mobile accordion section ─── */

function MobileAccordionSection({
  label,
  isOpen,
  onToggle,
  isActive,
  children,
  delay = 0,
}: {
  label: string
  isOpen: boolean
  onToggle: () => void
  isActive: boolean
  children: React.ReactNode
  delay?: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay, duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
    >
      <button
        onClick={onToggle}
        className={cn(
          "flex items-center justify-between w-full px-4 py-3 rounded-xl transition-all duration-150",
          "text-[15px] font-medium tracking-[-0.01em]",
          isActive
            ? "text-foreground bg-foreground/[0.04]"
            : "text-foreground/50 hover:text-foreground hover:bg-foreground/[0.03] active:bg-foreground/[0.05]"
        )}
      >
        {label}
        <ChevronDown className={cn(
          "h-4 w-4 text-muted-foreground/40 transition-transform duration-200",
          isOpen && "rotate-180"
        )} />
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
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
  const [mobileUseCasesOpen, setMobileUseCasesOpen] = useState(false)
  const [productsOpen, setProductsOpen] = useState(false)
  const [hoveredProduct, setHoveredProduct] = useState(0)
  const [mobileProductsOpen, setMobileProductsOpen] = useState(false)
  const productsDropdownTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [blogOpen, setBlogOpen] = useState(false)
  const [hoveredBlogItem, setHoveredBlogItem] = useState(0)
  const [mobileBlogOpen, setMobileBlogOpen] = useState(false)
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
        className={cn(
          "fixed top-0 left-0 right-0 z-50 transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
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
            {/* glass shell — always present, opacity fades in on scroll */}
            <div
              className={cn(
                "absolute inset-0 rounded-2xl",
                "backdrop-blur-2xl backdrop-saturate-[1.8]",
                "transition-[background-color,box-shadow,opacity] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]",
                scrolled
                  ? "bg-white/60 dark:bg-neutral-950/55 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_16px_rgba(0,0,0,0.04)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2),0_4px_16px_rgba(0,0,0,0.15)]"
                  : "bg-white/0 dark:bg-neutral-950/0 shadow-[0_0_0_rgba(0,0,0,0),0_0_0_rgba(0,0,0,0)]",
              )}
            />
            {/* border ring — separate div so opacity can be transitioned smoothly */}
            <div
              className={cn(
                "absolute inset-0 rounded-2xl pointer-events-none",
                "ring-1 ring-black/[0.06] dark:ring-white/[0.08]",
                "transition-opacity duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]",
                scrolled ? "opacity-100" : "opacity-0",
              )}
            />
            {/* top edge highlight */}
            <div className={cn(
              "absolute inset-x-0 top-0 h-px rounded-t-2xl pointer-events-none",
              "bg-gradient-to-r from-transparent via-white/60 dark:via-white/10 to-transparent",
              "transition-opacity duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]",
              scrolled ? "opacity-100" : "opacity-0",
            )} />

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
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.96 }}
                  transition={{ duration: 0.15 }}
                  className={cn(
                    "relative transition-all duration-500 flex-shrink-0",
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
                          {t(item.labelKey)}
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
                          {t(item.labelKey)}
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
                <AnimatedThemeToggler
                  className={cn(
                    "rounded-lg transition-all duration-200 text-foreground/40 hover:text-foreground/70 hover:bg-foreground/[0.05]",
                    scrolled ? "h-7 w-7 p-1.5 text-sm" : "h-9 w-9 p-2",
                  )}
                />
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
                <AnimatedThemeToggler className="p-1.5 rounded-lg h-8 w-8 text-foreground/40 hover:text-foreground/70 hover:bg-foreground/[0.05] inline-flex items-center justify-center transition-all duration-200" />
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

      {/* ━━━ mobile menu ━━━ */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <>
            {/* backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="fixed inset-0 z-40 bg-black/20 dark:bg-black/40 backdrop-blur-sm lg:hidden"
              onClick={closeMobileMenu}
            />

            {/* panel */}
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="fixed inset-x-0 top-0 z-40 lg:hidden pt-[56px] sm:pt-[64px]"
            >
              <div className="mx-3 sm:mx-5 overflow-hidden rounded-b-2xl">
                {/* glass bg */}
                <div className={cn(
                  "relative",
                  "bg-white/85 dark:bg-neutral-950/85",
                  "backdrop-blur-2xl backdrop-saturate-150",
                  "ring-1 ring-black/[0.06] dark:ring-white/[0.08]",
                  "shadow-[0_8px_40px_rgba(0,0,0,0.08)] dark:shadow-[0_8px_40px_rgba(0,0,0,0.3)]",
                )}>
                  {/* top highlight */}
                  <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/[0.06] to-transparent" />

                  <nav className="relative flex flex-col px-2 py-2.5 gap-0.5 max-h-[calc(100dvh-80px)] overflow-y-auto">
                    {/* Use Cases accordion */}
                    <MobileAccordionSection
                      label={t("useCases")}
                      isOpen={mobileUseCasesOpen}
                      onToggle={() => setMobileUseCasesOpen(!mobileUseCasesOpen)}
                      isActive={isUseCaseActive}
                      delay={0}
                    >
                      <div className="grid grid-cols-2 gap-0.5 px-1 py-1.5">
                        {useCaseDropdownDef.map((uc) => {
                          const Icon = uc.icon
                          const ucHref = "href" in uc ? (uc as { href: string }).href : `/use-cases/${uc.slug}`
                          return (
                            <Link
                              key={uc.slug}
                              href={ucHref}
                              onClick={closeMobileMenu}
                              className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-foreground/[0.04] active:bg-foreground/[0.06] transition-all duration-150"
                            >
                              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-foreground/[0.04]">
                                <Icon className="size-3 text-muted-foreground/50" strokeWidth={1.8} />
                              </span>
                              <span className="text-[13px] font-medium text-foreground/55">
                                {t(`useCaseItems.${uc.labelKey}`)}
                              </span>
                            </Link>
                          )
                        })}
                      </div>
                      <Link
                        href="/use-cases"
                        onClick={closeMobileMenu}
                        className="flex items-center justify-center gap-1.5 px-3 py-2.5 mx-1 mb-1 rounded-xl hover:bg-foreground/[0.04] transition-all"
                      >
                        <span className="text-[12px] font-medium text-muted-foreground/40">View all use cases</span>
                        <ArrowRight className="h-3 w-3 text-muted-foreground/30" />
                      </Link>
                    </MobileAccordionSection>

                    {/* Products accordion */}
                    <MobileAccordionSection
                      label={t("products")}
                      isOpen={mobileProductsOpen}
                      onToggle={() => setMobileProductsOpen(!mobileProductsOpen)}
                      isActive={isProductActive}
                      delay={0.03}
                    >
                      <div className="grid grid-cols-1 gap-0.5 px-1 py-1.5">
                        {productDropdownDef.map((item) => {
                          const Icon = item.icon
                          return (
                            <Link
                              key={item.href}
                              href={item.href}
                              onClick={closeMobileMenu}
                              className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-foreground/[0.04] active:bg-foreground/[0.06] transition-all duration-150"
                            >
                              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-foreground/[0.04]">
                                <Icon className="size-3 text-muted-foreground/50" strokeWidth={1.8} />
                              </span>
                              <span className="text-[13px] font-medium text-foreground/55">
                                {t(`productItems.${item.labelKey}`)}
                              </span>
                            </Link>
                          )
                        })}
                      </div>
                    </MobileAccordionSection>

                    {/* regular nav items */}
                    {navItemsDef.map((item, index) => {
                      const isActive = item.external
                        ? currentPath === item.href
                        : (currentPath === "/" || currentPath === "") &&
                          activeSection === item.href.substring(2)

                      const cls = cn(
                        "flex items-center px-4 py-3 rounded-xl transition-all duration-150",
                        "text-[15px] font-medium tracking-[-0.01em]",
                        isActive
                          ? "text-foreground bg-foreground/[0.04]"
                          : "text-foreground/50 hover:text-foreground hover:bg-foreground/[0.03] active:bg-foreground/[0.05]",
                      )

                      return (
                        <motion.div
                          key={item.labelKey}
                          initial={{ opacity: 0, x: -12 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{
                            delay: (index + 1) * 0.03,
                            duration: 0.25,
                            ease: [0.22, 1, 0.36, 1],
                          }}
                        >
                          {item.external ? (
                            <Link href={item.href} className={cls} onClick={closeMobileMenu}>
                              {t(item.labelKey)}
                            </Link>
                          ) : (
                            <a
                              href={item.href}
                              onClick={(e) => handleNavClick(e, item.href, item.external)}
                              className={cls}
                            >
                              {t(item.labelKey)}
                            </a>
                          )}
                        </motion.div>
                      )
                    })}

                    {/* Blog accordion */}
                    <MobileAccordionSection
                      label={t("blog")}
                      isOpen={mobileBlogOpen}
                      onToggle={() => setMobileBlogOpen(!mobileBlogOpen)}
                      isActive={isBlogActive}
                      delay={(navItemsDef.length + 1) * 0.03}
                    >
                      <div className="grid grid-cols-2 gap-0.5 px-1 py-1.5">
                        {blogDropdownDef.map((item) => {
                          const Icon = item.icon
                          return (
                            <Link
                              key={item.href}
                              href={item.href}
                              onClick={closeMobileMenu}
                              className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-foreground/[0.04] active:bg-foreground/[0.06] transition-all duration-150"
                            >
                              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-foreground/[0.04]">
                                <Icon className="size-3 text-muted-foreground/50" strokeWidth={1.8} />
                              </span>
                              <span className="text-[13px] font-medium text-foreground/55">
                                {t(`blogItems.${item.labelKey}`)}
                              </span>
                            </Link>
                          )
                        })}
                      </div>
                      <Link
                        href="/blog"
                        onClick={closeMobileMenu}
                        className="flex items-center justify-center gap-1.5 px-3 py-2.5 mx-1 mb-1 rounded-xl hover:bg-foreground/[0.04] transition-all"
                      >
                        <span className="text-[12px] font-medium text-muted-foreground/40">View all posts</span>
                        <ArrowRight className="h-3 w-3 text-muted-foreground/30" />
                      </Link>
                    </MobileAccordionSection>

                    {/* Download link */}
                    <motion.div
                      initial={{ opacity: 0, x: -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{
                        delay: (navItemsDef.length + 2) * 0.03,
                        duration: 0.25,
                        ease: [0.22, 1, 0.36, 1],
                      }}
                    >
                      <Link
                        href="/download"
                        onClick={closeMobileMenu}
                        className="flex items-center gap-2.5 px-4 py-3 rounded-xl text-[15px] font-medium tracking-[-0.01em] text-foreground/50 hover:text-foreground hover:bg-foreground/[0.03] active:bg-foreground/[0.05] transition-all duration-150"
                      >
                        <Download className="size-4 text-muted-foreground/40" strokeWidth={1.8} />
                        {t("download")}
                      </Link>
                    </motion.div>

                    {/* divider */}
                    <div className="my-1.5 mx-4 border-t border-foreground/[0.05]" />

                    {/* CTA */}
                    <motion.div
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        delay: (navItemsDef.length + 2) * 0.03,
                        duration: 0.25,
                      }}
                      className="px-1.5 pb-1.5"
                    >
                      <Link
                        href="/auth"
                        onClick={closeMobileMenu}
                        className={cn(
                          "flex items-center justify-center gap-2 w-full rounded-xl h-12",
                          "text-[15px] font-semibold tracking-[-0.01em]",
                          "bg-foreground text-background",
                          "hover:opacity-90 active:scale-[0.98]",
                          "shadow-[0_1px_3px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.1)]",
                          "dark:shadow-[0_1px_3px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.06)]",
                          "transition-all duration-150",
                        )}
                      >
                        {t("getStarted")}
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </motion.div>
                  </nav>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
