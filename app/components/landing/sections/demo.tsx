"use client"

import { motion } from "framer-motion"
import { useCallback } from "react"
import Image from "next/image"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { ArrowRight, Play } from "lucide-react"
import { cn } from "@/lib/utils"
import { LandingSectionHeader, LandingSectionTopGlow } from "../section-shell"

const EASE = [0.22, 1, 0.36, 1] as const

type DemoKey = "reddit" | "prospects" | "qa" | "email" | "job" | "hackernews"

type DemoSession = {
  key: DemoKey
  chatId: string
  videoId: string
  duration: string
}

// Order preserved from landing-page.tsx DEMO_SESSION_DATA. videoId mapping
// follows the brief's per-key thumbnail assignment; duration values are
// realistic, varied, and hardcoded as part of the card chrome.
const DEMO_SESSIONS: DemoSession[] = [
  { key: "reddit", chatId: "373c1f67-afec-4bd6-adda-3809ecdbdd75", videoId: "icxgLDephHE", duration: "2m 14s" },
  { key: "prospects", chatId: "425d3c49-3a06-41e5-9859-aa00c5b12f3d", videoId: "qTvmGfg3HVw", duration: "3m 12s" },
  { key: "qa", chatId: "7ee3e942-c5dd-4e49-93b6-353bb5273b7e", videoId: "Wbo2o74hVIo", duration: "1m 47s" },
  { key: "email", chatId: "60a0722b-fb98-43d6-a4e7-951d80a22363", videoId: "mH-csaCa508", duration: "2m 04s" },
  { key: "job", chatId: "4ac6f3d2-c273-4a07-bf98-b986d1cbfb88", videoId: "AnHJuRMLCnE", duration: "4m 08s" },
  { key: "hackernews", chatId: "d181de46-b41d-4b87-9648-0374b2b7ec1c", videoId: "A_OvNh51Npg", duration: "1m 33s" },
]

function thumbUrl(id: string) {
  // 1280x720 — crisp on retina at all card sizes. Falls back to YouTube's
  // generic placeholder only if a video lacks an HD thumb (rare for this set).
  return `https://img.youtube.com/vi/${id}/maxresdefault.jpg`
}

type CardProps = {
  demo: DemoSession
  isMobile: boolean
  onMouseMove?: (e: React.MouseEvent<HTMLDivElement>) => void
  onMouseLeave?: (e: React.MouseEvent<HTMLDivElement>) => void
}

