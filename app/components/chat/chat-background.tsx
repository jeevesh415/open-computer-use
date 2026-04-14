"use client"

import { type ChatBackground } from "@/lib/user-preference-store/utils"
import { cn } from "@/lib/utils"
import { useId } from "react"
/* ─── Constellation: real-world constellations in a large non-repeating tile ─── */

type Star = { x: number; y: number; r: number }
type Constellation = { name: string; stars: Star[]; lines: [number, number][] }

const constellations: Constellation[] = [
  {
    // Orion — the hunter (center-left)
    name: "orion",
    stars: [
      { x: 130, y: 280, r: 2.8 }, // 0 Betelgeuse (bright shoulder)
      { x: 200, y: 288, r: 2.2 }, // 1 Bellatrix (shoulder)
      { x: 155, y: 340, r: 1.8 }, // 2 Belt: Alnitak
      { x: 170, y: 345, r: 1.8 }, // 3 Belt: Alnilam
      { x: 185, y: 350, r: 1.8 }, // 4 Belt: Mintaka
      { x: 205, y: 410, r: 2.6 }, // 5 Rigel (bright foot)
      { x: 140, y: 405, r: 2.0 }, // 6 Saiph (foot)
    ],
    lines: [[0,1],[0,2],[1,4],[2,3],[3,4],[2,6],[4,5]],
  },
  {
    // Ursa Major / Big Dipper (upper-right)
    name: "big-dipper",
    stars: [
      { x: 620, y: 110, r: 2.2 }, // 0 Dubhe
      { x: 625, y: 150, r: 2.0 }, // 1 Merak
      { x: 670, y: 158, r: 1.8 }, // 2 Phecda
      { x: 668, y: 125, r: 1.5 }, // 3 Megrez
      { x: 710, y: 118, r: 2.0 }, // 4 Alioth
      { x: 745, y: 108, r: 2.0 }, // 5 Mizar
      { x: 780, y: 92, r: 2.0 },  // 6 Alkaid
    ],
    lines: [[0,1],[1,2],[2,3],[3,0],[3,4],[4,5],[5,6]],
  },
  {
    // Cassiopeia — the W (upper-center-left)
    name: "cassiopeia",
    stars: [
      { x: 290, y: 75, r: 2.0 },  // 0 Caph
      { x: 330, y: 60, r: 2.2 },  // 1 Schedar
      { x: 360, y: 90, r: 2.0 },  // 2 Gamma
      { x: 395, y: 68, r: 1.8 },  // 3 Ruchbah
      { x: 425, y: 95, r: 1.8 },  // 4 Epsilon
    ],
    lines: [[0,1],[1,2],[2,3],[3,4]],
  },
  {
    // Cygnus — Northern Cross (right-center)
    name: "cygnus",
    stars: [
      { x: 720, y: 340, r: 2.5 }, // 0 Deneb (tail, bright)
      { x: 718, y: 395, r: 2.0 }, // 1 Sadr (center)
      { x: 715, y: 450, r: 2.0 }, // 2 Albireo (head)
      { x: 670, y: 385, r: 1.8 }, // 3 left wing (Gienah)
      { x: 765, y: 380, r: 1.8 }, // 4 right wing (Delta)
    ],
    lines: [[0,1],[1,2],[3,1],[1,4]],
  },
  {
    // Scorpius — curved tail (lower-center)
    name: "scorpius",
    stars: [
      { x: 420, y: 485, r: 2.6 }, // 0 Antares (bright)
      { x: 395, y: 455, r: 1.8 }, // 1 Dschubba
      { x: 378, y: 438, r: 1.8 }, // 2 Graffias
      { x: 445, y: 520, r: 1.5 }, // 3 Tail 1
      { x: 465, y: 555, r: 1.5 }, // 4 Tail 2
      { x: 458, y: 585, r: 1.5 }, // 5 Tail 3
      { x: 440, y: 605, r: 2.0 }, // 6 Shaula (stinger)
      { x: 425, y: 610, r: 1.6 }, // 7 Lesath (stinger 2)
    ],
    lines: [[2,1],[1,0],[0,3],[3,4],[4,5],[5,6],[6,7]],
  },
  {
    // Gemini — the twins (left area)
    name: "gemini",
    stars: [
      { x: 55, y: 120, r: 2.4 },  // 0 Castor
      { x: 70, y: 145, r: 2.4 },  // 1 Pollux
      { x: 50, y: 165, r: 1.5 },  // 2 Wasat
      { x: 35, y: 195, r: 1.5 },  // 3 Mebsuta
      { x: 75, y: 190, r: 1.5 },  // 4 Tejat
      { x: 60, y: 220, r: 1.6 },  // 5 Alhena
    ],
    lines: [[0,1],[0,3],[1,2],[2,5],[1,4],[4,5]],
  },
  {
    // Leo — the lion (lower-left)
    name: "leo",
    stars: [
      { x: 120, y: 560, r: 2.5 }, // 0 Regulus (bright)
      { x: 100, y: 530, r: 1.8 }, // 1 Eta
      { x: 85, y: 505, r: 1.8 },  // 2 Algieba
      { x: 110, y: 490, r: 1.6 }, // 3 Zosma
      { x: 145, y: 495, r: 1.5 }, // 4 Chertan
      { x: 180, y: 510, r: 2.2 }, // 5 Denebola (tail)
    ],
    lines: [[0,1],[1,2],[2,3],[3,4],[4,5],[3,1]],
  },
]

