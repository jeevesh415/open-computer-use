"use client"

import { useState, useCallback } from "react"
import Link from "next/link"
import Image from "next/image"
import { cn } from "@/lib/utils"
import { LandingHeader } from "@/app/components/landing/landing-header"
import { LandingFooter } from "@/app/components/landing/landing-footer"
import { ArrowRight, ArrowUpRight, Play } from "lucide-react"
import { motion } from "framer-motion"
import { GuideLines } from "@/app/components/landing/guide-lines"

const videos = [
  { label: "Marketing", task: "Market your product on Reddit autonomously", videoId: "icxgLDephHE" },
  { label: "Go-to-Market", task: "Find prospects and send them a personalized email", videoId: "qTvmGfg3HVw" },
  { label: "QA Testing", task: "Test every checkout flow and report bugs", videoId: "Wbo2o74hVIo" },
  { label: "Job Application", task: "Find roles, tailor your resume, and apply", videoId: "mH-csaCa508" },
  { label: "Form Filling", task: "Fill out the YC S26 application for you", videoId: "AnHJuRMLCnE" },
  { label: "Social Media", task: "Post on Hacker News and engage with comments", videoId: "A_OvNh51Npg" },
]

const sessions = [
  {
    title: "Coasty on Reddit",
    chatId: "373c1f67-afec-4bd6-adda-3809ecdbdd75",
    description: "Autonomously run a marketing campaign, researching competitors, analyzing trends, and building a strategy.",
    tag: "Marketing",
  },
  {
    title: "Finding Prospective Customers",
    chatId: "425d3c49-3a06-41e5-9859-aa00c5b12f3d",
    description: "Find and research prospective customers, gathering key details to craft personalized outreach.",
    tag: "Go-to-Market",
  },
  {
    title: "QA Testing Itself",
    chatId: "7ee3e942-c5dd-4e49-93b6-353bb5273b7e",
    description: "Run quality assurance on its own product, navigating flows, catching bugs, and reporting issues.",
    tag: "QA Testing",
  },
  {
    title: "Sending an Email",
    chatId: "60a0722b-fb98-43d6-a4e7-951d80a22363",
    description: "Draft and deliver an email entirely on its own, from composing to hitting send.",
    tag: "Communication",
  },
  {
    title: "Applying to a Job",
    chatId: "4ac6f3d2-c273-4a07-bf98-b986d1cbfb88",
    description: "Find a matching role, tailor your resume, and submit the application autonomously.",
    tag: "Job Application",
  },
  {
    title: "Posting on Hacker News",
    chatId: "d181de46-b41d-4b87-9648-0374b2b7ec1c",
    description: "Create and publish a blog post on Hacker News, writing the content and submitting it.",
    tag: "Social Media",
  },
]

const fade = {
  hidden: { opacity: 0, y: 24 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, delay: i * 0.06, ease: [0.25, 0.1, 0.25, 1] as const },
  }),
}

