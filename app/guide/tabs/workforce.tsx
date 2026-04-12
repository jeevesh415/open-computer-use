"use client"

import { motion } from "framer-motion"
import Link from "next/link"
import { useTranslations } from "next-intl"
import {
  UsersThree,
  Briefcase,
  Brain,
  Lightning,
  ShareNetwork,
  TreeStructure,
  Clock,
  ArrowRight,
  PencilSimple,
  Megaphone,
  ShoppingCart,
  HeadphonesIcon,
} from "@phosphor-icons/react"

const fade = {
  hidden: { opacity: 0, y: 24 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, delay: i * 0.07, ease: [0.25, 0.1, 0.25, 1] as const },
  }),
}

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07 } },
}

const conceptKeys = [
  { icon: UsersThree, key: "employees" },
  { icon: Briefcase, key: "teams" },
  { icon: Brain, key: "sharedMemory" },
  { icon: Lightning, key: "triggers" },
  { icon: ShareNetwork, key: "delegates" },
  { icon: TreeStructure, key: "orgChart" },
] as const

const templateKeys = [
  { icon: PencilSimple, key: "contentOps" },
  { icon: HeadphonesIcon, key: "customerSupport" },
  { icon: Megaphone, key: "marketing" },
  { icon: ShoppingCart, key: "ecommerce" },
] as const

const cssAnimations = `
  @keyframes gv-org-company { 0% { opacity: 0; transform: scale(0.8) } 15%, 100% { opacity: 1; transform: scale(1) } }
  @keyframes gv-org-team-1 { 0%, 15% { opacity: 0; transform: translateY(-8px) } 30%, 100% { opacity: 1; transform: translateY(0) } }
  @keyframes gv-org-team-2 { 0%, 22% { opacity: 0; transform: translateY(-8px) } 37%, 100% { opacity: 1; transform: translateY(0) } }
  @keyframes gv-org-emp { 0%, 35% { opacity: 0; transform: scale(0) } 50%, 100% { opacity: 1; transform: scale(1) } }
  @keyframes gv-org-emp-d2 { 0%, 42% { opacity: 0; transform: scale(0) } 57%, 100% { opacity: 1; transform: scale(1) } }
  @keyframes gv-org-emp-d3 { 0%, 49% { opacity: 0; transform: scale(0) } 64%, 100% { opacity: 1; transform: scale(1) } }
  @keyframes gv-clock-tick { 0%, 100% { opacity: 0.3 } 50% { opacity: 0.6 } }
  @keyframes gv-chain-check { 0% { stroke-dashoffset: 20 } 30%, 100% { stroke-dashoffset: 0 } }
  @keyframes gv-chain-spin { 0% { transform: rotate(0deg) } 100% { transform: rotate(360deg) } }
  @keyframes gv-chain-line-1 { 0%, 25% { opacity: 0 } 35%, 100% { opacity: 1 } }
  @keyframes gv-chain-line-2 { 0%, 55% { opacity: 0 } 65%, 100% { opacity: 1 } }
  @keyframes gv-chain-step-2 { 0%, 30% { opacity: 0.3 } 40%, 100% { opacity: 1 } }
  @keyframes gv-chain-step-3 { 0%, 60% { opacity: 0.3 } 70%, 100% { opacity: 0.35 } }
  .gv-org-company { animation: gv-org-company 3s ease-out both }
  .gv-org-team-1 { animation: gv-org-team-1 3s ease-out both }
  .gv-org-team-2 { animation: gv-org-team-2 3s ease-out both }
  .gv-org-emp { animation: gv-org-emp 3s ease-out both }
  .gv-org-emp-d2 { animation: gv-org-emp-d2 3s ease-out both }
  .gv-org-emp-d3 { animation: gv-org-emp-d3 3s ease-out both }
  .gv-clock { animation: gv-clock-tick 2s ease-in-out infinite }
  .gv-chain-check { animation: gv-chain-check 5s ease-out infinite }
  .gv-chain-spin { animation: gv-chain-spin 1s linear infinite }
  .gv-chain-line-1 { animation: gv-chain-line-1 5s ease-out infinite }
  .gv-chain-line-2 { animation: gv-chain-line-2 5s ease-out infinite }
  .gv-chain-step-2 { animation: gv-chain-step-2 5s ease-out infinite }
  .gv-chain-step-3 { animation: gv-chain-step-3 5s ease-out infinite }
`

