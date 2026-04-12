"use client"

import { motion } from "framer-motion"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"
import {
  PaperPlaneRight,
  Globe,
  Terminal,
  Desktop,
  Check,
  Warning,
  ArrowRight,
  CursorClick,
} from "@phosphor-icons/react"

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

/* ─── CSS keyframes ─── */

const cssAnimations = `
@keyframes gv-cursor-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
@keyframes gv-msg-in {
  0% { opacity: 0; transform: translateY(8px); }
  100% { opacity: 1; transform: translateY(0); }
}
@keyframes gv-tool-in {
  0% { opacity: 0; transform: translateX(-6px); }
  100% { opacity: 1; transform: translateX(0); }
}
@keyframes gv-typing {
  0% { width: 0; }
  100% { width: 100%; }
}
@keyframes gv-dot-pulse {
  0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); }
  40% { opacity: 1; transform: scale(1); }
}
@keyframes gv-browser-click {
  0%, 100% { transform: translate(0, 0); }
  30% { transform: translate(20px, 12px); }
  50% { transform: translate(20px, 12px) scale(0.85); }
  60% { transform: translate(20px, 12px) scale(1); }
  80% { transform: translate(35px, 4px); }
}
@keyframes gv-term-line {
  0% { width: 0; opacity: 0; }
  10% { opacity: 1; }
  100% { width: 100%; opacity: 1; }
}
@keyframes gv-mouse-move {
  0%, 100% { transform: translate(0, 0); }
  25% { transform: translate(16px, 8px); }
  50% { transform: translate(28px, -4px); }
  75% { transform: translate(8px, 12px); }
}
@keyframes gv-status-pulse {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}
`

/* ─── main export ─── */

