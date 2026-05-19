"use client"

import { cn } from "@/lib/utils"

// ─── GuideLines (vertical side rails) ──────────────────────────────
// Used by the rest of the app (api-docs, pricing, blog, etc.). The
// landing page intentionally does NOT render these any more, but the
// export is kept here so those other pages compile.

const FADE_MASK =
  "linear-gradient(to bottom, transparent 0%, #000 1.5%, #000 98.5%, transparent 100%)"

const OUTER_GRADIENT = `linear-gradient(to right,
  transparent 0%,
  color-mix(in srgb, var(--foreground) 4%, transparent) 28%,
  color-mix(in srgb, var(--foreground) 18%, transparent) 50%,
  color-mix(in srgb, var(--foreground) 4%, transparent) 72%,
  transparent 100%)`

export function GuideLines() {
  return (
    <div className="absolute inset-0 pointer-events-none z-[1]" aria-hidden="true">
      <div className="mx-auto h-full max-w-7xl px-4 sm:px-6 relative">
        <GuideRail side="left" />
        <GuideRail side="right" />
      </div>
    </div>
  )
}

function GuideRail({ side }: { side: "left" | "right" }) {
  const isLeft = side === "left"
  const outerOffset = isLeft ? "left-5 sm:left-6" : "right-5 sm:right-6"
  const innerOffset = isLeft ? "left-[24px] sm:left-[32px]" : "right-[24px] sm:right-[32px]"
  const haloShift = isLeft ? { marginLeft: -3 } : { marginRight: -3 }

  return (
    <>
      <div
        className={cn("absolute top-0 bottom-0", outerOffset)}
        style={{
          width: 7,
          background: OUTER_GRADIENT,
          maskImage: FADE_MASK,
          WebkitMaskImage: FADE_MASK,
          ...haloShift,
        }}
      />
      <div
        className={cn(
          "absolute top-0 bottom-0 w-px bg-foreground/[0.07] dark:bg-foreground/[0.05]",
          innerOffset
        )}
        style={{ maskImage: FADE_MASK, WebkitMaskImage: FADE_MASK }}
      />
    </>
  )
}

/**
 * Horizontal section divider — a single hairline that fades to nothing
 * at both edges.
 *
 * No diamonds, no cross-marks, no chrome. Just a thin beam of light
 * across the section break. The 5-stop horizontal gradient gives the
 * line a soft halo at its centre and dissolves to transparent before
 * touching the page edges, so the divider reads as atmospheric
 * punctuation rather than a ruled line.
 */
export function SectionDivider() {
  return (
    <div
      aria-hidden="true"
      className="mx-auto h-px w-full max-w-7xl"
      style={{
        background: `linear-gradient(to right,
          transparent 0%,
          color-mix(in srgb, var(--foreground) 4%, transparent) 22%,
          color-mix(in srgb, var(--foreground) 14%, transparent) 50%,
          color-mix(in srgb, var(--foreground) 4%, transparent) 78%,
          transparent 100%)`,
      }}
    />
  )
}