// Background field stars — faint scattered dots to fill the sky
const fieldStars: Star[] = [
  { x: 50, y: 40, r: 0.8 },   { x: 260, y: 140, r: 1.0 },
  { x: 480, y: 60, r: 0.9 },  { x: 550, y: 200, r: 1.1 },
  { x: 830, y: 170, r: 0.8 }, { x: 800, y: 280, r: 0.9 },
  { x: 500, y: 310, r: 1.0 }, { x: 310, y: 380, r: 0.8 },
  { x: 590, y: 430, r: 0.9 }, { x: 850, y: 480, r: 1.0 },
  { x: 270, y: 540, r: 0.8 }, { x: 650, y: 560, r: 0.9 },
  { x: 170, y: 650, r: 1.0 }, { x: 780, y: 620, r: 0.8 },
  { x: 380, y: 250, r: 0.7 }, { x: 530, y: 140, r: 0.9 },
  { x: 150, y: 370, r: 0.8 }, { x: 870, y: 55, r: 1.0 },
  { x: 15, y: 445, r: 0.7 },  { x: 490, y: 635, r: 0.8 },
  { x: 340, y: 195, r: 0.6 }, { x: 690, y: 240, r: 0.7 },
  { x: 240, y: 440, r: 0.9 }, { x: 570, y: 510, r: 0.7 },
]

function ConstellationBackground() {
  const id = useId()

  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
    >
      <defs>
        <pattern id={id} width={900} height={700} patternUnits="userSpaceOnUse">
          {/* Field stars — scattered background */}
          {fieldStars.map((s, i) => (
            <circle
              key={`f-${i}`}
              cx={s.x}
              cy={s.y}
              r={s.r}
              className="fill-foreground/[0.08] dark:fill-foreground/[0.15]"
            />
          ))}
          {/* Constellation lines */}
          {constellations.map((c) =>
            c.lines.map(([a, b], li) => (
              <line
                key={`${c.name}-l${li}`}
                x1={c.stars[a].x}
                y1={c.stars[a].y}
                x2={c.stars[b].x}
                y2={c.stars[b].y}
                className="stroke-foreground/[0.07] dark:stroke-foreground/[0.13]"
                strokeWidth={0.7}
              />
            ))
          )}
          {/* Constellation stars */}
          {constellations.map((c) =>
            c.stars.map((s, si) => (
              <circle
                key={`${c.name}-s${si}`}
                cx={s.x}
                cy={s.y}
                r={s.r}
                className={cn(
                  s.r >= 2.4
                    ? "fill-foreground/[0.2] dark:fill-foreground/[0.4]"
                    : s.r >= 2.0
                      ? "fill-foreground/[0.15] dark:fill-foreground/[0.3]"
                      : "fill-foreground/[0.1] dark:fill-foreground/[0.22]"
                )}
              />
            ))
          )}
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  )
}

/* ─── Dot Matrix: halftone wave with sinusoidal size modulation ─── */

// Pre-computed dot grid with wave-modulated radii for a halftone effect.
// Tuned for restraint: more air between dots, smaller max radius, gentler tonal range.
const DOT_COLS = 14
const DOT_ROWS = 14
const DOT_SPACING = 24
const TILE_W = DOT_COLS * DOT_SPACING
const TILE_H = DOT_ROWS * DOT_SPACING

type Dot = { cx: number; cy: number; r: number; tier: 0 | 1 | 2 }

const dotMatrixDots: Dot[] = (() => {
  const dots: Dot[] = []
  for (let row = 0; row < DOT_ROWS; row++) {
    for (let col = 0; col < DOT_COLS; col++) {
      const cx = col * DOT_SPACING + DOT_SPACING / 2
      const cy = row * DOT_SPACING + DOT_SPACING / 2
      // Two overlapping sine waves create an organic, flowing modulation
      const wave1 = Math.sin((col / DOT_COLS) * Math.PI * 2.5) * Math.cos((row / DOT_ROWS) * Math.PI * 2)
      const wave2 = Math.sin(((col + row) / (DOT_COLS + DOT_ROWS)) * Math.PI * 4) * 0.5
      const t = (wave1 + wave2) * 0.5 + 0.5 // normalize to 0–1
      // Smaller radius range — barely-there at the troughs, never punchy at the peaks
      const r = 0.5 + t * 1.6 // 0.5 → 2.1
      // Three discrete tiers so the wave reads as halftone, not noise
      const tier: 0 | 1 | 2 = t > 0.72 ? 2 : t > 0.4 ? 1 : 0
      dots.push({ cx, cy, r, tier })
    }
  }
  return dots
})()

function DotMatrixBackground() {
  const id = useId()
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
    >
      <defs>
        <pattern id={id} width={TILE_W} height={TILE_H} patternUnits="userSpaceOnUse">
          {dotMatrixDots.map((d, i) => (
            <circle
              key={i}
              cx={d.cx}
              cy={d.cy}
              r={d.r}
              className={
                d.tier === 2
                  ? "fill-foreground/[0.08] dark:fill-foreground/[0.13]"
                  : d.tier === 1
                    ? "fill-foreground/[0.05] dark:fill-foreground/[0.08]"
                    : "fill-foreground/[0.025] dark:fill-foreground/[0.04]"
              }
            />
          ))}
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  )
}