export function ChatTasksTab({ inApp }: { inApp: boolean }) {
  const t = useTranslations("guide.chatTasks")
  return (
    <div className="space-y-16 sm:space-y-20">
      <style dangerouslySetInnerHTML={{ __html: cssAnimations }} />

      {/* ── Section 1: Hero Mock Chat UI ── */}
      <motion.section
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-60px" }}
        variants={stagger}
      >
        <motion.h2
          variants={fade}
          custom={0}
          className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight mb-2"
        >
          {t("commandCenter")}
        </motion.h2>
        <motion.p
          variants={fade}
          custom={1}
          className="text-sm text-foreground/50 mb-6"
        >
          {t("describeTask")}
        </motion.p>

        <motion.div
          variants={fade}
          custom={2}
          className="rounded-2xl border border-foreground/[0.06] bg-foreground/[0.02] overflow-hidden"
        >
          {/* Top bar */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-foreground/[0.06] bg-foreground/[0.02]">
            <div className="flex items-center gap-2 rounded-lg border border-foreground/[0.08] bg-foreground/[0.03] px-2.5 py-1">
              <div className="h-1.5 w-1.5 rounded-full bg-foreground/30" />
              <span className="text-[11px] font-medium text-foreground/50">Coasty</span>
            </div>
            <div
              className="flex items-center gap-2 rounded-lg border border-foreground/[0.08] bg-foreground/[0.03] px-2.5 py-1"
              style={{ animation: "gv-status-pulse 3s ease-in-out infinite" }}
            >
              <div className="h-1.5 w-1.5 rounded-full bg-foreground/40" />
              <span className="text-[11px] font-medium text-foreground/40">My Machine</span>
            </div>
          </div>

          {/* Chat messages area */}
          <div className="p-4 sm:p-6 space-y-4 min-h-[340px]">
            {/* User message */}
            <div
              className="flex justify-end"
              style={{ animation: "gv-msg-in 0.4s ease-out both", animationDelay: "0.2s" }}
            >
              <div className="rounded-2xl rounded-br-md bg-foreground text-background px-4 py-2.5 max-w-[80%] text-[13px] leading-relaxed">
                {t("examplePrompt")}
              </div>
            </div>

            {/* Assistant message */}
            <div
              className="flex justify-start"
              style={{ animation: "gv-msg-in 0.4s ease-out both", animationDelay: "0.8s" }}
            >
              <div className="rounded-2xl rounded-bl-md bg-foreground/[0.04] text-foreground/70 px-4 py-2.5 max-w-[80%] text-[13px] leading-relaxed">
                {t("exampleResponse")}
              </div>
            </div>

            {/* Tool calls appearing one by one */}
            <div className="space-y-2 pl-1">
              <div
                className="flex items-center gap-2 rounded-lg border border-foreground/[0.06] bg-foreground/[0.02] px-3 py-2 w-fit"
                style={{ animation: "gv-tool-in 0.3s ease-out both", animationDelay: "1.4s" }}
              >
                <div className="h-1.5 w-1.5 rounded-full bg-foreground/30" />
                <span className="text-foreground/40 font-mono text-[11px]">browser_navigate &rarr; amazon.com</span>
              </div>
              <div
                className="flex items-center gap-2 rounded-lg border border-foreground/[0.06] bg-foreground/[0.02] px-3 py-2 w-fit"
                style={{ animation: "gv-tool-in 0.3s ease-out both", animationDelay: "2.0s" }}
              >
                <div className="h-1.5 w-1.5 rounded-full bg-foreground/30" />
                <span className="text-foreground/40 font-mono text-[11px]">browser_search &rarr; wireless keyboards</span>
              </div>
              <div
                className="flex items-center gap-2 rounded-lg border border-foreground/[0.06] bg-foreground/[0.02] px-3 py-2 w-fit"
                style={{ animation: "gv-tool-in 0.3s ease-out both", animationDelay: "2.6s" }}
              >
                <div className="h-1.5 w-1.5 rounded-full bg-foreground/30" />
                <span className="text-foreground/40 font-mono text-[11px]">browser_click &rarr; sort by price</span>
              </div>
              <div
                className="flex items-center gap-2 rounded-lg border border-foreground/[0.06] bg-foreground/[0.02] px-3 py-2 w-fit"
                style={{ animation: "gv-tool-in 0.3s ease-out both", animationDelay: "3.2s" }}
              >
                <div className="h-1.5 w-1.5 rounded-full bg-foreground/30" />
                <span className="text-foreground/40 font-mono text-[11px]">file_write &rarr; comparison.csv</span>
              </div>
            </div>

            {/* Second assistant message */}
            <div
              className="flex justify-start"
              style={{ animation: "gv-msg-in 0.4s ease-out both", animationDelay: "3.8s" }}
            >
              <div className="rounded-2xl rounded-bl-md bg-foreground/[0.04] text-foreground/70 px-4 py-2.5 max-w-[80%] text-[13px] leading-relaxed">
                {t("exampleDone")}
              </div>
            </div>
          </div>

          {/* Input bar */}
          <div className="px-4 py-3 border-t border-foreground/[0.06] bg-foreground/[0.02]">
            <div className="flex items-center gap-3 rounded-xl border border-foreground/[0.08] bg-foreground/[0.02] px-4 py-2.5">
              <span className="flex-1 text-sm text-foreground/20">{t("describePlaceholder")}</span>
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-foreground/[0.06]">
                <PaperPlaneRight size={14} className="text-foreground/30" />
              </div>
            </div>
          </div>
        </motion.div>
      </motion.section>

      {/* ── Section 2: Three Agent Cards ── */}
      <motion.section
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-60px" }}
        variants={stagger}
      >
        <motion.h2
          variants={fade}
          custom={0}
          className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight mb-2"
        >
          {t("threeAgents")}
        </motion.h2>
        <motion.p
          variants={fade}
          custom={1}
          className="text-sm text-foreground/50 mb-8"
        >
          {t("autoAssigned")}
        </motion.p>

        <motion.div variants={fade} custom={2} className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Browser Agent */}
          <div className="rounded-2xl border border-foreground/[0.06] bg-foreground/[0.02] p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground/[0.05]">
                <Globe size={16} weight="duotone" className="text-foreground/60" />
              </div>
              <span className="text-sm font-semibold text-foreground">{t("browser")}</span>
            </div>
            {/* Mini browser with clicking cursor */}
            <div className="rounded-lg border border-foreground/[0.06] bg-foreground/[0.02] overflow-hidden h-28 relative">
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-foreground/[0.06]">
                <div className="flex gap-1">
                  <div className="h-1.5 w-1.5 rounded-full bg-foreground/10" />
                  <div className="h-1.5 w-1.5 rounded-full bg-foreground/10" />
                  <div className="h-1.5 w-1.5 rounded-full bg-foreground/10" />
                </div>
                <div className="flex-1 h-3 rounded bg-foreground/[0.04] mx-1" />
              </div>
              <div className="p-2 space-y-1.5">
                <div className="h-2 rounded bg-foreground/[0.05] w-3/4" />
                <div className="h-2 rounded bg-foreground/[0.04] w-1/2" />
                <div className="h-2 rounded bg-foreground/[0.03] w-2/3" />
              </div>
              <CursorClick
                size={14}
                weight="fill"
                className="absolute text-foreground/30"
                style={{ animation: "gv-browser-click 3s ease-in-out infinite", bottom: "16px", left: "12px" }}
              />
            </div>
            <p className="text-[12px] text-foreground/35 mt-3">{t("browserDesc")}</p>
          </div>

          {/* Terminal Agent */}
          <div className="rounded-2xl border border-foreground/[0.06] bg-foreground/[0.02] p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground/[0.05]">
                <Terminal size={16} weight="duotone" className="text-foreground/60" />
              </div>
              <span className="text-sm font-semibold text-foreground">{t("terminal")}</span>
            </div>
            {/* Mini terminal with text appearing */}
            <div className="rounded-lg border border-foreground/[0.06] bg-foreground/[0.03] overflow-hidden h-28 font-mono text-[10px] text-foreground/40 p-2.5 space-y-1.5">
              <div className="flex items-center gap-1">
                <span className="text-foreground/25">$</span>
                <div
                  className="overflow-hidden whitespace-nowrap"
                  style={{ animation: "gv-term-line 1.2s ease-out both", animationDelay: "0.3s" }}
                >
                  npm install puppeteer
                </div>
              </div>
              <div
                className="text-foreground/20 overflow-hidden whitespace-nowrap"
                style={{ animation: "gv-term-line 0.8s ease-out both", animationDelay: "1.6s" }}
              >
                added 52 packages in 3.2s
              </div>
              <div className="flex items-center gap-1">
                <span className="text-foreground/25">$</span>
                <div
                  className="overflow-hidden whitespace-nowrap"
                  style={{ animation: "gv-term-line 1s ease-out both", animationDelay: "2.8s" }}
                >
                  node scrape.js
                </div>
              </div>
              <div
                className="text-foreground/20 overflow-hidden whitespace-nowrap"
                style={{ animation: "gv-term-line 0.6s ease-out both", animationDelay: "4s" }}
              >
                Scraped 142 entries &rarr; output.csv
              </div>
              <div className="flex items-center gap-1">
                <span className="text-foreground/25">$</span>
                <span
                  className="inline-block w-1.5 h-3 bg-foreground/20"
                  style={{ animation: "gv-cursor-blink 1s step-end infinite" }}
                />
              </div>
            </div>
            <p className="text-[12px] text-foreground/35 mt-3">{t("terminalDesc")}</p>
          </div>

          {/* Desktop Agent */}
          <div className="rounded-2xl border border-foreground/[0.06] bg-foreground/[0.02] p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground/[0.05]">
                <Desktop size={16} weight="duotone" className="text-foreground/60" />
              </div>
              <span className="text-sm font-semibold text-foreground">{t("desktop")}</span>
            </div>
            {/* Mini desktop with mouse moving */}
            <div className="rounded-lg border border-foreground/[0.06] bg-foreground/[0.02] overflow-hidden h-28 relative">
              {/* Fake taskbar */}
              <div className="absolute bottom-0 left-0 right-0 h-4 bg-foreground/[0.04] border-t border-foreground/[0.06] flex items-center px-2 gap-1.5">
                <div className="h-2 w-2 rounded-sm bg-foreground/10" />
                <div className="h-2 w-2 rounded-sm bg-foreground/10" />
                <div className="h-2 w-2 rounded-sm bg-foreground/10" />
              </div>
              {/* Fake window */}
              <div className="absolute top-3 left-3 right-4 bottom-6 rounded border border-foreground/[0.06] bg-foreground/[0.02]">
                <div className="h-3 border-b border-foreground/[0.06] bg-foreground/[0.03] flex items-center px-1.5 gap-0.5">
                  <div className="h-1 w-1 rounded-full bg-foreground/10" />
                  <div className="h-1 w-1 rounded-full bg-foreground/10" />
                  <div className="h-1 w-1 rounded-full bg-foreground/10" />
                </div>
                <div className="p-1.5 space-y-1">
                  <div className="h-1.5 rounded bg-foreground/[0.04] w-4/5" />
                  <div className="h-1.5 rounded bg-foreground/[0.03] w-3/5" />
                </div>
              </div>
              {/* Animated cursor */}
              <div
                className="absolute w-3 h-3"
                style={{ animation: "gv-mouse-move 4s ease-in-out infinite", top: "40%", left: "30%" }}
              >
                <svg viewBox="0 0 12 16" fill="none" className="w-full h-full">
                  <path d="M1 1l4 14 2-5 5-2L1 1z" fill="currentColor" className="text-foreground/30" />
                </svg>
              </div>
            </div>
            <p className="text-[12px] text-foreground/35 mt-3">{t("desktopDesc")}</p>
          </div>
        </motion.div>
      </motion.section>

      {/* ── Section 3: Do / Don't ── */}
      <motion.section
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-60px" }}
        variants={stagger}
      >
        <motion.h2
          variants={fade}
          custom={0}
          className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight mb-2"
        >
          {t("betterPrompts")}
        </motion.h2>
        <motion.p
          variants={fade}
          custom={1}
          className="text-sm text-foreground/50 mb-8"
        >
          {t("specificBeatsVague")}
        </motion.p>

        <motion.div variants={fade} custom={2} className="space-y-3">
          {/* Comparison 1 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] p-4">
              <div className="flex items-center gap-2 mb-2">
                <Check size={13} weight="bold" className="text-foreground/50" />
                <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-foreground/40">{t("do")}</span>
              </div>
              <p className="text-[13px] text-foreground/70 leading-relaxed">
                &ldquo;{t("doExample1")}&rdquo;
              </p>
            </div>
            <div className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.015] p-4">
              <div className="flex items-center gap-2 mb-2">
                <Warning size={13} weight="bold" className="text-foreground/30" />
                <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-foreground/25">{t("dont")}</span>
              </div>
              <p className="text-[13px] text-foreground/30 leading-relaxed">
                &ldquo;{t("dontExample1")}&rdquo;
              </p>
            </div>
          </div>

          {/* Comparison 2 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] p-4">
              <div className="flex items-center gap-2 mb-2">
                <Check size={13} weight="bold" className="text-foreground/50" />
                <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-foreground/40">{t("do")}</span>
              </div>
              <p className="text-[13px] text-foreground/70 leading-relaxed">
                &ldquo;{t("doExample2")}&rdquo;
              </p>
            </div>
            <div className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.015] p-4">
              <div className="flex items-center gap-2 mb-2">
                <Warning size={13} weight="bold" className="text-foreground/30" />
                <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-foreground/25">{t("dont")}</span>
              </div>
              <p className="text-[13px] text-foreground/30 leading-relaxed">
                &ldquo;{t("dontExample2")}&rdquo;
              </p>
            </div>
          </div>
        </motion.div>
      </motion.section>

      {/* ── CTA ── */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ duration: 0.5, ease: [0.25, 0.1, 0.25, 1] }}
        className="text-center py-8"
      >
        <h2 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight mb-3">
          {t("readyToTry")}
        </h2>
        <p className="text-sm text-foreground/40 mb-6">
          {t("openChat")}
        </p>
        <Link
          href="/"
          className="inline-flex items-center gap-2 h-10 px-6 rounded-xl bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity"
        >
          {t("startChat")}
          <ArrowRight size={14} weight="bold" />
        </Link>
      </motion.section>
    </div>
  )
}
