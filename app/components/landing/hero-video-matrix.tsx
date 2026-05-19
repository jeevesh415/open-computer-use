"use client"

import { useEffect, useRef, useState, useMemo } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ArrowRight, Video, ChevronDown } from "lucide-react"
import Link from "next/link"
import NextImage from "next/image"
import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"

/* ─── stat helpers (count-up + value parsing) ───
 * Numbers in the resource-saved row count up on first viewport entry.
 * `parseStat` splits "$3,200" / "30 hrs" / "10×" / "0" into prefix/num/suffix
 * so we can animate the integer part while preserving formatting (commas,
 * units, multiplier glyph). */

function parseStat(raw: string): { prefix: string; num: number; suffix: string } {
  const m = raw.match(/^(\D*?)([\d,]+)(.*)$/)
  if (!m) return { prefix: "", num: 0, suffix: raw }
  return {
    prefix: m[1],
    num: parseInt(m[2].replace(/,/g, ""), 10),
    suffix: m[3],
  }
}

function useCountUp(target: number, durationMs: number, start: boolean): number {
  const [val, setVal] = useState(0)
  useEffect(() => {
    if (!start) return
    if (target === 0) { setVal(0); return }
    const t0 = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / durationMs)
      // ease-out cubic for a confident settle
      const eased = 1 - Math.pow(1 - t, 3)
      setVal(Math.round(target * eased))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, durationMs, start])
  return val
}

function StatCell({
  rawValue,
  label,
  sublabel,
  isMobile,
}: {
  rawValue: string
  label: string
  sublabel: string
  isMobile: boolean
}) {
  const { prefix, num, suffix } = useMemo(() => parseStat(rawValue), [rawValue])
  // Above-the-fold hero — count-up starts on mount. The parent stats row
  // owns the coordinated entrance animation.
  const animated = useCountUp(num, 1800, true)
  const display = num === 0
    ? `${prefix}0${suffix}`
    : `${prefix}${animated.toLocaleString()}${suffix}`

  // Three-tier hierarchy with a deliberate family break:
  //   • Number  — semibold sans, vertical gradient sheen.
  //   • Label   — mono caps, wide tracking. The "headline" of the metric.
  //   • Compare — sans, sentence case, quiet. Reads as a caption /
  //               footnote that explains what the number is benchmarked
  //               against. Sans→mono→sans creates clear visual rhythm
  //               without italics or extra ornament.
  // No inner motion — the parent stats wrapper handles the coordinated
  // entrance for the whole row.
  return (
    <div
      className="flex flex-col items-center text-center"
    >
      <div
        className={cn(
          "font-semibold tabular-nums tracking-[-0.05em] leading-none",
          "bg-clip-text text-transparent",
          "bg-gradient-to-b from-foreground to-foreground/85",
          "dark:from-white dark:to-white/80",
          // Mobile: 1.55rem (~25px) reads as composed, not loud, at 320–
          // 414px viewports. Desktop unchanged.
          isMobile ? "text-[1.55rem]" : "text-[1.85rem] lg:text-[2rem]",
        )}
      >
        {display}
      </div>
      <div
        className={cn(
          "font-mono uppercase leading-tight text-foreground/55 dark:text-white/55",
          isMobile
            ? "mt-2 text-[8px] tracking-[0.18em]"
            : "mt-3 text-[9px] tracking-[0.24em]",
        )}
      >
        {label}
      </div>
      <div
        className={cn(
          "font-light leading-[1.35] text-foreground/35 dark:text-white/35 normal-case",
          // min-h reserves the height of a 2-line sublabel so cells in
          // the 2x2 mobile grid (and 1x4 desktop row) line up vertically
          // even when some sublabels wrap to 1 line and others to 2.
          isMobile
            ? "mt-1 max-w-[130px] text-[9px] min-h-[2.4em]"
            : "mt-2 max-w-[150px] text-[11px] min-h-[2.7em]",
        )}
      >
        {sublabel}
      </div>
    </div>
  )
}

// Demo video IDs cycled across the grid
const VIDEO_IDS = [
  "icxgLDephHE", "qTvmGfg3HVw", "Wbo2o74hVIo",
  "mH-csaCa508", "AnHJuRMLCnE", "A_OvNh51Npg",
]

const HEADLINE_KEYS = [
  "computerAgent", "competitorIntel", "qaTesting",
  "dataExtraction", "leadGeneration", "emailOutreach",
] as const

// Per-row column offsets prevent adjacent duplicate thumbnails
const ROW_OFFSETS = [0, 3, 1, 5, 2, 4, 1]

// Master switch for the cinematic zoom-out + dissolve intro.
// false: hero scrolls naturally — smoothest on every device.
// true:  original 250vh sticky cinema sequence is restored.
const ENABLE_CINEMATIC_INTRO = false

