"use client"

import { motion } from "framer-motion"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"
import {
  ArrowRight,
  Copy,
  PaperPlaneTilt,
} from "@phosphor-icons/react"

/* ─── animation variants ─── */

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, delay: i * 0.07, ease: [0.25, 0.1, 0.25, 1] as const },
  }),
}

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
}

/* ─── keyframes ─── */

const keyframes = `
@keyframes gv-pulse-ring {
  0%, 100% { transform: scale(1); opacity: 0.5; }
  50% { transform: scale(1.35); opacity: 0; }
}
@keyframes gv-boot-bar {
  0% { width: 0%; }
  30% { width: 35%; }
  60% { width: 70%; }
  80% { width: 92%; }
  100% { width: 100%; }
}
@keyframes gv-boot-bar-fade {
  0%, 85% { opacity: 1; }
  100% { opacity: 0; }
}
@keyframes gv-type-cursor {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
@keyframes gv-type-1 { 0%, 10% { width: 0; } 100% { width: 7ch; } }
@keyframes gv-type-2 { 0%, 10% { width: 0; } 100% { width: 12ch; } }
@keyframes gv-type-3 { 0%, 10% { width: 0; } 100% { width: 10ch; } }
@keyframes gv-msg-slide {
  0% { opacity: 0; transform: translateY(12px); }
  100% { opacity: 1; transform: translateY(0); }
}
@keyframes gv-tool-pop {
  0% { opacity: 0; transform: scale(0.92); }
  100% { opacity: 1; transform: scale(1); }
}
@keyframes gv-spinner {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
@keyframes gv-dot-blink {
  0%, 20% { opacity: 0.2; }
  50% { opacity: 1; }
  80%, 100% { opacity: 0.2; }
}
@keyframes gv-check-in {
  0% { transform: scale(0); opacity: 0; }
  60% { transform: scale(1.2); }
  100% { transform: scale(1); opacity: 1; }
}
`

/* ─── Step 1: Sign Up ─── */