/* ─── Seigaiha: traditional Japanese concentric wave arcs ─── */

const SEIGAIHA_R = 36 // base radius of each scale unit
const SEIGAIHA_ARCS = 5 // concentric rings per unit

function SeigaihaUnit({ cx, cy, baseClass }: { cx: number; cy: number; baseClass: string }) {
  return (
    <g>
      {Array.from({ length: SEIGAIHA_ARCS }, (_, i) => {
        const r = SEIGAIHA_R * ((i + 1) / SEIGAIHA_ARCS)
        // Semicircle arc from left to right (top half)
        return (
          <path
            key={i}
            d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
            fill="none"
            className={baseClass}
            strokeWidth={i === SEIGAIHA_ARCS - 1 ? 0.8 : 0.5}
          />
        )
      })}
    </g>
  )
}

function SeigaihaBackground() {
  const id = useId()
  const w = SEIGAIHA_R * 2 // one full unit width
  const h = SEIGAIHA_R     // half-height offset per row

  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
    >
      <defs>
        <pattern id={id} width={w * 2} height={h * 2} patternUnits="userSpaceOnUse">
          {/* Row 1: two units side by side */}
          <SeigaihaUnit cx={0}     cy={h * 2} baseClass="stroke-foreground/[0.08] dark:stroke-foreground/[0.14]" />
          <SeigaihaUnit cx={w}     cy={h * 2} baseClass="stroke-foreground/[0.08] dark:stroke-foreground/[0.14]" />
          <SeigaihaUnit cx={w * 2} cy={h * 2} baseClass="stroke-foreground/[0.08] dark:stroke-foreground/[0.14]" />
          {/* Row 2: offset by half, staggered fish-scale */}
          <SeigaihaUnit cx={w * 0.5} cy={h} baseClass="stroke-foreground/[0.06] dark:stroke-foreground/[0.11]" />
          <SeigaihaUnit cx={w * 1.5} cy={h} baseClass="stroke-foreground/[0.06] dark:stroke-foreground/[0.11]" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  )
}

/* ─── Blueprint: technical drafting grid with construction marks ─── */

function BlueprintBackground() {
  const id = useId()
  const major = 80  // major grid cell
  const minor = 16  // sub-grid divisions (5 per major)
  const tile = major * 3 // 240px tile with crosshairs and dimension marks

  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
    >
      <defs>
        <pattern id={`${id}-minor`} width={minor} height={minor} patternUnits="userSpaceOnUse">
          <path
            d={`M ${minor} 0 L 0 0 0 ${minor}`}
            fill="none"
            className="stroke-foreground/[0.03] dark:stroke-foreground/[0.06]"
            strokeWidth={0.5}
          />
        </pattern>
        <pattern id={`${id}-major`} width={major} height={major} patternUnits="userSpaceOnUse">
          {/* Fill with sub-grid first */}
          <rect width={major} height={major} fill={`url(#${id}-minor)`} />
          {/* Major grid lines */}
          <path
            d={`M ${major} 0 L 0 0 0 ${major}`}
            fill="none"
            className="stroke-foreground/[0.07] dark:stroke-foreground/[0.12]"
            strokeWidth={0.7}
          />
        </pattern>
        <pattern id={id} width={tile} height={tile} patternUnits="userSpaceOnUse">
          {/* Base grid (minor + major combined) */}
          <rect width={tile} height={tile} fill={`url(#${id}-major)`} />

          {/* Crosshair markers at every major intersection */}
          {[0, 1, 2].map((row) =>
            [0, 1, 2].map((col) => {
              const cx = col * major
              const cy = row * major
              const arm = 4
              return (
                <g key={`cross-${row}-${col}`}>
                  <line x1={cx - arm} y1={cy} x2={cx + arm} y2={cy} className="stroke-foreground/[0.12] dark:stroke-foreground/[0.2]" strokeWidth={0.6} />
                  <line x1={cx} y1={cy - arm} x2={cx} y2={cy + arm} className="stroke-foreground/[0.12] dark:stroke-foreground/[0.2]" strokeWidth={0.6} />
                  <circle cx={cx} cy={cy} r={1.2} className="fill-foreground/[0.08] dark:fill-foreground/[0.14]" />
                </g>
              )
            })
          )}

          {/* Diagonal construction line — dashed, from corner to corner */}
          <line
            x1={0} y1={0} x2={tile} y2={tile}
            className="stroke-foreground/[0.04] dark:stroke-foreground/[0.07]"
            strokeWidth={0.5}
            strokeDasharray="6 10"
          />
          <line
            x1={tile} y1={0} x2={0} y2={tile}
            className="stroke-foreground/[0.03] dark:stroke-foreground/[0.05]"
            strokeWidth={0.5}
            strokeDasharray="4 14"
          />

          {/* Dimension tick marks along top edge */}
          {[0, 1, 2].map((i) => {
            const x = i * major
            return (
              <g key={`dim-top-${i}`}>
                <line x1={x} y1={0} x2={x} y2={5} className="stroke-foreground/[0.1] dark:stroke-foreground/[0.16]" strokeWidth={0.6} />
              </g>
            )
          })}
          {/* Dimension tick marks along left edge */}
          {[0, 1, 2].map((i) => {
            const y = i * major
            return (
              <g key={`dim-left-${i}`}>
                <line x1={0} y1={y} x2={5} y2={y} className="stroke-foreground/[0.1] dark:stroke-foreground/[0.16]" strokeWidth={0.6} />
              </g>
            )
          })}

          {/* Center reference circle — subtle construction mark */}
          <circle
            cx={tile / 2}
            cy={tile / 2}
            r={12}
            fill="none"
            className="stroke-foreground/[0.03] dark:stroke-foreground/[0.06]"
            strokeWidth={0.5}
            strokeDasharray="3 5"
          />
          <line
            x1={tile / 2 - 16} y1={tile / 2}
            x2={tile / 2 + 16} y2={tile / 2}
            className="stroke-foreground/[0.04] dark:stroke-foreground/[0.07]"
            strokeWidth={0.4}
            strokeDasharray="2 4"
          />
          <line
            x1={tile / 2} y1={tile / 2 - 16}
            x2={tile / 2} y2={tile / 2 + 16}
            className="stroke-foreground/[0.04] dark:stroke-foreground/[0.07]"
            strokeWidth={0.4}
            strokeDasharray="2 4"
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  )
}