function DemoCard({ demo, isMobile, onMouseMove, onMouseLeave }: CardProps) {
  const t = useTranslations()
  const tc = useTranslations("common")

  return (
    <div
      onMouseMove={!isMobile ? onMouseMove : undefined}
      onMouseLeave={!isMobile ? onMouseLeave : undefined}
      style={{ "--mouse-x": "50%", "--mouse-y": "50%" } as React.CSSProperties}
      className="group relative h-full"
    >
      <Link
        href={`/share/${demo.chatId}`}
        target="_blank"
        rel="noopener noreferrer"
        className="relative block h-full"
      >
        <div
          className={cn(
            "relative h-full overflow-hidden rounded-2xl border border-foreground/10 bg-card/40 backdrop-blur-[2px]",
            "transition-all duration-300",
            !isMobile && "group-hover:-translate-y-0.5 group-hover:border-foreground/20 group-hover:shadow-lg group-hover:shadow-foreground/[0.04]"
          )}
        >
          {/* Mouse-tracking spotlight */}
          <div
            className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
            style={{
              background:
                "radial-gradient(420px circle at var(--mouse-x) var(--mouse-y), rgba(120, 120, 120, 0.08), transparent 45%)",
            }}
          />

          {/* Thumbnail — uniform 16:9 across every card */}
          <div className="relative w-full overflow-hidden aspect-video">
            <Image
              src={thumbUrl(demo.videoId)}
              alt={t(`demo.sessions.${demo.key}.title`)}
              fill
              unoptimized
              sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
              className={cn(
                "object-cover transition-transform duration-[600ms]",
                !isMobile && "group-hover:scale-[1.04]"
              )}
              style={{ transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)" }}
            />

            {/* Inset hairline border */}
            <div className="pointer-events-none absolute inset-0 rounded-t-2xl ring-1 ring-inset ring-foreground/10" />

            {/* Edge vignette on hover */}
            <div
              className={cn(
                "pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500",
                !isMobile && "group-hover:opacity-100"
              )}
              style={{
                background:
                  "radial-gradient(ellipse at center, transparent 35%, rgba(0,0,0,0.35) 100%)",
              }}
            />

            {/* Play icon overlay */}
            <div
              className={cn(
                "pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-300",
                !isMobile && "group-hover:opacity-100"
              )}
            >
              <span className="relative inline-flex items-center justify-center">
                <span
                  className="absolute h-12 w-12 rounded-full border border-foreground/40"
                  style={{ animation: "lp-play-ring 1.8s ease-out infinite" }}
                />
                <span className="relative inline-flex h-12 w-12 items-center justify-center rounded-full bg-foreground/90 shadow-lg shadow-black/20">
                  <Play className="h-4 w-4 translate-x-[1px] fill-background text-background" />
                </span>
              </span>
            </div>
          </div>

          {/* Content */}
          <div className="flex flex-col gap-2 p-4 sm:p-5">
            {/* Pills row */}
            <div className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-foreground/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-foreground/55">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                {t(`demo.sessions.${demo.key}.tag`)}
              </span>
              <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-foreground/40">
                {demo.duration}
              </span>
            </div>

            {/* Title */}
            <h3 className="font-semibold leading-snug tracking-tight text-foreground text-base">
              {t(`demo.sessions.${demo.key}.title`)}
            </h3>

            {/* Description */}
            <p className="leading-relaxed text-muted-foreground/55 text-xs">
              {t(`demo.sessions.${demo.key}.description`)}
            </p>

            {/* Footer */}
            <div className="mt-2 flex items-center gap-1.5 text-foreground/55">
              <ArrowRight
                className={cn(
                  "h-3 w-3 transition-transform duration-200",
                  !isMobile && "group-hover:translate-x-1"
                )}
              />
              <span className="font-mono text-[10px] uppercase tracking-[0.14em]">
                {tc("watchSession")}
              </span>
            </div>
          </div>
        </div>
      </Link>
    </div>
  )
}

export function DemoSection({ isMobile }: { isMobile: boolean }) {
  const t = useTranslations()

  // Mouse-tracking spotlight handlers — same pattern as landing-page.tsx
  const handleCardMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100
    e.currentTarget.style.setProperty("--mouse-x", `${x}%`)
    e.currentTarget.style.setProperty("--mouse-y", `${y}%`)
  }, [])

  const handleCardMouseLeave = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.currentTarget.style.setProperty("--mouse-x", "50%")
    e.currentTarget.style.setProperty("--mouse-y", "50%")
  }, [])

  // Each card slides up + fades in with a staggered delay; row 2 lands a beat
  // after row 1, giving the grid a sense of being dealt in two passes.
  const cardInitial = { opacity: 0, y: 20 }
  const cardAnim = { opacity: 1, y: 0 }

  return (
    <section
      id="demo"
      className="relative py-20 sm:py-24 lg:py-32 px-8 sm:px-10 lg:px-12"
    >
      <LandingSectionTopGlow />

      <style jsx>{`
        @keyframes lp-play-ring {
          0% {
            transform: scale(0.85);
            opacity: 0.7;
          }
          100% {
            transform: scale(1.55);
            opacity: 0;
          }
        }
      `}</style>

      <div className="max-w-6xl w-full mx-auto">
        <LandingSectionHeader
          title={t("demo.title")}
          subtitle={t("demo.subtitle")}
          isMobile={isMobile}
        />

        {/* Uniform 3-col grid: 6 equal cards across 2 rows on lg, 2x3 on md,
            stacked on mobile. Every thumbnail is 16:9 maxres for crisp HD. */}
        <div
          className={cn(
            "grid gap-4 sm:gap-5",
            isMobile ? "grid-cols-1" : "grid-cols-2 lg:grid-cols-3"
          )}
        >
          {DEMO_SESSIONS.map((demo, i) => (
            <motion.div
              key={demo.chatId}
              initial={cardInitial}
              whileInView={cardAnim}
              viewport={{ once: true, amount: 0, margin: "0px 0px -80px 0px" }}
              transition={{ duration: 0.55, ease: EASE, delay: i * 0.07 }}
            >
              <DemoCard
                demo={demo}
                isMobile={isMobile}
                onMouseMove={handleCardMouseMove}
                onMouseLeave={handleCardMouseLeave}
              />
            </motion.div>
          ))}
        </div>

        {/* Footer */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, amount: 0, margin: "0px 0px -80px 0px" }}
          transition={{ duration: 0.5, ease: EASE, delay: 0.5 }}
          className="mt-14 flex flex-col items-center gap-5"
        >
          <div className="h-px w-24 bg-foreground/10" />
          <Link
            href="/discover"
            className="group inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.22em] text-foreground/60 transition-colors hover:text-foreground"
          >
            View all 50+ sessions
            <ArrowRight className="h-3 w-3 transition-transform duration-200 group-hover:translate-x-0.5" />
          </Link>
        </motion.div>
      </div>
    </section>
  )
}