function MockSignUp() {
  return (
    <div className="flex items-center justify-center py-8">
      <div className="relative">
        {/* Pulsing ring */}
        <div
          className="absolute inset-0 rounded-2xl border-2 border-foreground/20"
          style={{ animation: "gv-pulse-ring 2s ease-in-out infinite" }}
        />
        <div
          className="absolute inset-0 rounded-2xl border-2 border-foreground/10"
          style={{ animation: "gv-pulse-ring 2s ease-in-out infinite 0.6s" }}
        />

        <div className="relative flex items-center gap-3 rounded-2xl border border-foreground/10 bg-foreground/[0.03] px-6 py-4 select-none">
          {/* Google "G" icon */}
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-foreground/[0.06]">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" className="fill-foreground/40" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" className="fill-foreground/30" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" className="fill-foreground/25" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" className="fill-foreground/35" />
            </svg>
          </div>
          <span className="text-sm font-medium text-foreground/70">Sign in with Google</span>

          {/* Animated check */}
          <div
            className="ml-2 flex h-5 w-5 items-center justify-center rounded-full bg-foreground/10"
            style={{ animation: "gv-check-in 0.4s ease-out 2.5s both" }}
          >
            <svg viewBox="0 0 16 16" className="h-3 w-3">
              <path d="M3 8l3.5 3.5L13 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/50" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── Step 2: Create Machine ─── */

function MockMachineBoot() {
  return (
    <div className="flex items-center justify-center py-6">
      <div className="w-full max-w-[320px]">
        {/* Machine card */}
        <div className="rounded-xl border border-foreground/[0.08] bg-foreground/[0.02] p-5">
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground/[0.05]">
                <svg viewBox="0 0 24 24" className="h-4 w-4 text-foreground/40" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <rect x="2" y="3" width="20" height="14" rx="2" />
                  <path d="M8 21h8M12 17v4" />
                </svg>
              </div>
              <span className="text-sm font-medium text-foreground/70">My Machine</span>
            </div>
            {/* Status dot that appears */}
            <div className="flex items-center gap-1.5">
              <div
                className="h-2 w-2 rounded-full bg-foreground/40"
                style={{ animation: "gv-check-in 0.3s ease-out 4s both" }}
              />
              <span
                className="text-[11px] font-medium text-foreground/50"
                style={{ animation: "gv-check-in 0.3s ease-out 4s both" }}
              >
                Running
              </span>
            </div>
          </div>

          {/* Specs */}
          <div className="flex items-center gap-4 text-[11px] text-foreground/30 mb-5">
            <span>2 vCPU</span>
            <span className="h-3 w-px bg-foreground/10" />
            <span>4 GB</span>
            <span className="h-3 w-px bg-foreground/10" />
            <span>30 GB</span>
          </div>

          {/* Boot progress bar */}
          <div className="relative h-1.5 w-full rounded-full bg-foreground/[0.05] overflow-hidden"
            style={{ animation: "gv-boot-bar-fade 4.5s ease-out forwards" }}
          >
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-foreground/20"
              style={{ animation: "gv-boot-bar 4s ease-out forwards" }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── Step 3: Credentials ─── */

function MockCredentialForm() {
  return (
    <div className="flex items-center justify-center py-6">
      <div className="w-full max-w-[320px]">
        <div className="rounded-xl border border-foreground/[0.08] bg-foreground/[0.02] p-5 space-y-4">
          {/* Service */}
          <div>
            <div className="text-[11px] font-medium text-foreground/30 mb-1.5">Service</div>
            <div className="rounded-lg border border-foreground/[0.06] bg-foreground/[0.02] px-3 py-2 text-sm text-foreground/50 overflow-hidden whitespace-nowrap">
              <span
                className="inline-block"
                style={{ animation: "gv-type-1 1.5s steps(7) 0.5s both", overflow: "hidden", whiteSpace: "nowrap" }}
              >
                linkedin
              </span>
              <span className="inline-block w-px h-4 bg-foreground/30 ml-px align-middle" style={{ animation: "gv-type-cursor 0.7s step-end infinite" }} />
            </div>
          </div>

          {/* Username */}
          <div>
            <div className="text-[11px] font-medium text-foreground/30 mb-1.5">Username</div>
            <div className="rounded-lg border border-foreground/[0.06] bg-foreground/[0.02] px-3 py-2 text-sm text-foreground/50 overflow-hidden whitespace-nowrap">
              <span
                className="inline-block"
                style={{ animation: "gv-type-2 2s steps(12) 2s both", overflow: "hidden", whiteSpace: "nowrap" }}
              >
                me@email.com
              </span>
              <span className="inline-block w-px h-4 bg-foreground/30 ml-px align-middle" style={{ animation: "gv-type-cursor 0.7s step-end infinite 2s" }} />
            </div>
          </div>

          {/* Password */}
          <div>
            <div className="text-[11px] font-medium text-foreground/30 mb-1.5">Password</div>
            <div className="rounded-lg border border-foreground/[0.06] bg-foreground/[0.02] px-3 py-2 text-sm text-foreground/50 overflow-hidden whitespace-nowrap">
              <span
                className="inline-block"
                style={{ animation: "gv-type-3 1.8s steps(10) 4s both", overflow: "hidden", whiteSpace: "nowrap" }}
              >
                ··········
              </span>
              <span className="inline-block w-px h-4 bg-foreground/30 ml-px align-middle" style={{ animation: "gv-type-cursor 0.7s step-end infinite 4s" }} />
            </div>
          </div>

          {/* Lock icon */}
          <div className="flex items-center justify-center pt-1">
            <div
              className="flex items-center gap-1.5 text-[11px] text-foreground/25"
              style={{ animation: "gv-check-in 0.3s ease-out 6s both" }}
            >
              <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <rect x="3" y="7" width="10" height="7" rx="1.5" />
                <path d="M5 7V5a3 3 0 016 0v2" />
              </svg>
              Encrypted
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── Step 4: Chat ─── */

function MockChatFlow() {
  return (
    <div className="py-5 space-y-3 max-w-[380px] mx-auto">
      {/* User message */}
      <div
        className="flex justify-end"
        style={{ animation: "gv-msg-slide 0.4s ease-out 0.3s both" }}
      >
        <div className="rounded-2xl rounded-br-sm bg-foreground/[0.06] px-4 py-2.5 max-w-[85%]">
          <p className="text-[13px] text-foreground/60">Find SaaS companies in Austin and add to my sheet</p>
        </div>
      </div>

      {/* Assistant text */}
      <div
        className="max-w-[85%]"
        style={{ animation: "gv-msg-slide 0.4s ease-out 1s both" }}
      >
        <div className="rounded-2xl rounded-bl-sm bg-foreground/[0.03] border border-foreground/[0.05] px-4 py-2.5">
          <p className="text-[13px] text-foreground/40">On it. Searching now...</p>
        </div>
      </div>

      {/* Tool call 1 */}
      <div
        className="max-w-[80%]"
        style={{ animation: "gv-tool-pop 0.3s ease-out 1.8s both" }}
      >
        <div className="flex items-center gap-2 rounded-lg bg-foreground/[0.02] border border-foreground/[0.05] px-3 py-2">
          <svg viewBox="0 0 16 16" className="h-3 w-3 text-foreground/25 shrink-0" style={{ animation: "gv-spinner 1s linear infinite" }}>
            <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="8" strokeLinecap="round" />
          </svg>
          <span className="text-[11px] text-foreground/30">web_search(&quot;SaaS Austin TX&quot;)</span>
        </div>
      </div>

      {/* Tool call 2 */}
      <div
        className="max-w-[80%]"
        style={{ animation: "gv-tool-pop 0.3s ease-out 2.6s both" }}
      >
        <div className="flex items-center gap-2 rounded-lg bg-foreground/[0.02] border border-foreground/[0.05] px-3 py-2">
          <svg viewBox="0 0 16 16" className="h-3 w-3 text-foreground/25 shrink-0" style={{ animation: "gv-spinner 1s linear infinite" }}>
            <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="8" strokeLinecap="round" />
          </svg>
          <span className="text-[11px] text-foreground/30">open_browser(&quot;sheets.google.com&quot;)</span>
        </div>
      </div>

      {/* Screenshot placeholder */}
      <div
        className="aspect-[16/10] rounded-xl border border-foreground/[0.06] bg-foreground/[0.015] flex items-center justify-center"
        style={{ animation: "gv-tool-pop 0.3s ease-out 3.2s both" }}
      >
        <div className="flex flex-col items-center gap-1">
          <svg viewBox="0 0 24 24" className="h-6 w-6 text-foreground/15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <path d="M8 21h8M12 17v4" />
          </svg>
          <span className="text-[10px] text-foreground/15">Live desktop view</span>
        </div>
      </div>

      {/* Typing indicator */}
      <div
        className="flex gap-1 pl-2 pt-1"
        style={{ animation: "gv-msg-slide 0.3s ease-out 3.6s both" }}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-foreground/20" style={{ animation: "gv-dot-blink 1.2s ease-in-out infinite 0s" }} />
        <span className="h-1.5 w-1.5 rounded-full bg-foreground/20" style={{ animation: "gv-dot-blink 1.2s ease-in-out infinite 0.2s" }} />
        <span className="h-1.5 w-1.5 rounded-full bg-foreground/20" style={{ animation: "gv-dot-blink 1.2s ease-in-out infinite 0.4s" }} />
      </div>
    </div>
  )
}

/* ─── step data ─── */

const stepConfig = [
  { number: 1, key: "signUp", mock: MockSignUp },
  { number: 2, key: "createMachine", mock: MockMachineBoot },
  { number: 3, key: "saveCredentials", mock: MockCredentialForm },
  { number: 4, key: "giveTask", mock: MockChatFlow },
] as const

/* ─── main component ─── */

export function GettingStartedTab({ inApp }: { inApp: boolean }) {
  const t = useTranslations("guide.gettingStarted")
  const examplePrompts = [0, 1, 2, 3, 4, 5].map((i) => t(`examplePrompts.${i}`))

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: keyframes }} />

      <div className="space-y-8 sm:space-y-10">
        {/* ── Steps ── */}
        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-40px" }}
          variants={stagger}
          className="grid grid-cols-1 sm:grid-cols-2 gap-4"
        >
          {stepConfig.map((step, idx) => {
            const Mock = step.mock
            return (
              <motion.div
                key={step.number}
                variants={fadeUp}
                custom={idx}
                className="group rounded-2xl border border-foreground/[0.06] bg-foreground/[0.015] overflow-hidden"
              >
                {/* Step header */}
                <div className="px-5 pt-5 pb-0">
                  <div className="flex items-center gap-2.5 mb-1">
                    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-foreground/[0.06] text-[11px] font-bold text-foreground/40">
                      {step.number}
                    </span>
                    <span className="text-[11px] font-medium uppercase tracking-widest text-foreground/30">
                      {t(`steps.${step.key}.title`)}
                    </span>
                  </div>
                  <h3 className="text-base font-semibold text-foreground/70 leading-snug">
                    {t(`steps.${step.key}.desc`)}
                  </h3>
                </div>

                {/* Mock UI */}
                <Mock />
              </motion.div>
            )
          })}
        </motion.div>

        {/* ── Quick Prompts ── */}
        <motion.section
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-40px" }}
          variants={stagger}
        >
          <motion.div variants={fadeUp} custom={0} className="mb-4">
            <h2 className="text-lg font-semibold text-foreground/70 tracking-tight">
              {t("quickPrompts")}
            </h2>
          </motion.div>

          <motion.div variants={stagger} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {examplePrompts.map((prompt, i) => (
              <motion.button
                key={i}
                variants={fadeUp}
                custom={i + 1}
                onClick={() => navigator.clipboard?.writeText(prompt)}
                className={cn(
                  "group relative flex items-start gap-3 rounded-xl border border-foreground/[0.05] bg-foreground/[0.015] p-3.5 text-left transition-colors duration-150",
                  "hover:bg-foreground/[0.04] hover:border-foreground/[0.1]"
                )}
              >
                <PaperPlaneTilt size={14} weight="duotone" className="text-foreground/25 shrink-0 mt-0.5" />
                <span className="text-[13px] text-foreground/50 leading-relaxed flex-1">
                  {prompt}
                </span>
                <Copy
                  size={13}
                  weight="duotone"
                  className="text-foreground/15 shrink-0 mt-0.5 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                />
              </motion.button>
            ))}
          </motion.div>
        </motion.section>

        {/* ── CTA ── */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
          className="flex justify-center pt-2 pb-4"
        >
          <Link
            href="/"
            className="inline-flex items-center gap-2 h-10 px-6 rounded-xl bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity"
          >
            {t("startFirstTask")}
            <ArrowRight size={14} weight="bold" />
          </Link>
        </motion.div>
      </div>
    </>
  )
}
