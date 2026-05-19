"use client"

import Link from "next/link"
import { LandingHeader } from "@/app/components/landing/landing-header"
import { LandingFooter } from "@/app/components/landing/landing-footer"
import { ArrowRight, ArrowUpRight } from "lucide-react"
import { motion } from "framer-motion"
import { useTranslations } from "next-intl"

const competitors = [
  { slug: "anthropic-computer-use", name: "Anthropic Computer Use", tagline: "Managed platform vs raw API", category: "AI Agent" },
  { slug: "openai-operator", name: "OpenAI Operator", tagline: "Higher benchmarks, multi-model, open source", category: "AI Agent" },
  { slug: "adept-ai", name: "Adept AI", tagline: "Production-ready with proven results", category: "AI Agent" },
  { slug: "multion", name: "Multion", tagline: "Full desktop control, not just browser", category: "AI Agent" },
  { slug: "browserbase", name: "Browserbase", tagline: "Complete AI employee vs browser infra", category: "Infrastructure" },
  { slug: "induced-ai", name: "Induced AI", tagline: "VM isolation + CAPTCHA solving included", category: "AI Agent" },
  { slug: "devin-ai", name: "Devin AI", tagline: "General-purpose agent vs code-only", category: "AI Agent" },
  { slug: "uipath", name: "UiPath", tagline: "AI vision vs brittle RPA scripts", category: "RPA" },
  { slug: "automation-anywhere", name: "Automation Anywhere", tagline: "Adaptive AI vs rigid automation", category: "RPA" },
  { slug: "virtual-assistant", name: "Human Virtual Assistant", tagline: "$20/mo vs $3,000/mo — works 24/7", category: "Human" },
]

// Card stagger (ms) — see globals.css `.public-card-enter`. Used as plain
// CSS instead of framer-motion variants because wrapping a <Link> in
// <motion.*> causes a mobile double-tap bug (motion's gesture system
// swallows the first pointerdown to disambiguate tap vs drag).
const CARD_STAGGER_MS = 50

export default function ComparePage() {
  const t = useTranslations("comparePage")

  return (
    <div className="relative min-h-screen bg-background">
      <LandingHeader />

      <main className="pt-32 sm:pt-36 pb-24">
        <div className="max-w-5xl mx-auto px-7 sm:px-10 mb-16">
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6 }}
            className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/50 mb-4"
          >
            {t("title")}
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.05 }}
            className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.08] mb-5"
          >
            {t("heroTitle")}
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-muted-foreground text-lg sm:text-xl max-w-2xl leading-relaxed"
          >
            {t("heroDescription")}
          </motion.p>
        </div>

        <div className="max-w-5xl mx-auto px-7 sm:px-10 mb-28">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
            {competitors.map((comp, i) => (
              <div
                key={comp.slug}
                className="public-card-enter"
                style={{
                  ["--card-i" as string]: i,
                  ["--card-stagger-ms" as string]: `${CARD_STAGGER_MS}ms`,
                }}
              >
                <Link href={`/compare/${comp.slug}`}>
                  <div className="h-full rounded-xl overflow-hidden border border-border/30 bg-card hover:border-border/60 transition-colors duration-300 flex flex-col p-5 sm:p-6 group">
                    <div className="flex items-center justify-between mb-4">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground/40">
                        {comp.category}
                      </span>
                      <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/20 group-hover:text-foreground/50 transition-all duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                    </div>
                    <h3 className="font-semibold text-foreground group-hover:text-foreground/70 transition-colors duration-200 mb-2 leading-snug">
                      {t("vsLabel", { name: comp.name })}
                    </h3>
                    <p className="text-sm text-muted-foreground/70 leading-relaxed flex-1">
                      {comp.tagline}
                    </p>
                  </div>
                </Link>
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="max-w-5xl mx-auto px-7 sm:px-10">
          <div className="border-t border-border/30" />
          <div
            className="mt-24 text-center public-fade-up"
            style={{ ["--card-d" as string]: 400 }}
          >
            <p className="text-muted-foreground/60 text-sm mb-6">
              {t("ctaTitle")}
            </p>
            <Link
              href="/auth"
              className="inline-flex items-center gap-2.5 rounded-full font-semibold text-background bg-foreground px-8 py-3.5 text-[15px] cursor-pointer transition-transform duration-150 hover:scale-[1.02] hover:-translate-y-px active:scale-[0.98]"
            >
              {t("ctaButton")}
              <ArrowRight className="h-4 w-4" />
            </Link>
            <p className="text-[11px] text-muted-foreground/30 mt-4">
              {t("noCreditCard")}
            </p>
          </div>
        </div>
      </main>

      <LandingFooter />
    </div>
  )
}