/* ─── Zellige: Moroccan 8-pointed star mosaic ─── */

const ZELLIGE_S = 80
const zelligeStar = (() => {
  const c = ZELLIGE_S / 2, R = c, r = c * 0.4
  const pts = Array.from({ length: 16 }, (_, i) => {
    const a = ((i * 22.5 - 90) * Math.PI) / 180
    const rad = i % 2 === 0 ? R : r
    return `${(c + rad * Math.cos(a)).toFixed(1)} ${(c + rad * Math.sin(a)).toFixed(1)}`
  })
  return `M ${pts.join(" L ")} Z`
})()
const zelligeInnerOctagon = (() => {
  const c = ZELLIGE_S / 2, r = c * 0.4
  const pts = Array.from({ length: 8 }, (_, i) => {
    const a = ((i * 45 + 22.5 - 90) * Math.PI) / 180
    return `${(c + r * Math.cos(a)).toFixed(1)} ${(c + r * Math.sin(a)).toFixed(1)}`
  })
  return `M ${pts.join(" L ")} Z`
})()

function ZelligeBackground() {
  const id = useId()
  return (
    <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full">
      <defs>
        <pattern id={id} width={ZELLIGE_S} height={ZELLIGE_S} patternUnits="userSpaceOnUse">
          <path d={zelligeStar} fill="none"
            className="stroke-foreground/[0.1] dark:stroke-foreground/[0.16]" strokeWidth={0.7} />
          <path d={zelligeInnerOctagon} fill="none"
            className="stroke-foreground/[0.06] dark:stroke-foreground/[0.1]" strokeWidth={0.5} />
          <circle cx={ZELLIGE_S / 2} cy={ZELLIGE_S / 2} r={5} fill="none"
            className="stroke-foreground/[0.05] dark:stroke-foreground/[0.08]" strokeWidth={0.4} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  )
}

/* ─── Sashiko: Japanese hemp-leaf (asanoha) stitching ─── */

const SASHIKO_R = 20
const SASHIKO_W = Math.round(SASHIKO_R * Math.sqrt(3))
const SASHIKO_H = SASHIKO_R * 3

const sashikoLines = (() => {
  const R = SASHIKO_R, W = SASHIKO_W
  const centers: [number, number][] = [
    [0, 0], [W, 0], [W / 2, R * 1.5], [0, SASHIKO_H], [W, SASHIKO_H],
  ]
  const d: string[] = []
  for (const [cx, cy] of centers) {
    for (let i = 0; i < 6; i++) {
      const a1 = ((i * 60 - 90) * Math.PI) / 180
      const a2 = (((i + 1) * 60 - 90) * Math.PI) / 180
      const vx = cx + R * Math.cos(a1), vy = cy + R * Math.sin(a1)
      const nvx = cx + R * Math.cos(a2), nvy = cy + R * Math.sin(a2)
      d.push(`M${cx} ${cy}L${vx.toFixed(1)} ${vy.toFixed(1)}`)
      d.push(`M${cx} ${cy}L${((vx + nvx) / 2).toFixed(1)} ${((vy + nvy) / 2).toFixed(1)}`)
    }
  }
  return d.join(" ")
})()

const sashikoHexes = (() => {
  const R = SASHIKO_R, W = SASHIKO_W
  const centers: [number, number][] = [
    [0, 0], [W, 0], [W / 2, R * 1.5], [0, SASHIKO_H], [W, SASHIKO_H],
  ]
  const d: string[] = []
  for (const [cx, cy] of centers) {
    const pts = Array.from({ length: 6 }, (_, i) => {
      const a = ((i * 60 - 90) * Math.PI) / 180
      return `${(cx + R * Math.cos(a)).toFixed(1)} ${(cy + R * Math.sin(a)).toFixed(1)}`
    })
    d.push(`M ${pts.join(" L ")} Z`)
  }
  return d.join(" ")
})()

function SashikoBackground() {
  const id = useId()
  return (
    <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full">
      <defs>
        <pattern id={id} width={SASHIKO_W} height={SASHIKO_H} patternUnits="userSpaceOnUse">
          <path d={sashikoHexes} fill="none"
            className="stroke-foreground/[0.07] dark:stroke-foreground/[0.12]"
            strokeWidth={0.6} strokeDasharray="2.5 2" />
          <path d={sashikoLines} fill="none"
            className="stroke-foreground/[0.09] dark:stroke-foreground/[0.15]"
            strokeWidth={0.6} strokeDasharray="2.5 2" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  )
}

