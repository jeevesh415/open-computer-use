"use client"

import { useState, useEffect } from "react"
import { captureUtmParams } from "@/lib/posthog/analytics"
import { useSearchParams } from "next/navigation"
import { LandingHeader } from "./landing-header"
import { LandingFooter } from "./landing-footer"
import { HeroVideoMatrix } from "./hero-video-matrix"
import {
  HeroTaskShots,
  getFeaturedSide,
  FEATURED_RESERVE,
  FEATURED_RESERVE_OPPOSITE,
  type TriggerSection,
} from "./hero-task-shots"
import { cn } from "@/lib/utils"
import { TopAnnouncementBanner } from "./top-announcement-banner"
import { BenchmarkSection } from "./sections/benchmark"
import { WhyCoastySection } from "./sections/why-coasty"
import { DemoSection } from "./sections/demo"
import { CostSection } from "./sections/cost"
import { FeaturesSection } from "./sections/features"
import { PricingSection } from "./sections/pricing"
import { FAQSection } from "./sections/faq"
import { SectionDivider as SharedSectionDivider } from "./guide-lines"

// Sections that have a HeroTaskShots video paired with them. Order
// matches the visual scroll order of the page so the IntersectionObserver
// resolution (when multiple sections are mid-band during fast scroll)
// always picks the topmost one — i.e. the one the user just scrolled
// through, not the one they're about to leave.
const TRIGGER_SECTIONS = [
  "benchmark",
  "features",
  "why-coasty",
  "demo",
  "cost",
  "pricing",
] as const satisfies readonly TriggerSection[]

