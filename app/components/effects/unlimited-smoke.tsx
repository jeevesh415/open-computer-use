"use client"

/**
 * UnlimitedSmoke — cinematic-dark aurora behind Unlimited-plan surfaces.
 * Three deep-saturated blobs (warm gold + wine + midnight) drift very
 * slowly using the `unlimited-drift-{1,2,3}` keyframes in app/globals.css.
 *
 * Palette rationale: classic cinematic-luxury triad — deep amber-700 reads
 * as candlelit gold, rose-900 brings dramatic wine warmth, indigo-900
 * grounds the cool side.  Saturated low-luminance colors over the card
 * background read like a Vermeer painting under moody lighting, not a
 * neon dashboard.  Movement is almost contemplative (20-25px translate
 * over 60-80 second cycles) so the surface feels alive but never busy.
 *
 * Usage: drop as the FIRST child of a container that has BOTH
 *   `relative overflow-hidden isolate`
 * Any sibling content needs `relative` to render above the smoke.
 *
 *   <div className="relative overflow-hidden isolate rounded-xl ...">
 *     <UnlimitedSmoke variant="stat" />
 *     <div className="relative ...">my content</div>
 *   </div>
 *
 * Variants tuned for different card footprints — blob sizes and
 * positions scale to keep the motion visible at each surface size.
 */

import { cn } from "@/lib/utils"

type Variant = "stat" | "hero" | "card" | "wide"

interface Blob {
  /** Position + size + color + blur + animation, in one place per blob. */
  className: string
}

// ─── Palette (cinematic dark — burnt bronze / oxblood / deep teal) ──────
// Classic teal-and-orange film grading: warm anchors (gold + oxblood)
// against a cool teal counterpoint instead of indigo, which read as
// purple on the new dark-pocket banner.  Very-deep low-luminance hues.
// Combined with the keyframe opacity (oscillates 0.45 → 0.72), effective
// rendered opacity peaks around 18-25% — moody atmosphere, never glow.
const GOLD     = "bg-amber-800/45"     // burnt bronze warm anchor
const WINE     = "bg-rose-950/45"      // oxblood deep red bridge
const OCEAN    = "bg-teal-950/55"      // deep teal cool counterpoint

const VARIANTS: Record<Variant, Blob[]> = {
  // Compact stat card — three corner-anchored blobs, all visible.
  stat: [
    {
      className: cn(
        "-top-[40%] -left-[20%] w-[140%] h-[180%] blur-3xl",
        GOLD,
        "animate-unlimited-drift-1",
      ),
    },
    {
      className: cn(
        "-bottom-[40%] -right-[20%] w-[130%] h-[170%] blur-3xl",
        WINE,
        "animate-unlimited-drift-2",
      ),
    },
    {
      className: cn(
        "top-[20%] left-[30%] w-[80%] h-[80%] blur-3xl",
        OCEAN,
        "animate-unlimited-drift-3",
      ),
    },
  ],

  // Hero (wide settings card) — three horizontal blobs.
  hero: [
    {
      className: cn(
        "-top-[60%] -left-[10%] w-[55%] h-[260%] blur-3xl",
        GOLD,
        "animate-unlimited-drift-1",
      ),
    },
    {
      className: cn(
        "-top-[40%] left-[35%] w-[45%] h-[240%] blur-3xl",
        WINE,
        "animate-unlimited-drift-3",
      ),
    },
    {
      className: cn(
        "-bottom-[60%] -right-[10%] w-[55%] h-[260%] blur-3xl",
        OCEAN,
        "animate-unlimited-drift-2",
      ),
    },
  ],

  // Landing pricing card (tall column).
  card: [
    {
      className: cn(
        "-top-[10%] -left-[20%] w-[90%] h-[60%] blur-3xl",
        GOLD,
        "animate-unlimited-drift-1",
      ),
    },
    {
      className: cn(
        "top-[35%] left-[20%] w-[80%] h-[50%] blur-3xl",
        WINE,
        "animate-unlimited-drift-3",
      ),
    },
    {
      className: cn(
        "-bottom-[10%] -right-[20%] w-[90%] h-[60%] blur-3xl",
        OCEAN,
        "animate-unlimited-drift-2",
      ),
    },
  ],

  // /pricing main card (wide).
  wide: [
    {
      className: cn(
        "-top-[20%] -left-[5%] w-[55%] h-[140%] blur-3xl",
        GOLD,
        "animate-unlimited-drift-1",
      ),
    },
    {
      className: cn(
        "top-[10%] left-[35%] w-[45%] h-[120%] blur-3xl",
        WINE,
        "animate-unlimited-drift-3",
      ),
    },
    {
      className: cn(
        "-bottom-[20%] -right-[5%] w-[55%] h-[140%] blur-3xl",
        OCEAN,
        "animate-unlimited-drift-2",
      ),
    },
  ],
}

export function UnlimitedSmoke({ variant = "stat" }: { variant?: Variant }) {
  const blobs = VARIANTS[variant]
  return (
    <div
      aria-hidden
      // `rounded-[inherit]` makes the wrapper pick up the parent's
      // border-radius so blobs are clipped to the card's rounded shape
      // instead of leaking into the corners as visible color bands.
      className="absolute inset-0 pointer-events-none overflow-hidden rounded-[inherit]"
    >
      {blobs.map((blob, i) => (
        <div key={i} className={cn("absolute rounded-full", blob.className)} />
      ))}
    </div>
  )
}
