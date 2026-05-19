"use client"

/**
 * WhyCoastySection — the differentiation moment.
 *
 * Reframes 4 cards as cinematic vignettes — each card a mini film still that
 * comes alive on viewport entry and on hover. Layout is asymmetric: a hero
 * card spanning two columns sits above three standard cards. Mobile is a
 * single linear column with no animations (instant reveal).
 *
 * The vignettes are intentionally hairline: thin borders, restrained motion,
 * one or two intentional accents per card. The rest of the surface is left
 * quiet so the typography can lead.
 */

import { motion } from "framer-motion"
import { useCallback } from "react"
import { ArrowRight, Check, MousePointer2, Shield, MessageSquare, AlertTriangle, Search, Lock } from "lucide-react"
import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"
import { LandingSectionTopGlow, LandingSectionHeader } from "../section-shell"

type WhyKey = "worksLikeHuman" | "noScripts" | "handlesUnexpected" | "runsInIsolation"

// One-word category eyebrows for each vignette.
const CATEGORY_BY_KEY: Record<WhyKey, string> = {
  worksLikeHuman: "BEHAVIOR",
  noScripts: "INPUT",
  handlesUnexpected: "RECOVERY",
  runsInIsolation: "ISOLATION",
}

const EASE = [0.22, 1, 0.36, 1] as const

