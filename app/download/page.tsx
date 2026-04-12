"use client"

import { GuideLines } from "@/app/components/landing/guide-lines"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

import { RainbowButton } from "@/components/magicui/rainbow-button"
import { WindowsIcon, AppleIcon } from "@/components/icons/platform-icons"
import {
  ArrowRight,
  Download,
  Monitor,
  Globe,
  Terminal,
  FolderOpen,
  RefreshCw,
  Check,
  Loader2,
  ShieldAlert,
  Smartphone,
  X,
} from "lucide-react"
import Link from "next/link"
import { useState, useEffect, useCallback } from "react"
import { trackDesktopAppDownloaded } from "@/lib/posthog/analytics"
import { cn } from "@/lib/utils"

import { LandingHeader } from "@/app/components/landing/landing-header"
import { LandingFooter } from "@/app/components/landing/landing-footer"
import Image from "next/image"
import { motion, AnimatePresence } from "framer-motion"
import { useTranslations } from "next-intl"

type Platform = "windows" | "mac"

interface PlatformInfo {
  version: string
  filename: string
  sha512: string
  size: number
  releaseDate: string
  downloadUrl: string
}

interface DownloadData {
  windows: PlatformInfo | null
  mac: PlatformInfo | null
}

const platformMeta: Record<
  Platform,
  {
    label: string
    icon: typeof WindowsIcon
    extension: string
    requirements: string[]
  }
> = {
  windows: {
    label: "Windows",
    icon: WindowsIcon,
    extension: ".exe",
    requirements: ["Windows 10 or later", "64-bit (x86_64)", "4 GB RAM minimum"],
  },
  mac: {
    label: "macOS",
    icon: AppleIcon,
    extension: ".dmg",
    requirements: ["macOS 10.15 (Catalina) or later", "Apple Silicon or Intel", "4 GB RAM minimum"],
  },
}

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "windows"
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes("mac")) return "mac"
  return "windows"
}

function formatSize(bytes: number): string {
  if (!bytes) return ""
  const mb = bytes / (1024 * 1024)
  return `${mb.toFixed(1)} MB`
}

