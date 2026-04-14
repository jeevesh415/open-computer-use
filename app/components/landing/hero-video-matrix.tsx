"use client"

import { useEffect, useRef, useState, useMemo } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ArrowRight, Video, ChevronDown } from "lucide-react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"

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
  const [headlineIndex, setHeadlineIndex] = useState(0)
  const HEADLINES = HEADLINE_KEYS.map((key) => t(`useCases.${key}.headline`))

  // Auto-rotate headlines
  useEffect(() => {
    const interval = setInterval(() => {
      setHeadlineIndex((prev) => (prev + 1) % HEADLINES.length)
    }, 3500)
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

  // ─── Scroll-driven animation via continuous rAF loop ───
  // We run a rAF loop instead of listening to `scroll` events because Safari
  // coalesces scroll events during momentum scroll and can even stop updating
  // window.scrollY mid-gesture — which causes visible jumps. Reading the
  // container rect fresh every frame tracks the actual visual position.
  // An IntersectionObserver pauses the loop while the hero is offscreen.
  useEffect(() => {
    const container = containerRef.current
    const grid = gridRef.current
    const overlay = overlayRef.current
    const vignette = vignetteRef.current
    const bottomFade = bottomFadeRef.current
    const scrollInd = scrollIndRef.current
    const bgLayer = bgLayerRef.current
    if (!container || !grid) return

    const maxScale = cols
    let rafId = 0
    let isActive = true
    let lastP = -1
    const EPS = 0.0005

    const update = () => {
      if (!isActive) {
        rafId = 0
        return
      }
      rafId = requestAnimationFrame(update)

      const rect = container.getBoundingClientRect()
      const scrollable = container.offsetHeight - window.innerHeight
      if (scrollable <= 0) return

      const scrolled = Math.max(0, -rect.top)
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
      const dissolveP = Math.min(1, Math.max(0, (p - 0.65) / 0.3))
      const dissolveEased = Math.min(1, dissolveP * dissolveP * 1.1)

      const gridOpacity = 1 - dissolveEased
      grid.style.transform = `translate3d(0,0,0) scale3d(${currentScale}, ${currentScale}, 1)`
      grid.style.setProperty("--tile-opacity", String(Math.min(1, p * 3.3)))
      grid.style.opacity = String(gridOpacity)
      grid.style.visibility = gridOpacity <= 0 ? "hidden" : "visible"

      if (overlay) {
        const s = +(currentScale / maxScale).toFixed(4)
        const overlayOpacity = 1 - dissolveEased
        overlay.style.transform = `translate3d(0,0,0) scale3d(${s}, ${s}, 1)`
        overlay.style.opacity = String(overlayOpacity)
        overlay.style.visibility = overlayOpacity <= 0 ? "hidden" : "visible"
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

      const header = document.getElementById("landing-header-wrap")
      const guides = document.getElementById("guide-lines-wrap")
      if (header) {
        header.style.opacity = uiOpacity
        header.style.pointerEvents = parseFloat(uiOpacity) < 0.5 ? "none" : ""
      }
      if (guides) {
        guides.style.opacity = uiOpacity
      }

      const beamsFadeOut = Math.min(1, p * 4)
      const beamsFadeIn = dissolveP
      const beamsOpacity = String(Math.max(0, Math.min(1, 1 - beamsFadeOut + beamsFadeOut * beamsFadeIn)))
      const beamsEl = document.getElementById("beams-bg")
      if (beamsEl) {
        beamsEl.style.opacity = beamsOpacity
      }

      // Separate composited background layer — avoids repainting the sticky
      // element itself (which on Safari causes the sticky+transform jitter bug).
      if (bgLayer) {
        bgLayer.style.opacity = p > 0.03 ? "1" : "0"
      }
    }

    const io = new IntersectionObserver(
      (entries) => {
        const nowActive = entries[0]?.isIntersecting ?? true
        if (nowActive && !isActive) {
          isActive = true
          lastP = -1
          if (!rafId) rafId = requestAnimationFrame(update)
        } else if (!nowActive && isActive) {
          isActive = false
        }
      },
      { rootMargin: "200px 0px" }
    )
    io.observe(container)

    rafId = requestAnimationFrame(update)

    return () => {
      isActive = false
      if (rafId) cancelAnimationFrame(rafId)
      io.disconnect()
      const header = document.getElementById("landing-header-wrap")
      const guides = document.getElementById("guide-lines-wrap")
      const beamsEl = document.getElementById("beams-bg")
      if (header) { header.style.opacity = "1"; header.style.pointerEvents = "" }
      if (guides) guides.style.opacity = "1"
      if (beamsEl) beamsEl.style.opacity = "1"
    }
  }, [cols])

  return (
    <section
      id="hero"
      ref={containerRef}
      style={{ height: isMobile ? "250vh" : "300vh" }}
      className="relative"
    >
      <div
        ref={stickyRef}
        className="sticky top-0 h-screen overflow-hidden flex items-center justify-center"
        style={{
          // Promote the sticky element to its own compositor layer.
          // Works around a WebKit bug where child transforms cause the sticky
          // element to jitter by a few pixels during scroll.
          willChange: "transform",
          transform: "translateZ(0)",
        }}
      >
        {/* ─── Background fader (separate layer — avoids repainting sticky) ─── */}
        <div
          ref={bgLayerRef}
          className="absolute inset-0 bg-background pointer-events-none"
          style={{ opacity: 0, zIndex: 0, willChange: "opacity" }}
          aria-hidden="true"
        />
        {/* ─── Video tile grid ─── */}
        <div
          ref={gridRef}
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gap,
            // Ensure center tile fills viewport on ALL aspect ratios:
            // - 110vw covers width (with buffer for inter-tile gaps)
            // - 200vh * 9/16 = 112.5vh covers height on tall screens (MacBooks, iPads, phones)
            width: "max(110vw, 200vh)",
            transform: `scale3d(${cols}, ${cols}, 1)`,
            transformOrigin: "center center",
            willChange: "transform, opacity",
            backfaceVisibility: "hidden",
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
                  <img
                    src={`https://img.youtube.com/vi/${tile.videoId}/hqdefault.jpg`}
                    alt=""
                    width={480}
                    height={360}
                    decoding="async"
                    draggable={false}
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-black/15 dark:bg-black/25" />
                </>
              )}
            </div>
          ))}
        </div>

        {/* ─── Vignette: page bg bleeds in from edges ─── */}
        {/* Uses a radial-gradient background instead of mask-image because
            Safari re-rasterizes masks on every opacity change, causing flicker. */}
        <div
          ref={vignetteRef}
          className="absolute inset-0 pointer-events-none z-[5]"
          style={{
            background:
              "radial-gradient(ellipse 55% 45% at 50% 50%, transparent 20%, var(--background) 75%)",
            willChange: "opacity",
          }}
        />

        {/* ─── Bottom gradient for transition to content ─── */}
        <div
          ref={bottomFadeRef}
          className="absolute bottom-0 left-0 right-0 h-40 pointer-events-none z-[6] bg-gradient-to-t from-background via-background/60 to-transparent"
          style={{ opacity: 0 }}
        />

        {/* ─── Hero text — separate overlay, scales in sync with grid ─── */}
        <div
          ref={overlayRef}
          className={cn(
            "absolute inset-0 z-10 flex flex-col items-center justify-center pointer-events-none",
            isMobile ? "pt-24 pb-20" : "pt-28 pb-24"
          )}
          style={{
            willChange: "transform, opacity",
            transformOrigin: "center center",
          }}
        >
          <div
            className={cn(
              "pointer-events-auto text-center w-full",
              isMobile ? "px-5 max-w-[440px]" : "px-10 max-w-[900px]"
            )}
          >
            {/* Badge */}
            <div
              className={cn(
                "flex justify-center",
                isMobile ? "mb-4" : "mb-7"
              )}
            >
              <div
                className={cn(
                  "inline-flex items-center gap-2 rounded-full",
                  "border border-foreground/[0.06] dark:border-white/[0.08]",
                  "bg-foreground/[0.03] dark:bg-white/[0.04]",
                  "backdrop-blur-sm",
                  isMobile ? "px-3 py-1" : "px-4 py-1.5"
                )}
              >
                <span
                  className={cn(
                    "font-medium tracking-wide text-foreground/50 dark:text-white/60",
                    isMobile ? "text-[10px]" : "text-xs"
                  )}
                >
                  #1 Computer-Use Agent
                </span>
                <span className={cn("w-px bg-foreground/[0.1] dark:bg-white/[0.12]", isMobile ? "h-2.5" : "h-3")} />
                <span
                  className={cn(
                    "font-semibold tracking-wide text-foreground dark:text-white",
                    isMobile ? "text-[10px]" : "text-xs"
                  )}
                >
                  82% OSWorld
                </span>
              </div>
            </div>

            {/* Headline */}
            <h1
              className={cn(
                "font-semibold tracking-[-0.04em] text-foreground",
                isMobile
                  ? "text-[1.65rem] leading-[1.12]"
                  : "text-[2.5rem] md:text-[3rem] lg:text-[3.5rem] leading-[1.08]"
              )}
            >
              {t("headline")}
            </h1>

            {/* Rotating subheadline */}
            <div
              className={cn(
                "relative overflow-hidden",
                isMobile ? "mt-0.5 pb-1" : "mt-2 pb-2"
              )}
            >
              <span
                className={cn(
                  "invisible block font-medium tracking-[-0.03em]",
                  isMobile
                    ? "text-[1.25rem] leading-[1.3]"
                    : "text-[1.75rem] md:text-[2rem] lg:text-[2.25rem] leading-[1.3]"
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
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
                  className={cn(
                    "absolute inset-x-0 top-0 font-medium tracking-[-0.03em] text-foreground/50 dark:text-white/55",
                    isMobile
                      ? "text-[1.25rem] leading-[1.3]"
                      : "text-[1.75rem] md:text-[2rem] lg:text-[2.25rem] leading-[1.3]"
                  )}
                >
                  {HEADLINES[headlineIndex]}
                </motion.span>
              </AnimatePresence>
            </div>

            {/* Description */}
            <p
              className={cn(
                "mx-auto text-foreground/55 dark:text-white/60 leading-relaxed",
                isMobile
                  ? "mt-3 text-[13px] max-w-[340px]"
                  : "mt-5 text-[16px] sm:text-[17px] max-w-lg"
              )}
            >
              {t("useCases.computerAgent.outcome")}
            </p>

            {/* CTAs */}
            <div
              className={cn(
                "flex items-center justify-center",
                isMobile ? "mt-6 gap-4 flex-col" : "mt-9 gap-6"
              )}
            >
              <Link href="/auth">
                <motion.button
                  className={cn(
                    "inline-flex items-center gap-2 rounded-full font-medium cursor-pointer",
                    "bg-foreground text-background",
                    isMobile
                      ? "px-6 py-3 text-sm"
                      : "px-7 py-3 text-[15px]"
                  )}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  {tc("tryCoastyFree")}
                  <ArrowRight className="h-3.5 w-3.5" />
                </motion.button>
              </Link>
              <a
                href="https://cal.com/coasty/15min"
                target="_blank"
                rel="noopener noreferrer"
              >
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
        </div>

        {/* ─── Scroll indicator (independent, does not scale) ─── */}
        <div
          ref={scrollIndRef}
          className={cn(
            "absolute left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-1 text-foreground/30 dark:text-white/30",
            isMobile ? "bottom-6" : "bottom-10"
          )}
        >
          <span className="text-[10px] font-medium tracking-[0.2em] uppercase">
            Scroll
          </span>
          <motion.div
            animate={{ y: [0, 6, 0] }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          >
            <ChevronDown className="h-4 w-4" />
          </motion.div>
        </div>
      </div>
    </section>
  )
}
