"use client"

import { motion, AnimatePresence } from "framer-motion"
import NextImage from "next/image"
import { cn } from "@/lib/utils"
import { useEffect, useRef } from "react"

/* ─── Hero task shots ─────────────────────────────────────────
 * Fixed-overlay set of agent screenshots that "follow" the
 * viewport as the user scrolls. Each card has:
 *
 *   • A default gutter position (top % + side + inset px) — this
 *     is where it lives during the hero AND while the user is
 *     scrolling through normal content.
 *   • An optional triggerSection ("benchmark", "features", …):
 *     when the page-level scroll observer reports that section is
 *     in view, the matching card animates to a larger "featured"
 *     spot ON ITS OWN SIDE (no cross-viewport hops), a `<video>`
 *     fades in over the screenshot, and a mono caption with a
 *     live-pulse appears under the card.
 *   • A `videoSrc` (mp4 in /public/hero-tasks/). The video element
 *     only mounts while featured — no buffering / decode work for
 *     gutter cards.
 *   • A `taskLabel` rendered as the caption beneath the featured
 *     card. Mono caps, outside the frame (Vercel/Linear pattern).
 *
 * Focus-mode treatment for non-featured cards while another is
 * featured: dim to 0.18 opacity, desaturate to 0.6, scale to 0.94.
 * Reads as "off" without disappearing — preserves the spatial
 * anchor of the `)(` arrangement so the eye knows where each
 * card lives.
 */

const CARD_W = 200
const CARD_H = 113 // 200 × 9/16

// Featured tile target — same side as the card's gutter so the
// reveal feels like a local "lift", not a cross-viewport hop.
//
// Sized intentionally smaller than the original 420×236 so the
// section content next to it can stay at a comfortable 720–760px
// editorial column when the wrapper reflows. Bigger cards force
// section content below 700px which breaks bento grids and
// 5-card pricing rows.
const FEATURED_W = 360
const FEATURED_H = 203 // 360 × 9/16
const FEATURED_INSET = 60 // px from gutter edge — pulls card inboard
const FEATURED_TOP = "22%"

// Per-section vertical override. Demo's grid is dense at the top
// (3-col cards on lg) so the audit recommends bottom-right —
// drop the featured row to ~55% to land below the grid header.
// Other sections use the default top.
const FEATURED_TOP_BY_SECTION: Partial<Record<TriggerSection, string>> = {
  demo: "52%",
}

// Featured-video playback speed. The recordings are 30–60s of
// methodical agent action (clicks, dialogs, pauses) at 1×.
// 4× keeps every action legible while making the demo feel
// snappy and intentional.
const PLAYBACK_RATE = 4

// Easing — quint ease-out, the standard for tasteful UI motion.
// Same curve Linear / Stripe / Vercel land on for section reveals.
const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1]

export type TriggerSection =
  | "benchmark"
  | "features"
  | "why-coasty"
  | "demo"
  | "cost"
  | "pricing"

type Shot = {
  src: string
  alt: string
  /** vertical anchor as % of the overlay height */
  top: string
  /** which gutter the card lives in */
  side: "left" | "right"
  /** absolute px from the gutter edge — negative bleeds off-screen */
  inset: number
  /** within a gutter stack: back vs front (drives z-index, opacity, shadow) */
  layer: "back" | "front"
  /** if set, the card animates to FEATURED + plays this video when
   *  the page reports `triggerSection` is the in-view section */
  triggerSection?: TriggerSection
  videoSrc?: string
  // ─── Caption fields (rendered outside the frame, featured-only) ───
  /** App name for the eyebrow chip. Mono caps. */
  appLabel?: string
  /** Single-line bold task description. */
  taskLabel?: string
  /** Smaller sub-line describing what the agent achieved. */
  taskMeta?: string
}