export function WhyCoastySection({ isMobile }: { isMobile: boolean }) {
  const t = useTranslations()

  // Mouse-tracking radial spotlight — same pattern used elsewhere on the
  // landing page. Updates two CSS vars on the card root; the gradient is
  // drawn by an absolutely-positioned overlay below.
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

  // Hero card content — pulled out so the layout below stays readable.
  const heroKey: WhyKey = "worksLikeHuman"
  const stackKeys: WhyKey[] = ["noScripts", "handlesUnexpected", "runsInIsolation"]

  return (
    <section
      id="why-coasty"
      className="relative py-20 sm:py-24 lg:py-32 px-8 sm:px-10 lg:px-12"
    >
      <LandingSectionTopGlow />

      {/* Local keyframes for vignette-specific motion. The shared keyframes
          (lp-typing, lp-click-ring, lp-cursor-blink, lp-dot-pulse, lp-float,
          lp-check-pop) are already defined globally in landing-page.tsx and
          re-used here without redefinition. */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @keyframes wc-strike { 0% { width: 0% } 100% { width: 100% } }
            @keyframes wc-rgb-glitch { 0%, 92%, 100% { transform: translateX(0); opacity: 0 } 94% { transform: translateX(-1px); opacity: 0.6 } 96% { transform: translateX(1px); opacity: 0.6 } 98% { transform: translateX(0); opacity: 0 } }
            @keyframes wc-frame-pulse { 0%, 100% { opacity: 0.35 } 50% { opacity: 0.95 } }
            @keyframes wc-barrier-out { 0% { transform: scale(0.6); opacity: 0 } 30% { opacity: 0.9 } 100% { transform: scale(1.6); opacity: 0 } }
            @keyframes wc-rule-in { 0% { transform: scaleX(0); transform-origin: left } 100% { transform: scaleX(1); transform-origin: left } }
            @keyframes wc-arrow-drift { 0%, 100% { transform: translateX(0) } 50% { transform: translateX(2px) } }
            /* ── Hero vignette: cinematic 8s loop ─────────────────────────
               Phase map (% of 8s cycle):
                  0–6%  cursor off-screen, fading in
                  6–19% cursor glides to search field (curved easing)
                  19–21% input focus border lights up
                  21–40% "book a flight" types in (cursor blinks)
                  40–56% cursor glides down to first result row
                  56–60% result row hovers (scale + border)
                  60–64% click ring fires
                  64–100% row marks selected; BOOKED toast fades in/out
                  Whole loop restarts cleanly. */
            @keyframes wc-hero-cursor {
              0%, 5%  { left: 108%; top: 78%; opacity: 0 }
              8%      { opacity: 0.4 }
              19%     { left: 26%; top: 30%; opacity: 1 }
              40%     { left: 26%; top: 30%; opacity: 1 }
              56%     { left: 62%; top: 60%; opacity: 1 }
              62%     { left: 60%; top: 58%; opacity: 1 }
              92%     { left: 60%; top: 58%; opacity: 0.85 }
              100%    { left: 60%; top: 58%; opacity: 0 }
            }
            @keyframes wc-hero-input-focus {
              0%, 19%   { border-color: rgba(127,127,127,0.12); background-color: rgba(127,127,127,0.025) }
              22%, 42%  { border-color: rgba(127,127,127,0.55); background-color: rgba(127,127,127,0.06) }
              45%, 100% { border-color: rgba(127,127,127,0.12); background-color: rgba(127,127,127,0.025) }
            }
            @keyframes wc-hero-typing {
              0%, 22%   { width: 0% }
              40%, 100% { width: 100% }
            }
            @keyframes wc-hero-typed-caret {
              0%, 21%   { opacity: 0 }
              22%, 40%  { opacity: 1 }
              41%, 100% { opacity: 0 }
            }
            @keyframes wc-hero-results-in {
              0%, 40%   { opacity: 0; transform: translateY(4px) }
              48%, 100% { opacity: 1; transform: translateY(0) }
            }
            @keyframes wc-hero-result-hover {
              0%, 54%   { transform: scale(1); border-color: rgba(127,127,127,0); background-color: rgba(127,127,127,0) }
              58%, 100% { transform: scale(1.012); border-color: rgba(127,127,127,0.40); background-color: rgba(127,127,127,0.05) }
            }
            @keyframes wc-hero-click-ring {
              0%, 58%   { opacity: 0; transform: scale(0.55) }
              60%       { opacity: 0.9; transform: scale(1) }
              66%       { opacity: 0; transform: scale(1.7) }
              100%      { opacity: 0 }
            }
            @keyframes wc-hero-selected-check {
              0%, 60%   { opacity: 0; transform: scale(0.4) }
              66%, 100% { opacity: 1; transform: scale(1) }
            }
            @keyframes wc-hero-booked-toast {
              0%, 66%   { opacity: 0; transform: translateY(-6px) scale(0.96) }
              74%, 90%  { opacity: 1; transform: translateY(0) scale(1) }
              96%, 100% { opacity: 0; transform: translateY(-4px) scale(0.98) }
            }
            @keyframes wc-hero-live-pulse {
              0%, 100% { opacity: 0.55; transform: scale(1) }
              50%      { opacity: 1; transform: scale(1.25) }
            }
          `,
        }}
      />

      <div className="max-w-6xl w-full mx-auto">
        <LandingSectionHeader
          title={t("whyCoasty.title")}
          isMobile={isMobile}
        />

        <div
          className={cn(
            "w-full grid gap-4",
            // Mobile: single column. Desktop: 3-col grid where the hero spans
            // all three columns on the top row, then the three standard cards
            // sit equally below (each col-span-1). This keeps the bento dense
            // — no dead zones beside a hero that's shorter than its row.
            isMobile ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-3",
            // Narrow mode: container is ~720px, 3-col would put each
            // card at ~230px which crushes the vignette + copy. Drop
            // to single column — hero stays full-width, the 3 standard
            // cards stack vertically beneath it. Hero's internal
            // sm:grid-cols-[1.15fr_1fr] split still works at 720px.
            !isMobile && "group-data-[narrow]/feat:lg:grid-cols-1 group-data-[narrow]/feat:max-w-2xl group-data-[narrow]/feat:mx-auto",
          )}
        >
          {/* ── Hero card — full-width top row ───────────────────────── */}
          <HeroCard
            isMobile={isMobile}
            title={t(`whyCoasty.${heroKey}.title`)}
            description={t(`whyCoasty.${heroKey}.description`)}
            category={CATEGORY_BY_KEY[heroKey]}
            onMouseMove={!isMobile ? handleCardMouseMove : undefined}
            onMouseLeave={!isMobile ? handleCardMouseLeave : undefined}
          />

          {/* ── 3 standard cards, equal width below the hero ─────────── */}
          {stackKeys.map((key, i) => (
            <StandardCard
              key={key}
              cardKey={key}
              index={i}
              isMobile={isMobile}
              title={t(`whyCoasty.${key}.title`)}
              description={t(`whyCoasty.${key}.description`)}
              category={CATEGORY_BY_KEY[key]}
              onMouseMove={!isMobile ? handleCardMouseMove : undefined}
              onMouseLeave={!isMobile ? handleCardMouseLeave : undefined}
            />
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── Hero card ───────────────────────────────────────────────────────────

function HeroCard({
  isMobile,
  title,
  description,
  category,
  onMouseMove,
  onMouseLeave,
}: {
  isMobile: boolean
  title: string
  description: string
  category: string
  onMouseMove?: (e: React.MouseEvent<HTMLDivElement>) => void
  onMouseLeave?: (e: React.MouseEvent<HTMLDivElement>) => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0, margin: "0px 0px -80px 0px" }}
      transition={{ duration: 0.6, ease: EASE }}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      className={cn(
        "relative rounded-2xl border overflow-hidden transition-colors duration-500 group/card isolate",
        "border-foreground/10 hover:border-foreground/20",
        "bg-card/40 backdrop-blur-[2px]",
        // Hero takes the full top row (all 3 cols on lg+).
        !isMobile && "lg:col-span-3",
        // Narrow mode: parent grid drops to 1-col so `lg:col-span-3`
        // would force the hero to span 3 cols when only 1 exists,
        // pushing cards out of bounds. Reset grid placement.
        !isMobile && "group-data-[narrow]/feat:lg:[grid-area:auto]",
        isMobile ? "p-6" : "p-8 sm:p-10"
      )}
      style={{ "--mouse-x": "50%", "--mouse-y": "50%" } as React.CSSProperties}
    >
      {/* Top sheen hairline */}
      <div
        aria-hidden
        className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-foreground/15 to-transparent"
      />
      {/* Bottom hairline echo */}
      <div
        aria-hidden
        className="absolute inset-x-12 bottom-0 h-px bg-gradient-to-r from-transparent via-foreground/[0.06] to-transparent"
      />
      {/* Mouse-tracking spotlight */}
      {!isMobile && (
        <div
          aria-hidden
          className="absolute inset-0 opacity-0 group-hover/card:opacity-100 transition-opacity duration-500 pointer-events-none"
          style={{
            background:
              "radial-gradient(540px circle at var(--mouse-x) var(--mouse-y), rgba(127,127,127,0.08), transparent 45%)",
          }}
        />
      )}

      <div
        className={cn(
          "relative z-10 grid gap-8",
          !isMobile && "sm:grid-cols-[1.15fr_1fr] sm:items-center",
          // Narrow mode: stack vignette + copy into a single column
          // — the 1.15fr+1fr split crushes both halves at ~720px
          // hero width.
          !isMobile && "group-data-[narrow]/feat:sm:grid-cols-1",
        )}
      >
        {/* ── Vignette: cinematic interface tile with cursor + click + type ── */}
        <HeroVignette isMobile={isMobile} />

        {/* ── Copy ── */}
        <div className="relative">
          {/* Hairline above eyebrow — slides in from left on hover */}
          <div className="relative h-px w-10 mb-3 overflow-hidden">
            <div
              aria-hidden
              className="absolute inset-0 bg-foreground/20 origin-left scale-x-0 group-hover/card:scale-x-100 transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
            />
          </div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/60">
            {category}
          </p>
          <h3
            className={cn(
              "mt-3 font-semibold tracking-tight text-foreground",
              isMobile ? "text-xl" : "text-2xl sm:text-3xl"
            )}
          >
            {title}
          </h3>
          {/* Positioning sub-line — anti-claim that frames the description */}
          <p
            className={cn(
              "mt-3 font-light italic tracking-[-0.005em] text-foreground/50",
              isMobile ? "text-base" : "text-base sm:text-lg"
            )}
          >
            Not a chatbot. Not an RPA script.
          </p>
          <p className={cn("mt-2 text-muted-foreground/70", isMobile ? "text-sm" : "text-sm sm:text-base")}>
            {description}
          </p>
        </div>
      </div>
    </motion.div>
  )
}

// Hero vignette — cinematic 8-second loop of an agent booking a flight.
// Cursor enters from off-screen, types into a search field, glides to a
// result, clicks, and a "BOOKED" toast confirms. Mock app chrome is
// hairline-quiet so the demonstration carries the eye.
function HeroVignette({ isMobile }: { isMobile: boolean }) {
  const FLIGHTS = [
    { from: "SFO", to: "JFK", airline: "DELTA", price: "$284" },
    { from: "SFO", to: "LHR", airline: "BA",    price: "$612" },
    { from: "SFO", to: "NRT", airline: "JAL",   price: "$789" },
  ] as const

  return (
    <div className="relative w-full mx-auto sm:mx-0" style={{ maxWidth: isMobile ? 280 : undefined }}>
      {/* Soft floor — anchors the screen as if it were resting on a surface */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-10 -bottom-3 h-4 rounded-full bg-foreground/[0.05] blur-md"
      />

      {/* Screen frame */}
      <div
        className={cn(
          "relative w-full overflow-hidden rounded-[14px] border border-foreground/12",
          "bg-gradient-to-b from-background/95 to-background/85",
          "shadow-[0_1px_0_0_rgba(255,255,255,0.06)_inset,0_10px_36px_-14px_rgba(0,0,0,0.45)]",
          "aspect-[16/11]"
        )}
      >
        {/* Top sheen highlight — subtle "lit from above" edge */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-foreground/30 to-transparent"
        />

        {/* Browser chrome */}
        <div className="relative flex items-center gap-1.5 px-2.5 py-1.5 border-b border-foreground/8">
          <span className="h-1.5 w-1.5 rounded-full bg-foreground/18" />
          <span className="h-1.5 w-1.5 rounded-full bg-foreground/18" />
          <span className="h-1.5 w-1.5 rounded-full bg-foreground/18" />
          {/* URL pill */}
          <span className="ml-2 inline-flex items-center gap-1 px-1.5 py-[2px] rounded-md bg-foreground/[0.04] border border-foreground/10">
            <Lock className="size-2 text-foreground/35" strokeWidth={2.4} />
            <span className="text-[7px] font-mono tracking-tight text-foreground/55">flights.coasty.app</span>
          </span>
          {/* LIVE indicator — top-right, always pulsing */}
          <span className="ml-auto inline-flex items-center gap-1">
            <span
              className="h-1 w-1 rounded-full bg-emerald-500"
              style={{ animation: "wc-hero-live-pulse 1.8s ease-in-out infinite" }}
            />
            <span className="text-[6px] font-mono uppercase tracking-[0.18em] text-foreground/45">live</span>
          </span>
        </div>

        {/* Body — search + results */}
        <div className="relative px-2.5 pt-2.5 pb-2.5 flex flex-col gap-2 h-[calc(100%-26px)]">
          {/* Search field */}
          <div
            className="relative h-7 rounded-md flex items-center px-2 overflow-hidden border"
            style={{
              animation: !isMobile ? "wc-hero-input-focus 8s ease-in-out infinite" : undefined,
              borderColor: "rgba(127,127,127,0.25)",
              backgroundColor: "rgba(127,127,127,0.04)",
            }}
          >
            <Search className="size-2.5 text-foreground/35 shrink-0 mr-1.5" strokeWidth={2.2} />
            <span className="relative flex items-center text-[9px] font-mono text-foreground/75 whitespace-nowrap">
              <span
                className="inline-block overflow-hidden align-bottom"
                style={
                  !isMobile
                    ? { animation: "wc-hero-typing 8s steps(12, end) infinite", maxWidth: "100%" }
                    : undefined
                }
              >
                book a flight
              </span>
              <span
                className="ml-px text-foreground/55"
                style={!isMobile ? { animation: "wc-hero-typed-caret 8s step-end infinite" } : undefined}
              >
                |
              </span>
            </span>
          </div>

          {/* Result rows */}
          <div className="flex flex-col gap-1.5 flex-1">
            {FLIGHTS.map((r, i) => {
              const isTarget = i === 0
              return (
                <div
                  key={r.to}
                  className="relative flex items-center justify-between rounded-md px-2 py-1.5 border border-transparent will-change-transform"
                  style={
                    !isMobile
                      ? {
                          animation: isTarget
                            ? "wc-hero-results-in 8s ease-out infinite, wc-hero-result-hover 8s ease-in-out infinite"
                            : `wc-hero-results-in 8s ease-out infinite ${i * 0.08}s`,
                        }
                      : undefined
                  }
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[8.5px] font-mono font-semibold tabular-nums text-foreground/70">
                      {r.from}
                    </span>
                    <ArrowRight className="size-2 text-foreground/30 shrink-0" strokeWidth={2.4} />
                    <span className="text-[8.5px] font-mono font-semibold tabular-nums text-foreground/70">
                      {r.to}
                    </span>
                    <span className="text-[6.5px] font-mono uppercase tracking-[0.16em] text-foreground/40">
                      {r.airline}
                    </span>
                  </div>
                  <span className="text-[8.5px] font-mono font-semibold tabular-nums text-foreground/65">
                    {r.price}
                  </span>

                  {/* Click ring — only on the target row */}
                  {isTarget && !isMobile && (
                    <>
                      <span
                        aria-hidden
                        className="pointer-events-none absolute -inset-[2px] rounded-md border border-foreground/55"
                        style={{ animation: "wc-hero-click-ring 8s ease-out infinite" }}
                      />
                      {/* Selected check — pops in after click */}
                      <span
                        aria-hidden
                        className="pointer-events-none absolute -right-1 -top-1 inline-flex items-center justify-center h-3 w-3 rounded-full bg-foreground text-background"
                        style={{ animation: "wc-hero-selected-check 8s ease-out infinite" }}
                      >
                        <Check className="size-2" strokeWidth={3} />
                      </span>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* "BOOKED" toast — top-right, fades in after click */}
        {!isMobile && (
          <div
            className="absolute top-2 right-2.5 inline-flex items-center gap-1 px-1.5 py-[3px] rounded-md bg-foreground text-background shadow-[0_3px_10px_-2px_rgba(0,0,0,0.35)]"
            style={{ animation: "wc-hero-booked-toast 8s ease-in-out infinite" }}
          >
            <Check className="size-2.5" strokeWidth={3} />
            <span className="text-[7px] font-mono uppercase tracking-[0.18em] font-semibold">booked</span>
          </div>
        )}

        {/* Animated cursor — last so it sits above all other layers */}
        {!isMobile && (
          <div
            className="absolute pointer-events-none will-change-transform"
            style={{
              animation: "wc-hero-cursor 8s cubic-bezier(0.65, 0, 0.35, 1) infinite",
              transform: "translate(-30%, -20%)",
              left: "108%",
              top: "78%",
            }}
          >
            <MousePointer2
              className="size-[14px] text-foreground drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)]"
              strokeWidth={2}
              fill="currentColor"
            />
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Standard cards ──────────────────────────────────────────────────────

function StandardCard({
  cardKey,
  index,
  title,
  description,
  category,
  isMobile = false,
  onMouseMove,
  onMouseLeave,
  className,
}: {
  cardKey: WhyKey
  index: number
  title: string
  description: string
  category: string
  isMobile?: boolean
  onMouseMove?: (e: React.MouseEvent<HTMLDivElement>) => void
  onMouseLeave?: (e: React.MouseEvent<HTMLDivElement>) => void
  className?: string
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0, margin: "0px 0px -80px 0px" }}
      transition={{ duration: 0.55, ease: EASE, delay: 0.35 + index * 0.08 }}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      className={cn(
        "relative rounded-2xl border overflow-hidden transition-colors duration-500 group/card isolate h-full flex flex-col",
        "border-foreground/10 hover:border-foreground/20",
        "bg-card/40 backdrop-blur-[2px]",
        isMobile ? "p-6" : "p-6 sm:p-7",
        className
      )}
      style={{ "--mouse-x": "50%", "--mouse-y": "50%" } as React.CSSProperties}
    >
      {/* Top sheen */}
      <div
        aria-hidden
        className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-foreground/15 to-transparent"
      />
      {/* Bottom echo */}
      <div
        aria-hidden
        className="absolute inset-x-10 bottom-0 h-px bg-gradient-to-r from-transparent via-foreground/[0.06] to-transparent"
      />
      {!isMobile && (
        <div
          aria-hidden
          className="absolute inset-0 opacity-0 group-hover/card:opacity-100 transition-opacity duration-500 pointer-events-none"
          style={{
            background:
              "radial-gradient(360px circle at var(--mouse-x) var(--mouse-y), rgba(127,127,127,0.07), transparent 45%)",
          }}
        />
      )}

      <div className="relative z-10 flex flex-col">
        {/* Vignette area */}
        <div className={cn("flex items-center justify-center mb-5", isMobile ? "h-[88px]" : "h-[96px]")}>
          {cardKey === "noScripts" && <NoScriptsVignette />}
          {cardKey === "handlesUnexpected" && <HandlesUnexpectedVignette />}
          {cardKey === "runsInIsolation" && <RunsInIsolationVignette />}
        </div>

        {/* Hairline above eyebrow on hover */}
        <div className="relative h-px w-8 mb-2.5 overflow-hidden">
          <div
            aria-hidden
            className="absolute inset-0 bg-foreground/20 origin-left scale-x-0 group-hover/card:scale-x-100 transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
          />
        </div>
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/60">
          {category}
        </p>
        <h3 className="mt-2 text-xl font-semibold tracking-tight text-foreground">
          {title}
        </h3>
        <p className="mt-2 text-sm text-muted-foreground/65">{description}</p>
      </div>
    </motion.div>
  )
}

// ─── Vignette: noScripts ─────────────────────────────────────────────────
// Split scene: code editor (left) with lines being struck through, arrow,
// chat bubble (right) where natural language is typed. On hover, code fades
// down to 0.2 and chat scales up.
function NoScriptsVignette() {
  return (
    <div className="relative flex items-center gap-2.5 w-full justify-center">
      {/* Code editor frame — fades out on hover */}
      <div className="relative w-[78px] h-[64px] rounded-md border border-foreground/12 bg-foreground/[0.025] overflow-hidden transition-opacity duration-500 group-hover/card:opacity-25">
        <div className="px-1.5 py-1.5 space-y-1">
          {[
            { w: "85%", delay: "0s" },
            { w: "60%", delay: "0.5s" },
            { w: "75%", delay: "1s" },
            { w: "50%", delay: "1.5s" },
          ].map((line, i) => (
            <div key={i} className="relative h-[3px]">
              <span
                className="absolute inset-y-0 left-0 rounded-full bg-foreground/15"
                style={{ width: line.w }}
              />
              <span
                className="absolute top-1/2 -translate-y-1/2 left-0 h-px bg-foreground/35"
                style={{
                  width: line.w,
                  animation: `wc-strike 3.6s ${line.delay} ease-in-out infinite`,
                }}
              />
            </div>
          ))}
        </div>
      </div>

      <ArrowRight
        className="size-3 text-foreground/25 shrink-0"
        style={{ animation: "wc-arrow-drift 2.4s ease-in-out infinite" }}
      />

      {/* Chat bubble — scales up on hover */}
      <div className="relative w-[88px] h-[64px] rounded-md border border-foreground/15 bg-background/70 overflow-hidden transition-transform duration-500 group-hover/card:scale-[1.06] flex items-start gap-1 px-2 py-1.5">
        <MessageSquare className="size-2.5 mt-px text-foreground/45 shrink-0" />
        <div className="min-w-0 flex-1 space-y-1">
          <span
            className="block text-[8px] font-mono leading-tight text-foreground/65 whitespace-nowrap overflow-hidden"
            style={{ animation: "lp-typing 4.2s ease-in-out infinite" }}
          >
            do this for me
          </span>
          <span
            className="block h-[2px] w-[60%] rounded-full bg-foreground/12"
          />
        </div>
      </div>
    </div>
  )
}

// ─── Vignette: handlesUnexpected ─────────────────────────────────────────
// Three frames: normal → unexpected popup (RGB-glitch) → recovered. On
// hover the recovery loop accelerates.
function HandlesUnexpectedVignette() {
  return (
    <div className="relative flex items-center gap-1.5 w-full justify-center">
      {[0, 1, 2].map((idx) => (
        <div key={idx} className="flex items-center gap-1.5">
          {/* Frame */}
          <div className="relative w-[44px] h-[44px] rounded-md border border-foreground/12 bg-foreground/[0.02] overflow-hidden">
            {idx === 0 && (
              // Normal state — calm rows
              <div className="p-1 space-y-1">
                <span className="block h-[2px] w-[80%] rounded-full bg-foreground/15" />
                <span className="block h-[2px] w-[60%] rounded-full bg-foreground/15" />
                <span className="block h-[2px] w-[70%] rounded-full bg-foreground/15" />
              </div>
            )}
            {idx === 1 && (
              // Unexpected — popup with RGB glitch
              <>
                <div className="p-1 space-y-1 opacity-40">
                  <span className="block h-[2px] w-[80%] rounded-full bg-foreground/15" />
                  <span className="block h-[2px] w-[60%] rounded-full bg-foreground/15" />
                </div>
                <div
                  className="absolute inset-x-1 inset-y-2 rounded-sm border border-foreground/30 bg-background flex items-center justify-center"
                >
                  <AlertTriangle className="size-2.5 text-foreground/60" strokeWidth={2.4} />
                </div>
                {/* RGB split layers — barely visible, pulses ~8% of cycle */}
                <div
                  aria-hidden
                  className="absolute inset-x-1 inset-y-2 rounded-sm border border-red-500/40 mix-blend-screen"
                  style={{ animation: "wc-rgb-glitch 2.8s ease-in-out infinite" }}
                />
                <div
                  aria-hidden
                  className="absolute inset-x-1 inset-y-2 rounded-sm border border-cyan-500/40 mix-blend-screen"
                  style={{ animation: "wc-rgb-glitch 2.8s ease-in-out infinite reverse" }}
                />
              </>
            )}
            {idx === 2 && (
              // Recovered — checkmark
              <div className="absolute inset-0 flex items-center justify-center">
                <div
                  className="size-5 rounded-full border border-foreground/25 flex items-center justify-center"
                  style={{ animation: "lp-check-pop 0.6s ease forwards" }}
                >
                  <Check className="size-3 text-foreground/65" strokeWidth={2.4} />
                </div>
              </div>
            )}
          </div>
          {idx < 2 && (
            <ArrowRight className="size-2.5 text-foreground/20 shrink-0" />
          )}
        </div>
      ))}

      {/* Hover speedup — accelerates the glitch loop */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            .group\\/card:hover [data-wc-glitch] { animation-duration: 1.4s !important; }
          `,
        }}
      />
    </div>
  )
}

