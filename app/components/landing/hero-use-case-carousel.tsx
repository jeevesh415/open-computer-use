"use client"

import { useState, useEffect, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ArrowRight, Video, Play } from "lucide-react"
import Link from "next/link"
import Image from "next/image"
import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"

const DEMO_VIDEO_IDS = [
  "icxgLDephHE", "qTvmGfg3HVw", "Wbo2o74hVIo",
  "mH-csaCa508", "AnHJuRMLCnE", "A_OvNh51Npg",
]

const DEMO_VIDEO_KEYS = [
  "marketing", "goToMarket", "qaTesting",
  "jobApplication", "formFilling", "socialMedia",
] as const

const HEADLINE_KEYS = [
  "computerAgent", "competitorIntel", "qaTesting",
  "dataExtraction", "leadGeneration", "emailOutreach",
] as const

export function HeroUseCaseCarousel({ isMobile }: { isMobile: boolean }) {
  const [activeVideoIndex, setActiveVideoIndex] = useState(0)
  const [playingVideoId, setPlayingVideoId] = useState<string | null>(null)
  const [headlineIndex, setHeadlineIndex] = useState(0)
  const t = useTranslations("hero")
  const tc = useTranslations("common")

  const HEADLINES = HEADLINE_KEYS.map((key) => t(`useCases.${key}.headline`))
  const DEMO_VIDEOS = DEMO_VIDEO_IDS.map((id, i) => ({
    id,
    label: t(`demoVideos.${DEMO_VIDEO_KEYS[i]}.label`),
    task: t(`demoVideos.${DEMO_VIDEO_KEYS[i]}.task`),
  }))

  // Auto-rotate headlines
  useEffect(() => {
    const interval = setInterval(() => {
      setHeadlineIndex((prev) => (prev + 1) % HEADLINES.length)
    }, 3500)
    return () => clearInterval(interval)
  }, [HEADLINES.length])

  return (
    <div className="relative w-full max-w-[1000px] mx-auto">

      {/* ─── Text ─── */}
      <div className={cn("text-center", isMobile ? "mb-10" : "mb-16")}>

        {/* Badge */}
        <div className={cn("flex justify-center", isMobile ? "mb-5" : "mb-7")}>
          <div className={cn(
            "inline-flex items-center gap-2 rounded-full",
            "border border-foreground/[0.06] dark:border-white/[0.08]",
            "bg-foreground/[0.03] dark:bg-white/[0.04]",
            "backdrop-blur-sm",
            "px-4 py-1.5",
          )}>
            <span className={cn(
              "font-medium tracking-wide text-foreground/50 dark:text-white/60",
              isMobile ? "text-[11px]" : "text-xs"
            )}>
              #1 Computer-Use Agent
            </span>
            <span className="h-3 w-px bg-foreground/[0.1] dark:bg-white/[0.12]" />
            <span className={cn(
              "font-semibold tracking-wide text-foreground dark:text-white",
              isMobile ? "text-[11px]" : "text-xs"
            )}>
              82% OSWorld
            </span>
          </div>
        </div>

        {/* Headline */}
        <h1 className={cn(
          "font-semibold tracking-[-0.04em] text-foreground",
          isMobile
            ? "text-[2.5rem] leading-[1.08]"
            : "text-[3.5rem] sm:text-[4.25rem] lg:text-[5rem] leading-[1.04]"
        )}>
          {t("headline")}
        </h1>

        {/* Rotating subheadline */}
        <div className={cn(
          "relative overflow-hidden pb-2",
          isMobile ? "mt-1" : "mt-2"
        )}>
          <span
            className={cn(
              "invisible block font-semibold tracking-[-0.04em] leading-[1.3]",
              isMobile
                ? "text-[2.5rem]"
                : "text-[3.5rem] sm:text-[4.25rem] lg:text-[5rem]"
            )}
            aria-hidden="true"
          >
            {HEADLINES.reduce((a, b) => (b.length > a.length ? b : a), "")}
          </span>
          <AnimatePresence mode="wait">
            <motion.span
              key={headlineIndex}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -14 }}
              transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
              className={cn(
                "absolute inset-x-0 top-0 font-semibold tracking-[-0.04em] leading-[1.3] text-foreground/60 dark:text-white/65",
                isMobile
                  ? "text-[2.5rem]"
                  : "text-[3.5rem] sm:text-[4.25rem] lg:text-[5rem]"
              )}
            >
              {HEADLINES[headlineIndex]}
            </motion.span>
          </AnimatePresence>
        </div>

        {/* Description */}
        <p className={cn(
          "mx-auto max-w-lg text-foreground/55 dark:text-white/60 leading-relaxed",
          isMobile ? "mt-4 text-[13px]" : "mt-6 text-[17px]"
        )}>
          {t("useCases.computerAgent.outcome")}
        </p>

        {/* CTAs */}
        <div className={cn(
          "flex items-center justify-center",
          isMobile ? "mt-7 gap-5 flex-col" : "mt-10 gap-6"
        )}>
          <Link href="/auth">
            <motion.button
              className={cn(
                "inline-flex items-center gap-2 rounded-full font-medium cursor-pointer",
                "bg-foreground text-background",
                isMobile ? "px-6 py-3 text-sm" : "px-7 py-3 text-[15px]"
              )}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              {tc("tryCoastyFree")}
              <ArrowRight className="h-3.5 w-3.5" />
            </motion.button>
          </Link>
          <a href="https://cal.com/coasty/15min" target="_blank" rel="noopener noreferrer">
            <motion.button
              className={cn(
                "inline-flex items-center gap-1.5 font-medium cursor-pointer",
                "text-foreground/50 hover:text-foreground/75 dark:text-white/60 dark:hover:text-white/90 transition-colors duration-300",
                isMobile ? "text-sm" : "text-[15px]"
              )}
              whileHover={{ x: 2 }}
              whileTap={{ scale: 0.98 }}
            >
              <Video className="h-3.5 w-3.5" />
              {tc("bookDemo")}
            </motion.button>
          </a>
        </div>
      </div>

      {/* ─── Video ─── */}
      <div className="relative">
        {/* Soft ambient glow */}
        <div
          className="absolute -bottom-20 left-1/2 -translate-x-1/2 w-[70%] h-[50%] rounded-full blur-[80px] opacity-[0.025] dark:opacity-[0.045] pointer-events-none bg-foreground"
          aria-hidden="true"
        />

        {/* Video frame — edge-to-edge, no chrome */}
        <motion.div
          className={cn(
            "relative overflow-hidden bg-black",
            isMobile ? "rounded-xl" : "rounded-2xl",
            "ring-1 ring-black/[0.04] dark:ring-white/[0.06]",
            "shadow-[0_2px_8px_rgba(0,0,0,0.04),0_16px_48px_-12px_rgba(0,0,0,0.08)]",
            "dark:shadow-[0_2px_8px_rgba(0,0,0,0.2),0_20px_60px_-12px_rgba(0,0,0,0.4)]",
          )}
          whileHover={playingVideoId ? undefined : { scale: 1.005 }}
          transition={{ duration: 0.6, ease: [0.4, 0, 0.2, 1] }}
        >
          <AnimatePresence mode="wait">
            {playingVideoId ? (
              <motion.div
                key={`playing-${playingVideoId}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3 }}
                className="relative w-full"
                style={{ paddingTop: "56.25%" }}
              >
                <iframe
                  className="absolute inset-0 w-full h-full"
                  src={`https://www.youtube-nocookie.com/embed/${playingVideoId}?rel=0&modestbranding=1&showinfo=0&autoplay=1`}
                  title={`Coasty ${DEMO_VIDEOS[activeVideoIndex].label} Demo`}
                  allowFullScreen
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  style={{ border: "none" }}
                />
              </motion.div>
            ) : (
              <motion.div
                key={`thumb-${activeVideoIndex}`}
                initial={{ opacity: 0, scale: 1.02 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
                className="relative cursor-pointer group"
                onClick={() => setPlayingVideoId(DEMO_VIDEOS[activeVideoIndex].id)}
              >
                <div className="relative w-full" style={{ paddingTop: "56.25%" }}>
                  <Image
                    src={`https://img.youtube.com/vi/${DEMO_VIDEOS[activeVideoIndex].id}/maxresdefault.jpg`}
                    alt={`${DEMO_VIDEOS[activeVideoIndex].label} demo`}
                    fill
                    className="object-cover"
                    priority
                  />
                  {/* Scrim */}
                  <div className="absolute inset-0 bg-black/[0.03] group-hover:bg-black/[0.12] transition-colors duration-600" />

                  {/* Play button + label */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                    <div
                      className={cn(
                        "flex items-center justify-center rounded-full",
                        "bg-white/90 backdrop-blur-sm",
                        "shadow-[0_4px_24px_rgba(0,0,0,0.1)]",
                        "group-hover:scale-110 transition-transform duration-500 ease-out",
                        isMobile ? "h-12 w-12" : "h-14 w-14"
                      )}
                    >
                      <Play
                        className={cn(
                          "text-neutral-900 fill-neutral-900 ml-0.5",
                          isMobile ? "h-4 w-4" : "h-[18px] w-[18px]"
                        )}
                      />
                    </div>
                    <span
                      className={cn(
                        "px-3.5 py-1.5 rounded-full bg-black/25 backdrop-blur-md",
                        "font-medium text-white/80",
                        isMobile ? "text-[10px]" : "text-[11px]"
                      )}
                    >
                      {DEMO_VIDEOS[activeVideoIndex].task}
                    </span>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Video selector — clean text tabs */}
        <div
          className={cn(
            "mt-5 flex items-center justify-center",
            isMobile ? "gap-0.5 overflow-x-auto no-scrollbar px-1" : "gap-1"
          )}
          style={isMobile ? { scrollbarWidth: "none" } : undefined}
        >
          {DEMO_VIDEOS.map((video, i) => (
            <button
              key={video.id}
              onClick={() => {
                setActiveVideoIndex(i)
                setPlayingVideoId(null)
              }}
              className={cn(
                "rounded-full cursor-pointer whitespace-nowrap transition-all duration-300",
                isMobile ? "px-3 py-1.5 text-[10px]" : "px-4 py-2 text-[12px]",
                "font-medium",
                i === activeVideoIndex
                  ? "text-foreground bg-foreground/[0.07] dark:text-white dark:bg-white/[0.1]"
                  : "text-foreground/40 hover:text-foreground/60 dark:text-white/45 dark:hover:text-white/70"
              )}
            >
              {video.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
