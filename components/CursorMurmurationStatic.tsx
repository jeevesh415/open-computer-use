"use client"

/**
 * Cursor murmuration — static SVG fallback for mobile and reduced-motion.
 *
 * Renders OS-pointer arrows in a single inline SVG, deterministically laid
 * out with a stratified jitter so the layout looks designed rather than
 * random. Per-cursor rotation is sampled from a smooth curl-flow field so
 * neighboring cursors lean in similar directions — a frozen moment of the
 * murmuration the WebGL version animates.
 *
 * Layout adapts to viewport aspect: a tight landscape composition for
 * desktops in reduced-motion mode, and a taller, looser portrait layout
 * with stronger size hierarchy for phones — a compressed landscape grid
 * looks cramped behind the radial mask on narrow viewports.
 *
 * Zero JS runtime cost after mount. No layout thrash. No three.js.
 */

import { useEffect, useMemo, useState } from "react"

// Centered cursor path — bbox center moved to origin so SVG `rotate(deg)`
// pivots around the cursor's visual center rather than its top-left corner.
const CURSOR_PATH =
  "M -6.08 -9.75 L -6.08 7.84 L -1.92 4.36 L 0.47 9.75 L 2.78 8.70 L 0.35 3.38 L 6.08 3.10 Z"

// Default tip points NW (SVG-CW angle 238° from +X). Applying SVG rotate(α)
// moves it to angle (238 + α) mod 360. We want tip ≡ flow direction, so
// α = ψ_flow_svg − 238° = 122° − θ_math_deg.
const TIP_OFFSET_DEG = 122

