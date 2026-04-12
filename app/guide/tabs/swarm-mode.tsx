"use client"

import { motion } from "framer-motion"
import { useTranslations } from "next-intl"
import {
  MagnifyingGlass,
  Briefcase,
  MapPin,
  EnvelopeSimple,
  ShareNetwork,
  TestTube,
  Lock,
  CheckCircle,
  ArrowRight,
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

const useCaseKeys = [
  { icon: MagnifyingGlass, key: "parallelResearch" },
  { icon: Briefcase, key: "bulkApplications" },
  { icon: MapPin, key: "multiCitySearch" },
  { icon: EnvelopeSimple, key: "parallelOutreach" },
  { icon: ShareNetwork, key: "crossPlatform" },
  { icon: TestTube, key: "distributedTesting" },
] as const

const cssAnimations = `
  @keyframes gv-bar-1 { 0% { width: 0% } 40% { width: 100% } 100% { width: 100% } }
  @keyframes gv-bar-2 { 0% { width: 0% } 50% { width: 100% } 100% { width: 100% } }
  @keyframes gv-bar-3 { 0% { width: 0% } 100% { width: 72% } }
  @keyframes gv-bar-4 { 0% { width: 0% } 100% { width: 45% } }
  @keyframes gv-check-pop { 0%, 35% { transform: scale(0); opacity: 0 } 45% { transform: scale(1.2); opacity: 1 } 50%, 100% { transform: scale(1); opacity: 1 } }
  @keyframes gv-check-pop-2 { 0%, 45% { transform: scale(0); opacity: 0 } 55% { transform: scale(1.2); opacity: 1 } 60%, 100% { transform: scale(1); opacity: 1 } }
  @keyframes gv-spin { 0% { transform: rotate(0deg) } 100% { transform: rotate(360deg) } }
  @keyframes gv-converge { 0%, 70% { opacity: 0; transform: translateY(-8px) } 80% { opacity: 1; transform: translateY(0) } 100% { opacity: 1; transform: translateY(0) } }
  @keyframes gv-result-pop { 0%, 80% { transform: scale(0); opacity: 0 } 90% { transform: scale(1.1); opacity: 1 } 95%, 100% { transform: scale(1); opacity: 1 } }
  @keyframes gv-pulse-dim { 0%, 100% { opacity: 0.35 } 50% { opacity: 0.5 } }
  .gv-bar-1 { animation: gv-bar-1 4s ease-out infinite }
  .gv-bar-2 { animation: gv-bar-2 4s ease-out infinite }
  .gv-bar-3 { animation: gv-bar-3 4s ease-out infinite }
  .gv-bar-4 { animation: gv-bar-4 4s ease-out infinite }
  .gv-check-1 { animation: gv-check-pop 4s ease-out infinite }
  .gv-check-2 { animation: gv-check-pop-2 4s ease-out infinite }
  .gv-spinner { animation: gv-spin 1s linear infinite }
  .gv-converge { animation: gv-converge 4s ease-out infinite }
  .gv-result { animation: gv-result-pop 4s ease-out infinite }
  .gv-pending { animation: gv-pulse-dim 2s ease-in-out infinite }
`

const machines: { id: number; status: "done" | "run" | "wait"; delay: string }[] = [
  { id: 1, status: "done", delay: "gv-bar-1" },
  { id: 2, status: "done", delay: "gv-bar-2" },
  { id: 3, status: "run", delay: "gv-bar-3" },
  { id: 4, status: "run", delay: "gv-bar-4" },
  { id: 5, status: "wait", delay: "" },
]

export function SwarmModeTab({ inApp }: { inApp: boolean }) {
  const t = useTranslations("guide.swarmTab")
  return (
    <div className="space-y-0">
      <style dangerouslySetInnerHTML={{ __html: cssAnimations }} />

      {/* ── Hero: Parallel Execution Visual ── */}
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
          {t("runParallel", { count: 5 })}
        </motion.h2>

        <motion.p
          variants={fade}
          custom={2}
          className="text-sm text-foreground/50 mb-10 max-w-md"
        >
          {t("sameTask", { multiplier: 5 })}
        </motion.p>

        {/* Animated machine cards */}
        <motion.div
          variants={fade}
          custom={3}
          className="rounded-2xl border border-foreground/[0.06] bg-foreground/[0.02] p-5 sm:p-8 max-w-2xl"
        >
          <div className="grid grid-cols-5 gap-2 sm:gap-3 mb-8">
            {machines.map((m) => (
              <div
                key={m.id}
                className={`rounded-xl border border-foreground/[0.06] bg-foreground/[0.03] p-2.5 sm:p-3 text-center ${m.status === "wait" ? "gv-pending" : ""}`}
              >
                <div className="text-[11px] font-bold text-foreground/40 mb-1.5">M{m.id}</div>

                {/* Progress bar */}
                <div className="h-1.5 rounded-full bg-foreground/[0.06] mb-2 overflow-hidden">
                  {m.status === "done" && (
                    <div className={`h-full rounded-full bg-foreground/30 ${m.delay}`} />
                  )}
                  {m.status === "run" && (
                    <div className={`h-full rounded-full bg-foreground/20 ${m.delay}`} />
                  )}
                </div>

                {/* Status icon */}
                <div className="h-4 flex items-center justify-center">
                  {m.status === "done" && (
                    <div className={m.id === 1 ? "gv-check-1" : "gv-check-2"}>
                      <svg width="14" height="14" viewBox="0 0 14 14" className="text-foreground/60">
                        <circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="1.2" />
                        <path d="M4 7l2 2 4-4" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                  )}
                  {m.status === "run" && (
                    <div className="gv-spinner">
                      <svg width="12" height="12" viewBox="0 0 12 12" className="text-foreground/40">
                        <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="20 8" />
                      </svg>
                    </div>
                  )}
                  {m.status === "wait" && (
                    <div className="h-1.5 w-1.5 rounded-full bg-foreground/20" />
                  )}
                </div>

                <div className="text-[9px] font-medium text-foreground/30 mt-1">
                  {m.status === "done" ? t("done") : m.status === "run" ? t("running") : t("pending")}
                </div>
              </div>
            ))}
          </div>

          {/* Converging arrows */}
          <div className="flex justify-center mb-3 gv-converge">
            <svg width="120" height="24" viewBox="0 0 120 24" className="text-foreground/20">
              <path d="M10 4 L60 20" fill="none" stroke="currentColor" strokeWidth="1" />
              <path d="M35 4 L60 20" fill="none" stroke="currentColor" strokeWidth="1" />
              <path d="M60 4 L60 20" fill="none" stroke="currentColor" strokeWidth="1" />
              <path d="M85 4 L60 20" fill="none" stroke="currentColor" strokeWidth="1" />
              <path d="M110 4 L60 20" fill="none" stroke="currentColor" strokeWidth="1" />
            </svg>
          </div>

          {/* Result badge */}
          <div className="flex justify-center gv-result">
            <div className="inline-flex items-center gap-2 rounded-full border border-foreground/[0.08] bg-foreground/[0.05] px-4 py-1.5">
              <svg width="12" height="12" viewBox="0 0 12 12" className="text-foreground/50">
                <circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" strokeWidth="1" />
                <path d="M3.5 6l2 2 3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="text-xs font-semibold text-foreground/60">{t("result")}</span>
            </div>
          </div>
        </motion.div>
      </motion.section>

      {/* ── Use Cases Grid ── */}
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
          {t("whatToSwarm")}
        </motion.h2>

        <motion.div variants={stagger} className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {useCaseKeys.map((uc, i) => {
            const Icon = uc.icon
            return (
              <motion.div
                key={i}
                variants={fade}
                custom={i + 1}
                className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] p-4"
              >
                <Icon size={20} weight="duotone" className="text-foreground/40 mb-2.5" />
                <p className="text-[13px] font-semibold text-foreground mb-0.5">{t(`useCases.${uc.key}.title`)}</p>
                <p className="text-[11px] text-foreground/40 leading-snug">{t(`useCases.${uc.key}.desc`, { count: 5 })}</p>
              </motion.div>
            )
          })}
        </motion.div>
      </motion.section>

      {/* ── Availability ── */}
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
          {t("availability")}
        </motion.h2>

        <motion.div variants={stagger} className="grid grid-cols-2 gap-3 max-w-md">
          <motion.div
            variants={fade}
            custom={1}
            className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] p-4 text-center"
          >
            <Lock size={20} weight="duotone" className="text-foreground/25 mx-auto mb-2" />
            <p className="text-sm font-semibold text-foreground/40">Free</p>
            <p className="text-[11px] text-foreground/25 mt-0.5">{t("freeNotAvailable")}</p>
          </motion.div>
          <motion.div
            variants={fade}
            custom={2}
            className="rounded-xl border border-foreground/[0.08] bg-foreground/[0.03] p-4 text-center"
          >
            <CheckCircle size={20} weight="duotone" className="text-foreground/50 mx-auto mb-2" />
            <p className="text-sm font-semibold text-foreground">{t("litePlus")}</p>
            <p className="text-[11px] text-foreground/40 mt-0.5">{t("agentRange")}</p>
          </motion.div>
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
          <a
            href="/"
            className="inline-flex items-center gap-2 h-10 px-6 rounded-xl bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity"
          >
            {t("startSwarm")}
            <ArrowRight size={14} weight="bold" />
          </a>
        </motion.section>
      )}
    </div>
  )
}
