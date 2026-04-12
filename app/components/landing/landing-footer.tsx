"use client"

import Link from "next/link"
import Image from "next/image"
import { useTheme } from "next-themes"
import { useState, useEffect } from "react"
import { ArrowUpRight } from "lucide-react"
import { useTranslations } from "next-intl"
import { LanguageSwitcher } from "@/components/language-switcher"

type FooterColumn = { titleKey: string; links: { href: string; labelKey: string; external?: boolean }[] }

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
  const t = useTranslations("footer")
  const tc = useTranslations("common")

  useEffect(() => {
    setMounted(true)
  }, [])

  return (
    <footer className="border-t border-border/40">
      {/* Main footer content */}
      <div className="mx-auto max-w-5xl px-7 sm:px-10">
        {/* Top section: brand + columns */}
        <div className="py-12 sm:py-16 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-10 lg:gap-8">
          {/* Brand column — spans 2 cols on lg */}
          <div className="col-span-2 sm:col-span-3 lg:col-span-2 flex flex-col gap-4">
            <Link href="/" className="flex items-center gap-2.5 group w-fit">
              <div className="relative h-8 w-8 flex-shrink-0">
                {mounted && (
                  <Image
                    src={resolvedTheme === "dark" ? "/logo_light.svg" : "/logo_dark.svg"}
                    alt="Coasty"
                    width={32}
                    height={32}
                    className="w-full h-full object-contain"
                  />
                )}
              </div>
              <span className="font-semibold text-foreground text-base tracking-[-0.01em]">
                Coasty
              </span>
            </Link>
            <p className="text-sm text-muted-foreground/60 leading-relaxed max-w-[260px]">
              {t("tagline")}
              <br />
              {t("tagline2")}
            </p>
          </div>

          {/* Link columns */}
          {footerColumnsDef.map((column) => (
            <div key={column.titleKey} className="flex flex-col gap-3">
              <h3 className="text-[13px] font-medium text-foreground tracking-[-0.006em]">
                {t(column.titleKey)}
              </h3>
              <ul className="flex flex-col gap-2.5">
                {column.links.map((link) => (
                  <li key={link.labelKey}>
                    <Link
                      href={link.href}
                      {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                      className="group/link inline-flex items-center gap-1 text-[13px] text-muted-foreground/60 hover:text-foreground transition-colors duration-200"
                    >
                      {t(link.labelKey)}
                      {link.external && (
                        <ArrowUpRight className="h-3 w-3 opacity-0 -translate-y-px translate-x-[-2px] group-hover/link:opacity-100 group-hover/link:translate-x-0 group-hover/link:translate-y-0 transition-all duration-200" />
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Language switcher strip */}
        <div className="border-t border-border/20 pt-6 pb-2">
          <LanguageSwitcher />
        </div>

        {/* Bottom bar */}
        <div className="border-t border-border/20 py-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-[12px] text-muted-foreground/50 tracking-[-0.006em]">
            &copy; {new Date().getFullYear()} Coasty. {tc("allRightsReserved")}
          </p>
          <div className="flex items-center gap-4">
            <Link
              href="/privacy"
              className="text-[12px] text-muted-foreground/50 hover:text-muted-foreground transition-colors duration-200"
            >
              {tc("privacy")}
            </Link>
            <span className="text-muted-foreground/20 text-[10px]">|</span>
            <Link
              href="/terms"
              className="text-[12px] text-muted-foreground/50 hover:text-muted-foreground transition-colors duration-200"
            >
              {tc("terms")}
            </Link>
          </div>
        </div>
      </div>

      {/* Giant Coasty wordmark */}
      <div className="relative w-full flex items-end justify-center select-none overflow-x-clip overflow-y-visible px-7 sm:px-10 md:px-10 pb-6">
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-[80%] h-[60%] bg-gradient-to-r from-blue-500/[0.07] via-purple-500/[0.07] to-blue-500/[0.07] dark:from-blue-400/[0.05] dark:via-purple-400/[0.05] dark:to-blue-400/[0.05] rounded-full blur-3xl" />
        </div>
        <h2
          className="relative text-[20vw] sm:text-[18vw] md:text-[16vw] lg:text-[14vw] font-black tracking-tighter leading-[1.15] bg-gradient-to-b from-foreground/90 via-foreground/50 to-foreground/10 bg-clip-text text-transparent px-[0.15em] pb-[0.15em]"
          aria-hidden="true"
        >
          Coasty
        </h2>
      </div>
    </footer>
  )
}
