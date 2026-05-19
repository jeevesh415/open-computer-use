"use client"

import Link from "next/link"
import Image from "next/image"
import { useTheme } from "next-themes"
import { useState, useEffect } from "react"
import { ArrowUpRight, Globe, ChevronRight, Mail } from "lucide-react"
import { useTranslations, useLocale } from "next-intl"
import { localeNames, type Locale } from "@/i18n/config"
import { LanguageSwitcherCompact } from "@/components/language-switcher"

type FooterColumn = {
  titleKey: string
  links: { href: string; labelKey: string; external?: boolean }[]
}

const footerColumnsDef: FooterColumn[] = [
  {
    titleKey: "columns.product",
    links: [
      { href: "/computer-use", labelKey: "links.computerUse" },
      { href: "/guide", labelKey: "links.guide" },
      { href: "/download", labelKey: "links.download" },
      { href: "/pricing", labelKey: "links.pricing" },
      { href: "/agent-swarms", labelKey: "links.agentSwarms" },
      { href: "/status", labelKey: "links.status" },
    ],
  },
  {
    titleKey: "columns.resources",
    links: [
      { href: "/blog", labelKey: "links.blog" },
      { href: "/use-cases", labelKey: "links.useCases" },
      { href: "/results", labelKey: "links.demos" },
      { href: "/compare", labelKey: "links.compare" },
    ],
  },
  {
    titleKey: "columns.company",
    links: [
      { href: "https://cal.com/coasty/15min", labelKey: "links.talkToCofounders", external: true },
      { href: "mailto:founders@coasty.ai", labelKey: "links.contact", external: true },
    ],
  },
  {
    titleKey: "columns.legal",
    links: [
      { href: "/privacy", labelKey: "links.privacy" },
      { href: "/terms", labelKey: "links.terms" },
    ],
  },
]