const orgEmployees: { initials: string; roleKey: string; freq: string; animClass: string }[][] = [
  [
    { initials: "AT", roleKey: "writer", freq: "daily", animClass: "gv-org-emp" },
    { initials: "EC", roleKey: "seo", freq: "weekly", animClass: "gv-org-emp-d2" },
    { initials: "NV", roleKey: "social", freq: "12h", animClass: "gv-org-emp-d3" },
  ],
  [
    { initials: "SG", roleKey: "inbox", freq: "30m", animClass: "gv-org-emp" },
    { initials: "IR", roleKey: "docs", freq: "weekly", animClass: "gv-org-emp-d2" },
  ],
]

export function WorkforceTab({ inApp }: { inApp: boolean }) {
  const t = useTranslations("guide.workforceTab")
  return (
    <div className="space-y-0">
      <style dangerouslySetInnerHTML={{ __html: cssAnimations }} />

      {/* ── Hero: Org Chart Visual ── */}
      <motion.section
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-60px" }}
        variants={stagger}
        className="mb-16 sm:mb-20"
      >
        <motion.p
          variants={fade}
          custom={0}
          className="text-xs font-medium uppercase tracking-[0.2em] text-foreground/50 mb-4"
        >
          {t("title")}
        </motion.p>

        <motion.h2
          variants={fade}
          custom={1}
          className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight mb-2"
        >
          {t("subtitle")}
        </motion.h2>

        <motion.p
          variants={fade}
          custom={2}
          className="text-sm text-foreground/50 mb-10 max-w-md"
        >
          {t("description")}
        </motion.p>

        {/* Animated org chart */}
        <motion.div
          variants={fade}
          custom={3}
          className="rounded-2xl border border-foreground/[0.06] bg-foreground/[0.02] p-6 sm:p-10 max-w-xl"
        >
          <div className="flex flex-col items-center">
            {/* Company box */}
            <div className="gv-org-company rounded-xl border border-foreground/[0.08] bg-foreground/[0.04] px-5 py-2.5 text-center mb-1">
              <p className="text-[13px] font-bold text-foreground/70">{t("myCompany")}</p>
            </div>

            <div className="h-6 w-px bg-foreground/[0.08]" />

            {/* Teams row */}
            <div className="flex gap-10 sm:gap-16 items-start">
              {(["contentOps", "support"] as const).map((teamKey, ti) => (
                <div key={teamKey} className="flex flex-col items-center">
                  <div className={`${ti === 0 ? "gv-org-team-1" : "gv-org-team-2"} rounded-lg border border-foreground/[0.08] bg-foreground/[0.03] px-4 py-2 text-center mb-1`}>
                    <p className="text-[11px] font-semibold text-foreground/60">{t(teamKey)}</p>
                  </div>

                  <div className="h-4 w-px bg-foreground/[0.06]" />

                  {/* Employee avatars */}
                  <div className="flex flex-col gap-2 mt-1">
                    {orgEmployees[ti].map((emp) => (
                      <div key={emp.initials} className={`${emp.animClass} flex items-center gap-2`}>
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-foreground/[0.08] bg-foreground/[0.04]">
                          <span className="text-[9px] font-bold text-foreground/50">{emp.initials}</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[10px] font-medium text-foreground/50">{t(emp.roleKey)}</span>
                          <span className="flex items-center gap-0.5 text-[9px] text-foreground/30 gv-clock">
                            <Clock size={8} weight="fill" />
                            {emp.freq}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      </motion.section>

      {/* ── Core Concepts Grid ── */}
      <motion.section
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-60px" }}
        variants={stagger}
        className="mb-16 sm:mb-20"
      >
        <motion.h2
          variants={fade}
          custom={0}
          className="text-xl sm:text-2xl font-bold text-foreground tracking-tight mb-6"
        >
          {t("concepts")}
        </motion.h2>

        <motion.div variants={stagger} className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {conceptKeys.map((c, i) => {
            const Icon = c.icon
            return (
              <motion.div
                key={c.key}
                variants={fade}
                custom={i + 1}
                className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] p-4"
              >
                <Icon size={20} weight="duotone" className="text-foreground/40 mb-2.5" />
                <p className="text-[13px] font-semibold text-foreground mb-0.5">{t(`conceptItems.${c.key}.title`)}</p>
                <p className="text-[11px] text-foreground/40 leading-snug">{t(`conceptItems.${c.key}.desc`)}</p>
              </motion.div>
            )
          })}
        </motion.div>
      </motion.section>

      {/* ── Trigger Chain Visual ── */}
      <motion.section
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-60px" }}
        variants={stagger}
        className="mb-16 sm:mb-20"
      >
        <motion.h2
          variants={fade}
          custom={0}
          className="text-xl sm:text-2xl font-bold text-foreground tracking-tight mb-2"
        >
          {t("chainTitle")}
        </motion.h2>

        <motion.p
          variants={fade}
          custom={1}
          className="text-sm text-foreground/50 mb-8 max-w-md"
        >
          {t("chainDesc")}
        </motion.p>

        <motion.div
          variants={fade}
          custom={2}
          className="rounded-2xl border border-foreground/[0.06] bg-foreground/[0.02] p-5 sm:p-8 max-w-lg"
        >
          {/* Step 1 - Completed */}
          <div className="flex items-center gap-3 rounded-xl border border-foreground/[0.08] bg-foreground/[0.03] px-4 py-3">
            <svg width="18" height="18" viewBox="0 0 18 18" className="text-foreground/50 shrink-0">
              <circle cx="9" cy="9" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
              <path d="M5.5 9l2.5 2.5 4.5-4.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" className="gv-chain-check" />
            </svg>
            <div className="flex-1 min-w-0">
              <span className="text-[13px] font-semibold text-foreground/70">{t("scout")}</span>
              <span className="text-[11px] text-foreground/35 ml-2">{t("scoutDesc")}</span>
            </div>
            <span className="text-[10px] font-medium text-foreground/40">{t("done")}</span>
          </div>

          {/* Arrow 1 */}
          <div className="flex items-center gap-2 pl-7 py-1 gv-chain-line-1">
            <div className="h-5 w-px bg-foreground/[0.1]" />
            <span className="text-[9px] font-medium text-foreground/30 bg-foreground/[0.03] px-2 py-0.5 rounded-full">
              {t("onComplete")}
            </span>
          </div>

          {/* Step 2 - Running */}
          <div className="flex items-center gap-3 rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] px-4 py-3 gv-chain-step-2">
            <div className="gv-chain-spin shrink-0">
              <svg width="16" height="16" viewBox="0 0 16 16" className="text-foreground/40">
                <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="26 10" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-[13px] font-semibold text-foreground/60">{t("atlas")}</span>
              <span className="text-[11px] text-foreground/30 ml-2">{t("atlasDesc")}</span>
            </div>
            <span className="text-[10px] font-medium text-foreground/35">Running</span>
          </div>

          {/* Arrow 2 */}
          <div className="flex items-center gap-2 pl-7 py-1 gv-chain-line-2">
            <div className="h-5 w-px bg-foreground/[0.06]" />
            <span className="text-[9px] font-medium text-foreground/20 bg-foreground/[0.02] px-2 py-0.5 rounded-full">
              {t("onComplete")}
            </span>
          </div>

          {/* Step 3 - Waiting */}
          <div className="flex items-center gap-3 rounded-xl border border-foreground/[0.04] bg-foreground/[0.01] px-4 py-3 gv-chain-step-3">
            <div className="h-2 w-2 rounded-full bg-foreground/15 shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-[13px] font-semibold text-foreground/35">{t("nova")}</span>
              <span className="text-[11px] text-foreground/20 ml-2">{t("novaDesc")}</span>
            </div>
            <span className="text-[10px] font-medium text-foreground/20">{t("waiting")}</span>
          </div>
        </motion.div>
      </motion.section>

      {/* ── Templates Preview ── */}
      <motion.section
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-60px" }}
        variants={stagger}
        className="mb-16 sm:mb-20"
      >
        <motion.h2
          variants={fade}
          custom={0}
          className="text-xl sm:text-2xl font-bold text-foreground tracking-tight mb-6"
        >
          {t("templates")}
        </motion.h2>

        <motion.div variants={stagger} className="grid grid-cols-2 gap-3 max-w-lg">
          {templateKeys.map((tmpl, i) => {
            const Icon = tmpl.icon
            return (
              <motion.div
                key={tmpl.key}
                variants={fade}
                custom={i + 1}
                className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] p-4"
              >
                <Icon size={20} weight="duotone" className="text-foreground/40 mb-3" />
                <p className="text-[13px] font-semibold text-foreground mb-1">{t(`templateItems.${tmpl.key}.name`)}</p>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-medium text-foreground/30 bg-foreground/[0.04] px-2 py-0.5 rounded-full">
                    {t(`templateItems.${tmpl.key}.plan`)}
                  </span>
                  <span className="text-[10px] text-foreground/30">{t("employees", { count: t(`templateItems.${tmpl.key}.count`) })}</span>
                </div>
              </motion.div>
            )
          })}
        </motion.div>
      </motion.section>

      {/* ── CTA ── */}
      {inApp && (
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.5, ease: [0.25, 0.1, 0.25, 1] }}
          className="text-center mb-8"
        >
          <Link
            href="/schedules"
            className="inline-flex items-center gap-2 h-10 px-6 rounded-xl bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity"
          >
            {t("openWorkforce")}
            <ArrowRight size={14} weight="bold" />
          </Link>
        </motion.section>
      )}
    </div>
  )
}
