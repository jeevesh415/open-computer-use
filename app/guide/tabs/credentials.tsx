"use client"

import { useState } from "react"
import Link from "next/link"
import { motion } from "framer-motion"
import { useTranslations } from "next-intl"
import {
  ArrowRight,
  Lock,
  ShieldCheck,
  EyeSlash,
  Eye,
  CheckCircle,
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

const credentialStyles = `
  @keyframes gv-scan-match {
    0% { top: 0%; opacity: 0 }
    10% { opacity: 1 }
    50% { top: 50% }
    90% { opacity: 1 }
    100% { top: 100%; opacity: 0 }
  }
  @keyframes gv-connect-line {
    0% { width: 0; opacity: 0 }
    30% { opacity: 1 }
    100% { width: 100%; opacity: 1 }
  }
  @keyframes gv-fill-field {
    0% { width: 0 }
    100% { width: 100% }
  }
  @keyframes gv-check-pop {
    0% { transform: scale(0); opacity: 0 }
    60% { transform: scale(1.3); opacity: 1 }
    100% { transform: scale(1); opacity: 1 }
  }
  @keyframes gv-fade-in {
    0% { opacity: 0; transform: translateY(4px) }
    100% { opacity: 1; transform: translateY(0) }
  }
  @keyframes gv-shimmer {
    0% { background-position: -200% 0 }
    100% { background-position: 200% 0 }
  }
  @keyframes gv-pulse-ring {
    0% { box-shadow: 0 0 0 0 rgba(var(--foreground-rgb, 0,0,0), 0.08) }
    50% { box-shadow: 0 0 0 6px rgba(var(--foreground-rgb, 0,0,0), 0) }
    100% { box-shadow: 0 0 0 0 rgba(var(--foreground-rgb, 0,0,0), 0) }
  }
`

/* ─── data ─── */

const savedCreds = [
  { domain: "gmail.com", initial: "G", username: "john@example.com" },
  { domain: "linkedin.com", initial: "L", username: "john.doe" },
  { domain: "notion.so", initial: "N", username: "john@example.com" },
  { domain: "hubspot.com", initial: "H", username: "john@company.com" },
]

const securityKeys = [
  { icon: Lock, labelKey: "encrypted", descKey: "aes256" },
  { icon: ShieldCheck, labelKey: "vmIsolated", descKey: "sandboxed" },
  { icon: EyeSlash, labelKey: "neverLogged", descKey: "zeroTrace" },
] as const

/* ─── hero: auto-fill flow ─── */

function AutoFillFlowMock({ t }: { t: any }) {
  return (
    <div className="rounded-2xl border border-foreground/[0.06] bg-foreground/[0.02] p-4 sm:p-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        {/* Panel 1: Login page skeleton */}
        <div className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.015] p-4 relative overflow-hidden">
          <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-foreground/25 mb-3 block">
            {t("loginDetected")}
          </span>
          <div className="space-y-2.5">
            {/* URL bar */}
            <div className="h-5 rounded-md bg-foreground/[0.04] flex items-center px-2">
              <div className="h-1.5 w-1.5 rounded-full bg-foreground/10 mr-1.5" />
              <div className="h-1.5 w-16 rounded bg-foreground/[0.06]" />
            </div>
            {/* Email label */}
            <div className="h-2 w-10 rounded bg-foreground/[0.06]" />
            {/* Email field skeleton */}
            <div className="h-7 rounded-md border border-foreground/[0.06] bg-foreground/[0.02] relative overflow-hidden">
              <div
                className="absolute inset-0"
                style={{
                  background: "linear-gradient(90deg, transparent 0%, rgba(var(--foreground-rgb,0,0,0),0.03) 50%, transparent 100%)",
                  backgroundSize: "200% 100%",
                  animation: "gv-shimmer 2s linear infinite",
                }}
              />
            </div>
            {/* Password label */}
            <div className="h-2 w-12 rounded bg-foreground/[0.06]" />
            {/* Password field skeleton */}
            <div className="h-7 rounded-md border border-foreground/[0.06] bg-foreground/[0.02] relative overflow-hidden">
              <div
                className="absolute inset-0"
                style={{
                  background: "linear-gradient(90deg, transparent 0%, rgba(var(--foreground-rgb,0,0,0),0.03) 50%, transparent 100%)",
                  backgroundSize: "200% 100%",
                  animation: "gv-shimmer 2s linear infinite 0.3s",
                }}
              />
            </div>
            {/* Submit button skeleton */}
            <div className="h-6 w-14 rounded-md bg-foreground/[0.06]" />
          </div>
          {/* Scanning line */}
          <div
            className="absolute left-0 right-0 h-px bg-foreground/15"
            style={{ animation: "gv-scan-match 3s ease-in-out infinite" }}
          />
        </div>

        {/* Panel 2: Credential matched */}
        <div className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.015] p-4 flex flex-col items-center justify-center">
          <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-foreground/25 mb-4 block">
            {t("matched")}
          </span>
          <div className="w-full space-y-3">
            {/* Domain bubble */}
            <div className="flex items-center justify-center">
              <div className="h-7 px-3 rounded-lg border border-foreground/[0.08] bg-foreground/[0.03] flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-full bg-foreground/15" />
                <span className="text-[10px] text-foreground/40">gmail.com</span>
              </div>
            </div>
            {/* Connecting line */}
            <div className="flex items-center justify-center h-4">
              <div className="relative h-px w-20 bg-foreground/[0.06] overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 bg-foreground/25 origin-left"
                  style={{ animation: "gv-connect-line 2s ease forwards infinite" }}
                />
              </div>
            </div>
            {/* Credential bubble */}
            <div className="flex items-center justify-center">
              <div
                className="h-7 px-3 rounded-lg border border-foreground/[0.08] bg-foreground/[0.03] flex items-center gap-1.5"
                style={{ animation: "gv-fade-in 0.5s ease forwards 1s", opacity: 0 }}
              >
                <Lock size={10} className="text-foreground/30" />
                <span className="text-[10px] text-foreground/40">{t("credentialFound")}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Panel 3: Auto-filled */}
        <div className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.015] p-4 relative">
          <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-foreground/25 mb-3 block">
            {t("autoFilled")}
          </span>
          <div className="space-y-2.5">
            {/* URL bar */}
            <div className="h-5 rounded-md bg-foreground/[0.04] flex items-center px-2">
              <div className="h-1.5 w-1.5 rounded-full bg-foreground/10 mr-1.5" />
              <div className="h-1.5 w-16 rounded bg-foreground/[0.06]" />
            </div>
            {/* Email label */}
            <div className="h-2 w-10 rounded bg-foreground/[0.06]" />
            {/* Email field filled */}
            <div className="h-7 rounded-md border border-foreground/[0.08] bg-foreground/[0.02] flex items-center px-2 gap-1.5 overflow-hidden">
              <div className="flex-1 overflow-hidden">
                <div
                  className="text-[10px] text-foreground/50 whitespace-nowrap overflow-hidden"
                  style={{ animation: "gv-fill-field 1.5s ease forwards 1.5s", width: 0 }}
                >
                  john@example.com
                </div>
              </div>
              <CheckCircle
                size={11}
                weight="fill"
                className="text-foreground/30 shrink-0"
                style={{ animation: "gv-check-pop 0.3s ease forwards 2.5s", opacity: 0 }}
              />
            </div>
            {/* Password label */}
            <div className="h-2 w-12 rounded bg-foreground/[0.06]" />
            {/* Password field filled */}
            <div className="h-7 rounded-md border border-foreground/[0.08] bg-foreground/[0.02] flex items-center px-2 gap-1.5 overflow-hidden">
              <div className="flex-1 overflow-hidden">
                <div
                  className="text-[10px] text-foreground/50 whitespace-nowrap overflow-hidden"
                  style={{ animation: "gv-fill-field 1.5s ease forwards 2s", width: 0 }}
                >
                  {"\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"}
                </div>
              </div>
              <CheckCircle
                size={11}
                weight="fill"
                className="text-foreground/30 shrink-0"
                style={{ animation: "gv-check-pop 0.3s ease forwards 3s", opacity: 0 }}
              />
            </div>
            {/* Submit */}
            <div className="h-6 w-14 rounded-md bg-foreground/[0.08]" />
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── credential card with reveal ─── */

