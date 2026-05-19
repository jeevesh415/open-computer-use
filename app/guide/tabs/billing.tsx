"use client"

import Link from "next/link"
import { motion } from "framer-motion"
import { useTranslations } from "next-intl"
import {
  ArrowRight,
  Lightning,
  Star,
  Infinity as InfinityIcon,
} from "@phosphor-icons/react"
import { UnlimitedSmoke } from "@/app/components/effects/unlimited-smoke"

/* ─── animation variants ─── */

const fade = {
  hidden: { opacity: 0, y: 20 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, delay: i * 0.05, ease: [0.25, 0.1, 0.25, 1] as const },
  }),
}

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
}

/* ─── CSS animations ─── */

const billingAnimations = `
@keyframes gv-gauge-fill {
  0% { stroke-dashoffset: 251; }
  100% { stroke-dashoffset: 63; }
}
@keyframes gv-tick {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 1; }
}
@keyframes gv-progress-deplete {
  0% { width: 100%; }
  100% { width: 0%; }
}
@keyframes gv-credit-count {
  0% { opacity: 0; transform: translateY(4px); }
  100% { opacity: 1; transform: translateY(0); }
}
@keyframes gv-pulse-ring {
  0% { transform: scale(1); opacity: 0.3; }
  50% { transform: scale(1.15); opacity: 0; }
  100% { transform: scale(1); opacity: 0; }
}
.gv-gauge-fill {
  animation: gv-gauge-fill 2s ease-out forwards;
  stroke-dasharray: 251;
  stroke-dashoffset: 251;
}
.gv-tick-1 { animation: gv-tick 2s ease-in-out infinite; }
.gv-tick-2 { animation: gv-tick 2s ease-in-out 0.3s infinite; }
.gv-tick-3 { animation: gv-tick 2s ease-in-out 0.6s infinite; }
.gv-progress-deplete { animation: gv-progress-deplete 4s linear infinite; }
.gv-credit-count { animation: gv-credit-count 0.5s ease-out 0.8s both; }
.gv-pulse-ring { animation: gv-pulse-ring 2s ease-out infinite; }
`

/* ─── plans data ─── */

// Master list — every entry stays in code so re-enabling a plan is a
// single `purchasable: true` flip.  The render filters to purchasable
// entries only; the source of truth for which plans are live is
// lib/pricing/tiers.ts (PURCHASABLE_DB_TIERS).
const ALL_PLAN_KEYS: readonly { key: string; name: string; price: string; popular?: boolean; featured?: boolean; purchasable: boolean }[] = [
  { key: "free", name: "Free", price: "$0", purchasable: false },
  { key: "lite", name: "Lite", price: "$9", purchasable: false },
  { key: "starter", name: "Starter", price: "$19", purchasable: true },
  { key: "unlimited", name: "Unlimited", price: "$249", featured: true, purchasable: true },
]

const planKeys = ALL_PLAN_KEYS.filter((p) => p.purchasable)

const faqKeys = ["howCharged", "runOut", "rollOver"] as const

/* ─── main component ─── */

