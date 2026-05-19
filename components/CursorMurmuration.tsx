"use client"

/**
 * Cursor murmuration — entry component.
 *
 * Branches by device tier:
 *   • reduced-motion / mobile / no-hover / low-end → render nothing
 *   • desktop / tablet → WebGL flock, count tuned to GPU/CPU class
 *
 * The WebGL impl lives in a separate module that is dynamic-imported only
 * when needed, so three.js never enters the bundle on devices that won't
 * render it.
 */

import dynamic from "next/dynamic"
import { useEffect, useState } from "react"
import { useLiteMode } from "@/lib/hooks/use-lite-mode"

// No loading fallback: the WebGL flock spawns off-canvas and streams in,
// so a centered static composition shown during the dynamic import would
// flash a different layout right before the entry animation begins.
const CursorMurmurationFlock = dynamic(
  () => import("./CursorMurmurationFlock"),
  { ssr: false }
)

type Tier = "static" | "tablet" | "desktop"

function pickTier(): Tier {
  if (typeof window === "undefined") return "static"

  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches
  const noHover = window.matchMedia("(hover: none)").matches
  const narrow = window.innerWidth < 768

  if (reducedMotion || noHover || narrow) return "static"

  const nav = navigator as Navigator & {
    deviceMemory?: number
    connection?: { saveData?: boolean; effectiveType?: string }
  }
  const cores = nav.hardwareConcurrency ?? 8
  const memory = nav.deviceMemory ?? 8
  const saveData = nav.connection?.saveData === true
  const slowNet =
    nav.connection?.effectiveType === "2g" ||
    nav.connection?.effectiveType === "slow-2g"
  if (cores <= 4 || memory <= 4 || saveData || slowNet) return "static"

  // Tablet-class machines: trim the flock so the boids loop stays under 1ms
  // per frame on ARM laptops and older integrated GPUs.
  if (window.innerWidth < 1280) return "tablet"
  return "desktop"
}

export default function CursorMurmuration() {
  // SSR-safe: render nothing until we know the device tier. The page's
  // natural background fills in for the brief gap.
  const [tier, setTier] = useState<Tier | null>(null)
  // useLiteMode is also wired here so we react to runtime changes
  // (prefers-reduced-motion toggled, viewport resized across breakpoints).
  const lite = useLiteMode()

  useEffect(() => {
    setTier(pickTier())
    const onResize = () => setTier(pickTier())
    window.addEventListener("resize", onResize, { passive: true })
    return () => window.removeEventListener("resize", onResize)
    // lite is a derived signal — re-evaluating on its change keeps the tier
    // in sync when the user flips reduced-motion mid-session.
  }, [lite.lite, lite.reducedMotion, lite.mobile])

  if (tier === null) return null
  // Mobile / reduced-motion / low-end devices render nothing — no static
  // SVG fallback, no WebGL. The page's natural background carries those
  // surfaces; the cursor flock is a desktop-only flourish.
  if (tier === "static") return null

  // Minimal cursor presence — 5 on desktop, 3 on tablet. At this count
  // the boids no longer read as a flock; each cursor is a deliberate
  // editorial mark drifting through the scene. The quieter the better:
  // the cone of light + headline carry the hero, and a few cursors are
  // enough to suggest "computer agency" without any visual noise.
  const count = tier === "desktop" ? 5 : 3
  return <CursorMurmurationFlock count={count} />
}
