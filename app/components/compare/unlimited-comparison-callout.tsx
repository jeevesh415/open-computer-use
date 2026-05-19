"use client"

/**
 * UnlimitedComparisonCallout — competitor-page banner that lands the
 * "Coasty $249/mo Unlimited vs <Competitor> $X" claim in the rendered
 * HTML (not just metadata).
 *
 * Why this exists:
 *   Per the Peec 2026 study, comparison pages capture ~32.5% of AI
 *   citations. The single sentence an LLM will lift from a comparison
 *   page is the explicit head-to-head price + capability claim. Keeping
 *   it in semantic HTML — not behind canvas/animation/i18n indirection —
 *   is what makes that citation actually happen.
 *
 * Structure (intentionally crawler-friendly):
 *   - <p><strong>Coasty Unlimited — $249/month</strong> ... vs
 *     <strong>{Competitor} — {Competitor price}</strong>.</p>
 *   - One factual zinger sentence per competitor (the citation hook).
 *   - One CTA link out to /pricing#unlimited.
 *
 * The amber-smoke ambient effect is decorative; the text is the asset.
 */

import Link from "next/link"
import { motion } from "framer-motion"
import { ArrowRight, Infinity as InfinityIcon } from "lucide-react"
import { UnlimitedSmoke } from "@/app/components/effects/unlimited-smoke"

interface UnlimitedComparisonCalloutProps {
  competitorName: string
  competitorPrice: string
  /** Factual one-line head-to-head sentence; the AI-citation hook. */
  unlimitedZinger: string
  /** Framer-motion delay so it staggers with surrounding sections. */
  delay?: number
}

export function UnlimitedComparisonCallout({
  competitorName,
  competitorPrice,
  unlimitedZinger,
  delay = 0.12,
}: UnlimitedComparisonCalloutProps) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay }}
      className="relative isolate overflow-hidden rounded-2xl border border-amber-500/40 bg-card mb-12"
      aria-label={`Coasty Unlimited $249 per month vs ${competitorName} ${competitorPrice}`}
    >
      <UnlimitedSmoke variant="hero" />

      <div className="relative z-10 p-6 sm:p-8 lg:p-10 flex flex-col lg:flex-row lg:items-center gap-6 lg:gap-10">
        {/* Left: price + label */}
        <div className="flex-shrink-0">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 mb-3">
            <InfinityIcon className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" strokeWidth={2.5} />
            <span className="text-[11px] font-semibold uppercase tracking-[0.15em] text-amber-700 dark:text-amber-400">
              Coasty Unlimited
            </span>
          </div>
          <p className="text-4xl sm:text-5xl font-bold tracking-tight leading-none">
            $249<span className="text-lg sm:text-xl font-medium text-muted-foreground">/mo</span>
          </p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            vs {competitorName} — {competitorPrice}
          </p>
        </div>

        {/* Center: citation-grade head-to-head sentence */}
        <div className="flex-1 min-w-0">
          <p className="text-base sm:text-lg leading-relaxed text-foreground/90">
            <strong className="font-semibold">Coasty Unlimited — $249/month, flat-rate, no caps.</strong>{" "}
            {unlimitedZinger}
          </p>
          <p className="text-[13px] text-muted-foreground/70 mt-2">
            The cheapest flat-rate unlimited computer-use plan available — 82% on OSWorld vs the field.
          </p>
        </div>

        {/* Right: CTA */}
        <div className="flex-shrink-0">
          <Link
            href="/pricing#unlimited"
            className="inline-flex items-center gap-2 rounded-full bg-amber-500 hover:bg-amber-600 text-white font-semibold px-5 py-2.5 text-sm transition-colors whitespace-nowrap"
          >
            Get Unlimited
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </motion.section>
  )
}