// ─── )( layout — symmetric parabola per side ───
// Both sides share the same five Y rows (32 / 40 / 47 / 55 / 63),
// and inset values mirror across the vertical centre at row 47%.
// Top + bottom rows sit at the gutter edge (inset −25, 25px of
// off-screen bleed); the middle row pulls deepest toward the
// centre at +50; the off-middle rows at +20.
//
//          inset:    LEFT side  (origin: viewport-left)
//           −25  ┃────[card 32%]                                  ◀ edge
//           +20  ┃        [card 40%]
//           +50  ┃              [card 47%]                          ◀ deepest
//           +20  ┃        [card 55%]
//           −25  ┃────[card 63%]                                  ◀ edge
//
// The right side is the mirror image, so the two columns together
// read as a `)(` parenthesis pair embracing the headline column.
const SHOTS: Shot[] = [
  // ── LEFT gutter — "(" half ──
  {
    src: "/hero-tasks/writer.png", alt: "Coasty agent drafting a document",
    top: "32%", side: "left", inset: -25, layer: "back",
    triggerSection: "pricing", videoSrc: "/hero-tasks/writer.mp4",
    appLabel: "LibreOffice Writer",
    taskLabel: "Drafting a long-form document",
    taskMeta: "H₂O — Soak Up The Science layout",
  },
  {
    src: "/hero-tasks/vscode.png", alt: "Coasty agent writing Python in VS Code",
    top: "40%", side: "left", inset: 20, layer: "front",
    triggerSection: "benchmark", videoSrc: "/hero-tasks/vscode.mp4",
    appLabel: "VS Code",
    taskLabel: "Writing & running Python",
    taskMeta: "Bubble-sort implementation, tested live",
  },
  {
    src: "/hero-tasks/os.png", alt: "Coasty agent in a desktop terminal",
    top: "47%", side: "left", inset: 50, layer: "front",
  },
  {
    src: "/hero-tasks/multi-apps.png", alt: "Coasty agent running code while reading",
    top: "55%", side: "left", inset: 20, layer: "back",
    triggerSection: "features", videoSrc: "/hero-tasks/multi-apps.mp4",
    appLabel: "Multi-window flow",
    taskLabel: "Running code while reading docs",
    taskMeta: "Editor + terminal + reference, side by side",
  },
  {
    src: "/hero-tasks/gimp.png", alt: "Coasty agent editing a portrait in GIMP",
    top: "63%", side: "left", inset: -25, layer: "front",
  },

  // ── RIGHT gutter — ")" half (same Y rows as left, mirror insets) ──
  {
    src: "/hero-tasks/impress.png", alt: "Coasty agent restyling slides in Impress",
    top: "32%", side: "right", inset: -25, layer: "back",
    triggerSection: "demo", videoSrc: "/hero-tasks/impress.mp4",
    appLabel: "LibreOffice Impress",
    taskLabel: "Restyling presentation slides",
    taskMeta: "Layout, typography, palette in one pass",
  },
  {
    src: "/hero-tasks/writer-2.png", alt: "Coasty agent shaping document layout",
    top: "40%", side: "right", inset: 20, layer: "front",
  },
  {
    src: "/hero-tasks/gimp-2.png", alt: "Coasty agent reshaping imagery in GIMP",
    top: "47%", side: "right", inset: 50, layer: "front",
  },
  {
    src: "/hero-tasks/thunderbird.png", alt: "Coasty agent in Thunderbird mail",
    top: "55%", side: "right", inset: 20, layer: "back",
    triggerSection: "cost", videoSrc: "/hero-tasks/thunderbird.mp4",
    appLabel: "Thunderbird",
    taskLabel: "Configuring an email account",
    taskMeta: "IMAP, folder sync, signature — end to end",
  },
  {
    src: "/hero-tasks/vlc.png", alt: "Coasty agent navigating VLC preferences",
    top: "63%", side: "right", inset: -25, layer: "front",
    triggerSection: "why-coasty", videoSrc: "/hero-tasks/vlc.mp4",
    appLabel: "VLC",
    taskLabel: "Navigating Advanced preferences",
    taskMeta: "Adapts to a deeply nested settings tree",
  },
]

interface HeroTaskShotsProps {
  isMobile: boolean
  /** which section is currently in view — drives the featured-card
   *  swap. `null` (or "hero") means no card is featured; all live
   *  in their gutter positions. */
  currentSection?: TriggerSection | "hero" | null
  /** Gates the entire overlay — when false (hero still in view) the
   *  cards aren't mounted, so the hero stage stays clean. When it
   *  flips true (user has scrolled past hero), cards mount and run
   *  their pan-in cascade from the gutter edges. */
  visible?: boolean
}

