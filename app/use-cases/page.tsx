"use client"

import Link from "next/link"
import { LandingHeader } from "@/app/components/landing/landing-header"
import { GuideLines } from "@/app/components/landing/guide-lines"
import { LandingFooter } from "@/app/components/landing/landing-footer"
import { motion } from "framer-motion"
import { ArrowRight } from "lucide-react"
import { USE_CASES, USE_CASE_COLORS } from "./data"
import { cn } from "@/lib/utils"

const fade = {
  hidden: { opacity: 0, y: 24 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, delay: i * 0.05, ease: [0.25, 0.1, 0.25, 1] as const },
  }),
}

export default function UseCasesPage() {
  return (
    <div className="relative min-h-screen bg-background">
      <GuideLines />
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
                <motion.div
                  key={uc.slug}
                  custom={i}
                  initial="hidden"
                  animate="show"
                  variants={fade}
                >
                  <Link href={`/use-cases/${uc.slug}`}>
                    <div className="h-full rounded-xl overflow-hidden border border-border/30 bg-card hover:border-border/60 transition-all duration-300 flex flex-col group">
                      {/* Visual hero: large stat + icon background */}
                      <div className="relative px-5 pt-5 sm:px-6 sm:pt-6 pb-4 overflow-hidden">
                        {/* Faded large icon watermark */}
                        <Icon className="absolute -right-3 -top-3 size-24 text-foreground/[0.03] dark:text-foreground/[0.04] transition-all duration-500 group-hover:text-foreground/[0.06] group-hover:scale-110" strokeWidth={1} />
                        <div className="relative">
                          <span className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground/90">
                            {uc.heroStat}
                          </span>
                          <p className="text-[11px] font-medium text-muted-foreground/40 mt-0.5 tracking-wide">
                            {uc.heroStatLabel}
                          </p>
                        </div>
                      </div>

                      {/* Content */}
                      <div className="px-5 pb-5 sm:px-6 sm:pb-6 flex flex-col flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <Icon className="size-3.5 text-muted-foreground/40" />
                          <h3 className="text-sm font-semibold text-foreground">
                            {uc.label}
                          </h3>
                        </div>

                        <p className="text-[13px] text-muted-foreground/50 leading-relaxed flex-1">
                          {uc.outcome}
                        </p>

                        <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-border/20">
                          <span className="text-[11px] font-medium text-muted-foreground/40 group-hover:text-foreground/60 transition-colors duration-200">
                            See details
                          </span>
                          <ArrowRight className="size-3 text-muted-foreground/30 group-hover:text-foreground/60 group-hover:translate-x-0.5 transition-all duration-200" />
                        </div>
                      </div>
                    </div>
                  </Link>
                </motion.div>
              )
            })}
          </div>
        </div>

        {/* CTA */}
        <div className="max-w-5xl mx-auto px-7 sm:px-10">
          <div className="border-t border-border/30" />
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="mt-24 text-center"
          >
            <p className="text-muted-foreground/60 text-sm mb-6">
              Ready to 10x your output?
            </p>
            <Link href="/auth">
              <motion.button
                className="inline-flex items-center gap-2.5 rounded-full font-semibold text-background bg-foreground px-8 py-3.5 text-[15px] cursor-pointer"
                whileHover={{ scale: 1.02, y: -1 }}
                whileTap={{ scale: 0.98 }}
              >
                Try Coasty Free
                <ArrowRight className="h-4 w-4" />
              </motion.button>
            </Link>
            <p className="text-[11px] text-muted-foreground/30 mt-4">
              No credit card required
            </p>
          </motion.div>
        </div>
      </main>

      <LandingFooter />
    </div>
  )
}