/* ─── Kolam: South Indian threshold art ─── */

function KolamBackground() {
  const id = useId()
  const S = 60
  const c = S / 2

  return (
    <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full">
      <defs>
        <pattern id={id} width={S} height={S} patternUnits="userSpaceOnUse">
          {/* Grid dots — rice flour anchor points */}
          <circle cx={c} cy={c} r={1.8} className="fill-foreground/[0.14] dark:fill-foreground/[0.22]" />
          <circle cx={0} cy={0} r={1.3} className="fill-foreground/[0.1] dark:fill-foreground/[0.16]" />
          <circle cx={S} cy={0} r={1.3} className="fill-foreground/[0.1] dark:fill-foreground/[0.16]" />
          <circle cx={0} cy={S} r={1.3} className="fill-foreground/[0.1] dark:fill-foreground/[0.16]" />
          <circle cx={S} cy={S} r={1.3} className="fill-foreground/[0.1] dark:fill-foreground/[0.16]" />
          {/* Flowing curves — four petals looping around the center dot */}
          <path d={`M 0 ${c} Q ${c * 0.35} ${c * 0.35} ${c} 0`} fill="none"
            className="stroke-foreground/[0.1] dark:stroke-foreground/[0.16]" strokeWidth={0.8} />
          <path d={`M ${c} 0 Q ${c * 1.65} ${c * 0.35} ${S} ${c}`} fill="none"
            className="stroke-foreground/[0.1] dark:stroke-foreground/[0.16]" strokeWidth={0.8} />
          <path d={`M ${S} ${c} Q ${c * 1.65} ${c * 1.65} ${c} ${S}`} fill="none"
            className="stroke-foreground/[0.1] dark:stroke-foreground/[0.16]" strokeWidth={0.8} />
          <path d={`M ${c} ${S} Q ${c * 0.35} ${c * 1.65} 0 ${c}`} fill="none"
            className="stroke-foreground/[0.1] dark:stroke-foreground/[0.16]" strokeWidth={0.8} />
          {/* Inner petal — small eye shape around center */}
          <path d={`M ${c - 12} ${c} Q ${c} ${c - 12} ${c + 12} ${c}`} fill="none"
            className="stroke-foreground/[0.06] dark:stroke-foreground/[0.1]" strokeWidth={0.5} />
          <path d={`M ${c + 12} ${c} Q ${c} ${c + 12} ${c - 12} ${c}`} fill="none"
            className="stroke-foreground/[0.06] dark:stroke-foreground/[0.1]" strokeWidth={0.5} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  )
}

/* ─── Celtic Knot: interlacing eternal bands ─── */

function CelticKnotBackground() {
  const id = useId()
  const S = 56
  const h = S / 2
  const g = 5

  return (
    <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full">
      <defs>
        <pattern id={id} width={S} height={S} patternUnits="userSpaceOnUse">
          {/* Over strand: sinuous S-curve TL → BR */}
          <path
            d={`M 0 0 C ${S * 0.4} ${S * 0.1}, ${S * 0.6} ${S * 0.9}, ${S} ${S}`}
            fill="none"
            className="stroke-foreground/[0.12] dark:stroke-foreground/[0.18]"
            strokeWidth={2.5} strokeLinecap="round"
          />
          {/* Under strand: TR → BL, split at crossing with gap */}
          <path
            d={`M ${S} 0 C ${S * 0.7} ${S * 0.15}, ${h + g * 1.5} ${h - g * 2}, ${h + g} ${h - g}`}
            fill="none"
            className="stroke-foreground/[0.08] dark:stroke-foreground/[0.13]"
            strokeWidth={2.5} strokeLinecap="round"
          />
          <path
            d={`M ${h - g} ${h + g} C ${h - g * 1.5} ${h + g * 2}, ${S * 0.3} ${S * 0.85}, 0 ${S}`}
            fill="none"
            className="stroke-foreground/[0.08] dark:stroke-foreground/[0.13]"
            strokeWidth={2.5} strokeLinecap="round"
          />
          {/* Subtle knot center mark */}
          <circle cx={h} cy={h} r={1} className="fill-foreground/[0.05] dark:fill-foreground/[0.08]" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  )
}

/* ─── Arabesque: Islamic geometric interlocking diamonds ─── */