// ─── Ambient background ──────────────────────────────────────────
// Two layers on every viewport (top radial wash + bottom fade), plus
// extra layers on desktop only (left/right ambient orbs, mouse-tracked
// spotlight, film grain). Mobile stays super clean — only the wash +
// the fade survive there, so the headline reads on near-empty ground.
function HeroAmbientBackground({ isMobile }: { isMobile: boolean }) {
  const rootRef = useRef<HTMLDivElement | null>(null)

  // Mouse-tracked spotlight — a quiet radial that follows the cursor on
  // desktop. Pure CSS var update + composited radial gradient — no React
  // re-render. Disabled on mobile.
  useEffect(() => {
    if (isMobile) return
    const el = rootRef.current
    if (!el) return
    let raf = 0
    let pendingX = 50
    let pendingY = 30
    const onMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect()
      pendingX = ((e.clientX - rect.left) / rect.width) * 100
      pendingY = ((e.clientY - rect.top) / rect.height) * 100
      if (!raf) {
        raf = requestAnimationFrame(() => {
          el.style.setProperty("--hero-spot-x", `${pendingX}%`)
          el.style.setProperty("--hero-spot-y", `${pendingY}%`)
          raf = 0
        })
      }
    }
    window.addEventListener("pointermove", onMove, { passive: true })
    return () => {
      window.removeEventListener("pointermove", onMove)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [isMobile])

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      className="absolute inset-0 z-0 pointer-events-none overflow-hidden"
      style={{
        transform: "translateZ(0)",
        "--hero-spot-x": "50%",
        "--hero-spot-y": "30%",
      } as React.CSSProperties}
    >
      {/* Top radial wash — "lit from above" centre glow. Always on; the
          mobile version uses a slightly tighter, lower-opacity wash. */}
      <div
        className="absolute inset-0"
        style={{
          background: isMobile
            ? "radial-gradient(ellipse 110% 45% at 50% 0%, color-mix(in oklab, var(--foreground) 3%, transparent), transparent 70%)"
            : "radial-gradient(ellipse 90% 55% at 50% 0%, color-mix(in oklab, var(--foreground) 4%, transparent), transparent 70%)",
        }}
      />

      {/* Desktop-only chrome — orbs + dot grid. Skipped on mobile so the
          hero is just type on ground; no orbs to clutter a small viewport
          and no grid to compete with the 2×2 stats row. */}
      {!isMobile && (
        <>
          {/* Local keyframes for the orb drift — kept inside this branch so
              they're absent from the mobile build entirely.
              Respects prefers-reduced-motion: when the OS signal is set,
              the orbs hold still (no animation), and the spotlight bg
              transition is removed so cursor moves don't tween. */}
          <style
            dangerouslySetInnerHTML={{
              __html: `
                @keyframes coasty-hero-orb-a {
                  0%, 100% { transform: translate3d(-4%, -2%, 0) scale(1); }
                  50%      { transform: translate3d(4%, 3%, 0) scale(1.05); }
                }
                @keyframes coasty-hero-orb-b {
                  0%, 100% { transform: translate3d(3%, 2%, 0) scale(1.04); }
                  50%      { transform: translate3d(-3%, -3%, 0) scale(1); }
                }
                @media (prefers-reduced-motion: reduce) {
                  [data-coasty-hero-orb] { animation: none !important; }
                  [data-coasty-hero-spotlight] { transition: none !important; }
                }
              `,
            }}
          />

          {/* Left ambient orb — far-blurred foreground disc, slow drift.
              Heavier blur (120px) so it reads as atmosphere, not a disc. */}
          <div
            data-coasty-hero-orb=""
            className="absolute top-[18%] left-[8%] h-[42vh] w-[42vh] rounded-full opacity-60"
            style={{
              background:
                "radial-gradient(circle at 50% 50%, color-mix(in oklab, var(--foreground) 6%, transparent), transparent 65%)",
              filter: "blur(120px)",
              animation: "coasty-hero-orb-a 22s ease-in-out infinite",
              willChange: "transform",
            }}
          />

          {/* Right ambient orb — mirrored, opposite phase */}
          <div
            data-coasty-hero-orb=""
            className="absolute top-[28%] right-[6%] h-[48vh] w-[48vh] rounded-full opacity-55"
            style={{
              background:
                "radial-gradient(circle at 50% 50%, color-mix(in oklab, var(--foreground) 5%, transparent), transparent 65%)",
              filter: "blur(130px)",
              animation: "coasty-hero-orb-b 26s ease-in-out infinite",
              willChange: "transform",
            }}
          />

          {/* Mouse-tracked spotlight — quiet radial that softly follows
              the cursor. Pure CSS variables drive the centre; no React
              re-renders. transition softens the var update so quick
              cursor moves don't snap-jump. */}
          <div
            data-coasty-hero-spotlight=""
            className="absolute inset-0 transition-[background] duration-300 ease-out"
            style={{
              background:
                "radial-gradient(620px circle at var(--hero-spot-x) var(--hero-spot-y), color-mix(in oklab, var(--foreground) 4%, transparent), transparent 55%)",
            }}
          />

          {/* Film grain — fractal SVG noise blended in at very low alpha.
              The "premium texture" detail used by Linear / Vercel / Stripe
              heroes. Static (no animation), zero JS, ~700 bytes inline.
              Mix-blend-overlay makes it lighten light bg and darken dark
              bg, so it stays a quiet film grain in both modes. */}
          <div
            className="absolute inset-0 mix-blend-overlay opacity-[0.35] dark:opacity-[0.18]"
            style={{
              backgroundImage:
                "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 0.4 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
              backgroundSize: "220px 220px",
            }}
          />
        </>
      )}

      {/* Bottom fade — linear handoff to the next section. Always on. */}
      <div
        className="absolute bottom-0 left-0 right-0 h-40"
        style={{
          background:
            "linear-gradient(to bottom, transparent, var(--background) 85%)",
        }}
      />
    </div>
  )
}