function CredCard({ domain, initial, username }: { domain: string; initial: string; username: string }) {
  const [revealed, setRevealed] = useState(false)

  return (
    <div className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] p-3.5 transition-all hover:border-foreground/[0.1]">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.06] text-[11px] font-bold text-foreground/40">
          {initial}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-foreground/60 truncate">{domain}</p>
          <p className="text-[10px] text-foreground/30 truncate">{username}</p>
        </div>
      </div>
      <div className="flex items-center gap-1.5 mt-2 pl-11">
        <span className="text-[11px] text-foreground/25 font-mono">
          {revealed ? "s3cur3P@ss!" : "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"}
        </span>
        <button
          onClick={() => setRevealed(!revealed)}
          className="text-foreground/20 hover:text-foreground/40 transition-colors"
        >
          {revealed ? <EyeSlash size={12} /> : <Eye size={12} />}
        </button>
      </div>
    </div>
  )
}

/* ─── main export ─── */

export function CredentialsTab({ inApp }: { inApp: boolean }) {
  const t = useTranslations("guide.credentialsTab")
  return (
    <div className="space-y-0">
      <style dangerouslySetInnerHTML={{ __html: credentialStyles }} />

      {/* ── Section 1: Auto-Fill Flow Hero ── */}
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
          {t("autoFillTitle")}
        </motion.h2>
        <motion.p
          variants={fadeUp}
          className="text-sm text-foreground/40 mb-8"
        >
          {t("autoFillDesc")}
        </motion.p>

        <motion.div variants={fadeUp}>
          <AutoFillFlowMock t={t} />
        </motion.div>
      </motion.section>

      {/* ── Section 2: Security ── */}
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
          {t("security")}
        </motion.h2>

        <motion.div variants={fadeUp} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {securityKeys.map((item, i) => {
            const Icon = item.icon
            return (
              <div
                key={i}
                className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] p-4 flex items-center gap-3"
                style={{
                  animation: `gv-fade-in 0.4s ease forwards ${0.2 + i * 0.15}s`,
                  opacity: 0,
                }}
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.04]">
                  <Icon size={15} weight="duotone" className="text-foreground/40" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-foreground/60">{t(item.labelKey)}</p>
                  <p className="text-[10px] text-foreground/30">{t(item.descKey)}</p>
                </div>
              </div>
            )
          })}
        </motion.div>
      </motion.section>

      {/* ── Section 3: Saved Credentials Mock ── */}
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
          {t("savedCredentials")}
        </motion.h2>
        <motion.p
          variants={fadeUp}
          className="text-sm text-foreground/40 mb-8"
        >
          {t("addOnce")}
        </motion.p>

        <motion.div
          variants={fadeUp}
          className="grid grid-cols-1 sm:grid-cols-2 gap-3"
        >
          {savedCreds.map((cred) => (
            <CredCard key={cred.domain} {...cred} />
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
          {t("saveFirst")}
        </h2>
        <Link
          href="/secrets"
          className="inline-flex items-center gap-2 h-10 px-6 rounded-xl bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity"
        >
          {t("goToCredentials")}
          <ArrowRight size={14} weight="bold" />
        </Link>
      </motion.section>
    </div>
  )
}