function ArabesqueBackground() {
  const id = useId()
  const S = 80
  const c = S / 2

  return (
    <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full">
      <defs>
        <pattern id={id} width={S} height={S} patternUnits="userSpaceOnUse">
          {/* Outer diamond — connecting edge midpoints */}
          <path d={`M ${c} 0 L ${S} ${c} L ${c} ${S} L 0 ${c} Z`} fill="none"
            className="stroke-foreground/[0.1] dark:stroke-foreground/[0.16]" strokeWidth={0.7} />
          {/* Inner diamond */}
          <path d={`M ${c} ${c * 0.45} L ${c * 1.55} ${c} L ${c} ${c * 1.55} L ${c * 0.45} ${c} Z`} fill="none"
            className="stroke-foreground/[0.07] dark:stroke-foreground/[0.12]" strokeWidth={0.6} />
          {/* Innermost diamond */}
          <path d={`M ${c} ${c * 0.72} L ${c * 1.28} ${c} L ${c} ${c * 1.28} L ${c * 0.72} ${c} Z`} fill="none"
            className="stroke-foreground/[0.05] dark:stroke-foreground/[0.09]" strokeWidth={0.5} />
          {/* Ogee arches — curved lines inside the outer diamond */}
          <path d={`M ${c} 0 Q ${c * 0.6} ${c * 0.6} 0 ${c}`} fill="none"
            className="stroke-foreground/[0.06] dark:stroke-foreground/[0.1]" strokeWidth={0.5} />
          <path d={`M ${c} 0 Q ${c * 1.4} ${c * 0.6} ${S} ${c}`} fill="none"
            className="stroke-foreground/[0.06] dark:stroke-foreground/[0.1]" strokeWidth={0.5} />
          <path d={`M 0 ${c} Q ${c * 0.6} ${c * 1.4} ${c} ${S}`} fill="none"
            className="stroke-foreground/[0.06] dark:stroke-foreground/[0.1]" strokeWidth={0.5} />
          <path d={`M ${S} ${c} Q ${c * 1.4} ${c * 1.4} ${c} ${S}`} fill="none"
            className="stroke-foreground/[0.06] dark:stroke-foreground/[0.1]" strokeWidth={0.5} />
          {/* Corner connections */}
          <line x1={0} y1={0} x2={c * 0.45} y2={c * 0.45}
            className="stroke-foreground/[0.04] dark:stroke-foreground/[0.07]" strokeWidth={0.5} />
          <line x1={S} y1={0} x2={c * 1.55} y2={c * 0.45}
            className="stroke-foreground/[0.04] dark:stroke-foreground/[0.07]" strokeWidth={0.5} />
          <line x1={S} y1={S} x2={c * 1.55} y2={c * 1.55}
            className="stroke-foreground/[0.04] dark:stroke-foreground/[0.07]" strokeWidth={0.5} />
          <line x1={0} y1={S} x2={c * 0.45} y2={c * 1.55}
            className="stroke-foreground/[0.04] dark:stroke-foreground/[0.07]" strokeWidth={0.5} />
          {/* Center rosette */}
          <circle cx={c} cy={c} r={4} fill="none"
            className="stroke-foreground/[0.05] dark:stroke-foreground/[0.08]" strokeWidth={0.4} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  )
}

/* ─── Kente: West African geometric weave ─── */

function KenteBackground() {
  const id = useId()
  const W = 48
  const H = 64
  const b = 16

  return (
    <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full">
      <defs>
        <pattern id={id} width={W} height={H} patternUnits="userSpaceOnUse">
          {/* Band separators — horizontal warp lines */}
          {[0, 1, 2, 3, 4].map((i) => (
            <line key={`b${i}`} x1={0} y1={i * b} x2={W} y2={i * b}
              className="stroke-foreground/[0.08] dark:stroke-foreground/[0.14]" strokeWidth={0.7} />
          ))}
          {/* Band 1: Zigzag triangles */}
          <path
            d={`M 0 ${b / 2} L 12 3 L 24 ${b - 3} L 36 3 L 48 ${b / 2}`}
            fill="none" className="stroke-foreground/[0.1] dark:stroke-foreground/[0.16]" strokeWidth={0.7} />
          {/* Band 2: Alternating blocks */}
          {[0, 2, 4].map((i) => (
            <rect key={`c${i}`} x={i * 8 + 2} y={b + 3} width={5} height={b - 6} rx={0.5}
              className="fill-foreground/[0.06] dark:fill-foreground/[0.1]" />
          ))}
          {[1, 3].map((i) => (
            <rect key={`c2${i}`} x={i * 8 + 4} y={b + 5} width={3} height={b - 10} rx={0.5}
              className="fill-foreground/[0.03] dark:fill-foreground/[0.06]" />
          ))}
          {/* Band 3: Diamond chain */}
          {[0, 1].map((i) => (
            <path key={`d${i}`}
              d={`M ${i * 24 + 12} ${b * 2 + 2} L ${i * 24 + 22} ${b * 2 + b / 2} L ${i * 24 + 12} ${b * 3 - 2} L ${i * 24 + 2} ${b * 2 + b / 2} Z`}
              fill="none" className="stroke-foreground/[0.09] dark:stroke-foreground/[0.14]" strokeWidth={0.6} />
          ))}
          {/* Band 4: X cross-stitch marks */}
          {[0, 1, 2].map((i) => (
            <g key={`x${i}`}>
              <line x1={i * 16 + 3} y1={b * 3 + 3} x2={i * 16 + 13} y2={b * 4 - 3}
                className="stroke-foreground/[0.07] dark:stroke-foreground/[0.12]" strokeWidth={0.6} />
              <line x1={i * 16 + 13} y1={b * 3 + 3} x2={i * 16 + 3} y2={b * 4 - 3}
                className="stroke-foreground/[0.07] dark:stroke-foreground/[0.12]" strokeWidth={0.6} />
            </g>
          ))}
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  )
}

/* ─── Mayan: Mesoamerican step-fret (greca) ─── */