export function HeroVideoMatrix({ isMobile }: { isMobile: boolean }) {
  const cols = isMobile ? 9 : 11
  const rows = isMobile ? 7 : 7
  const gap = isMobile ? 3 : 6

  const containerRef = useRef<HTMLDivElement>(null)
  const stickyRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const vignetteRef = useRef<HTMLDivElement>(null)
  const bottomFadeRef = useRef<HTMLDivElement>(null)
  const scrollIndRef = useRef<HTMLDivElement>(null)
  const bgLayerRef = useRef<HTMLDivElement>(null)

  const centerCol = Math.floor(cols / 2)
  const centerRow = Math.floor(rows / 2)

  const t = useTranslations("hero")
  const tc = useTranslations("common")
  // Resource-saved stats — money / time / output / effort. Lives under
  // `hero.resourceStats` in messages so it's hero-scoped (the generic
  // `stats` namespace below the hero used different keys).
  const RESOURCE_STAT_KEYS = ["money", "time", "speed", "effort"] as const
  const [headlineIndex, setHeadlineIndex] = useState(0)
  const HEADLINES = HEADLINE_KEYS.map((key) => t(`useCases.${key}.headline`))

  // Auto-rotate headlines. Slower cadence (4.5s) than a typical marquee
  // so each line gets a confident dwell — premium pacing reads as
  // intentional, not jittery.
  useEffect(() => {
    const interval = setInterval(() => {
      setHeadlineIndex((prev) => (prev + 1) % HEADLINES.length)
    }, 4500)
    return () => clearInterval(interval)
  }, [HEADLINES.length])

  // Preload/decode thumbnails on mount — Safari defers lazy decode inside
  // transformed parents and dumps the work mid-scroll, causing visible stutter.
  useEffect(() => {
    VIDEO_IDS.forEach((id) => {
      const img = new window.Image()
      img.decoding = "async"
      img.src = `https://img.youtube.com/vi/${id}/hqdefault.jpg`
    })
  }, [])

  // Pre-compute tile layout
  const tiles = useMemo(() => {
    return Array.from({ length: cols * rows }, (_, i) => {
      const col = i % cols
      const row = Math.floor(i / cols)
      const videoIdx =
        (col + ROW_OFFSETS[row % ROW_OFFSETS.length]) % VIDEO_IDS.length
      return {
        videoId: VIDEO_IDS[videoIdx],
        isCenter: col === centerCol && row === centerRow,
      }
    })
  }, [cols, rows, centerCol, centerRow])

  // ─── Scroll-driven cinematic intro: DISABLED ───
  // The hero now scrolls naturally — no zoom-out, no dissolve,
  // no sticky positioning. Page flows into the next section
  // straight from the bottom of the viewport-height hero, which
  // is the smoothest possible behavior on every device (mobile
  // momentum scroll, low-power laptops, every browser).
  // The original rAF implementation is preserved below in an
  // `if (false)` block so it can be re-enabled by flipping the
  // gate. Refs / IntersectionObservers / fail-safe timers all
  // come back together as one unit.
  useEffect(() => {
    if (!ENABLE_CINEMATIC_INTRO) return
    const container = containerRef.current
    const grid = gridRef.current
    const overlay = overlayRef.current
    const vignette = vignetteRef.current
    const bottomFade = bottomFadeRef.current
    const scrollInd = scrollIndRef.current
    const bgLayer = bgLayerRef.current
    if (!container || !grid) return

    // Cache external DOM lookups once — avoids getElementById per frame
    const header = document.getElementById("landing-header-wrap")
    const beamsEl = document.getElementById("beams-bg")
    const crossfade = document.getElementById("hero-crossfade")

    // Cached geometry — recomputed only on resize / ResizeObserver fire.
    // Measured via getBoundingClientRect ONCE, outside the rAF loop.
    let containerTop = 0
    let scrollable = 0
    const measure = () => {
      const r = container.getBoundingClientRect()
      containerTop = r.top + window.scrollY
      scrollable = container.offsetHeight - window.innerHeight
    }
    measure()

    const maxScale = cols
    let rafId = 0
    let isActive = true
    let lastP = -1
    const EPS = 0.0005

    // Track discrete states to avoid redundant DOM writes that thrash layers
    let gridHidden = false
    let overlayHidden = false
    let headerDisabled = false

    const update = () => {
      if (!isActive) {
        rafId = 0
        return
      }
      rafId = requestAnimationFrame(update)

      if (scrollable <= 0) return

      // window.scrollY is cached by the browser — reading it does not force
      // layout, unlike getBoundingClientRect() after style writes.
      const scrolled = Math.max(0, window.scrollY - containerTop)
      const p = Math.min(1, scrolled / scrollable) // linear 0 → 1

      // Skip DOM writes when progress is unchanged — Safari still invalidates
      // composited layers on no-op writes, which contributes to flicker.
      if (Math.abs(p - lastP) < EPS) return
      lastP = p

      // ── Phase 1: Zoom-out (first 65% of scroll) ──
      const zoomP = Math.min(1, p / 0.65)
      const zoomEased = 1 - Math.pow(1 - zoomP, 3) // cubic ease-out
      const minScale = 1.5
      const currentScale = +(maxScale - zoomEased * (maxScale - minScale)).toFixed(3)

      // ── Phase 2: Dissolve (last 35%) ──
      // Use the full remaining scroll range (0.65→1.0) so the grid dissolve
      // ends exactly when the next section enters — no blank gap.
      const dissolveP = Math.min(1, Math.max(0, (p - 0.65) / 0.35))
      const dissolveEased = Math.min(1, dissolveP * dissolveP * 1.1)

      const gridOpacity = 1 - dissolveEased
      grid.style.transform = `translate3d(0,0,0) scale3d(${currentScale}, ${currentScale}, 1)`
      grid.style.setProperty("--tile-opacity", String(Math.min(1, p * 3.3)))
      grid.style.opacity = String(gridOpacity)
      const shouldHideGrid = gridOpacity < 0.005
      if (shouldHideGrid !== gridHidden) {
        grid.style.visibility = shouldHideGrid ? "hidden" : "visible"
        gridHidden = shouldHideGrid
      }

      if (overlay) {
        const s = +(currentScale / maxScale).toFixed(3)
        const overlayOpacity = 1 - dissolveEased
        overlay.style.transform = `translate3d(0,0,0) scale3d(${s},${s},1)`
        overlay.style.opacity = String(overlayOpacity)
        const shouldHideOverlay = overlayOpacity < 0.005
        if (shouldHideOverlay !== overlayHidden) {
          overlay.style.visibility = shouldHideOverlay ? "hidden" : "visible"
          overlayHidden = shouldHideOverlay
        }
      }

      if (scrollInd) {
        scrollInd.style.opacity = String(Math.max(0, 1 - p * 8))
      }

      if (vignette) {
        const vignetteIn = Math.min(1, p * 4)
        const vignetteOut = Math.max(0, 1 - zoomEased * 1.4)
        vignette.style.opacity = String(vignetteIn * vignetteOut)
      }

      if (bottomFade) {
        const base = Math.max(0, Math.min(1, zoomEased * 2 - 0.5))
        bottomFade.style.opacity = String(base * (1 - dissolveEased))
      }

      const uiFadeOut = Math.min(1, p * 10)
      const uiFadeIn = dissolveP * dissolveP
      const uiOpacity = String(Math.max(0, Math.min(1, 1 - uiFadeOut + uiFadeOut * uiFadeIn)))

      if (header) {
        header.style.opacity = uiOpacity
        const shouldDisable = parseFloat(uiOpacity) < 0.5
        if (shouldDisable !== headerDisabled) {
          header.style.pointerEvents = shouldDisable ? "none" : ""
          headerDisabled = shouldDisable
        }
      }

      const beamsFadeOut = Math.min(1, p * 4)
      const beamsFadeIn = dissolveP
      const beamsOpacity = String(Math.max(0, Math.min(1, 1 - beamsFadeOut + beamsFadeOut * beamsFadeIn)))
      if (beamsEl) {
        beamsEl.style.opacity = beamsOpacity
      }

      // Separate composited background layer — avoids repainting the sticky
      // element itself (which on Safari causes the sticky+transform jitter bug).
      // Fades in early (p 0.01→0.05) and holds during zoom/dissolve, then
      // fades OUT near the end (p 0.93→1.0) so the hero becomes transparent
      // and the beams + content below show through — no black gap.
      if (bgLayer) {
        const bgIn = Math.min(1, Math.max(0, (p - 0.01) * 25))
        const bgOut = Math.min(1, Math.max(0, (1 - p) / 0.07))
        bgLayer.style.opacity = String(Math.min(bgIn, bgOut))
      }

      // Cross-fade: content section fades IN as the hero grid fades OUT.
      // Uses the second half of the dissolve so the grid is already mostly
      // gone before content appears — avoids a messy double-exposure.
      if (crossfade) {
        const contentOpacity = Math.max(0, Math.min(1, dissolveEased * 2 - 1))
        crossfade.style.opacity = String(contentOpacity)
        crossfade.style.pointerEvents = contentOpacity > 0.3 ? "" : "none"
      }
    }

    // Mobile-safety net — the gradual rAF-driven fade can be interrupted
    // by Safari's momentum-scroll rAF throttling: if the user flicks past
    // the entire 250vh hero in one inertial gesture, the IntersectionObserver
    // fires "non-intersecting" before any rAF frame has a chance to set
    // crossfade opacity to 1, leaving the rest of the page stuck invisible.
    // This helper forces the final post-hero visible state on the persistent
    // outside-the-hero elements that the rAF loop drives. We deliberately
    // DON'T touch hero-internal layers (overlay/grid/vignette/bottomFade/
    // bgLayer) — the main content's z-1 + marginTop:-100vh covers the hero
    // when scrolled past, and the rAF's discrete-state cache (overlayHidden,
    // gridHidden) would go stale if we wrote to those directly here.
    const forcePostHeroState = () => {
      if (crossfade) {
        if (crossfade.style.opacity !== "1") crossfade.style.opacity = "1"
        if (crossfade.style.pointerEvents !== "") crossfade.style.pointerEvents = ""
      }
      if (header) {
        header.style.opacity = "1"
        header.style.pointerEvents = ""
      }
      if (beamsEl) beamsEl.style.opacity = "1"
    }

    const isPastHero = () => scrollable > 0 && window.scrollY > containerTop + scrollable

    const io = new IntersectionObserver(
      (entries) => {
        const nowActive = entries[0]?.isIntersecting ?? true
        if (nowActive && !isActive) {
          isActive = true
          lastP = -1
          if (!rafId) rafId = requestAnimationFrame(update)
        } else if (!nowActive && isActive) {
          isActive = false
          // Lock the post-hero state explicitly — the rAF loop won't run
          // again until the user scrolls back into the hero.
          if (isPastHero()) forcePostHeroState()
        }
      },
      { rootMargin: "200px 0px" }
    )
    io.observe(container)

    // Re-measure on viewport changes. ResizeObserver covers content-driven
    // size changes (font-load reflows, image decodes); the resize event
    // covers viewport-driven changes that ResizeObserver misses.
    const ro = new ResizeObserver(measure)
    ro.observe(container)
    const onResize = () => measure()
    window.addEventListener("resize", onResize, { passive: true })

    // ── iOS visibility safety: crossfade is scroll-driven, not rAF-driven ──
    // The visual hero choreography (zoom, dissolve, vignette, etc.) runs on
    // rAF for smoothness. But on iOS Safari, rAF is throttled — sometimes
    // paused entirely — during momentum scroll, which left the entire page
    // BELOW the hero stuck at opacity 0 / pointer-events:none for users who
    // scrolled in one big flick. The IntersectionObserver+isPastHero safety
    // net only covered the "fully past hero" case; users who landed in the
    // dissolve zone (65–100% of hero) saw an invisible page.
    //
    // Scroll events on iOS are coalesced during momentum but always fire
    // again once momentum ends — and they fire reliably during slow user
    // scrolls. So we compute crossfade opacity directly from scrollY here
    // on every scroll event (and once on mount), independent of rAF. If
    // rAF runs, great — both paths converge to the same opacity. If rAF
    // is throttled, scroll events alone keep the page visible.
    const computeCrossfadeOpacity = () => {
      if (scrollable <= 0) return 1
      const scrolled = Math.max(0, window.scrollY - containerTop)
      const p = Math.min(1, scrolled / scrollable)
      // Same dissolve curve as the rAF path so visuals match exactly.
      const dissolveP = Math.min(1, Math.max(0, (p - 0.65) / 0.35))
      const dissolveEased = Math.min(1, dissolveP * dissolveP * 1.1)
      return Math.max(0, Math.min(1, dissolveEased * 2 - 1))
    }
    const syncCrossfade = () => {
      if (!crossfade) return
      // Past-hero short-circuit covers the "user scrolled fully past in one
      // gesture" case — same as forcePostHeroState's intent but cheaper.
      if (isPastHero()) {
        if (crossfade.style.opacity !== "1") crossfade.style.opacity = "1"
        if (crossfade.style.pointerEvents !== "") crossfade.style.pointerEvents = ""
        return
      }
      const target = computeCrossfadeOpacity()
      // Only write when materially different — Safari invalidates composited
      // layers on no-op writes, which contributes to flicker.
      const current = parseFloat(crossfade.style.opacity || "0")
      if (Math.abs(target - current) > 0.005) {
        crossfade.style.opacity = String(target)
      }
      const wantsPointer = target > 0.3
      const hasPointer = crossfade.style.pointerEvents !== "none"
      if (wantsPointer !== hasPointer) {
        crossfade.style.pointerEvents = wantsPointer ? "" : "none"
      }
    }

    const onScroll = () => {
      // Full safety net (header / beams / crossfade) when past hero,
      // progressive crossfade sync otherwise. Both are O(1) and idempotent.
      if (isPastHero() && crossfade && crossfade.style.opacity !== "1") {
        forcePostHeroState()
      } else {
        syncCrossfade()
      }
    }
    window.addEventListener("scroll", onScroll, { passive: true })

    // Initial sync — covers (a) deep links / back-button restore past the
    // hero, and (b) the case where rAF takes a frame or two to start and
    // the user has already scrolled into the dissolve zone before then.
    if (isPastHero()) {
      forcePostHeroState()
    } else {
      syncCrossfade()
    }

    // Hard fail-safe: if the user has scrolled at all but the crossfade is
    // still effectively invisible after 1.5s, force it visible. This catches
    // the worst-case iOS scenario where rAF is paused, scroll events were
    // coalesced into nothing, AND IntersectionObserver hasn't fired. Better
    // to drop the cinematic intro than to ship an invisible page.
    const failSafeTimer = window.setTimeout(() => {
      if (!crossfade) return
      const past50 = scrollable > 0 && window.scrollY > containerTop + scrollable * 0.5
      const stillHidden = parseFloat(crossfade.style.opacity || "0") < 0.5
      if (past50 && stillHidden) {
        crossfade.style.opacity = "1"
        crossfade.style.pointerEvents = ""
      }
    }, 1500)

    rafId = requestAnimationFrame(update)

    return () => {
      isActive = false
      if (rafId) cancelAnimationFrame(rafId)
      window.clearTimeout(failSafeTimer)
      io.disconnect()
      ro.disconnect()
      window.removeEventListener("resize", onResize)
      window.removeEventListener("scroll", onScroll)
      // Use cached refs — no getElementById in cleanup
      if (header) { header.style.opacity = "1"; header.style.pointerEvents = "" }
      if (beamsEl) beamsEl.style.opacity = "1"
      if (crossfade) { crossfade.style.opacity = "1"; crossfade.style.pointerEvents = "" }
    }
  }, [cols])

  return (
    <section
      id="hero"
      ref={containerRef}
      // Cinematic mode: 250vh sticky container.
      // Natural mode: a single viewport-height container so the page
      // flows straight from the hero into the next section. We use
      // min-h-screen so the section can grow if content overflows on
      // unusual viewports (very short landscape phones), while the
      // inner div is a strict h-screen so the overlay's percentage-
      // anchored cards (top: 32%, etc.) resolve against a real 100vh
      // frame — without that, the overlay collapses to content height
      // and the side-gutter cards crush together.
      style={ENABLE_CINEMATIC_INTRO ? { height: "250vh" } : undefined}
      className={cn(
        "relative",
        !ENABLE_CINEMATIC_INTRO && "min-h-screen overflow-hidden",
      )}
    >
      <div
        ref={stickyRef}
        className={cn(
          ENABLE_CINEMATIC_INTRO
            ? "sticky top-0 h-screen overflow-hidden flex items-center justify-center"
            : "relative w-full h-screen flex items-center justify-center",
        )}
        style={
          ENABLE_CINEMATIC_INTRO
            ? {
                // Promote the sticky element to its own compositor layer.
                // Works around a WebKit bug where child transforms cause the sticky
                // element to jitter by a few pixels during scroll.
                willChange: "transform",
                transform: "translateZ(0)",
              }
            : undefined
        }
      >
        {/* ─── Natural-scroll ambient background ───
            Layered, performance-cheap composition that lives BELOW
            the z-10 hero overlay and ABOVE the page bg-background.
            All layers are pointer-events-none and aria-hidden so
            they're decorative only.

            Five layers, back-to-front:
              1. Top radial wash — "lit from above" foreground glow
                 anchored at the top centre, fades by 70%.
              2. Two ambient orbs — far-blurred foreground discs
                 drifting slowly opposite each other. Single-channel
                 (foreground tint), zero brand colour.
              3. Dot grid — a 24px micro-grid clipped to a central
                 radial mask so only the headline area shows the
                 grain. Edges stay pristine bg.
              4. Side gutter vignette — gentle inward fade on left
                 and right edges so the gutter video cards read
                 against quiet ground.
              5. Bottom fade — linear handoff to the next section.

            Total cost: zero JS, zero images, four absolute divs +
            two slow CSS keyframe animations. Renders identically
            in dark mode via foreground/* CSS variables. */}
        {!ENABLE_CINEMATIC_INTRO && (
          <HeroAmbientBackground isMobile={isMobile} />
        )}
        {ENABLE_CINEMATIC_INTRO && (
          <>
            {/* ─── Background fader (separate layer — avoids repainting sticky) ─── */}
            <div
              ref={bgLayerRef}
              className="absolute inset-0 bg-background pointer-events-none"
              style={{ opacity: 0.001, zIndex: 0, willChange: "opacity", transform: "translateZ(0)" }}
              aria-hidden="true"
            />
            {/* ─── Video tile grid ─── */}
            <div
              ref={gridRef}
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${cols}, 1fr)`,
                gap,
                width: "max(110vw, 200vh)",
                transform: `scale3d(${cols}, ${cols}, 1)`,
                transformOrigin: "center center",
                willChange: "transform, opacity",
              }}
            >
              {tiles.map((tile, i) => (
                <div
                  key={i}
                  className={cn(
                    "relative overflow-hidden aspect-video rounded-[2px]",
                    tile.isCenter ? "bg-transparent" : "bg-neutral-900"
                  )}
                  style={
                    tile.isCenter
                      ? undefined
                      : ({
                          opacity: "var(--tile-opacity, 0)",
                        } as React.CSSProperties)
                  }
                >
                  {!tile.isCenter && (
                    <>
                      <NextImage
                        src={`https://img.youtube.com/vi/${tile.videoId}/hqdefault.jpg`}
                        alt=""
                        fill
                        sizes="(max-width: 768px) 12vw, 10vw"
                        draggable={false}
                        unoptimized
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-black/15 dark:bg-black/25" />
                    </>
                  )}
                </div>
              ))}
            </div>

            {/* ─── Vignette ─── */}
            <div
              ref={vignetteRef}
              className="absolute inset-0 pointer-events-none z-[5]"
              style={{
                background:
                  "radial-gradient(ellipse 55% 45% at 50% 50%, transparent 20%, var(--background) 75%)",
                willChange: "opacity",
                transform: "translateZ(0)",
              }}
            />

            {/* ─── Bottom gradient for transition to content ─── */}
            <div
              ref={bottomFadeRef}
              className="absolute bottom-0 left-0 right-0 h-40 pointer-events-none z-[6] bg-gradient-to-t from-background via-background/60 to-transparent"
              style={{ opacity: 0.001, willChange: "opacity", transform: "translateZ(0)" }}
            />
          </>
        )}

        {/* ─── Hero text — separate overlay, scales in sync with grid ─── */}
        <div
          ref={overlayRef}
          className={cn(
            "absolute inset-0 z-10 flex flex-col items-center justify-center pointer-events-none pt-36 sm:pt-44 pb-16"
          )}
          style={{
            transform: "translateZ(0)",
            willChange: "transform, opacity",
            transformOrigin: "center center",
          }}
        >
          {/* HeroTaskShots is no longer rendered here — it now lives
              at the landing-page level as a fixed-position overlay so
              the cards "follow" the viewport across all sections and
              can swap their imagery for per-section video on scroll.
              See app/components/landing/landing-page.tsx. */}

          <div
            className={cn(
              "pointer-events-auto text-center w-full",
              // Tighter editorial measure on desktop — keeps the headline
              // from sprawling and pulls the stats card into the same
              // optical column as the type.
              isMobile ? "px-5 max-w-[440px]" : "px-10 max-w-[820px]"
            )}
          >
            {/* Headline — tightened tracking + leading + text-balance for
                a more confident editorial wrap. Vertical gradient sheen
                (foreground → foreground/85) is the same "type from paper"
                treatment used on the stat numbers below — it pulls the
                bottom of each glyph down a touch in luminance, which the
                eye reads as quiet depth, not contrast. Cinematic entrance
                with quint ease-out arrives first; the rest of the column
                follows in a coordinated wave. */}
            <motion.h1
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.95, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
              className={cn(
                "font-semibold tracking-[-0.045em] text-balance pb-1 sm:pb-2",
                "bg-clip-text text-transparent",
                "bg-gradient-to-b from-foreground to-foreground/85",
                "dark:from-white dark:to-white/82",
                isMobile
                  ? "text-[1.65rem] leading-[1.14]"
                  : "text-[2.25rem] md:text-[2.75rem] lg:text-[3.25rem] leading-[1.12]"
              )}
            >
              {t("headline")}
            </motion.h1>

            {/* Rotating subheadline — signature ease curve for a
                "confident settle" arrival; 0.6s duration breathes longer
                than the previous 0.5s. Tracking matched to the headline
                for typographic continuity. */}
            <div
              role="text"
              aria-live="polite"
              aria-atomic="true"
              className={cn(
                "relative overflow-hidden",
                isMobile ? "mt-1 pb-1" : "mt-2.5 pb-2"
              )}
            >
              <span
                className={cn(
                  "invisible block font-medium tracking-[-0.035em]",
                  isMobile
                    ? "text-[1.2rem] leading-[1.28]"
                    : "text-[1.6rem] md:text-[1.85rem] lg:text-[2.05rem] leading-[1.28]"
                )}
                aria-hidden="true"
              >
                {HEADLINES.reduce(
                  (a, b) => (b.length > a.length ? b : a),
                  ""
                )}
              </span>
              <AnimatePresence mode="wait">
                <motion.span
                  key={headlineIndex}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -7 }}
                  transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
                  className={cn(
                    "absolute inset-x-0 top-0 font-medium tracking-[-0.035em] text-foreground/50 dark:text-white/55",
                    isMobile
                      ? "text-[1.2rem] leading-[1.28]"
                      : "text-[1.6rem] md:text-[1.85rem] lg:text-[2.05rem] leading-[1.28]"
                  )}
                >
                  {HEADLINES[headlineIndex]}
                </motion.span>
              </AnimatePresence>
            </div>

            {/* Description — tighter leading (1.55 vs relaxed 1.625), narrower
                measure on desktop for a true editorial line length. */}
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.18, ease: [0.22, 1, 0.36, 1] }}
              className={cn(
                "mx-auto text-foreground/65 dark:text-white/65",
                isMobile
                  ? "mt-2.5 text-[12.5px] leading-[1.5] max-w-[300px]"
                  : "mt-4 text-[15px] sm:text-[16px] leading-[1.55] max-w-[440px]"
              )}
            >
              {t("useCases.computerAgent.outcome")}
            </motion.p>

            {/* ─── Resources saved — money / time / output / effort.
                A glass spec-strip mirroring the landing-header chrome
                vocabulary: low-opacity tinted panel, hairline border,
                backdrop blur, single signature top hairline. Tapered
                vertical hairlines between columns give the row the
                feel of an editorial spec sheet. No ambient cone or
                wash behind it — the stats stand on their own against
                the page background. */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.85, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className={cn(
                "relative mx-auto",
                isMobile ? "mt-6 max-w-[320px]" : "mt-9 max-w-[620px]",
              )}
              aria-label="Resources saved per workflow"
            >

              {/* No panel chrome anywhere — the tapered hairline cell
                  dividers carry all the structure the row needs. On
                  mobile the 2x2 grid uses a cross-pattern of dividers
                  (vertical between columns, horizontal between rows)
                  for the same editorial spec-sheet feel as desktop. */}
              <div className="relative">
                <div
                  className={cn(
                    "relative grid",
                    isMobile ? "grid-cols-2" : "grid-cols-4",
                  )}
                >
                  {RESOURCE_STAT_KEYS.map((key, i) => {
                    // Desktop: tapered vertical divider before every cell
                    // except the first. Mobile (2x2): vertical before
                    // right-column cells, horizontal above bottom-row cells.
                    const hasLeftDivider = !isMobile && i > 0
                    const mobileLeftDivider = isMobile && i % 2 === 1
                    const mobileTopDivider = isMobile && i >= 2
                    return (
                      <div
                        key={key}
                        className={cn(
                          "relative",
                          // Padding — tighter on mobile so the 2x2 grid
                          // breathes without crushing the sublabel wrap.
                          isMobile ? "px-2 py-3.5" : "px-4 py-8",
                          // Desktop divider — eased to a whisper.
                          hasLeftDivider &&
                            "before:content-[''] before:absolute before:left-0 before:top-7 before:bottom-7 before:w-px before:bg-gradient-to-b before:from-transparent before:via-foreground/[0.09] dark:before:via-white/[0.11] before:to-transparent",
                          // Mobile vertical hairline between the two columns.
                          mobileLeftDivider &&
                            "before:content-[''] before:absolute before:left-0 before:top-4 before:bottom-4 before:w-px before:bg-gradient-to-b before:from-transparent before:via-foreground/[0.10] dark:before:via-white/[0.12] before:to-transparent",
                          // Mobile horizontal hairline above the bottom row.
                          mobileTopDivider &&
                            "after:content-[''] after:absolute after:top-0 after:left-4 after:right-4 after:h-px after:bg-gradient-to-r after:from-transparent after:via-foreground/[0.10] dark:after:via-white/[0.12] after:to-transparent",
                        )}
                      >
                        <StatCell
                          isMobile={isMobile}
                          rawValue={t(`resourceStats.${key}.value`)}
                          label={t(`resourceStats.${key}.label`)}
                          sublabel={t(`resourceStats.${key}.sublabel`)}
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
            </motion.div>

            {/* CTAs — primary keeps the solid foreground fill but adds a
                soft inset highlight + quiet shadow for depth, and dials
                the hover scale back to 1.015 (premium restraint over
                the previous 1.02). Secondary drops the x-translate
                gimmick — colour shift alone reads more confident. */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.75, delay: 0.45, ease: [0.22, 1, 0.36, 1] }}
              className={cn(
                "flex items-center justify-center",
                isMobile ? "mt-5 gap-2.5 flex-col" : "mt-7 gap-6"
              )}
            >
              <Link
                href="/auth"
                className={cn(
                  "group/cta inline-flex items-center justify-center gap-2 rounded-full font-medium cursor-pointer",
                  "bg-foreground text-background",
                  "shadow-[0_1px_0_0_rgba(255,255,255,0.08)_inset,0_6px_18px_-10px_rgba(0,0,0,0.22)]",
                  "dark:shadow-[0_1px_0_0_rgba(0,0,0,0.10)_inset,0_6px_18px_-10px_rgba(0,0,0,0.40)]",
                  "transition-[box-shadow,transform] duration-300",
                  "hover:scale-[1.012] active:scale-[0.985]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  isMobile
                    ? "w-full max-w-[260px] px-6 py-3 text-sm"
                    : "px-7 py-3 text-[14.5px]"
                )}
              >
                {tc("tryCoastyFree")}
                <ArrowRight className="h-3.5 w-3.5 transition-transform duration-300 ease-out group-hover/cta:translate-x-0.5" />
              </Link>
              <a
                href="https://cal.com/coasty/15min"
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  "inline-flex items-center justify-center gap-2 rounded-full font-medium cursor-pointer",
                  // Outlined glass pill — mirrors the primary's shape and
                  // size for visual rhythm but trades the solid fill for a
                  // hairline ring + barely-tinted glass plate. Reads on
                  // any background colour (white, dark, tinted) because:
                  //   • Border is foreground-tinted, so it darkens on light
                  //     backgrounds and lightens on dark ones.
                  //   • Background is foreground/[0.03] — invisible on
                  //     plain white but adds a soft glass plate over
                  //     coloured backgrounds, lifting the button off them.
                  //   • Text is at full foreground opacity so contrast is
                  //     guaranteed in both modes.
                  "border border-foreground/15 dark:border-white/15",
                  "text-foreground dark:text-white",
                  "bg-foreground/[0.025] dark:bg-white/[0.03]",
                  "backdrop-blur-[2px]",
                  "hover:bg-foreground/[0.05] hover:border-foreground/25",
                  "dark:hover:bg-white/[0.06] dark:hover:border-white/25",
                  "transition-[background,border-color,transform] duration-300",
                  "active:scale-[0.985]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  isMobile
                    ? "w-full max-w-[260px] px-6 py-3 text-sm"
                    : "px-7 py-3 text-[14.5px]"
                )}
              >
                <Video className="h-3.5 w-3.5" />
                {tc("bookDemo")}
              </a>
            </motion.div>
          </div>
        </div>

        {/* ─── Scroll indicator ───
            Cinematic-mode only — the cue makes sense when the user
            needs to know "this hero unfolds as you scroll." In
            natural-scroll mode the page just continues normally and
            the indicator is redundant. */}
        {ENABLE_CINEMATIC_INTRO && (
          <div
            ref={scrollIndRef}
            className={cn(
              "absolute left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-2 text-foreground/30 dark:text-white/30",
              isMobile ? "bottom-6" : "bottom-10"
            )}
          >
            <span
              className={cn(
                "font-mono text-[9px] uppercase",
                isMobile ? "tracking-[0.18em]" : "tracking-[0.22em]"
              )}
            >
              Scroll
            </span>
            <motion.div
              animate={{ y: [0, 4, 0] }}
              transition={{
                duration: 2.2,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            >
              <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.6} />
            </motion.div>
          </div>
        )}
      </div>
    </section>
  )
}
