"use client"

/**
 * PricingSection — minimal editorial pricing.
 *
 * Five plans in a single calm row. One consistent card chrome across all
 * tiers; the highlighted plan is differentiated only by a slightly stronger
 * border, a faint top sheen, and a filled CTA. No scale-ups, no badges, no
 * shimmer, no gauge bars — just price, plan, three checks, button.
 *
 * Numbers count up on viewport entry. Cards cascade left-to-right with a
 * gentle stagger. Mobile collapses to a single column with instant reveals.
 */

import { motion } from "framer-motion"
import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { ArrowRight, Check, Infinity as InfinityIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { LandingSectionTopGlow, LandingSectionHeader } from "../section-shell"
import { VISIBLE_TIERS, type SubscriptionTierId } from "@/lib/pricing/tiers"
import { UnlimitedSmoke } from "@/app/components/effects/unlimited-smoke"

const EASE = [0.22, 1, 0.36, 1] as const

// Numeric data sourced from `lib/pricing/tiers.ts` (canonical). Names,
// descriptions, and CTAs come from i18n via `t("pricing.plans.<key>.*")`.
// Enterprise is filtered out — landing surfaces only the five purchasable
// tiers; enterprise is a footer/contact-sales play, not a card.
type PlanRow = {
  key: SubscriptionTierId
  /** Pre-formatted price string ("$0", "$19", "$100") for display + count-up parsing */
  price: string
  credits: number
  machines: number
  swarm: number
  highlighted: boolean
}

const PLAN_DATA: PlanRow[] = VISIBLE_TIERS
  .filter((tier) => tier.id !== "enterprise")
  .map((tier) => ({
    key: tier.id,
    price: `$${tier.priceUSD ?? 0}`,
    credits: tier.creditsPerMonth,
    machines: tier.machinesIncluded,
    swarm: tier.swarmAgentsLimit,
    highlighted: tier.highlighted,
  }))

// Count-up: integer ramps from 0 → target with ease-out cubic, gated on
// `start` so each card animates only after its viewport entry.
function useCountUp(target: number, durationMs: number, start: boolean): number {
  const [val, setVal] = useState(0)
  useEffect(() => {
    if (!start) return
    if (target === 0) { setVal(0); return }
    const t0 = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / durationMs)
      const eased = 1 - Math.pow(1 - t, 3)
      setVal(Math.round(target * eased))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, durationMs, start])
  return val
}

export function PricingSection({ isMobile }: { isMobile: boolean }) {
  const t = useTranslations()
  const tc = useTranslations("common")

  const handleCardMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100
    e.currentTarget.style.setProperty("--mouse-x", `${x}%`)
    e.currentTarget.style.setProperty("--mouse-y", `${y}%`)
  }, [])

  const handleCardMouseLeave = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.currentTarget.style.setProperty("--mouse-x", "50%")
    e.currentTarget.style.setProperty("--mouse-y", "50%")
  }, [])

  return (
    <section
      id="pricing"
      className="relative py-20 sm:py-24 lg:py-32 px-8 sm:px-10 lg:px-12"
    >
      <LandingSectionTopGlow />
      <div className="max-w-6xl w-full mx-auto">
        <LandingSectionHeader
          title={t("pricing.title")}
          subtitle={t("pricing.subtitle")}
          isMobile={isMobile}
        />

        <div
          className={cn(
            "relative grid gap-3 sm:gap-4 mx-auto",
            // Layout adapts to PLAN_DATA.length so the grid stays legible
            // whether we ship 2, 3, 4, or 5 cards.  See lib/pricing/tiers.ts
            // PURCHASABLE_TIERS — toggle a tier's `purchasable` to add/remove.
            isMobile
              ? "grid-cols-1 max-w-md"
              : PLAN_DATA.length <= 2
                ? "grid-cols-1 sm:grid-cols-2 max-w-3xl"
                : PLAN_DATA.length === 3
                  ? "grid-cols-1 sm:grid-cols-3 max-w-4xl"
                  : PLAN_DATA.length === 4
                    ? "grid-cols-2 lg:grid-cols-4 max-w-5xl"
                    : cn(
                        "grid-cols-2 lg:grid-cols-3 xl:grid-cols-5",
                        // Narrow mode (parent has data-narrow because a video
                        // card is featured): drop from 5-col to 2-col so each
                        // pricing card stays ~340px and the price + feature
                        // list stay legible. Without this override the cards
                        // collapse to ~145px and the price text crashes into
                        // the feature checks.
                        "group-data-[narrow]/feat:grid-cols-1 group-data-[narrow]/feat:lg:grid-cols-2 group-data-[narrow]/feat:xl:grid-cols-2",
                        "group-data-[narrow]/feat:max-w-2xl group-data-[narrow]/feat:mx-auto",
                      ),
          )}
        >
          {PLAN_DATA.map((plan, planIdx) => {
            const vmLabel =
              plan.machines === 0
                ? t("pricing.vmTemporary")
                : plan.key === "lite"
                  ? t("pricing.vmDeletedAfterInactivity")
                  : plan.machines > 1
                    ? t("pricing.vmAlwaysOnPlural", { count: plan.machines })
                    : t("pricing.vmAlwaysOn", { count: plan.machines })

            return (
              <PlanCard
                key={plan.key}
                plan={plan}
                cardDelay={isMobile ? 0 : planIdx * 0.06}
                isMobile={isMobile}
                onMouseMove={!isMobile ? handleCardMouseMove : undefined}
                onMouseLeave={!isMobile ? handleCardMouseLeave : undefined}
                creditsLabel={
                  plan.key === "unlimited"
                    ? t("pricing.unlimitedCredits")
                    : plan.credits > 0
                      ? tc("creditsPerMonth", { count: plan.credits.toLocaleString() })
                      : "Pay-as-you-go credits"
                }
                vmLabel={vmLabel}
                swarmLabel={
                  // Three cases so the grammar reads right at every count:
                  //  0  → "Single agent at a time"  (free — no swarm mode)
                  //  1  → "1 concurrent agent"      (unlimited — explicit cap)
                  //  2+ → "N agents in parallel"    (paid swarm tiers)
                  plan.swarm === 0
                    ? "Single agent at a time"
                    : plan.swarm === 1
                      ? "1 concurrent agent"
                      : tc("agentsInParallel", { count: plan.swarm })
                }
                ctaLabel={
                  plan.price === "$0"
                    ? tc("startFree")
                    : t(`pricing.plans.${plan.key}.cta`)
                }
                ctaHref={plan.price === "$0" ? "/auth" : "/pricing"}
                planName={t(`pricing.plans.${plan.key}.name`)}
                planDescription={t(`pricing.plans.${plan.key}.description`)}
                monthLabel={tc("month")}
              />
            )
          })}
        </div>

        {/* Editorial outro — single hairline rule + one quiet line of copy. */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0, margin: "0px 0px -80px 0px" }}
          transition={{ duration: 0.6, delay: 0.4, ease: EASE }}
          className="mt-14 flex flex-col items-center gap-4"
        >
          <Link
            href="/pricing"
            className="group inline-flex items-center gap-1.5 text-[12px] text-foreground/55 hover:text-foreground transition-colors"
          >
            <span>View detailed comparison</span>
            <ArrowRight className="h-3 w-3 transition-transform duration-300 group-hover:translate-x-0.5" />
          </Link>
        </motion.div>
      </div>
    </section>
  )
}