function MayanBackground() {
  const id = useId()
  const S = 64
  const c = S / 2

  return (
    <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full">
      <defs>
        <pattern id={id} width={S} height={S} patternUnits="userSpaceOnUse">
          {/* Outer stepped frame — notched corners like temple borders */}
          <path
            d={`M 0 8 H 8 V 0 H ${S - 8} V 8 H ${S} V ${S - 8} H ${S - 8} V ${S} H 8 V ${S - 8} H 0 Z`}
            fill="none" className="stroke-foreground/[0.1] dark:stroke-foreground/[0.16]" strokeWidth={0.8} />
          {/* Inner stepped frame */}
          <path
            d={`M ${c - 12} ${c - 4} H ${c - 4} V ${c - 12} H ${c + 4} V ${c - 4} H ${c + 12} V ${c + 4} H ${c + 4} V ${c + 12} H ${c - 4} V ${c + 4} H ${c - 12} Z`}
            fill="none" className="stroke-foreground/[0.07] dark:stroke-foreground/[0.12]" strokeWidth={0.6} />
          {/* Center glyph — small stepped square */}
          <rect x={c - 3} y={c - 3} width={6} height={6}
            className="stroke-foreground/[0.05] dark:stroke-foreground/[0.09] fill-none" strokeWidth={0.5} />
          {/* Diagonal step accents at corners */}
          <path d="M 0 0 L 8 8" className="stroke-foreground/[0.04] dark:stroke-foreground/[0.07]" strokeWidth={0.5} />
          <path d={`M ${S} 0 L ${S - 8} 8`} className="stroke-foreground/[0.04] dark:stroke-foreground/[0.07]" strokeWidth={0.5} />
          <path d={`M ${S} ${S} L ${S - 8} ${S - 8}`} className="stroke-foreground/[0.04] dark:stroke-foreground/[0.07]" strokeWidth={0.5} />
          <path d={`M 0 ${S} L 8 ${S - 8}`} className="stroke-foreground/[0.04] dark:stroke-foreground/[0.07]" strokeWidth={0.5} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  )
}

/* ─── Scandinavian: Nordic angular knot carving ─── */

function ScandinavianBackground() {
  const id = useId()
  const S = 48
  const c = S / 2

  return (
    <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full">
      <defs>
        <pattern id={id} width={S} height={S} patternUnits="userSpaceOnUse">
          {/* Angular rune-like mark — upward and downward chevrons with center bar */}
          <path
            d={`M ${c - 12} ${c - 16} L ${c} ${c - 6} L ${c + 12} ${c - 16}`}
            fill="none" className="stroke-foreground/[0.1] dark:stroke-foreground/[0.16]" strokeWidth={0.9} />
          <path
            d={`M ${c - 12} ${c + 16} L ${c} ${c + 6} L ${c + 12} ${c + 16}`}
            fill="none" className="stroke-foreground/[0.1] dark:stroke-foreground/[0.16]" strokeWidth={0.9} />
          <line x1={c} y1={c - 6} x2={c} y2={c + 6}
            className="stroke-foreground/[0.1] dark:stroke-foreground/[0.16]" strokeWidth={0.9} />
          {/* Border grid — carved frame lines */}
          <line x1={0} y1={0} x2={S} y2={0}
            className="stroke-foreground/[0.05] dark:stroke-foreground/[0.08]" strokeWidth={0.5} />
          <line x1={0} y1={0} x2={0} y2={S}
            className="stroke-foreground/[0.05] dark:stroke-foreground/[0.08]" strokeWidth={0.5} />
          {/* Corner marks — like carved notches in birch wood */}
          <circle cx={0} cy={0} r={1.5}
            className="fill-foreground/[0.07] dark:fill-foreground/[0.11]" />
          {/* Small diamond accent at center bottom */}
          <path d={`M ${c} ${c + 20} L ${c + 3} ${c + 23} L ${c} ${c + 26} L ${c - 3} ${c + 23} Z`}
            fill="none" className="stroke-foreground/[0.05] dark:stroke-foreground/[0.08]" strokeWidth={0.5} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  )
}

/* ─── Paisley: Persian boteh teardrop motif ─── */

function PaisleyBackground() {
  const id = useId()
  const W = 64
  const H = 96

  return (
    <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full">
      <defs>
        <pattern id={id} width={W} height={H} patternUnits="userSpaceOnUse">
          {/* Main boteh teardrop */}
          <path
            d="M 32 12 C 50 12, 54 35, 46 52 C 41 63, 28 68, 24 60 C 18 48, 14 32, 32 12 Z"
            fill="none" className="stroke-foreground/[0.1] dark:stroke-foreground/[0.16]" strokeWidth={0.7} />
          {/* Inner teardrop */}
          <path
            d="M 32 22 C 44 22, 45 38, 40 48 C 37 54, 30 55, 28 50 C 25 43, 23 32, 32 22 Z"
            fill="none" className="stroke-foreground/[0.06] dark:stroke-foreground/[0.1]" strokeWidth={0.5} />
          {/* Curled tip — the signature paisley flourish */}
          <path
            d="M 32 12 C 36 6, 46 8, 44 16"
            fill="none" className="stroke-foreground/[0.08] dark:stroke-foreground/[0.13]" strokeWidth={0.6} />
          {/* Interior vein */}
          <path
            d="M 32 28 C 36 36, 36 44, 34 50"
            fill="none" className="stroke-foreground/[0.04] dark:stroke-foreground/[0.07]" strokeWidth={0.4} />
          {/* Small seed detail */}
          <circle cx={33} cy={32} r={1.5}
            className="fill-foreground/[0.06] dark:fill-foreground/[0.1]" />
          {/* Tiny accent teardrop — fills space below main boteh */}
          <path
            d="M 32 76 C 38 74, 40 80, 36 84 C 34 86, 30 85, 32 76 Z"
            fill="none" className="stroke-foreground/[0.05] dark:stroke-foreground/[0.08]" strokeWidth={0.4} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  )
}