function VideoPlayer({
  videoId,
  label,
  task,
  featured = false,
}: {
  videoId: string
  label: string
  task: string
  featured?: boolean
}) {
  const [playing, setPlaying] = useState(false)

  const handlePlay = useCallback(() => setPlaying(true), [])

  return (
    <div className={cn(
      "rounded-xl overflow-hidden border bg-card flex flex-col h-full",
      featured
        ? "sm:rounded-2xl border-border/40 shadow-[0_4px_24px_-4px_rgba(0,0,0,0.08),0_12px_48px_-8px_rgba(0,0,0,0.1)] dark:shadow-[0_4px_24px_-4px_rgba(0,0,0,0.3),0_12px_48px_-8px_rgba(0,0,0,0.4)] ring-1 ring-white/[0.05] dark:ring-white/[0.03]"
        : "border-border/30 hover:border-border/50 transition-colors duration-300"
    )}>
      {/* Browser chrome — featured only */}
      {featured && (
        <div className="flex items-center px-4 py-2 bg-muted/30 dark:bg-white/[0.03] border-b border-border/20">
          <div className="flex items-center gap-[6px]">
            <div className="h-[10px] w-[10px] rounded-full bg-foreground/[0.08] dark:bg-white/[0.08]" />
            <div className="h-[10px] w-[10px] rounded-full bg-foreground/[0.08] dark:bg-white/[0.08]" />
            <div className="h-[10px] w-[10px] rounded-full bg-foreground/[0.08] dark:bg-white/[0.08]" />
          </div>
          <div className="flex-1 flex justify-center">
            <div className="rounded-md bg-foreground/[0.04] dark:bg-white/[0.04] flex items-center justify-center gap-1.5 px-4 py-[3px] max-w-[300px]">
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" className="text-muted-foreground/30 shrink-0">
                <path d="M11.5 7V5a3.5 3.5 0 10-7 0v2M4 7h8a2 2 0 012 2v4a2 2 0 01-2 2H4a2 2 0 01-2-2V9a2 2 0 012-2z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span className="text-[11px] text-muted-foreground/35 truncate select-none font-mono">
                coasty.ai/{label.toLowerCase().replace(/[\s-]+/g, "-")}
              </span>
            </div>
          </div>
          <div className="w-[54px]" />
        </div>
      )}

      {/* Video area */}
      <div className="relative w-full bg-neutral-950" style={{ paddingTop: "56.25%" }}>
        {playing ? (
          <div className="absolute inset-0">
            <iframe
              className="w-full h-full"
              src={`https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1&showinfo=0&autoplay=1`}
              title={`Coasty ${label} Demo`}
              allowFullScreen
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              style={{ border: "none" }}
            />
          </div>
        ) : (
          <div
            className="absolute inset-0 cursor-pointer group"
            onClick={handlePlay}
          >
            <Image
              src={`https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`}
              alt={`${label} demo`}
              fill
              className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.015]"
              sizes={featured ? "(max-width: 768px) 100vw, 960px" : "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"}
            />

            {/* Gradient overlay */}
            <div className={cn(
              "absolute inset-0 transition-colors duration-500",
              featured
                ? "bg-gradient-to-t from-black/40 via-black/10 to-black/5 group-hover:from-black/50"
                : "bg-gradient-to-t from-black/35 via-black/5 to-transparent group-hover:from-black/45"
            )} />

            {/* Play button */}
            <div className="absolute inset-0 flex items-center justify-center">
              <motion.div
                className={cn(
                  "flex items-center justify-center rounded-full",
                  "bg-white/[0.15] backdrop-blur-md border border-white/20",
                  "group-hover:bg-white/[0.22] group-hover:border-white/30 transition-all duration-300",
                  featured ? "h-[72px] w-[72px]" : "h-12 w-12"
                )}
                whileHover={{ scale: 1.06 }}
                whileTap={{ scale: 0.94 }}
              >
                <Play
                  className={cn(
                    "text-white fill-white ml-[2px] drop-shadow-sm",
                    featured ? "h-6 w-6" : "h-4 w-4"
                  )}
                />
              </motion.div>
            </div>

            {/* Label badge — bottom left */}
            <div className={cn("absolute left-0 bottom-0", featured ? "p-4" : "p-2.5")}>
              <span className={cn(
                "inline-flex items-center gap-1.5 text-white/80 font-medium backdrop-blur-sm bg-white/[0.08] rounded-md border border-white/[0.08]",
                featured ? "text-xs px-2.5 py-1" : "text-[10px] px-2 py-0.5"
              )}>
                <span className="h-1 w-1 rounded-full bg-white/50" />
                {label}
              </span>
            </div>

            {/* Watch text — bottom right, featured only */}
            {featured && (
              <div className="absolute right-0 bottom-0 p-4">
                <span className="text-xs text-white/40 group-hover:text-white/60 transition-colors duration-300">
                  Watch demo &rarr;
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Caption */}
      <div className={cn(
        "flex items-center justify-between",
        featured ? "px-5 py-4 sm:px-6 sm:py-5" : "px-4 py-3"
      )}>
        <div className="min-w-0">
          {!featured && (
            <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground/40">
              {label}
            </span>
          )}
          <p className={cn(
            "text-foreground leading-snug",
            featured ? "font-medium" : "text-sm text-foreground/80 mt-0.5 line-clamp-2"
          )}>
            {task}
          </p>
        </div>
        {featured && (
          <span className="hidden sm:block text-[11px] text-muted-foreground/30 font-medium shrink-0 ml-4">
            Featured
          </span>
        )}
      </div>
    </div>
  )
}

export default function ResultsPage() {
  const [featured, ...rest] = videos

  return (
    <div className="relative min-h-screen bg-background">
      <GuideLines />
      <LandingHeader />

      <main className="pt-32 sm:pt-36 pb-24">
        {/* ── Header ── */}
        <div className="max-w-5xl mx-auto px-7 sm:px-10 mb-20">
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6 }}
            className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/50 mb-4"
          >
            Demos
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.05 }}
            className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.08] mb-5"
          >
            Watch it work.{" "}
            <span className="text-muted-foreground/40">Unscripted.</span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-muted-foreground text-lg sm:text-xl max-w-xl leading-relaxed"
          >
            Every session below is unscripted. Coasty was given a task and completed it autonomously.browse, click, type, think.
          </motion.p>
        </div>

        {/* ── Featured Video ── */}
        <div className="max-w-5xl mx-auto px-7 sm:px-10 mb-6">
          <motion.div
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.15, ease: [0.25, 0.1, 0.25, 1] }}
          >
            <VideoPlayer
              videoId={featured.videoId}
              label={featured.label}
              task={featured.task}
              featured
            />
          </motion.div>
        </div>

        {/* ── Video Grid ── */}
        <div className="max-w-5xl mx-auto px-7 sm:px-10 mb-28">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
            {rest.map((v, i) => (
              <motion.div
                key={v.videoId + v.label}
                custom={i}
                initial="hidden"
                animate="show"
                variants={fade}
              >
                <VideoPlayer
                  videoId={v.videoId}
                  label={v.label}
                  task={v.task}
                />
              </motion.div>
            ))}
          </div>
        </div>

        {/* ── Divider ── */}
        <div className="max-w-5xl mx-auto px-7 sm:px-10">
          <div className="border-t border-border/30" />
        </div>

        {/* ── Sessions ── */}
        <div className="max-w-5xl mx-auto px-7 sm:px-10 mt-20">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="mb-12"
          >
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/50 mb-4">
              Agent Transcripts
            </p>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-3">
              Full session logs
            </h2>
            <p className="text-muted-foreground max-w-lg">
              Read every step the agent took.every click, every decision, every result. Nothing hidden.
            </p>
          </motion.div>

          <div className="space-y-0">
            {sessions.map((s, i) => (
              <motion.div
                key={s.chatId}
                custom={i}
                initial="hidden"
                animate="show"
                variants={fade}
              >
                <Link
                  href={`/share/${s.chatId}`}
                  target="_blank"
                  className="group flex items-start sm:items-center gap-4 sm:gap-6 py-5 sm:py-6 border-b border-border/20 hover:border-border/40 transition-colors duration-300"
                >
                  {/* Number */}
                  <span className="text-2xl sm:text-3xl font-bold text-muted-foreground/15 tabular-nums leading-none pt-0.5 sm:pt-0 w-8 sm:w-10 shrink-0 text-right">
                    {String(i + 1).padStart(2, "0")}
                  </span>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2.5 mb-1">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/40">
                        {s.tag}
                      </span>
                    </div>
                    <h3 className="font-semibold text-foreground group-hover:text-foreground/70 transition-colors duration-200 mb-0.5">
                      {s.title}
                    </h3>
                    <p className="text-sm text-muted-foreground/70 leading-relaxed hidden sm:block">
                      {s.description}
                    </p>
                  </div>

                  {/* Arrow */}
                  <ArrowUpRight className="h-4 w-4 text-muted-foreground/20 group-hover:text-foreground/50 transition-all duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 shrink-0 mt-1 sm:mt-0" />
                </Link>
              </motion.div>
            ))}
          </div>
        </div>

        {/* ── CTA ── */}
        <div className="max-w-5xl mx-auto px-7 sm:px-10">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="mt-24 sm:mt-28 text-center"
          >
            <p className="text-muted-foreground/60 text-sm mb-6">
              Seen enough?
            </p>
            <Link href="/auth">
              <motion.button
                className="inline-flex items-center gap-2.5 rounded-full font-semibold text-background bg-foreground px-8 py-3.5 text-[15px] cursor-pointer"
                whileHover={{ scale: 1.02, y: -1 }}
                whileTap={{ scale: 0.98 }}
              >
                Try Coasty Free
                <ArrowRight className="h-4 w-4" />
              </motion.button>
            </Link>
            <p className="text-[11px] text-muted-foreground/30 mt-4">
              No credit card required
            </p>
          </motion.div>
        </div>
      </main>

      <LandingFooter />
    </div>
  )
}