export function HeroTaskShots({ isMobile, currentSection, visible = true }: HeroTaskShotsProps) {
  if (isMobile) return null
  if (!visible) return null

  const featuredIndex = SHOTS.findIndex(
    (s) => s.triggerSection && s.triggerSection === currentSection,
  )
  const isAnyFeatured = featuredIndex >= 0

  return (
    <div
      aria-hidden="true"
      // z-40 sits above section content (z-10 inside section-shell)
      // and the floating section rail (z-30), but below the header
      // (z-50) and announcement banner (z-[60]) so global nav still
      // wins. Wrapper is pointer-events-none so clicks pass through
      // to section content; individual cards re-enable pointer-events
      // for hover.
      className="pointer-events-none fixed inset-0 z-40 hidden mac:block"
    >
      {SHOTS.map((s, i) => {
        const isFeatured = i === featuredIndex
        const isFront = s.layer === "front"
        const sideStyle =
          s.side === "left" ? { left: s.inset } : { right: s.inset }
        // Top-to-bottom hero entrance wave — single coordinated motion.
        const topPct = parseFloat(s.top) / 100
        const initialDelay = 0.22 + topPct * 0.42
        return (
          <ShotCard
            key={s.src}
            shot={s}
            isFeatured={isFeatured}
            isAnyFeatured={isAnyFeatured}
            isFront={isFront}
            sideStyle={sideStyle}
            initialDelay={initialDelay}
          />
        )
      })}
    </div>
  )
}

// ─── Per-card component ───
interface ShotCardProps {
  shot: Shot
  isFeatured: boolean
  /** True if any card on the page is currently featured. Drives
   *  focus-mode dimming for non-featured cards. */
  isAnyFeatured: boolean
  isFront: boolean
  sideStyle: { left: number } | { right: number }
  initialDelay: number
}

