"use client"

import { motion } from "framer-motion"
import { useCallback } from "react"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import { LandingSectionHeader, LandingSectionTopGlow } from "../section-shell"
import { SelfCorrectingVignette } from "./feature-cards/self-correcting"
import { AuditTrailVignette } from "./feature-cards/audit-trail"
import { ScheduleVignette } from "./feature-cards/schedule"
import { SandboxedVignette } from "./feature-cards/sandboxed"
import { BenchmarkVignette } from "./feature-cards/benchmark"
import { SwarmsVignette } from "./feature-cards/swarms"

/**
 * FeaturesSection — bento layout reimagined.
 *
 * Replaces the uniform 3-col grid with a heterogeneous bento layout where
 * each card has its own signature interactive vignette. Vignettes live in
 * `feature-cards/*` and are wrapped in identical card chrome here (hairline
 * border, top sheen, mouse-tracking spotlight, padding).
 *
 * Desktop bento (3 cols × 4 rows):
 *   ┌─────────────────────┬───────────┐
 *   │ selfCorrecting (2c) │ auditTrail│
 *   ├─────────────────────┤  (1c×2r)  │
 *   │ benchmark      (2c) │           │
 *   ├──────────┬──────────┴───────────┤
 *   │ schedule │ sandboxed │ swarms   │
 *   └──────────┴──────────────────────┘
 *
 * Mobile: single column stack, all cards uniform.
 */

const EASE = [0.22, 1, 0.36, 1] as const

type CardKey = "selfCorrecting" | "auditTrail" | "schedule" | "sandboxed" | "benchmark" | "swarms"