export function LandingFooter() {
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [langOpen, setLangOpen] = useState(false)
  const locale = useLocale() as Locale
  const t = useTranslations("footer")
  const tc = useTranslations("common")

  useEffect(() => {
    setMounted(true)
  }, [])

  return (
    <footer className="relative">
      {/* Gradient top edge — replaces flat border */}
      <div className="h-px w-full bg-gradient-to-r from-transparent via-border/50 to-transparent" />

      <div className="mx-auto max-w-5xl px-7 sm:px-10">
        {/* ── Top section: brand + link columns ── */}
        <div className="pt-14 sm:pt-20 pb-12 sm:pb-16 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-12 gap-y-10 gap-x-8">
          {/* Brand column — wider on desktop for breathing room */}
          <div className="col-span-2 sm:col-span-3 lg:col-span-4 flex flex-col gap-5">
            <Link href="/" className="flex items-center gap-2.5 group w-fit">
              <div className="relative h-7 w-7 flex-shrink-0">
                {mounted && (
                  <Image
                    src={
                      resolvedTheme === "dark"
                        ? "/logo_light.svg"
                        : "/logo_dark.svg"
                    }
                    alt="Coasty"
                    width={28}
                    height={28}
                    className="w-full h-full object-contain transition-opacity duration-300 group-hover:opacity-60"
                  />
                )}
              </div>
              <span className="font-semibold text-foreground text-[15px] tracking-[-0.02em]">
                Coasty
              </span>
            </Link>

            <p className="text-[13px] text-muted-foreground/50 leading-[1.65] max-w-[240px]">
              {t("tagline")}
              <br />
              {t("tagline2")}
            </p>

            {/* Social icons */}
            <div className="flex items-center gap-2 mt-1">
              <Link
                href="https://x.com/coastyai"
                target="_blank"
                rel="noopener noreferrer"
                className="group/s flex h-8 w-8 items-center justify-center rounded-full border border-border/25 text-muted-foreground/35 transition-all duration-300 hover:border-border/50 hover:text-foreground/60 hover:bg-foreground/[0.03]"
                aria-label="Follow on X"
              >
                <svg viewBox="0 0 24 24" className="h-[13px] w-[13px] fill-current">
                  <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
                </svg>
              </Link>
              <Link
                href="https://www.linkedin.com/company/coastyai/"
                target="_blank"
                rel="noopener noreferrer"
                className="group/s flex h-8 w-8 items-center justify-center rounded-full border border-border/25 text-muted-foreground/35 transition-all duration-300 hover:border-border/50 hover:text-foreground/60 hover:bg-foreground/[0.03]"
                aria-label="LinkedIn"
              >
                <svg viewBox="0 0 24 24" className="h-[13px] w-[13px] fill-current">
                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                </svg>
              </Link>
              <Link
                href="https://www.youtube.com/@CoastyAI"
                target="_blank"
                rel="noopener noreferrer"
                className="group/s flex h-8 w-8 items-center justify-center rounded-full border border-border/25 text-muted-foreground/35 transition-all duration-300 hover:border-border/50 hover:text-foreground/60 hover:bg-foreground/[0.03]"
                aria-label="YouTube"
              >
                <svg viewBox="0 0 24 24" className="h-[14px] w-[14px] fill-current">
                  <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                </svg>
              </Link>
              <Link
                href="mailto:prateek@llmhub.dev"
                className="group/s flex h-8 w-8 items-center justify-center rounded-full border border-border/25 text-muted-foreground/35 transition-all duration-300 hover:border-border/50 hover:text-foreground/60 hover:bg-foreground/[0.03]"
                aria-label="Email Prateek"
              >
                <Mail className="h-[13px] w-[13px]" />
              </Link>
            </div>
          </div>

          {/* Link columns — 2 of 12 grid cols each */}
          {footerColumnsDef.map((column) => (
            <div
              key={column.titleKey}
              className="flex flex-col gap-3.5 lg:col-span-2"
            >
              <h3 className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground/40">
                {t(column.titleKey)}
              </h3>
              <ul className="flex flex-col gap-[9px]">
                {column.links.map((link) => (
                  <li key={link.labelKey}>
                    <Link
                      href={link.href}
                      {...(link.external
                        ? { target: "_blank", rel: "noopener noreferrer" }
                        : {})}
                      className="group/link inline-flex items-center gap-1 text-[13px] text-muted-foreground/55 transition-colors duration-200 hover:text-foreground"
                    >
                      <span className="relative">
                        {t(link.labelKey)}
                        {/* Underline slides in from left on hover */}
                        <span className="absolute -bottom-px left-0 h-px w-0 bg-foreground/25 transition-all duration-300 ease-out group-hover/link:w-full" />
                      </span>
                      {link.external && (
                        <ArrowUpRight className="h-3 w-3 -translate-y-px translate-x-[-2px] opacity-0 transition-all duration-200 group-hover/link:translate-x-0 group-hover/link:translate-y-0 group-hover/link:opacity-50" />
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* ── Bottom bar ── */}
        <div className="flex flex-col items-center gap-4 border-t border-border/15 py-6 sm:flex-row sm:justify-between sm:gap-3">
          {/* Left: copyright */}
          <p className="text-[11px] tracking-[0.005em] text-muted-foreground/35">
            &copy; {new Date().getFullYear()} Coasty.{" "}
            {tc("allRightsReserved")}
          </p>

          {/* Center cluster: language + status */}
          <div className="flex items-center gap-3">
            {/* Language trigger — opens the compact modal */}
            <div className="relative">
              <button
                onClick={() => setLangOpen(true)}
                className="group/lang inline-flex items-center gap-1.5 rounded-full border border-border/20 px-2.5 py-1.5 transition-all duration-300 hover:border-border/40 hover:bg-foreground/[0.02] cursor-pointer"
              >
                <Globe className="h-3 w-3 text-muted-foreground/35 transition-colors duration-300 group-hover/lang:text-muted-foreground/60" />
                <span className="text-[11px] font-medium text-muted-foreground/45 transition-colors duration-300 group-hover/lang:text-muted-foreground/70">
                  {localeNames[locale]}
                </span>
                <ChevronRight className="h-2.5 w-2.5 text-muted-foreground/25 transition-all duration-300 group-hover/lang:text-muted-foreground/45 group-hover/lang:translate-x-px" />
              </button>
              <LanguageSwitcherCompact
                open={langOpen}
                onOpenChange={setLangOpen}
              />
            </div>

            {/* Subtle separator dot */}
            <span className="h-0.5 w-0.5 rounded-full bg-muted-foreground/20" />

            {/* Status pill */}
            <Link
              href="/status"
              className="group/status inline-flex items-center gap-2 rounded-full border border-emerald-500/15 bg-emerald-500/[0.04] px-2.5 py-1.5 transition-all duration-300 hover:border-emerald-500/25 hover:bg-emerald-500/[0.07]"
            >
              <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500/70" />
              <span className="text-[11px] font-medium tracking-[0.01em] text-emerald-600/70 dark:text-emerald-400/70 transition-colors duration-300 group-hover/status:text-emerald-600 dark:group-hover/status:text-emerald-400">
                {t("status")}
              </span>
            </Link>
          </div>

          {/* Right: legal links */}
          <div className="flex items-center gap-5">
            <Link
              href="/privacy"
              className="text-[11px] text-muted-foreground/35 transition-colors duration-200 hover:text-muted-foreground/60"
            >
              {tc("privacy")}
            </Link>
            <Link
              href="/terms"
              className="text-[11px] text-muted-foreground/35 transition-colors duration-200 hover:text-muted-foreground/60"
            >
              {tc("terms")}
            </Link>
          </div>
        </div>
      </div>

      {/* ── Giant Coasty wordmark ── */}
      <div className="relative w-full select-none overflow-x-clip px-7 pb-8 sm:px-10">
        <div className="relative flex w-full items-end justify-center overflow-visible">
          {/* Ambient glow — neutral foreground wash, not a tinted gradient. */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-[50%] w-[65%] rounded-full bg-foreground/[0.04] blur-[100px] dark:bg-foreground/[0.025]" />
          </div>
          <h2
            className="relative bg-gradient-to-b from-foreground/[0.14] via-foreground/[0.06] to-transparent bg-clip-text text-[20vw] font-black leading-none tracking-[-0.04em] text-transparent sm:text-[18vw] md:text-[15vw] lg:text-[13vw]"
            aria-hidden="true"
          >
            Coasty
          </h2>
        </div>
      </div>
    </footer>
  )
}