function ShotCard({
  shot,
  isFeatured,
  isAnyFeatured,
  isFront,
  sideStyle,
  initialDelay,
}: ShotCardProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)

  // Make sure the video plays from the start every time it becomes
  // featured AND that it stays at our chosen playback rate across
  // the entire lifecycle. Listeners cover:
  //   - loadedmetadata: Chrome / WebKit reset rate to 1.0 the moment
  //     they finish parsing metadata, even if it was set earlier.
  //   - play: fires on initial play AND on every native loop seek-
  //     to-zero, so rate persists across loops.
  //   - ratechange: belt-and-braces guard if a browser flips it.
  useEffect(() => {
    if (!isFeatured) return
    const v = videoRef.current
    if (!v) return

    const applyRate = () => {
      if (v.playbackRate !== PLAYBACK_RATE) v.playbackRate = PLAYBACK_RATE
    }
    v.addEventListener("loadedmetadata", applyRate)
    v.addEventListener("play", applyRate)
    v.addEventListener("ratechange", applyRate)

    v.currentTime = 0
    v.playbackRate = PLAYBACK_RATE
    v.play().catch(() => {})

    return () => {
      v.removeEventListener("loadedmetadata", applyRate)
      v.removeEventListener("play", applyRate)
      v.removeEventListener("ratechange", applyRate)
      v.pause()
    }
  }, [isFeatured])

  // Compute target position / size for the current state.
  // Featured cards stay on their own side — no cross-viewport hop.
  const featuredTop =
    (shot.triggerSection && FEATURED_TOP_BY_SECTION[shot.triggerSection]) ||
    FEATURED_TOP

  const target = isFeatured
    ? shot.side === "left"
      ? {
          left: FEATURED_INSET,
          right: undefined,
          top: featuredTop,
          width: FEATURED_W,
          height: FEATURED_H,
        }
      : {
          right: FEATURED_INSET,
          left: undefined,
          top: featuredTop,
          width: FEATURED_W,
          height: FEATURED_H,
        }
    : {
        ...sideStyle,
        top: shot.top,
        width: CARD_W,
        height: CARD_H,
      }

  // Focus mode — when ANY card is featured, the others fade back
  // to a quiet, desaturated, slightly-shrunken state. Preserves
  // their `)(` spatial anchor without competing for attention.
  const inFocusBackground = isAnyFeatured && !isFeatured

  // Focus-mode dim drops to 0.10 (was 0.18) — low enough that any
  // visual overlap with the reflowed section content reads as a
  // ghosted background, not as competing chrome. Section content
  // legibility is the priority once any card is featured.
  const targetOpacity = isFeatured
    ? 1
    : inFocusBackground
      ? 0.1
      : isFront
        ? 0.96
        : 0.74

  // Pan-in entrance — card slides in horizontally from its own gutter
  // (left cards drift in from the left edge, right cards from the
  // right) instead of fading up. Combined with the top-down delay
  // cascade, the overall reveal reads as the gutters "filling in"
  // once the user clears the hero.
  const panFromX = shot.side === "left" ? -80 : 80

  return (
    <motion.div
      initial={{ opacity: 0, x: panFromX }}
      animate={{
        opacity: targetOpacity,
        x: 0,
        scale: inFocusBackground ? 0.94 : 1,
        filter: inFocusBackground ? "saturate(0.6)" : "saturate(1)",
        ...target,
      }}
      transition={{
        // Initial mount — top-down wave with the entrance ease.
        opacity: { duration: 0.85, delay: initialDelay, ease: [0.22, 1, 0.36, 1] },
        x: { duration: 0.9, delay: initialDelay, ease: [0.22, 1, 0.36, 1] },
        // Featured swap — quint ease-out, ~550ms. Short enough to
        // feel responsive, long enough to read as deliberate.
        // Non-featured cards lag the featured by ~80ms so the
        // active reveal "leads" the focus dim.
        scale: { duration: 0.55, delay: isFeatured ? 0 : 0.08, ease: EASE },
        filter: { duration: 0.55, delay: isFeatured ? 0 : 0.08, ease: EASE },
        top: { duration: 0.55, ease: EASE },
        left: { duration: 0.55, ease: EASE },
        right: { duration: 0.55, ease: EASE },
        width: { duration: 0.55, ease: EASE },
        height: { duration: 0.55, ease: EASE },
      }}
      className={cn(
        "absolute group pointer-events-auto",
        // Hover lift only for gutter cards in the unfocused page state
        !isAnyFeatured && "transition-[opacity] duration-300 hover:opacity-100",
      )}
      style={{
        // z-index — featured tile lifts above everything else
        // (sections + gutter cards). Front cards in their gutter
        // state still sit above back cards via z:2 vs z:1.
        zIndex: isFeatured ? 60 : isFront ? 2 : 1,
        willChange: "transform, opacity, filter, top, left, right, width, height",
      }}
    >
      <div
        className={cn(
          "relative overflow-hidden rounded-[8px] w-full h-full",
          "ring-1 ring-foreground/10 dark:ring-white/10",
          "bg-neutral-900",
          "transition-[box-shadow] duration-500",
          // Featured card gets a deep single-stop drop shadow
          // (per A-tier pattern: never multi-layer, never sharp).
          isFeatured
            ? "shadow-[0_28px_70px_-24px_rgba(0,0,0,0.45)] dark:shadow-[0_32px_80px_-24px_rgba(0,0,0,0.75)]"
            : isFront
              ? "shadow-[0_14px_34px_-14px_rgba(0,0,0,0.5),0_2px_8px_-3px_rgba(0,0,0,0.25)] dark:shadow-[0_16px_38px_-14px_rgba(0,0,0,0.75),0_2px_10px_-3px_rgba(0,0,0,0.45)] group-hover:shadow-[0_22px_46px_-16px_rgba(0,0,0,0.6),0_3px_10px_-3px_rgba(0,0,0,0.3)]"
              : "shadow-[0_8px_22px_-14px_rgba(0,0,0,0.35)] dark:shadow-[0_10px_26px_-14px_rgba(0,0,0,0.55)]",
        )}
      >
        {/* Static screenshot — always rendered. Fades behind the
            video when the card is featured, so the swap reads as
            a smooth dissolve rather than a hard cut. */}
        <NextImage
          src={shot.src}
          alt={shot.alt}
          fill
          draggable={false}
          quality={75}
          sizes={isFeatured ? `${FEATURED_W}px` : `${CARD_W}px`}
          className="object-cover select-none"
        />
        {/* Video layer — mounted only while featured + only when
            this card has a videoSrc. preload="none" + muted +
            playsInline keeps mobile/iOS happy and avoids any
            buffering work until the user actually scrolls into
            the trigger section. */}
        <AnimatePresence>
          {isFeatured && shot.videoSrc && (
            <motion.video
              key={shot.videoSrc}
              ref={videoRef}
              src={shot.videoSrc}
              muted
              loop
              playsInline
              preload="none"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.45, ease: EASE }}
              className="absolute inset-0 w-full h-full object-cover"
            />
          )}
        </AnimatePresence>
        {/* Faint inner top-edge highlight — the "glass print" cue. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-[8px] [box-shadow:inset_0_1px_0_0_rgba(255,255,255,0.05)]"
        />
      </div>

      {/* ─── Caption (featured-only, outside the frame) ───
          Three-tier editorial layout, mounted under the card:
            1. Mono-caps eyebrow: live-pulse dot · APP NAME — tells
               the reader at a glance which tool the agent is in.
            2. Task title (Sans, medium weight) — what the agent
               is doing right now.
            3. Sub-meta (Sans, light, lower opacity, smaller) —
               specific context: what gets produced, what's tricky.
          Aligned to the card's OUTER edge so the captions sit in
          the gutter, not overlapping the section content. */}
      <AnimatePresence>
        {isFeatured && shot.taskLabel && (
          <motion.div
            key={`${shot.src}-label`}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -2 }}
            transition={{ delay: 0.32, duration: 0.4, ease: EASE }}
            className={cn(
              "absolute pt-3.5 max-w-[420px]",
              shot.side === "left"
                ? "left-1 right-auto text-left"
                : "right-1 left-auto text-right",
            )}
            style={{ top: "100%" }}
          >
            {/* Eyebrow — mono caps with live pulse + app chip */}
            <div
              className={cn(
                "font-mono text-[10px] uppercase tracking-[0.22em] text-foreground/55 dark:text-white/65",
                "flex items-center gap-2 mb-2",
                shot.side === "right" && "flex-row-reverse",
              )}
            >
              <LivePulseDot />
              <span>Live task</span>
              {shot.appLabel && (
                <>
                  <span aria-hidden="true" className="text-foreground/25 dark:text-white/30">·</span>
                  <span className="text-foreground/65 dark:text-white/75">{shot.appLabel}</span>
                </>
              )}
            </div>

            {/* Task title — the headline of the caption */}
            <div className="text-[14px] leading-tight text-foreground/90 dark:text-white/95 font-medium tracking-[-0.005em]">
              {shot.taskLabel}
            </div>

            {/* Task meta — quieter line describing what's notable */}
            {shot.taskMeta && (
              <div className="mt-1 text-[12px] leading-snug font-light text-foreground/55 dark:text-white/55 tracking-[-0.002em]">
                {shot.taskMeta}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ─── Live-pulse dot ───
// Two stacked spans — outer ping animation, inner solid disk.
// Tiny, restrained, signals "now playing" without screaming.
function LivePulseDot() {
  return (
    <span className="relative flex h-1.5 w-1.5">
      <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400/55 animate-ping"></span>
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400/85"></span>
    </span>
  )
}

// ─── Public helper: which gutter is the featured card in? ───
// landing-page uses this to reflow the section content so it
// doesn't sit underneath the floating card. Returns null when
// no card is featured (hero / between trigger sections / footer).
export function getFeaturedSide(
  section: TriggerSection | "hero" | null | undefined,
): "left" | "right" | null {
  if (!section || section === "hero") return null
  const card = SHOTS.find((s) => s.triggerSection === section)
  return card?.side ?? null
}

// ─── Public reserve constants for landing-page section reflow ───
//
// The featured-side reserve is the padding the section content
// needs on the side where the active 420px featured card lives,
// so they don't overlap. Combines:
//   FEATURED_INSET (80px gutter)  +  FEATURED_W (420px card)
//   −  small overlap budget (~60px allowed visual gap to card)
// = ~440px.
export const FEATURED_RESERVE = FEATURED_INSET + FEATURED_W - 60 // 440
//
// The opposite-side reserve is what's needed on the OTHER side
// — the side without the featured card but still hosting the
// dim gutter cards in their `)(` arrangement. Without this,
// section content would slide right past the dim cards on resize.
// The deepest gutter inset is +50, the gutter card width is
// CARD_W (200), and we add ~30px breathing room so the section
// edge sits clear of the dim card silhouettes.
//
//   max gutter inset (50)  +  CARD_W (200)  −  60 overlap budget
//   ≈ ~190px
//
// 60 is the same overlap budget used on the featured side, so
// the two reserves are derived consistently and you can change
// the budget in one place.
export const FEATURED_RESERVE_OPPOSITE = 50 + CARD_W - 60 // 190
