"use client"

import { Fragment } from "react"
import Link from "next/link"
import { motion } from "framer-motion"
import { useTranslations } from "next-intl"
import {
  ArrowRight,
  Desktop,
  Cpu,
  HardDrives,
  GearSix,
  Play,
  Stop,
  CircleNotch,
} from "@phosphor-icons/react"

/* ─── animations ─── */

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
}

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const } },
}

/* ─── CSS keyframes ─── */

const machineStyles = `
  @keyframes gv-pulse-green {
    0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(34,197,94,0.4) }
    50% { opacity: 0.7; box-shadow: 0 0 0 6px rgba(34,197,94,0) }
  }
  @keyframes gv-spin {
    0% { transform: rotate(0deg) }
    100% { transform: rotate(360deg) }
  }
  @keyframes gv-progress-fill {
    0% { width: 0% }
    60% { width: 72% }
    80% { width: 88% }
    100% { width: 95% }
  }
  @keyframes gv-fade-in {
    0% { opacity: 0; transform: translateY(4px) }
    100% { opacity: 1; transform: translateY(0) }
  }
  @keyframes gv-arrow-flow {
    0% { opacity: 0.15; transform: translateX(-2px) }
    50% { opacity: 0.5; transform: translateX(2px) }
    100% { opacity: 0.15; transform: translateX(-2px) }
  }
  @keyframes gv-dot-appear {
    0% { transform: scale(0); opacity: 0 }
    60% { transform: scale(1.3); opacity: 1 }
    100% { transform: scale(1); opacity: 1 }
  }
`

/* ─── data ─── */

const planLimits = [
  { plan: "Free", machines: "1 temp", swarm: "--" },
  { plan: "Lite", machines: "1", swarm: "2" },
  { plan: "Starter", machines: "1", swarm: "3" },
  { plan: "Plus", machines: "2", swarm: "6" },
  { plan: "Pro", machines: "3", swarm: "9" },
]

const lifecycleKeys = [
  { key: "creating", dotClass: "bg-foreground/30" },
  { key: "starting", dotClass: "bg-foreground/40" },
  { key: "running", dotClass: "bg-foreground/60" },
  { key: "stopping", dotClass: "bg-foreground/40" },
  { key: "stopped", dotClass: "bg-foreground/20" },
] as const

/* ─── hero mock components ─── */

