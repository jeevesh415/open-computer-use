"use client"

import { motion } from "framer-motion"
import Link from "next/link"
import { useTranslations } from "next-intl"
import {
  ArrowRight,
  Globe,
  FolderOpen,
  Terminal,
  Desktop,
  Camera,
  AppWindow,
  Cloud,
  Monitor,
  ShieldCheck,
  Browser,
  UserCircle,
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

/* ─── CSS animations ─── */

const overlayAnimations = `
@keyframes gv-pill-glow {
  0%, 100% { box-shadow: 0 0 0 0 rgba(34,197,94,0.15); }
  50% { box-shadow: 0 0 12px 4px rgba(34,197,94,0.1); }
}
@keyframes gv-dot-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(0.7); }
}
@keyframes gv-expand-line {
  0% { width: 0; opacity: 0; }
  40% { width: 60px; opacity: 0.5; }
  100% { width: 100%; opacity: 0.15; }
}
@keyframes gv-msg-appear {
  0% { opacity: 0; transform: translateY(6px); }
  100% { opacity: 1; transform: translateY(0); }
}
@keyframes gv-cursor-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
@keyframes gv-typing-dot {
  0%, 100% { opacity: 0.2; }
  50% { opacity: 0.8; }
}
.gv-pill-glow { animation: gv-pill-glow 3s ease-in-out infinite; }
.gv-dot-pulse { animation: gv-dot-pulse 2s ease-in-out infinite; }
.gv-expand-line { animation: gv-expand-line 2s ease-out forwards; }
.gv-msg-1 { animation: gv-msg-appear 0.4s ease-out 0.3s both; }
.gv-msg-2 { animation: gv-msg-appear 0.4s ease-out 0.8s both; }
.gv-msg-3 { animation: gv-msg-appear 0.4s ease-out 1.3s both; }
.gv-cursor-blink { animation: gv-cursor-blink 1s step-end infinite; }
.gv-typing-1 { animation: gv-typing-dot 1.4s ease-in-out infinite; }
.gv-typing-2 { animation: gv-typing-dot 1.4s ease-in-out 0.2s infinite; }
.gv-typing-3 { animation: gv-typing-dot 1.4s ease-in-out 0.4s infinite; }
`

/* ─── capability data ─── */

const capabilityKeys = [
  { icon: Globe, key: "browser" },
  { icon: FolderOpen, key: "files" },
  { icon: Terminal, key: "terminal" },
  { icon: Desktop, key: "desktop" },
  { icon: Camera, key: "screenshots" },
  { icon: AppWindow, key: "apps" },
] as const

/* ─── main component ─── */

export function DesktopAppTab({ inApp }: { inApp: boolean }) {
  const t = useTranslations("guide.desktopAppTab")
  return (
    <div className="space-y-16 sm:space-y-20">
      <style dangerouslySetInnerHTML={{ __html: overlayAnimations }} />

      {/* ── Section 1: Hero — The Overlay ── */}
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
          {t("overlay")}
        </motion.h2>
        <motion.p
          variants={fade}
          custom={1}
          className="text-sm text-foreground/50 text-center mb-10"
        >
          {t("overlayDesc")}
        </motion.p>

        <motion.div
          variants={fade}
          custom={2}
          className="grid grid-cols-1 sm:grid-cols-2 gap-6 items-start"
        >
          {/* Compact Pill */}
          <div className="flex flex-col items-center">
            <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-foreground/30 mb-5">
              {t("compact")}
            </p>
            <div className="relative">
              {/* Simulated desktop background */}
              <div className="w-full max-w-[280px] mx-auto rounded-2xl border border-foreground/[0.06] bg-foreground/[0.02] p-8 pb-16 relative overflow-hidden">
                {/* Fake title bar dots */}
                <div className="flex gap-1.5 mb-6">
                  <div className="w-2 h-2 rounded-full bg-foreground/[0.08]" />
                  <div className="w-2 h-2 rounded-full bg-foreground/[0.08]" />
                  <div className="w-2 h-2 rounded-full bg-foreground/[0.08]" />
                </div>
                {/* Content lines */}
                <div className="space-y-2.5 mb-6">
                  <div className="h-2 w-3/4 rounded bg-foreground/[0.04]" />
                  <div className="h-2 w-1/2 rounded bg-foreground/[0.04]" />
                  <div className="h-2 w-2/3 rounded bg-foreground/[0.04]" />
                </div>
                {/* Floating pill overlay */}
                <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10">
                  <div className="gv-pill-glow inline-flex items-center gap-2.5 rounded-full border border-foreground/[0.08] bg-background/90 backdrop-blur-md px-4 py-2 shadow-lg">
                    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-foreground/[0.06]">
                      <span className="text-[9px] font-bold text-foreground/60">C</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="gv-dot-pulse h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      <span className="text-[11px] font-medium text-foreground/60">{t("ready")}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Expanded Panel */}
          <div className="flex flex-col items-center">
            <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-foreground/30 mb-5">
              {t("expanded")}
            </p>
            <div className="w-full max-w-[280px] mx-auto">
              <div className="rounded-2xl border border-foreground/[0.08] bg-background/90 backdrop-blur-md shadow-lg overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-foreground/[0.06] px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-foreground/[0.06]">
                      <span className="text-[9px] font-bold text-foreground/60">C</span>
                    </div>
                    <span className="text-[11px] font-semibold text-foreground/70">Coasty</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 gv-dot-pulse" />
                  </div>
                </div>

                {/* Messages */}
                <div className="space-y-2 p-3 min-h-[140px]">
                  <div className="gv-msg-1 flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-foreground/[0.05] px-3 py-2">
                      <p className="text-[10px] text-foreground/60">{t("exampleTask")}</p>
                    </div>
                  </div>
                  <div className="gv-msg-2 max-w-[85%]">
                    <div className="rounded-2xl rounded-bl-sm border border-foreground/[0.06] px-3 py-2">
                      <p className="text-[10px] text-foreground/50">{t("exampleResponse")}</p>
                    </div>
                  </div>
                  <div className="gv-msg-3 max-w-[70%]">
                    <div className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] px-2.5 py-1.5 flex items-center gap-1.5">
                      <FolderOpen size={9} weight="duotone" className="text-foreground/30" />
                      <span className="text-[9px] text-foreground/40">~/Documents/resume.docx</span>
                    </div>
                  </div>
                </div>

                {/* Input */}
                <div className="border-t border-foreground/[0.06] p-2.5">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 rounded-lg border border-foreground/[0.06] bg-foreground/[0.02] px-2.5 py-1.5 flex items-center">
                      <span className="text-[10px] text-foreground/25">{t("describePlaceholder")}</span>
                      <span className="gv-cursor-blink ml-0.5 w-px h-3 bg-foreground/30" />
                    </div>
                    <div className="flex h-6 w-6 items-center justify-center rounded-md bg-foreground/90">
                      <ArrowRight size={10} weight="bold" className="text-background" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Connection line between pill and panel */}
              <div className="flex justify-center mt-3">
                <div className="gv-expand-line h-px bg-foreground/20" />
              </div>
            </div>
          </div>
        </motion.div>
      </motion.section>

      {/* ── Section 2: Capabilities ── */}
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
          {t("whatItControls")}
        </motion.h2>

        <motion.div variants={stagger} className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {capabilityKeys.map((cap, i) => {
            const Icon = cap.icon
            return (
              <motion.div
                key={cap.key}
                variants={fade}
                custom={i + 1}
                className="group rounded-2xl border border-foreground/[0.06] bg-foreground/[0.02] p-4 text-center transition-colors hover:bg-foreground/[0.04]"
              >
                <div className="flex h-10 w-10 mx-auto items-center justify-center rounded-xl bg-foreground/[0.05] mb-3">
                  <Icon size={20} weight="duotone" className="text-foreground/50" />
                </div>
                <p className="text-[13px] font-semibold text-foreground/70 mb-0.5">{t(`controls.${cap.key}.name`)}</p>
                <p className="text-[11px] text-foreground/35">{t(`controls.${cap.key}.desc`)}</p>
              </motion.div>
            )
          })}
        </motion.div>
      </motion.section>

      {/* ── Section 3: Cloud vs Desktop ── */}
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
          {t("twoWays")}
        </motion.h2>

        <motion.div variants={stagger} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Cloud VM */}
          <motion.div
            variants={fade}
            custom={1}
            className="rounded-2xl border border-foreground/[0.06] bg-foreground/[0.02] p-6"
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-foreground/[0.05] mb-4">
              <Cloud size={22} weight="duotone" className="text-foreground/50" />
            </div>
            <p className="text-[15px] font-semibold text-foreground/70 mb-4">{t("cloudVm")}</p>
            <div className="space-y-3">
              <div className="flex items-start gap-2.5">
                <ShieldCheck size={14} weight="duotone" className="text-foreground/30 mt-0.5 shrink-0" />
                <p className="text-[12px] text-foreground/45 leading-relaxed">{t("cloudFeatures.isolated")}</p>
              </div>
              <div className="flex items-start gap-2.5">
                <Browser size={14} weight="duotone" className="text-foreground/30 mt-0.5 shrink-0" />
                <p className="text-[12px] text-foreground/45 leading-relaxed">{t("cloudFeatures.freshBrowser")}</p>
              </div>
              <div className="flex items-start gap-2.5">
                <ShieldCheck size={14} weight="duotone" className="text-foreground/30 mt-0.5 shrink-0" />
                <p className="text-[12px] text-foreground/45 leading-relaxed">{t("cloudFeatures.maxSecurity")}</p>
              </div>
            </div>
          </motion.div>

          {/* Desktop */}
          <motion.div
            variants={fade}
            custom={2}
            className="rounded-2xl border border-foreground/[0.06] bg-foreground/[0.02] p-6"
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-foreground/[0.05] mb-4">
              <Monitor size={22} weight="duotone" className="text-foreground/50" />
            </div>
            <p className="text-[15px] font-semibold text-foreground/70 mb-4">{t("desktopMode")}</p>
            <div className="space-y-3">
              <div className="flex items-start gap-2.5">
                <FolderOpen size={14} weight="duotone" className="text-foreground/30 mt-0.5 shrink-0" />
                <p className="text-[12px] text-foreground/45 leading-relaxed">{t("desktopFeatures.yourFiles")}</p>
              </div>
              <div className="flex items-start gap-2.5">
                <AppWindow size={14} weight="duotone" className="text-foreground/30 mt-0.5 shrink-0" />
                <p className="text-[12px] text-foreground/45 leading-relaxed">{t("desktopFeatures.yourApps")}</p>
              </div>
              <div className="flex items-start gap-2.5">
                <UserCircle size={14} weight="duotone" className="text-foreground/30 mt-0.5 shrink-0" />
                <p className="text-[12px] text-foreground/45 leading-relaxed">{t("desktopFeatures.yourSessions")}</p>
              </div>
            </div>
          </motion.div>
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
          href="/download"
          className="inline-flex items-center gap-2.5 h-11 px-6 rounded-xl bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity"
        >
          {t("downloadCta")}
          <ArrowRight size={15} weight="bold" />
        </Link>
      </motion.div>
    </div>
  )
}