export function FeaturesSection({ isMobile }: { isMobile: boolean }) {
  const t = useTranslations()

  // Mouse-tracking spotlight handlers — copied verbatim from landing-page.tsx
  // so card chrome behaves consistently with other sections.
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

  const cards: {
    key: CardKey
    titleKey: string
    descKey: string
    Vignette: (props: { isMobile: boolean }) => React.JSX.Element
    /** Tailwind grid placement on lg screens */
    span: string
    /** Hero cards get larger inner padding */
    hero?: boolean
  }[] = [
    {
      key: "selfCorrecting",
      titleKey: "features.selfCorrecting.title",
      descKey: "features.selfCorrecting.description",
      Vignette: SelfCorrectingVignette,
      // Row 1: cols 1-2
      span: "lg:col-span-2 lg:row-span-1 lg:col-start-1 lg:row-start-1",
      hero: true,
    },
    {
      key: "auditTrail",
      titleKey: "features.auditTrail.title",
      descKey: "features.auditTrail.description",
      Vignette: AuditTrailVignette,
      // Rows 1-2: col 3
      span: "lg:col-span-1 lg:row-span-2 lg:col-start-3 lg:row-start-1",
    },
    {
      key: "benchmark",
      titleKey: "features.benchmark.title",
      descKey: "features.benchmark.description",
      Vignette: BenchmarkVignette,
      // Row 2: cols 1-2
      span: "lg:col-span-2 lg:row-span-1 lg:col-start-1 lg:row-start-2",
      hero: true,
    },
    {
      key: "schedule",
      titleKey: "features.schedule.title",
      descKey: "features.schedule.description",
      Vignette: ScheduleVignette,
      // Row 3: col 1
      span: "lg:col-span-1 lg:row-span-1 lg:col-start-1 lg:row-start-3",
    },
    {
      key: "sandboxed",
      titleKey: "features.sandboxed.title",
      descKey: "features.sandboxed.description",
      Vignette: SandboxedVignette,
      // Row 3: col 2
      span: "lg:col-span-1 lg:row-span-1 lg:col-start-2 lg:row-start-3",
    },
    {
      key: "swarms",
      titleKey: "features.swarms.title",
      descKey: "features.swarms.description",
      Vignette: SwarmsVignette,
      // Row 3: col 3
      span: "lg:col-span-1 lg:row-span-1 lg:col-start-3 lg:row-start-3",
    },
  ]

  // Display order matches the visual reading order on desktop, but stagger by
  // index for the entry animation regardless of grid placement.
  return (
    <section
      id="features"
      className="relative py-20 sm:py-24 lg:py-32 px-8 sm:px-10 lg:px-12"
    >
      <LandingSectionTopGlow />

      <div className="max-w-6xl w-full mx-auto">
        <LandingSectionHeader
          title={t("features.title")}
          isMobile={isMobile}
        />

        <div
          className={cn(
            "grid gap-4",
            // Mobile: single column. Desktop: 3-col, 3-row bento with auto rows.
            isMobile ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-3 lg:auto-rows-[minmax(0,auto)]",
            // Narrow mode (sibling video card is featured, container
            // is ~720px): collapse the bento to a single vertical
            // column. The per-card col-span / col-start placements
            // become no-ops when there's only one column. Cards stack
            // top-to-bottom at full width — much more legible than
            // 3 cards crammed into 720px.
            !isMobile && "group-data-[narrow]/feat:lg:grid-cols-1 group-data-[narrow]/feat:max-w-2xl group-data-[narrow]/feat:mx-auto",
          )}
        >
          {cards.map((c, i) => {
            const { Vignette } = c
            return (
              <motion.div
                key={c.key}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0, margin: "0px 0px -80px 0px" }}
                transition={{ duration: 0.5, delay: i * 0.08, ease: EASE }}
                onMouseMove={!isMobile ? handleCardMouseMove : undefined}
                onMouseLeave={!isMobile ? handleCardMouseLeave : undefined}
                className={cn(
                  // base card chrome — rounded, hairline, hover-lift
                  "group relative overflow-hidden rounded-2xl border border-foreground/10",
                  "bg-card/40 backdrop-blur-[2px]",
                  "transition-[border-color,box-shadow,transform] duration-500",
                  "hover:border-foreground/20 hover:shadow-[0_1px_2px_rgba(0,0,0,0.04),0_18px_44px_-22px_rgba(0,0,0,0.18)]",
                  "dark:hover:shadow-[0_1px_2px_rgba(0,0,0,0.3),0_18px_44px_-22px_rgba(0,0,0,0.5)]",
                  // padding — hero cards get more breathing room
                  c.hero ? "p-6 sm:p-8" : "p-5 sm:p-6",
                  // grid placement (desktop only — on mobile cards stack)
                  !isMobile && c.span,
                  // Narrow mode: parent grid drops to 1-col, so the
                  // per-card `lg:col-span-2 / lg:col-start-3 / row-span-2`
                  // placements become invalid (cards try to span past
                  // the only column, or start in non-existent col 3).
                  // Reset every grid-area property to `auto` so cards
                  // flow naturally in row order.
                  !isMobile && "group-data-[narrow]/feat:lg:[grid-area:auto]",
                  // flex column so the vignette grows and the title/desc sit at the bottom
                  "flex flex-col"
                )}
                style={{ "--mouse-x": "50%", "--mouse-y": "50%" } as React.CSSProperties}
              >
                {/* inner top sheen — gradient hairline */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-foreground/15 to-transparent"
                />

                {/* mouse-tracking spotlight — only visible on hover */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                  style={{
                    background:
                      "radial-gradient(640px circle at var(--mouse-x) var(--mouse-y), rgba(127,127,127,0.10), transparent 42%)",
                  }}
                />

                {/* card body */}
                <div className="relative z-10 flex flex-1 flex-col">
                  {/* vignette — fills the upper portion */}
                  <div className="flex-1">
                    <Vignette isMobile={isMobile} />
                  </div>

                  {/* hairline separator between vignette and copy */}
                  <span
                    aria-hidden
                    className="my-4 block h-px w-full bg-gradient-to-r from-transparent via-foreground/[0.06] to-transparent"
                  />

                  {/* title + description */}
                  <div>
                    <h3
                      className={cn(
                        "font-semibold tracking-tight text-foreground",
                        c.hero ? "text-base sm:text-lg" : "text-sm sm:text-base"
                      )}
                    >
                      {t(c.titleKey)}
                    </h3>
                    <p
                      className={cn(
                        "mt-1 text-muted-foreground/70",
                        c.hero ? "text-[13px] sm:text-sm" : "text-xs sm:text-[13px]",
                        "leading-relaxed"
                      )}
                    >
                      {t(c.descKey)}
                    </p>
                  </div>
                </div>
              </motion.div>
            )
          })}
        </div>

      </div>
    </section>
  )
}