// ── Card ──────────────────────────────────────────────────────────────────

function PlanCard({
  plan,
  cardDelay,
  isMobile,
  onMouseMove,
  onMouseLeave,
  creditsLabel,
  vmLabel,
  swarmLabel,
  ctaLabel,
  ctaHref,
  planName,
  planDescription,
  monthLabel,
}: {
  plan: (typeof PLAN_DATA)[number]
  cardDelay: number
  isMobile: boolean
  onMouseMove?: (e: React.MouseEvent<HTMLDivElement>) => void
  onMouseLeave?: (e: React.MouseEvent<HTMLDivElement>) => void
  creditsLabel: string
  vmLabel: string
  swarmLabel: string
  ctaLabel: string
  ctaHref: string
  planName: string
  planDescription: string
  monthLabel: string
}) {
  const [inView, setInView] = useState(false)

  // Parse the integer out of "$0" / "$100" so we can animate it.
  const target = parseInt(plan.price.replace(/[^0-9]/g, ""), 10) || 0
  const counterStart = inView && !isMobile
  const animatedValue = useCountUp(target, 1100, counterStart)
  const displayValue = isMobile ? target : animatedValue

  const isFree = plan.key === "free"
  const isHighlighted = plan.highlighted
  const isUnlimited = plan.key === "unlimited"

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      onViewportEnter={() => setInView(true)}
      viewport={{ once: true, amount: 0, margin: "0px 0px -80px 0px" }}
      transition={{ duration: 0.6, delay: cardDelay, ease: EASE }}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      className={cn(
        "group relative rounded-2xl flex flex-col min-w-0 isolate",
        "transition-[border-color,background-color,transform,box-shadow] duration-500 ease-out",
        "p-5 sm:p-6",
        // Shared grey card base across the whole landing page.
        "bg-card/40 backdrop-blur-[2px]",
        // Unlimited is the flagship — its distinction is carried by a stronger
        // foreground border + a single deeper hairline at the top, not by a
        // tinted wash. No colored accents anywhere on the card — typography
        // and weight do the differentiating work.
        isUnlimited
          ? "border border-foreground/45 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.10)] dark:shadow-[0_8px_24px_-12px_rgba(0,0,0,0.35)]"
          : isHighlighted
            ? "border border-foreground/25"
            : "border border-foreground/10 hover:border-foreground/20",
        !isMobile && "hover:-translate-y-0.5",
      )}
      style={{ "--mouse-x": "50%", "--mouse-y": "50%" } as React.CSSProperties}
    >
      {/* Mouse-tracked spotlight — same neutral pattern as elsewhere. */}
      {!isMobile && (
        <div
          aria-hidden
          className="absolute inset-0 rounded-2xl overflow-hidden opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
          style={{
            background:
              "radial-gradient(380px circle at var(--mouse-x) var(--mouse-y), rgba(120,130,145,0.06), transparent 45%)",
          }}
        />
      )}

      {/* Unlimited-only: slow amber smoke wash.  Sits below all chrome
          because subsequent content has `relative` (z=auto in the same
          stacking context, painted in source order — content renders
          after, on top). */}
      {isUnlimited && <UnlimitedSmoke variant="card" />}

      {/* Top sheen — only on the highlighted card, the single signature accent. */}
      {isHighlighted && !isUnlimited && (
        <div
          aria-hidden
          className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-foreground/30 to-transparent"
        />
      )}

      {/* Unlimited's signature accent — a single foreground hairline at the
          top edge, slightly stronger than Plus's. One signature accent only:
          the eyebrow chip below carries the only colored note on the card. */}
      {isUnlimited && (
        <div
          aria-hidden
          className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-foreground/45 to-transparent"
        />
      )}

      {/* "BEST VALUE" eyebrow — distinct from Plus's "Popular" badge */}
      {isUnlimited && (
        <div className="relative mb-2 -mt-0.5">
          <span className="inline-flex items-center gap-1 font-mono text-[9.5px] uppercase tracking-[0.22em] text-foreground/70">
            <InfinityIcon className="h-2.5 w-2.5" strokeWidth={2.5} />
            Best Value
          </span>
        </div>
      )}

      {/* Plan name */}
      <h3 className="relative font-semibold text-foreground tracking-tight text-base mb-1">
        {planName}
      </h3>

      {/* Description — quiet 1–2 line subtitle */}
      <p className="relative text-[12.5px] leading-snug text-muted-foreground/65 line-clamp-2 mb-6 min-h-[2.4em]">
        {planDescription}
      </p>

      {/* Price */}
      <div className="relative mb-5">
        <div className="flex items-baseline gap-0.5">
          <span className="text-foreground/55 text-2xl font-semibold tracking-[-0.04em]">$</span>
          <span className="text-5xl font-semibold tracking-[-0.04em] tabular-nums text-foreground leading-none">
            {displayValue}
          </span>
          <span className="ml-1 text-foreground/45 text-sm">/{monthLabel}</span>
        </div>
        <div
          className="mt-2 font-mono text-[9.5px] uppercase tracking-[0.22em] text-foreground/35"
        >
          {isFree ? "No credit card" : "Billed monthly"}
        </div>
      </div>

      {/* Hairline */}
      <div className="relative h-px bg-foreground/8 mb-5" />

      {/* Three feature lines — each is a quiet check + label */}
      <ul className="relative space-y-2.5 mb-6">
        <FeatureLine
          inView={inView}
          isMobile={isMobile}
          delay={cardDelay + 0.25}
          label={creditsLabel}
          dim={plan.credits === 0}
        />
        <FeatureLine
          inView={inView}
          isMobile={isMobile}
          delay={cardDelay + 0.32}
          label={vmLabel}
        />
        <FeatureLine
          inView={inView}
          isMobile={isMobile}
          delay={cardDelay + 0.39}
          label={swarmLabel}
          dim={plan.swarm === 0}
        />
      </ul>

      {/* Spacer pushes CTA to a uniform bottom across the row */}
      <div className="flex-1" />

      {/* CTA */}
      <Link
        href={ctaHref}
        className={cn(
          "relative inline-flex items-center justify-center gap-1.5 w-full rounded-full px-4 py-2.5",
          "text-sm font-medium transition-all duration-200 border",
          isUnlimited || isHighlighted
            ? "bg-foreground text-background border-foreground hover:bg-foreground/90"
            : "bg-transparent text-foreground border-foreground/15 hover:border-foreground/35 hover:bg-foreground/[0.025]",
        )}
      >
        <span>{ctaLabel}</span>
        <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
      </Link>
    </motion.div>
  )
}

// ── Feature line ──────────────────────────────────────────────────────────

function FeatureLine({
  inView,
  isMobile,
  delay,
  label,
  dim = false,
}: {
  inView: boolean
  isMobile: boolean
  delay: number
  label: string
  dim?: boolean
}) {
  return (
    <motion.li
      initial={{ opacity: 0, x: -4 }}
      animate={inView ? { opacity: 1, x: 0 } : { opacity: 0, x: -4 }}
      transition={{ duration: 0.4, delay, ease: EASE }}
      className={cn(
        "flex items-start gap-2 text-[12.5px] leading-snug",
        dim ? "text-foreground/40" : "text-foreground/75",
      )}
    >
      <Check
        className={cn(
          "h-3 w-3 mt-[3px] shrink-0",
          dim ? "text-foreground/25" : "text-foreground/55",
        )}
        strokeWidth={2.4}
      />
      <span>{label}</span>
    </motion.li>
  )
}