// Mulberry32 — small, fast, deterministic PRNG. Seeded so SSR and CSR
// produce identical markup, no hydration mismatch, no first-paint flash.
function mulberry32(seed: number): () => number {
  let s = seed
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface StaticCursor {
  x: number
  y: number
  rotationDeg: number
  scale: number
  opacity: number
  haloOpacity: number
}

interface Layout {
  cursors: StaticCursor[]
  viewBoxW: number
  viewBoxH: number
}

function generateLandscapeLayout(): Layout {
  const VIEWBOX_W = 1600
  const VIEWBOX_H = 900
  const rng = mulberry32(0xc045)

  const flowAt = (x: number, y: number): number => {
    const xn = x / VIEWBOX_W
    const yn = y / VIEWBOX_H
    return (
      0.42 +
      Math.sin(xn * 2.6 + yn * 1.4) * 0.45 +
      Math.cos(yn * 3.1 - xn * 1.7) * 0.28
    )
  }

  const cursors: StaticCursor[] = []
  const COLS = 12
  const ROWS = 9
  const CLUSTER_CX = VIEWBOX_W * 0.5
  const CLUSTER_CY = VIEWBOX_H * 0.55
  const CLUSTER_HALF_W = VIEWBOX_W * 0.18
  const CLUSTER_HALF_H = VIEWBOX_H * 0.2
  const cellW = (CLUSTER_HALF_W * 2) / COLS
  const cellH = (CLUSTER_HALF_H * 2) / ROWS
  for (let i = 0; i < COLS * ROWS; i++) {
    const col = i % COLS
    const row = Math.floor(i / COLS)
    const x = CLUSTER_CX - CLUSTER_HALF_W + col * cellW + (0.15 + rng() * 0.7) * cellW
    const y = CLUSTER_CY - CLUSTER_HALF_H + row * cellH + (0.15 + rng() * 0.7) * cellH

    const flow = flowAt(x, y)
    const jitter = (rng() - 0.5) * 0.3
    const angleMath = flow + jitter
    const rotationDeg = TIP_OFFSET_DEG - (angleMath * 180) / Math.PI

    const z = rng()
    const scale = 0.7 + z * 0.85
    const opacity = 0.22 + z * 0.62
    const haloOpacity = 0.18 + z * 0.22

    cursors.push({ x, y, rotationDeg, scale, opacity, haloOpacity })
  }

  const leaderAngle = flowAt(CLUSTER_CX, CLUSTER_CY)
  const leaderDx = Math.cos(leaderAngle) * CLUSTER_HALF_W * 0.9
  const leaderDy = Math.sin(leaderAngle) * CLUSTER_HALF_H * 0.9
  const leaders = [
    { x: CLUSTER_CX + leaderDx * 0.85, y: CLUSTER_CY - leaderDy * 0.85 },
    { x: CLUSTER_CX + leaderDx, y: CLUSTER_CY - leaderDy + cellH * 0.6 },
  ]
  for (const l of leaders) {
    const angleMath = flowAt(l.x, l.y)
    cursors.push({
      x: l.x,
      y: l.y,
      rotationDeg: TIP_OFFSET_DEG - (angleMath * 180) / Math.PI,
      scale: 1.85,
      opacity: 0.92,
      haloOpacity: 0.4,
    })
  }

  return { cursors, viewBoxW: VIEWBOX_W, viewBoxH: VIEWBOX_H }
}

// Portrait layout — designed for phones in portrait orientation. The
// landscape grid gets brutally cropped horizontally by `xMidYMid slice`
// on tall viewports, so we use a portrait viewBox and a sparse, hand-
// composed arrangement: three big "hero" pointers anchor the eye, a few
// mid pointers add depth, and a small scattering of background pointers
// adds texture without crowding. Total ≈ 16 cursors — the flock reads as
// a deliberate constellation, not a smear.
function generatePortraitLayout(): Layout {
  const VIEWBOX_W = 900
  const VIEWBOX_H = 1600
  const rng = mulberry32(0x9e37)

  const flowAt = (x: number, y: number): number => {
    const xn = x / VIEWBOX_W
    const yn = y / VIEWBOX_H
    return (
      0.55 +
      Math.sin(yn * 2.4 + xn * 1.2) * 0.4 +
      Math.cos(xn * 2.8 - yn * 1.6) * 0.3
    )
  }

  const cursors: StaticCursor[] = []

  // Hand-placed cursors with explicit sizes. Order is back-to-front: small
  // background first, then mid, then heroes — so the heroes' halos overlap
  // smaller pointers rather than the other way around. Positions are tuned
  // by eye, not derived, because at this count algorithmic placement looks
  // worse than a thoughtful arrangement.
  const placed: Array<{
    x: number
    y: number
    scale: number
    opacity: number
    haloOpacity: number
  }> = [
    // Background — sparse texture, kept clear of the optical center
    { x: 0.18, y: 0.28, scale: 0.55, opacity: 0.32, haloOpacity: 0.16 },
    { x: 0.82, y: 0.32, scale: 0.5, opacity: 0.28, haloOpacity: 0.14 },
    { x: 0.12, y: 0.58, scale: 0.6, opacity: 0.36, haloOpacity: 0.18 },
    { x: 0.88, y: 0.62, scale: 0.55, opacity: 0.32, haloOpacity: 0.16 },
    { x: 0.24, y: 0.74, scale: 0.5, opacity: 0.28, haloOpacity: 0.14 },
    { x: 0.76, y: 0.78, scale: 0.58, opacity: 0.34, haloOpacity: 0.17 },
    // Mid — depth around the heroes
    { x: 0.36, y: 0.4, scale: 0.95, opacity: 0.6, haloOpacity: 0.26 },
    { x: 0.64, y: 0.36, scale: 1.05, opacity: 0.65, haloOpacity: 0.28 },
    { x: 0.32, y: 0.58, scale: 1.0, opacity: 0.62, haloOpacity: 0.27 },
    { x: 0.68, y: 0.62, scale: 1.1, opacity: 0.68, haloOpacity: 0.3 },
    { x: 0.5, y: 0.7, scale: 0.9, opacity: 0.55, haloOpacity: 0.24 },
    // Heroes — three deliberate anchors along a downward-right diagonal
    { x: 0.3, y: 0.32, scale: 1.7, opacity: 0.9, haloOpacity: 0.4 },
    { x: 0.54, y: 0.48, scale: 2.2, opacity: 0.95, haloOpacity: 0.45 },
    { x: 0.7, y: 0.66, scale: 1.55, opacity: 0.88, haloOpacity: 0.38 },
  ]

  for (const p of placed) {
    const x = p.x * VIEWBOX_W
    const y = p.y * VIEWBOX_H
    const angleMath = flowAt(x, y) + (rng() - 0.5) * 0.18
    const rotationDeg = TIP_OFFSET_DEG - (angleMath * 180) / Math.PI
    cursors.push({
      x,
      y,
      rotationDeg,
      scale: p.scale,
      opacity: p.opacity,
      haloOpacity: p.haloOpacity,
    })
  }

  return { cursors, viewBoxW: VIEWBOX_W, viewBoxH: VIEWBOX_H }
}

function pickLayout(): Layout {
  if (typeof window === "undefined") return generateLandscapeLayout()
  return window.innerHeight > window.innerWidth
    ? generatePortraitLayout()
    : generateLandscapeLayout()
}

export default function CursorMurmurationStatic() {
  // Start with landscape for SSR/first paint — matches the historical
  // markup so hydration is stable, then swap to portrait if needed once
  // we know the viewport. The swap happens before paint on most phones
  // because useEffect runs synchronously after mount.
  const [layout, setLayout] = useState<Layout>(() => generateLandscapeLayout())

  useEffect(() => {
    setLayout(pickLayout())
    // Re-evaluate on orientation/resize so a phone rotated to landscape
    // (or a desktop window narrowed below square) gets the right composition.
    const onResize = () => setLayout(pickLayout())
    window.addEventListener("resize", onResize, { passive: true })
    return () => window.removeEventListener("resize", onResize)
  }, [])

  const cursors = useMemo(() => layout.cursors, [layout])

  return (
    <svg
      className="absolute inset-0 h-full w-full"
      viewBox={`0 0 ${layout.viewBoxW} ${layout.viewBoxH}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      style={{ pointerEvents: "none" }}
    >
      {cursors.map((c, i) => (
        <g
          key={i}
          transform={`translate(${c.x.toFixed(2)} ${c.y.toFixed(
            2
          )}) rotate(${c.rotationDeg.toFixed(2)}) scale(${c.scale.toFixed(3)})`}
        >
          {/* Soft halo — same shape, slightly inflated, dark. Gives each
              cursor a rim that survives the invert filter and prevents
              overlapping cursors from merging into white blobs. */}
          <path
            d={CURSOR_PATH}
            fill="#000"
            opacity={c.haloOpacity}
            transform="scale(1.3)"
          />
          <path d={CURSOR_PATH} fill="#fff" opacity={c.opacity} />
        </g>
      ))}
    </svg>
  )
}