function DashboardMock({ t }: { t: any }) {
  return (
    <div className="rounded-2xl border border-foreground/[0.06] bg-foreground/[0.02] p-4 sm:p-6">
      {/* Header bar */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <Desktop size={14} weight="duotone" className="text-foreground/40" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.15em] text-foreground/40">
            {t("title")}
          </span>
        </div>
        <div className="h-6 px-3 rounded-md bg-foreground/[0.06] flex items-center">
          <span className="text-[10px] text-foreground/30">{t("newMachine")}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Card 1: Running */}
        <div className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground/70">{t("researchVm")}</span>
            <div className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 rounded-full bg-foreground/50"
                style={{ animation: "gv-pulse-green 2s ease-in-out infinite" }}
              />
              <span className="text-[10px] text-foreground/40">{t("states.running")}</span>
            </div>
          </div>
          <div className="flex items-center gap-3 text-[10px] text-foreground/25">
            <span className="flex items-center gap-1"><Cpu size={10} /> {t("cores", { count: 2 })}</span>
            <span className="flex items-center gap-1"><HardDrives size={10} /> {t("gb", { count: 4 })}</span>
          </div>
          <div className="flex gap-1.5">
            <div className="h-6 px-2 rounded-md border border-foreground/[0.06] flex items-center gap-1 text-[10px] text-foreground/30">
              <Stop size={10} /> {t("stop")}
            </div>
            <div className="h-6 px-2 rounded-md border border-foreground/[0.06] flex items-center gap-1 text-[10px] text-foreground/30">
              <GearSix size={10} />
            </div>
          </div>
        </div>

        {/* Card 2: Stopped */}
        <div className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.015] p-4 space-y-3 opacity-60">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground/70">{t("emailVm")}</span>
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-foreground/15" />
              <span className="text-[10px] text-foreground/30">{t("states.stopped")}</span>
            </div>
          </div>
          <div className="flex items-center gap-3 text-[10px] text-foreground/20">
            <span className="flex items-center gap-1"><Cpu size={10} /> {t("cores", { count: 2 })}</span>
            <span className="flex items-center gap-1"><HardDrives size={10} /> {t("gb", { count: 4 })}</span>
          </div>
          <div className="flex gap-1.5">
            <div className="h-6 px-2 rounded-md border border-foreground/[0.06] flex items-center gap-1 text-[10px] text-foreground/30">
              <Play size={10} /> {t("start")}
            </div>
            <div className="h-6 px-2 rounded-md border border-foreground/[0.06] flex items-center gap-1 text-[10px] text-foreground/30">
              <GearSix size={10} />
            </div>
          </div>
        </div>

        {/* Card 3: Creating with progress bar */}
        <div className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground/70">{t("testingVm")}</span>
            <div className="flex items-center gap-1.5">
              <CircleNotch
                size={10}
                weight="bold"
                className="text-foreground/40"
                style={{ animation: "gv-spin 1s linear infinite" }}
              />
              <span className="text-[10px] text-foreground/40">{t("states.creating")}</span>
            </div>
          </div>
          <div className="flex items-center gap-3 text-[10px] text-foreground/25">
            <span className="flex items-center gap-1"><Cpu size={10} /> {t("cores", { count: 4 })}</span>
            <span className="flex items-center gap-1"><HardDrives size={10} /> {t("gb", { count: 8 })}</span>
          </div>
          {/* Progress bar */}
          <div className="space-y-1.5">
            <div className="h-1.5 w-full rounded-full bg-foreground/[0.06] overflow-hidden">
              <div
                className="h-full rounded-full bg-foreground/25"
                style={{ animation: "gv-progress-fill 4s ease-in-out infinite" }}
              />
            </div>
            <span className="text-[9px] text-foreground/25">{t("provisioning")}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── lifecycle flow ─── */