// ─── Vignette: runsInIsolation ───────────────────────────────────────────
// Four nested frames (OS → VM → Sandbox → Process) with staggered pulse,
// shield icon at the center. On hover, a barrier ring pulses outward.
function RunsInIsolationVignette() {
  const labels = ["OS", "VM", "SBX", ""]
  return (
    <div className="relative w-[96px] h-[88px] flex items-center justify-center">
      {/* Outer 4 → inner 1 nested boxes */}
      {[0, 1, 2, 3].map((depth) => {
        const inset = depth * 8
        const label = labels[depth]
        return (
          <div
            key={depth}
            className="absolute rounded-md border border-foreground/15"
            style={{
              top: inset,
              right: inset,
              bottom: inset,
              left: inset,
              animation: `wc-frame-pulse ${2.6 + depth * 0.4}s ease-in-out ${depth * 0.3}s infinite`,
            }}
          >
            {label && (
              <span className="absolute -top-[5px] left-1.5 px-1 bg-background text-[7px] font-mono uppercase tracking-[0.16em] text-foreground/35">
                {label}
              </span>
            )}
          </div>
        )
      })}

      {/* Innermost: glowing process dot + shield */}
      <div className="relative z-10 flex items-center gap-1">
        <span
          aria-hidden
          className="h-1.5 w-1.5 rounded-full bg-foreground/70"
          style={{ animation: "lp-dot-pulse 1.6s ease-in-out infinite" }}
        />
        <Shield
          className="size-3 text-foreground/55"
          strokeWidth={2}
        />
      </div>

      {/* Barrier pulse — only visible on hover, expands outward from center */}
      <span
        aria-hidden
        className="absolute inset-0 m-auto h-3 w-3 rounded-full border border-foreground/35 opacity-0 group-hover/card:opacity-100"
        style={{ animation: "wc-barrier-out 1.6s ease-out infinite" }}
      />
    </div>
  )
}
