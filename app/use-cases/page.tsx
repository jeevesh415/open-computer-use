"use client"

import Link from "next/link"
import { LandingHeader } from "@/app/components/landing/landing-header"
import { LandingFooter } from "@/app/components/landing/landing-footer"
import { motion } from "framer-motion"
import { ArrowRight } from "lucide-react"
import { USE_CASES } from "./data"

// Card stagger + CTA delay (ms) — kept here so the original framer-motion
// rhythm is preserved while the actual animation runs as pure CSS via the
// `.public-card-enter` / `.public-fade-up` classes. See globals.css for the
// keyframes and the rationale (mobile double-tap bug when motion wraps
// clickable elements).
const CARD_STAGGER_MS = 50

export default function UseCasesPage() {
  return (
    <div className="relative min-h-screen bg-background">
      <LandingHeader />

      <main className="pt-32 sm:pt-36 pb-24">
        {/* Hero */}
        <div className="max-w-5xl mx-auto px-7 sm:px-10 mb-16">
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6 }}
            className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/50 mb-4"
          >
            Use Cases
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.05 }}
            className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.08] mb-5"
          >
            10x on autopilot.
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-muted-foreground text-lg sm:text-xl max-w-2xl leading-relaxed"
          >
            An AI agent that controls a real computer. It delivers competitor reports, QA tests, lead lists, and more. Pick a use case and see what you get.
          </motion.p>
        </div>

        {/* Use Case Grid */}
        <div className="max-w-5xl mx-auto px-7 sm:px-10 mb-28">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
            {USE_CASES.map((uc, i) => {
              const Icon = uc.icon

              return (
                <div
                  key={uc.slug}
                  className="public-card-enter"
                  style={{
                    ["--card-i" as string]: i,
                    ["--card-stagger-ms" as string]: `${CARD_STAGGER_MS}ms`,
                  }}
                >
                  <Link href={`/use-cases/${uc.slug}`}>
                    <div className="group flex h-full flex-col overflow-hidden rounded-xl border border-border/40 bg-card/30 backdrop-blur-sm transition-colors duration-300 hover:border-border hover:bg-card/60">
                      {/* Visual hero: large stat + icon background */}
                      <div className="relative overflow-hidden px-5 pt-5 pb-3 sm:px-6 sm:pt-6">
                        <Icon
                          className="absolute -right-3 -top-3 size-24 text-foreground/[0.04] transition-all duration-500 group-hover:scale-110 group-hover:text-foreground/[0.07] dark:text-foreground/[0.05]"
                          strokeWidth={1}
                        />
                        <div className="relative">
                          <span className="text-3xl font-semibold tracking-tight tabular-nums text-foreground sm:text-4xl">
                            {uc.heroStat}
                          </span>
                          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/60">
                            {uc.heroStatLabel}
                          </p>
                        </div>
                      </div>

                      {/* Content */}
                      <div className="flex flex-1 flex-col px-5 pb-5 sm:px-6 sm:pb-6">
                        <div className="mb-2 flex items-center gap-2">
                          <Icon className="size-3.5 text-muted-foreground/50" />
                          <h3 className="text-sm font-semibold text-foreground">
                            {uc.label}
                          </h3>
                        </div>

                        <p className="flex-1 text-[13px] leading-relaxed text-muted-foreground">
                          {uc.outcome}
                        </p>

                        <div className="mt-4 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground/50 transition-colors duration-200 group-hover:text-foreground">
                          <span>See details</span>
                          <ArrowRight className="size-3 transition-transform duration-200 group-hover:translate-x-0.5" />
                        </div>
                      </div>
                    </div>
                  </Link>
                </div>
              )
            })}
          </div>
        </div>

        {/* CTA */}
        <div className="mx-auto max-w-5xl px-7 sm:px-10">
          <div
            className="public-fade-up text-center"
            style={{ ["--card-d" as string]: 400 }}
          >
            <p className="mb-6 text-sm text-muted-foreground">
              Ready to 10x your output?
            </p>
            <Link
              href="/auth"
              className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-full bg-foreground px-7 text-[15px] font-medium text-background transition-colors hover:bg-foreground/85"
            >
              Try Coasty Free
              <ArrowRight className="h-4 w-4" />
            </Link>
            <p className="mt-4 text-[11px] text-muted-foreground/50">
              No credit card required
            </p>
          </div>
        </div>
      </main>

      <LandingFooter />
    </div>
  )
}