/* ─── Batik: Indonesian kawung (palm sugar cross-section) ─── */

function BatikBackground() {
  const id = useId()
  const S = 44
  const c = S / 2
  const d = 12
  const R = 10

  return (
    <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full">
      <defs>
        <pattern id={id} width={S} height={S} patternUnits="userSpaceOnUse">
          {/* Four circles forming the kawung clover — N, E, S, W */}
          <circle cx={c} cy={c - d} r={R} fill="none"
            className="stroke-foreground/[0.08] dark:stroke-foreground/[0.14]" strokeWidth={0.6} />
          <circle cx={c + d} cy={c} r={R} fill="none"
            className="stroke-foreground/[0.08] dark:stroke-foreground/[0.14]" strokeWidth={0.6} />
          <circle cx={c} cy={c + d} r={R} fill="none"
            className="stroke-foreground/[0.08] dark:stroke-foreground/[0.14]" strokeWidth={0.6} />
          <circle cx={c - d} cy={c} r={R} fill="none"
            className="stroke-foreground/[0.08] dark:stroke-foreground/[0.14]" strokeWidth={0.6} />
          {/* Center dot — seed of the palm sugar */}
          <circle cx={c} cy={c} r={2}
            className="fill-foreground/[0.08] dark:fill-foreground/[0.13]" />
          {/* Outer ring connecting the petals */}
          <circle cx={c} cy={c} r={d + R * 0.35} fill="none"
            className="stroke-foreground/[0.04] dark:stroke-foreground/[0.07]" strokeWidth={0.4} />
          {/* Corner kawung (partial, shared with adjacent tiles) */}
          <circle cx={0} cy={0} r={R * 0.7} fill="none"
            className="stroke-foreground/[0.05] dark:stroke-foreground/[0.09]" strokeWidth={0.4} />
          <circle cx={S} cy={0} r={R * 0.7} fill="none"
            className="stroke-foreground/[0.05] dark:stroke-foreground/[0.09]" strokeWidth={0.4} />
          <circle cx={0} cy={S} r={R * 0.7} fill="none"
            className="stroke-foreground/[0.05] dark:stroke-foreground/[0.09]" strokeWidth={0.4} />
          <circle cx={S} cy={S} r={R * 0.7} fill="none"
            className="stroke-foreground/[0.05] dark:stroke-foreground/[0.09]" strokeWidth={0.4} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  )
}

/* ─── Isometric: 3D grid via GridPattern ─── */
function IsometricBackground() {
  const id = useId()
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
    >
      <defs>
        <pattern id={id} width={86.6} height={100} patternUnits="userSpaceOnUse">
          <path d="M0 0 L43.3 25 L86.6 0" fill="none" className="stroke-foreground/[0.12] dark:stroke-foreground/[0.18]" strokeWidth={0.7} />
          <path d="M0 50 L43.3 75 L86.6 50" fill="none" className="stroke-foreground/[0.12] dark:stroke-foreground/[0.18]" strokeWidth={0.7} />
          <path d="M0 50 L43.3 25" fill="none" className="stroke-foreground/[0.12] dark:stroke-foreground/[0.18]" strokeWidth={0.7} />
          <path d="M86.6 50 L43.3 25" fill="none" className="stroke-foreground/[0.12] dark:stroke-foreground/[0.18]" strokeWidth={0.7} />
          <path d="M43.3 25 L43.3 75" fill="none" className="stroke-foreground/[0.12] dark:stroke-foreground/[0.18]" strokeWidth={0.7} />
          <path d="M0 100 L43.3 75" fill="none" className="stroke-foreground/[0.12] dark:stroke-foreground/[0.18]" strokeWidth={0.7} />
          <path d="M86.6 100 L43.3 75" fill="none" className="stroke-foreground/[0.12] dark:stroke-foreground/[0.18]" strokeWidth={0.7} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  )
}

/* ─── Main export ─── */
export function ChatBackgroundLayer({ background }: { background: ChatBackground }) {
  if (background === "none") return null

  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden="true">
      {background === "constellation" && <ConstellationBackground />}
      {background === "isometric" && <IsometricBackground />}
      {background === "dotmatrix" && <DotMatrixBackground />}
      {background === "seigaiha" && <SeigaihaBackground />}
      {background === "blueprint" && <BlueprintBackground />}
      {background === "zellige" && <ZelligeBackground />}
      {background === "sashiko" && <SashikoBackground />}
      {background === "kolam" && <KolamBackground />}
      {background === "celtic" && <CelticKnotBackground />}
      {background === "arabesque" && <ArabesqueBackground />}
      {background === "kente" && <KenteBackground />}
      {background === "mayan" && <MayanBackground />}
      {background === "scandinavian" && <ScandinavianBackground />}
      {background === "paisley" && <PaisleyBackground />}
      {background === "batik" && <BatikBackground />}
    </div>
  )
}