export function BillingTab({ inApp }: { inApp: boolean }) {
  const t = useTranslations("guide.billingTab")
  return (
    <div className="space-y-16 sm:space-y-20">
      <style dangerouslySetInnerHTML={{ __html: billingAnimations }} />

      {/* ── Section 1: Hero — Credits Visual ── */}
      <motion.section
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-60px" }}
        variants={stagger}
      >
        <motion.h2
          variants={fade}
          custom={0}
          className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight mb-2 text-center"
        >
          {t("credits")}
        </motion.h2>
        <motion.p
          variants={fade}
          custom={1}
          className="text-sm text-foreground/50 text-center mb-10"
        >
          {t("timeMetric")}
        </motion.p>

        <motion.div
          variants={fade}
          custom={2}
          className="grid grid-cols-1 sm:grid-cols-2 gap-6 items-center"
        >
          {/* Left: Credit gauge */}
          <div className="flex flex-col items-center">
            <div className="relative w-[180px] h-[180px]">
              {/* Background ring */}
              <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                <circle
                  cx="50" cy="50" r="40"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  className="text-foreground/[0.06]"
                />
                <circle
                  cx="50" cy="50" r="40"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  className="text-foreground/50 gv-gauge-fill"
                />
              </svg>
              {/* Pulse ring */}
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-[100px] h-[100px] rounded-full border border-foreground/[0.06] gv-pulse-ring" />
              </div>
              {/* Center text */}
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-[11px] font-medium text-foreground/30 mb-1">{t("rate")}</span>
                <span className="text-2xl font-bold text-foreground/70 gv-credit-count">{t("rateValue")}</span>
                <span className="text-[10px] text-foreground/30 mt-0.5">{t("creditsPerMin")}</span>
              </div>
            </div>
            {/* Tick marks */}
            <div className="flex items-center gap-3 mt-4">
              <div className="flex items-center gap-1">
                <div className="gv-tick-1 w-1 h-3 rounded-full bg-foreground/20" />
                <div className="gv-tick-2 w-1 h-3 rounded-full bg-foreground/20" />
                <div className="gv-tick-3 w-1 h-3 rounded-full bg-foreground/20" />
              </div>
              <span className="text-[11px] text-foreground/30">{t("metered")}</span>
            </div>
          </div>

          {/* Right: Example */}
          <div className="rounded-2xl border border-foreground/[0.06] bg-foreground/[0.02] p-6">
            <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-foreground/30 mb-5">
              {t("example")}
            </p>
            <div className="flex items-baseline gap-2 mb-4">
              <span className="text-3xl font-bold text-foreground/70">8</span>
              <span className="text-sm text-foreground/30">{t("minTask")}</span>
            </div>

            {/* Progress bar */}
            <div className="relative w-full h-2 rounded-full bg-foreground/[0.06] mb-3 overflow-hidden">
              <div className="gv-progress-deplete absolute inset-y-0 left-0 rounded-full bg-foreground/20" />
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[11px] text-foreground/30">{t("startCredits", { count: 600 })}</span>
              <span className="text-[11px] text-foreground/30">{t("endCredits", { count: 520 })}</span>
            </div>

            <div className="mt-5 flex items-center gap-3 rounded-xl bg-foreground/[0.03] px-4 py-3">
              <Lightning size={16} weight="duotone" className="text-foreground/40" />
              <div>
                <p className="text-sm font-semibold text-foreground/60">{t("creditsUsed", { count: 80 })}</p>
                <p className="text-[11px] text-foreground/30">{t("calculation", { mins: 8 })}</p>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.section>

      {/* ── Section 2: Plans ── */}
      <motion.section
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-60px" }}
        variants={stagger}
      >
        <motion.h2
          variants={fade}
          custom={0}
          className="text-xl sm:text-2xl font-bold text-foreground tracking-tight mb-8 text-center"
        >
          {t("plans")}
        </motion.h2>

        <motion.div
          variants={stagger}
          className={`grid gap-3 mx-auto ${
            planKeys.length <= 2
              ? "grid-cols-1 sm:grid-cols-2 max-w-2xl"
              : planKeys.length === 3
                ? "grid-cols-1 sm:grid-cols-3"
                : planKeys.length === 4
                  ? "grid-cols-2 sm:grid-cols-4"
                  : planKeys.length === 5
                    ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"
                    : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6"
          }`}
        >
          {planKeys.map((plan, i) => (
            <motion.div
              key={plan.key}
              variants={fade}
              custom={i + 1}
              className={`relative overflow-hidden isolate rounded-2xl border p-4 text-center transition-colors ${
                plan.featured
                  ? "border-amber-500/40 shadow-[0_8px_24px_-8px_rgba(245,158,11,0.25)]"
                  : plan.popular
                    ? "border-foreground/[0.15] bg-foreground/[0.04]"
                    : "border-foreground/[0.06] bg-foreground/[0.02]"
              }`}
            >
              {/* Unlimited-only smoke wash — slow amber drift */}
              {plan.featured && <UnlimitedSmoke variant="stat" />}

              {plan.featured && (
                <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 z-20">
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500 border border-amber-600/30 px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-white shadow-[0_2px_8px_-2px_rgba(245,158,11,0.55)]">
                    <InfinityIcon size={8} weight="bold" />
                    Best Value
                  </span>
                </div>
              )}
              {plan.popular && !plan.featured && (
                <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 z-20">
                  <span className="inline-flex items-center gap-1 rounded-full bg-foreground/[0.06] border border-foreground/[0.1] px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-foreground/50">
                    <Star size={8} weight="fill" />
                    Popular
                  </span>
                </div>
              )}

              <p className={`relative text-[12px] font-semibold mb-1 mt-1 ${plan.featured ? "text-amber-700 dark:text-amber-400" : "text-foreground/60"}`}>{plan.name}</p>
              <p className={`relative text-xl font-bold mb-3 ${plan.featured ? "text-foreground" : "text-foreground/70"}`}>{t("perMonth", { price: plan.price })}</p>

              <div className="relative space-y-2 text-[11px] text-foreground/40">
                <p><span className={`font-semibold ${plan.featured ? "text-amber-700 dark:text-amber-400" : "text-foreground/55"}`}>{t(`planData.${plan.key}.credits`)}</span> {plan.key !== "unlimited" && t("credits").toLowerCase()}</p>
                <p>{t(`planData.${plan.key}.machines`)}</p>
                <p className="text-foreground/35">{t(`planData.${plan.key}.feature`)}</p>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </motion.section>

      {/* ── Section 3: FAQ ── */}
      <motion.section
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-60px" }}
        variants={stagger}
      >
        <motion.h2
          variants={fade}
          custom={0}
          className="text-xl sm:text-2xl font-bold text-foreground tracking-tight mb-8 text-center"
        >
          {t("faqTitle")}
        </motion.h2>

        <motion.div variants={stagger} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {faqKeys.map((key, i) => (
            <motion.div
              key={key}
              variants={fade}
              custom={i + 1}
              className="rounded-2xl border border-foreground/[0.06] bg-foreground/[0.02] p-5"
            >
              <p className="text-[13px] font-semibold text-foreground/60 mb-2">{t(`faqs.${key}.q`)}</p>
              <p className="text-[12px] text-foreground/35 leading-relaxed">{t(`faqs.${key}.a`)}</p>
            </motion.div>
          ))}
        </motion.div>
      </motion.section>

      {/* ── CTA ── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ duration: 0.5, ease: [0.25, 0.1, 0.25, 1] }}
        className="flex justify-center"
      >
        <Link
          href="/account?section=billing"
          className="inline-flex items-center gap-2.5 h-11 px-6 rounded-xl bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity"
        >
          {t("goToBilling")}
          <ArrowRight size={15} weight="bold" />
        </Link>
      </motion.div>
    </div>
  )
}