export default function DownloadPage() {
  const t = useTranslations("downloadPage")
  const [isMobile, setIsMobile] = useState(false)
  const [detectedPlatform, setDetectedPlatform] = useState<Platform>("windows")
  const [downloadData, setDownloadData] = useState<DownloadData | null>(null)
  const [loading, setLoading] = useState(true)
  const [showSplash, setShowSplash] = useState(true)

  const closeSplash = useCallback(() => setShowSplash(false), [])

  useEffect(() => {
    setIsMobile(window.innerWidth < 768)
    setDetectedPlatform(detectPlatform())

    const onResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  useEffect(() => {
    fetch(`/api/download?_=${Date.now()}`, { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`API returned ${res.status}`)
        return res.json()
      })
      .then((data: DownloadData) => {
        setDownloadData(data)
      })
      .catch((err) => {
        console.error("Failed to fetch download data:", err)
      })
      .finally(() => setLoading(false))
  }, [])

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.08, delayChildren: 0.1 },
    },
  }

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.45, ease: "easeOut" as const },
    },
  }

  const version = downloadData?.windows?.version || downloadData?.mac?.version

  const allPlatforms: Platform[] = ["windows", "mac"]

  const features = [
    { icon: Globe, label: t("features.browser") },
    { icon: Monitor, label: t("features.desktop") },
    { icon: Terminal, label: t("features.terminal") },
    { icon: FolderOpen, label: t("features.files") },
    { icon: RefreshCw, label: t("features.updates") },
    { icon: Smartphone, label: t("features.remote") },
  ]

  function getDownloadButton(platform: Platform, variant: "hero" | "card") {
    const meta = platformMeta[platform]
    const data = downloadData?.[platform]

    if (loading) {
      return variant === "hero" ? (
        <RainbowButton size="lg" className="w-full sm:w-auto" disabled>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {t("loading")}
        </RainbowButton>
      ) : (
        <Button variant="outline" size="sm" className="w-full" disabled>
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          {t("loading")}
        </Button>
      )
    }

    if (data) {
      return variant === "hero" ? (
        <RainbowButton size="lg" className="w-full sm:w-auto" asChild>
          <a href={data.downloadUrl} onClick={() => trackDesktopAppDownloaded(platform)}>
            <Download className="mr-2 h-4 w-4" />
            {t("downloadFor", { platform: meta.label })}
          </a>
        </RainbowButton>
      ) : (
        <Button
          variant={platform === detectedPlatform ? "default" : "outline"}
          size="sm"
          className="w-full"
          asChild
        >
          <a href={data.downloadUrl} onClick={() => trackDesktopAppDownloaded(platform)}>
            <Download className="mr-1.5 h-3.5 w-3.5" />
            {t("download")}
          </a>
        </Button>
      )
    }

    // Fallback — no data but loading finished
    return variant === "hero" ? (
      <Button size="lg" disabled className="w-full sm:w-auto">
        {t("unavailable")}
      </Button>
    ) : (
      <Button variant="outline" size="sm" className="w-full" disabled>
        {t("unavailable")}
      </Button>
    )
  }

  const splashPlatform = downloadData?.[detectedPlatform]

  return (
    <div className="min-h-screen bg-background relative">
      {/* ─── Full-screen splash popup ─── */}
      <AnimatePresence>
        {showSplash && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="fixed inset-0 z-[60] overflow-hidden bg-black"
          >
            {/* Smoke layers — multicolor, roaming */}
            <div className="pointer-events-none absolute inset-0 z-[1]">
              {/* Teal — roams from top-left to bottom-right */}
              <motion.div
                animate={{
                  x: ["0%", "60%", "20%", "80%", "10%", "50%", "0%"],
                  y: ["0%", "40%", "70%", "20%", "60%", "10%", "0%"],
                  scale: [1, 1.2, 0.8, 1.3, 0.9, 1.1, 1],
                }}
                transition={{ duration: 20, ease: "easeInOut", repeat: Infinity }}
                className="absolute top-[-10%] left-[-10%] h-[45%] w-[45%]"
              >
                <div className="h-full w-full rounded-full bg-teal-500/[0.30] blur-[80px]" />
              </motion.div>

              {/* Rose — roams from bottom-right to top-left */}
              <motion.div
                animate={{
                  x: ["0%", "-50%", "-10%", "-70%", "-30%", "-60%", "0%"],
                  y: ["0%", "-50%", "-20%", "-60%", "-10%", "-40%", "0%"],
                  scale: [1, 0.9, 1.3, 1, 1.2, 0.85, 1],
                }}
                transition={{ duration: 22, ease: "easeInOut", repeat: Infinity, delay: 1 }}
                className="absolute bottom-[-10%] right-[-10%] h-[45%] w-[45%]"
              >
                <div className="h-full w-full rounded-full bg-rose-500/[0.25] blur-[70px]" />
              </motion.div>

              {/* Blue — zigzags across the middle */}
              <motion.div
                animate={{
                  x: ["-20%", "40%", "-30%", "60%", "0%", "50%", "-20%"],
                  y: ["10%", "-20%", "30%", "-10%", "40%", "0%", "10%"],
                  scale: [1.1, 0.85, 1.25, 0.9, 1.15, 1, 1.1],
                }}
                transition={{ duration: 18, ease: "easeInOut", repeat: Infinity, delay: 3 }}
                className="absolute top-[10%] left-[30%] h-[40%] w-[40%]"
              >
                <div className="h-full w-full rounded-full bg-blue-500/[0.25] blur-[70px]" />
              </motion.div>

              {/* Amber — sweeps from left to right and back */}
              <motion.div
                animate={{
                  x: ["-10%", "70%", "20%", "90%", "0%", "50%", "-10%"],
                  y: ["20%", "-10%", "40%", "10%", "-20%", "30%", "20%"],
                  scale: [1, 1.15, 0.9, 1.2, 1.05, 0.85, 1],
                }}
                transition={{ duration: 19, ease: "easeInOut", repeat: Infinity, delay: 2 }}
                className="absolute top-[40%] left-[-5%] h-[35%] w-[35%]"
              >
                <div className="h-full w-full rounded-full bg-amber-500/[0.22] blur-[60px]" />
              </motion.div>

              {/* Violet — orbits around center */}
              <motion.div
                animate={{
                  x: ["0%", "30%", "10%", "-30%", "-15%", "20%", "0%"],
                  y: ["0%", "-25%", "20%", "10%", "-20%", "15%", "0%"],
                  scale: [1, 1.3, 0.85, 1.2, 0.9, 1.15, 1],
                  opacity: [0.6, 1, 0.5, 0.9, 0.7, 1, 0.6],
                }}
                transition={{ duration: 15, ease: "easeInOut", repeat: Infinity }}
                className="absolute top-[25%] left-[20%] h-[35%] w-[40%]"
              >
                <div className="h-full w-full rounded-full bg-violet-500/[0.20] blur-[65px]" />
              </motion.div>

              {/* Cyan wisp — fast, long travel */}
              <motion.div
                animate={{
                  x: ["-20%", "80%", "10%", "60%", "-20%"],
                  y: ["10%", "-15%", "30%", "50%", "10%"],
                  opacity: [0, 1, 0.4, 1, 0],
                }}
                transition={{ duration: 8, ease: "easeInOut", repeat: Infinity }}
                className="absolute top-[15%] left-[5%] h-[14%] w-[16%]"
              >
                <div className="h-full w-full rounded-full bg-cyan-400/[0.35] blur-[35px]" />
              </motion.div>

              {/* Orange wisp — fast, diagonal */}
              <motion.div
                animate={{
                  x: ["30%", "-60%", "20%", "-40%", "30%"],
                  y: ["-10%", "50%", "-20%", "40%", "-10%"],
                  opacity: [0, 1, 0.3, 1, 0],
                }}
                transition={{ duration: 9, ease: "easeInOut", repeat: Infinity, delay: 1.5 }}
                className="absolute top-[50%] right-[5%] h-[12%] w-[14%]"
              >
                <div className="h-full w-full rounded-full bg-orange-400/[0.30] blur-[30px]" />
              </motion.div>

              {/* Emerald wisp — fast, bottom sweep */}
              <motion.div
                animate={{
                  x: ["50%", "-30%", "70%", "-10%", "50%"],
                  y: ["0%", "20%", "-15%", "10%", "0%"],
                  opacity: [0, 0.8, 0.2, 1, 0],
                }}
                transition={{ duration: 7, ease: "easeInOut", repeat: Infinity, delay: 4 }}
                className="absolute bottom-[15%] left-[10%] h-[13%] w-[15%]"
              >
                <div className="h-full w-full rounded-full bg-emerald-400/[0.28] blur-[32px]" />
              </motion.div>
            </div>

            {/* Close button */}
            <button
              type="button"
              onClick={closeSplash}
              className="fixed top-4 right-4 sm:top-6 sm:right-6 z-20 flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/50 backdrop-blur-sm transition-all duration-200 hover:bg-white/10 hover:text-white/80 hover:border-white/20"
            >
              <X className="h-4 w-4 sm:h-5 sm:w-5" strokeWidth={1.5} />
            </button>

            {/* Content — always fits viewport, no scrolling */}
            <div className="relative z-10 flex h-full flex-col items-center justify-center px-5 sm:px-8 md:px-12 py-14 sm:py-10">
              <div className="flex w-full max-w-3xl flex-col items-center gap-5 sm:gap-6">
                {/* Demo screenshot — constrained to never overflow */}
                <motion.div
                  initial={{ opacity: 0, y: 24, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.6, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
                  className="w-full"
                >
                  <div className="relative mx-auto overflow-hidden rounded-lg sm:rounded-xl md:rounded-2xl border border-white/[0.08] shadow-2xl shadow-black/50 max-h-[50vh] sm:max-h-[55vh]">
                    <Image
                      src="/demo-screenshot.png"
                      alt="Coasty desktop app demo"
                      width={1456}
                      height={816}
                      className="w-full h-full object-cover object-top"
                      priority
                    />
                    {/* Subtle reflection overlay */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-white/[0.02]" />
                  </div>
                </motion.div>

                {/* Text + Download */}
                <motion.div
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.35, ease: [0.22, 1, 0.36, 1] }}
                  className="flex flex-col items-center gap-3 sm:gap-4 text-center"
                >
                  <div>
                    <h2 className="text-lg sm:text-2xl md:text-3xl font-semibold text-white tracking-tight">
                      {t("heroTitle")}
                    </h2>
                    <p className="mt-1 sm:mt-2 text-[11px] sm:text-sm md:text-base text-white/40 max-w-md mx-auto leading-relaxed">
                      {t("heroDescription")}
                    </p>
                  </div>

                  <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-3 w-full sm:w-auto">
                    {splashPlatform ? (
                      <a
                        href={splashPlatform.downloadUrl}
                        onClick={() => trackDesktopAppDownloaded(detectedPlatform)}
                        className="inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-full bg-white px-5 sm:px-6 py-2 sm:py-2.5 text-xs sm:text-sm font-semibold text-black transition-all duration-200 hover:bg-white/90 hover:scale-[1.02] active:scale-[0.98]"
                      >
                        <Download className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                        {t("downloadFor", { platform: platformMeta[detectedPlatform].label })}
                      </a>
                    ) : loading ? (
                      <div className="inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-full bg-white/10 px-5 sm:px-6 py-2 sm:py-2.5 text-xs sm:text-sm font-medium text-white/50">
                        <Loader2 className="h-3.5 w-3.5 sm:h-4 sm:w-4 animate-spin" />
                        {t("loading")}
                      </div>
                    ) : null}

                    <button
                      type="button"
                      onClick={closeSplash}
                      className="text-[11px] sm:text-sm text-white/30 hover:text-white/60 transition-colors duration-200 py-0.5"
                    >
                      {t("browserCta")}
                    </button>
                  </div>
                </motion.div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <GuideLines />
      <LandingHeader />

      <main className={cn("relative", isMobile ? "pt-16" : "pt-20")}>
        {/* Hero */}
        <section
          className={cn(
            "flex items-center justify-center",
            isMobile ? "px-7 py-12" : "px-10 py-20"
          )}
        >
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="w-full max-w-4xl"
          >
            <motion.div variants={itemVariants} className="text-center mb-8">
              <Badge variant="outline" className="mb-4">
                <Download className="mr-1 h-3 w-3" />
                {t("title")}
              </Badge>
              <h1
                className={cn(
                  "font-bold tracking-tight",
                  isMobile ? "text-4xl" : "text-5xl sm:text-6xl"
                )}
              >
                <span className="bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
                  {t("heroTitle")}
                </span>
              </h1>
              <p
                className={cn(
                  "text-muted-foreground mx-auto",
                  isMobile
                    ? "mt-4 text-base max-w-md"
                    : "mt-6 text-lg sm:text-xl max-w-2xl"
                )}
              >
                {t("heroDescription")}
              </p>
              {version && (
                <div className="flex justify-center mt-4">
                  <Badge variant="secondary">v{version}</Badge>
                </div>
              )}
            </motion.div>

            {/* Interactive overlay demo */}
            <motion.div variants={itemVariants} className="mb-16">
              <h3
                className={cn(
                  "text-center font-semibold mb-2",
                  isMobile ? "text-xl" : "text-2xl"
                )}
              >
                {t("seeInAction")}
              </h3>
              <p className="text-center text-sm text-muted-foreground mb-8 max-w-md mx-auto">
                {t("overlayDescription")}
              </p>
              <div className="mx-auto max-w-3xl overflow-hidden rounded-2xl shadow-2xl shadow-primary/10 border border-white/10">
                <Image
                  src="/demo-screenshot.png"
                  alt="Coasty desktop app running on Windows and macOS"
                  width={1456}
                  height={816}
                  className="w-full h-auto"
                  priority
                />
              </div>
            </motion.div>

            {/* Recommended download */}
            <motion.div variants={itemVariants} className="mb-12">
              {(() => {
                const meta = platformMeta[detectedPlatform]
                const data = downloadData?.[detectedPlatform]
                const Icon = meta.icon
                return (
                  <div
                    className={cn(
                      "relative mx-auto max-w-lg rounded-2xl border border-primary/30 bg-card/80 backdrop-blur-sm p-6 sm:p-8",
                      "shadow-lg shadow-primary/5"
                    )}
                  >
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <Badge className="bg-primary text-primary-foreground border-0">
                        {t("recommended")}
                      </Badge>
                    </div>
                    <div className="flex flex-col items-center gap-4 text-center">
                      <div className="p-3 rounded-xl bg-primary/10">
                        <Icon className="h-8 w-8 text-primary" />
                      </div>
                      <div>
                        <h2 className="text-xl font-semibold">
                          {t("coastyFor", { platform: meta.label })}
                        </h2>
                        {data && (
                          <p className="text-sm text-muted-foreground mt-1">
                            {t("installerLabel", { extension: meta.extension })}
                            {data.size ? ` · ${formatSize(data.size)}` : ""}
                          </p>
                        )}
                      </div>
                      {getDownloadButton(detectedPlatform, "hero")}
                    </div>
                  </div>
                )
              })()}
            </motion.div>

            {/* Installation notice */}
            <motion.div variants={itemVariants} className="mb-12">
              <div className="mx-auto max-w-lg rounded-xl border border-border/60 bg-card/60 backdrop-blur-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-border/40 bg-muted/30">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4 text-muted-foreground" />
                    <p className="text-sm font-medium">{t("beforeInstall")}</p>
                  </div>
                </div>
                <div className="px-4 py-3.5 space-y-3">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {t("beforeInstallDescription")}
                  </p>
                  <div className="space-y-2.5">
                    <div className="flex gap-2.5">
                      <WindowsIcon className="h-3.5 w-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Windows SmartScreen will say{" "}
                        <span className="text-foreground font-medium">
                          {'"'}{t("windowsSteps.step1")}{'"'}
                        </span>
                        . Click{" "}
                        <span className="text-foreground font-medium">{t("windowsSteps.step2")}</span>
                        {" "}then{" "}
                        <span className="text-foreground font-medium">{t("windowsSteps.step3")}</span>.
                      </p>
                    </div>
                    <div className="flex gap-2.5">
                      <AppleIcon className="h-3.5 w-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        macOS Gatekeeper will say{" "}
                        <span className="text-foreground font-medium">
                          {'"'}{t("macSteps.step1")}{'"'}
                        </span>
                        . Open{" "}
                        <span className="text-foreground font-medium">
                          {t("macSteps.step2")}
                        </span>
                        {" "}and click{" "}
                        <span className="text-foreground font-medium">{t("macSteps.step3")}</span>.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>

            {/* All platforms */}
            <motion.div variants={itemVariants} className="mb-16">
              <h3 className="text-center text-sm font-medium text-muted-foreground mb-6">
                {t("allPlatforms")}
              </h3>
              <div
                className={cn(
                  "grid gap-4 max-w-3xl mx-auto",
                  isMobile ? "grid-cols-1" : "grid-cols-2"
                )}
              >
                {allPlatforms.map((platform) => {
                  const meta = platformMeta[platform]
                  const data = downloadData?.[platform]
                  const Icon = meta.icon
                  const isRecommended = platform === detectedPlatform
                  return (
                    <div
                      key={platform}
                      className={cn(
                        "rounded-xl border bg-card/60 backdrop-blur-sm p-5 transition-all hover:shadow-md",
                        isRecommended
                          ? "border-primary/30"
                          : "border-border/50 hover:border-primary/20"
                      )}
                    >
                      <div className="flex flex-col items-center gap-3 text-center">
                        <Icon className="h-6 w-6 text-muted-foreground" />
                        <div>
                          <p className="font-medium">{meta.label}</p>
                          <p className="text-xs text-muted-foreground">
                            {meta.extension}
                            {data?.size ? ` · ${formatSize(data.size)}` : ""}
                          </p>
                        </div>
                        {getDownloadButton(platform, "card")}
                      </div>
                    </div>
                  )
                })}
              </div>
            </motion.div>

            {/* System Requirements */}
            <motion.div variants={itemVariants} className="mb-16">
              <h3
                className={cn(
                  "text-center font-semibold mb-8",
                  isMobile ? "text-xl" : "text-2xl"
                )}
              >
                {t("systemRequirements.title")}
              </h3>
              <div
                className={cn(
                  "grid gap-4 max-w-3xl mx-auto",
                  isMobile ? "grid-cols-1" : "grid-cols-2"
                )}
              >
                {allPlatforms.map((platform) => {
                  const meta = platformMeta[platform]
                  const Icon = meta.icon
                  return (
                    <div
                      key={platform}
                      className="rounded-xl border border-border/50 bg-card/60 backdrop-blur-sm p-5"
                    >
                      <div className="flex items-center gap-2 mb-3">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        <p className="font-medium text-sm">{meta.label}</p>
                      </div>
                      <ul className="space-y-1.5">
                        {meta.requirements.map((req) => (
                          <li
                            key={req}
                            className="flex items-start gap-2 text-xs text-muted-foreground"
                          >
                            <Check className="h-3 w-3 text-primary mt-0.5 flex-shrink-0" />
                            {req}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )
                })}
              </div>
            </motion.div>

            {/* What's included */}
            <motion.div variants={itemVariants} className="mb-16">
              <h3
                className={cn(
                  "text-center font-semibold mb-8",
                  isMobile ? "text-xl" : "text-2xl"
                )}
              >
                {t("whatsIncluded")}
              </h3>
              <div className="flex flex-wrap justify-center gap-3 max-w-xl mx-auto">
                {features.map((f) => (
                  <div
                    key={f.label}
                    className="inline-flex items-center gap-2 rounded-full border border-border/50 bg-card/60 backdrop-blur-sm px-4 py-2"
                  >
                    <f.icon className="h-4 w-4 text-primary" />
                    <span className="text-sm">{f.label}</span>
                  </div>
                ))}
              </div>
            </motion.div>

            {/* CTA */}
            <motion.div variants={itemVariants} className="text-center mb-12">
              <p className="text-muted-foreground mb-4">
                {t("browserCtaDescription")}
              </p>
              <Button variant="outline" size="lg" className="rounded-3xl" asChild>
                <Link href="/auth">
                  {t("browserCta")}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </motion.div>
          </motion.div>
        </section>

        <LandingFooter />
      </main>
    </div>
  )
}