export function LandingPage() {
  const [isMobile, setIsMobile] = useState(false)
  const [currentSection, setCurrentSection] = useState<TriggerSection | null>(null)
  // Gates HeroTaskShots — keeps the side cards hidden during the hero
  // so the headline gets a clean stage, then lets them pan in from
  // their gutters as the user scrolls into the next section.
  const [pastHero, setPastHero] = useState(false)

  const searchParams = useSearchParams()

  // Capture referral code and UTM params from URL
  useEffect(() => {
    const ref = searchParams.get("ref")
    if (ref) {
      localStorage.setItem("coasty_referral_code", ref)
      const url = new URL(window.location.href)
      url.searchParams.delete("ref")
      window.history.replaceState({}, "", url.toString())
    }
    captureUtmParams()
  }, [searchParams])

  // Detect mobile
  useEffect(() => {
    setIsMobile(window.innerWidth < 768)
    const onResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Past-hero reveal — flips true once the user has scrolled ~60% of
  // a viewport, which is roughly where the hero ends and the next
  // section's top edge enters view. Reveals the gutter cards with
  // their pan-in cascade so the hero stays uncluttered.
  useEffect(() => {
    if (typeof window === "undefined") return
    let rafId = 0
    const onScroll = () => {
      if (rafId) return
      rafId = requestAnimationFrame(() => {
        rafId = 0
        setPastHero(window.scrollY > window.innerHeight * 0.6)
      })
    }
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("resize", onScroll)
    return () => {
      window.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", onScroll)
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [])

  // ── Section-in-view tracking for HeroTaskShots ──
  // One IntersectionObserver watches every trigger-mapped section.
  // A section is considered "in view" when its middle band crosses
  // the middle 40% of the viewport (rootMargin: -30% / -30%). That
  // band is narrow enough to give a clear "this is the section the
  // user is reading right now" signal without flickering at the
  // boundaries between adjacent sections.
  //
  // We don't watch the hero or footer — when no trigger section is
  // mid-band, currentSection is null and no card is featured.
  useEffect(() => {
    if (typeof window === "undefined") return
    if (window.innerWidth < 1440) return // matches HeroTaskShots `mac:block` gate (90rem)

    const inView = new Set<TriggerSection>()
    const elements: { id: TriggerSection; el: HTMLElement }[] = []
    for (const id of TRIGGER_SECTIONS) {
      const el = document.getElementById(id)
      if (el) elements.push({ id, el })
    }
    if (elements.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).id as TriggerSection
          if (entry.isIntersecting) inView.add(id)
          else inView.delete(id)
        }
        // TRIGGER_SECTIONS is in scroll order; .find returns the topmost
        // one in view (matches what the user just scrolled into).
        const topMost = TRIGGER_SECTIONS.find((id) => inView.has(id)) ?? null
        setCurrentSection(topMost)
      },
      {
        // Centre band of the viewport — a section is "in view" when
        // ANY of its body crosses the middle 40%. Generous enough that
        // every trigger section reliably activates at typical scroll
        // speeds without ping-ponging between adjacent sections.
        rootMargin: "-30% 0px -30% 0px",
        threshold: 0,
      },
    )

    for (const { el } of elements) observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const SectionDivider = SharedSectionDivider

  // Which side is the featured card on right now? Drives the
  // section-content reflow below — when a card is featured on the
  // right, sections shift LEFT to clear room for the floating
  // video; vice versa for left. Returns null during hero / between
  // trigger sections / after pricing → no reflow, sections sit
  // centred normally.
  const featuredSide = getFeaturedSide(currentSection)

  return (
    <>
      <div className="min-h-screen bg-background relative isolate overflow-x-clip">

      {/* Top announcement banner — fixed above the header, dismissible,
          persisted in localStorage. The banner sets `--top-banner-h` on
          the document root; the LandingHeader's `top` reads that var so
          it sits flush below the banner whenever it's visible. */}
      <TopAnnouncementBanner />

      {/* Fixed header */}
      <div id="landing-header-wrap">
        <LandingHeader />
      </div>

      {/* Hero Section */}
      <HeroVideoMatrix isMobile={isMobile} />

      {/* Hero task shots — fixed-position overlay that follows the
          viewport across all sections. Each card lives in a gutter
          position by default; when the user scrolls into one of the
          trigger sections (benchmark / features / …), the matched
          card animates to a featured spot and plays a short demo
          video. Hidden below 2xl (1536px) and on mobile to avoid
          overlapping section content. */}
      <HeroTaskShots
        isMobile={isMobile}
        currentSection={currentSection}
        visible={pastHero}
      />

      {/* Main content — natural scroll. The hero is a single
          viewport tall and the page flows straight into the next
          section below, no sticky / cinema dissolve / negative
          margin tricks. Smoothest possible scroll on every device.
          (#hero-crossfade kept as the wrapper id in case the
          cinematic intro is ever re-enabled — the rAF reads it
          by id.) */}
      <main className="relative">
        <div
          id="hero-crossfade"
          className="bg-background relative"
        >
          {/* Social Proof Bar removed — these stats now live inside the hero
              overlay (see [hero-video-matrix.tsx](./hero-video-matrix.tsx))
              so users see every value dimension at the same time as the
              headline, without an extra scroll. */}

        <SectionDivider />

        {/* ══════════════════════════════════════════════════════════════
            Guided Sections — flowing vertical layout.
            Each section sits at its natural height with consistent
            rhythm (py-20 sm:py-24 lg:py-32) inside a max-w-6xl container.
            Section transitions are handled by SectionDivider between them.

            featuredSide-driven horizontal reflow:
              When a HeroTaskShots card is featured on the right, this
              wrapper grows its right padding by FEATURED_RESERVE so
              section content shifts left and clears room for the
              floating card. Mirrored for the left side. The padding
              animates over 550ms with the same quint ease-out curve
              the card itself uses, so the reflow feels coupled to
              the reveal.
           ══════════════════════════════════════════════════════════════ */}
        <div
          // Named group so descendant sections can opt into
          // narrow-mode layout overrides via `group-data-[narrow]/feat:`
          // arbitrary variants. The data attribute is set whenever a
          // card is featured — that's also when the wrapper reflows
          // and the section content area shrinks to ~720px.
          className={cn(
            "group/feat max-w-7xl mx-auto",
            // Bottom padding on the trigger wrapper gives the last
            // section (pricing) visual breathing room before the
            // SectionDivider + FAQ that follow. It also creates a
            // scroll buffer so the featured-card exit transition
            // can complete cleanly as the user crosses out of
            // pricing's centre band.
            "pb-16 sm:pb-20 lg:pb-24",
            // Only animate / apply the reflow on viewports wide enough
            // to host the featured card (the cards themselves are
            // gated at the custom `mac` breakpoint = 1440px). The
            // arbitrary-value padding utilities below are also `mac:`
            // prefixed so below that width no padding is applied —
            // section content stays centred.
            "mac:transition-[padding] mac:duration-[550ms] mac:ease-[cubic-bezier(0.16,1,0.3,1)]",
            // Featured-LEFT: section gets the big reserve on the
            // left (clears the featured card) AND a smaller
            // reserve on the right (clears the OPPOSITE side's
            // dim gutter cards still rendered at their `)(`
            // positions). Mirrored for featured-right.
            featuredSide === "left" &&
              "mac:pl-[var(--reserve-featured)] mac:pr-[var(--reserve-opposite)]",
            featuredSide === "right" &&
              "mac:pr-[var(--reserve-featured)] mac:pl-[var(--reserve-opposite)]",
          )}
          // data-narrow is set whenever any card is featured. Sections
          // inside the group key narrow-mode classes off this attribute
          // via `group-data-[narrow]/feat:` arbitrary variants — that's
          // how pricing collapses to 2-col, features bento drops a
          // tier, etc. when the column is squeezed.
          data-narrow={featuredSide ? "" : undefined}
          style={
            // CSS variables hold the two px reserves — featured
            // side and opposite side. Sourced from the hero-task
            // shots module so any geometry change there flows
            // through to the section reflow without further edits.
            {
              "--reserve-featured": `${FEATURED_RESERVE}px`,
              "--reserve-opposite": `${FEATURED_RESERVE_OPPOSITE}px`,
            } as React.CSSProperties
          }
        >

        <BenchmarkSection isMobile={isMobile} />

        <SectionDivider />

        <FeaturesSection isMobile={isMobile} />

        <SectionDivider />

        <WhyCoastySection isMobile={isMobile} />

        <SectionDivider />

        <DemoSection isMobile={isMobile} />

        <SectionDivider />

        <CostSection isMobile={isMobile} />

        <SectionDivider />

        <PricingSection isMobile={isMobile} />

        </div>{/* end Guided Sections wrapper */}

        <SectionDivider />

        <FAQSection isMobile={isMobile} />

        <SectionDivider />

        {/* Footer */}
        <LandingFooter />
        </div>{/* end #hero-crossfade */}
      </main>
      </div>
    </>
  )
}