function LifecycleFlow({ t }: { t: any }) {
  return (
    <div className="rounded-2xl border border-foreground/[0.06] bg-foreground/[0.02] p-5 sm:p-8">
      {/* Desktop: horizontal */}
      <div className="hidden sm:flex items-center justify-between">
        {lifecycleKeys.map((step, i) => (
          <Fragment key={step.key}>
            <div className="flex flex-col items-center gap-2">
              <div
                className={`h-3 w-3 rounded-full ${step.dotClass}`}
                style={{
                  animation: `gv-dot-appear 0.4s ease forwards ${0.3 + i * 0.25}s`,
                  opacity: 0,
                }}
              />
              <span
                className="text-[11px] font-medium text-foreground/50"
                style={{
                  animation: `gv-fade-in 0.3s ease forwards ${0.5 + i * 0.25}s`,
                  opacity: 0,
                }}
              >
                {t(`states.${step.key}`)}
              </span>
            </div>
            {i < lifecycleKeys.length - 1 && (
              <div
                className="text-foreground/15 text-sm mx-1"
                style={{ animation: `gv-arrow-flow 2s ease-in-out infinite ${i * 0.3}s` }}
              >
                &rarr;
              </div>
            )}
          </Fragment>
        ))}
      </div>

      {/* Mobile: vertical */}
      <div className="flex flex-col gap-3 sm:hidden">
        {lifecycleKeys.map((step, i) => (
          <div key={step.key} className="flex items-center gap-3">
            <div
              className={`h-3 w-3 rounded-full shrink-0 ${step.dotClass}`}
              style={{
                animation: `gv-dot-appear 0.4s ease forwards ${0.3 + i * 0.25}s`,
                opacity: 0,
              }}
            />
            <span
              className="text-[11px] font-medium text-foreground/50"
              style={{
                animation: `gv-fade-in 0.3s ease forwards ${0.5 + i * 0.25}s`,
                opacity: 0,
              }}
            >
              {t(`states.${step.key}`)}
            </span>
            {i < lifecycleKeys.length - 1 && (
              <span
                className="text-foreground/15 text-xs ml-auto"
                style={{ animation: `gv-arrow-flow 2s ease-in-out infinite ${i * 0.3}s` }}
              >
                &darr;
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ─── main export ─── */

export function MachinesTab({ inApp }: { inApp: boolean }) {
  const t = useTranslations("guide.machinesTab")
  return (
    <div className="space-y-0">
      <style dangerouslySetInnerHTML={{ __html: machineStyles }} />

      {/* ── Section 1: Machine Dashboard Hero ── */}
      <motion.section
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-60px" }}
        variants={stagger}
        className="mb-14 sm:mb-20"
      >
        <motion.h2
          variants={fadeUp}
          className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight mb-2"
        >
          {t("title")}
        </motion.h2>
        <motion.p
          variants={fadeUp}
          className="text-sm text-foreground/40 mb-8"
        >
          {t("subtitle")}
        </motion.p>

        <motion.div variants={fadeUp}>
          <DashboardMock t={t} />
        </motion.div>
      </motion.section>

      {/* ── Section 2: Lifecycle Flow ── */}
      <motion.section
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-60px" }}
        variants={stagger}
        className="mb-14 sm:mb-20"
      >
        <motion.h2
          variants={fadeUp}
          className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight mb-2"
        >
          {t("lifecycle")}
        </motion.h2>
        <motion.p
          variants={fadeUp}
          className="text-sm text-foreground/40 mb-8"
        >
          {t("lifecycleDesc")}
        </motion.p>

        <motion.div variants={fadeUp}>
          <LifecycleFlow t={t} />
        </motion.div>
      </motion.section>

      {/* ── Section 3: Plan Limits ── */}
      <motion.section
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-60px" }}
        variants={stagger}
        className="mb-14 sm:mb-20"
      >
        <motion.h2
          variants={fadeUp}
          className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight mb-8"
        >
          {t("planLimits")}
        </motion.h2>

        <motion.div
          variants={fadeUp}
          className="rounded-2xl border border-foreground/[0.06] bg-foreground/[0.02] overflow-hidden"
        >
          <div className="grid grid-cols-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground/30 border-b border-foreground/[0.06]">
            <div className="px-4 py-3">{t("planCol")}</div>
            <div className="px-4 py-3">{t("machinesCol")}</div>
            <div className="px-4 py-3">{t("swarmAgentsCol")}</div>
          </div>
          {planLimits.map((row, i) => (
            <div
              key={row.plan}
              className="grid grid-cols-3 border-b border-foreground/[0.03] last:border-b-0"
              style={{
                animation: `gv-fade-in 0.3s ease forwards ${0.2 + i * 0.1}s`,
                opacity: 0,
              }}
            >
              <div className="px-4 py-2.5 text-sm font-medium text-foreground/60">{row.plan}</div>
              <div className="px-4 py-2.5 text-sm text-foreground/40">{row.machines}</div>
              <div className="px-4 py-2.5 text-sm text-foreground/30">{row.swarm}</div>
            </div>
          ))}
        </motion.div>
      </motion.section>

      {/* ── CTA ── */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="rounded-2xl border border-foreground/[0.06] bg-foreground/[0.02] text-center p-8"
      >
        <h2 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight mb-6">
          {t("spinUp")}
        </h2>
        <Link
          href="/machines"
          className="inline-flex items-center gap-2 h-10 px-6 rounded-xl bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity"
        >
          {t("goToMachines")}
          <ArrowRight size={14} weight="bold" />
        </Link>
      </motion.section>
    </div>
  )
}
