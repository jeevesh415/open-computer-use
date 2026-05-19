"use client"

import { useMemo } from "react"

/**
 * Deterministic post thumbnails.
 *
 * ─── Why this file was rewritten ────────────────────────────────────────
 *
 * The previous implementation rendered ~6 GPU compositor layers per card:
 *   - 3 absolute divs with `filter: blur(20-30px)` (one per palette color)
 *   - multiple <kbd> elements each with `backdrop-filter: blur()`
 *   - an inline SVG noise texture (decoded per card)
 *   - a vignette gradient
 *
 * Multiplied across ~20–60 posts, this made the blog index visibly janky
 * on mid-range Android and any iPhone older than the 12. The fix keeps
 * the same visual language (soft color wash + keyboard key signature)
 * but composes it from **one** background-image stack (two static radial
 * gradients) and replaces backdrop-filter with a solid translucent
 * surface. Net compositor cost: ~6 layers → 1 per card. Noise overlay is
 * removed entirely (matches the project's "no noise" design direction).
 *
 * Hit-testing rationale (carried over from the previous version):
 * `pointer-events-none` on the wrapper means taps pass straight through
 * to the parent <Link>, avoiding the iOS Safari subpixel hit-test bug
 * that plagued the old design.
 */

function hashStr(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

/** Each palette is a 3-color set used as the two radial-gradient stops. */
const PALETTES = [
  ["#6366f1", "#8b5cf6", "#a78bfa"], // indigo → violet
  ["#ec4899", "#f43f5e", "#fb923c"], // pink → rose → orange
  ["#06b6d4", "#3b82f6", "#8b5cf6"], // cyan → blue → violet
  ["#10b981", "#06b6d4", "#3b82f6"], // emerald → cyan → blue
  ["#f59e0b", "#f43f5e", "#ec4899"], // amber → rose → pink
  ["#8b5cf6", "#ec4899", "#f43f5e"], // violet → pink → rose
  ["#14b8a6", "#10b981", "#22d3ee"], // teal → emerald → cyan
  ["#f97316", "#ef4444", "#dc2626"], // orange → red → deep red
  ["#a855f7", "#6366f1", "#3b82f6"], // purple → indigo → blue
  ["#84cc16", "#22c55e", "#06b6d4"], // lime → green → cyan
  ["#e879f9", "#c084fc", "#818cf8"], // fuchsia → purple → indigo
  ["#fb7185", "#f472b6", "#c084fc"], // rose → pink → purple
]

const KEY_OPTIONS = [
  ["Ctrl", "C"], ["Cmd", "V"], ["⌘", "Z"], ["Alt", "Tab"],
  ["Ctrl", "S"], ["⇧", "Enter"], ["Esc"], ["Tab"],
  ["⌘", "K"], ["Ctrl", "A"], ["F5"], ["Ctrl", "Z"],
  ["⌘", "N"], ["Del"], ["Home"], ["⌘", "T"],
  ["Ctrl", "F"], ["⇧", "Tab"], ["Alt", "F4"], ["⌘", "Space"],
  ["Ctrl", "P"], ["F12"], ["⌘", "D"], ["Ctrl", "R"],
  ["⌘", "W"], ["Pg Up"], ["End"], ["⌘", "B"],
  ["Ctrl", "H"], ["⌘", "L"],
]

/**
 * Build the single `background-image` stack for a card.
 * Two radial gradients + a solid base — the gradients are soft enough on
 * their own that we don't need an additional `filter: blur()` pass.
 */
function gradientStack(palette: string[], h: number, intensity: "card" | "featured", isDark: boolean) {
  const aX = 20 + (h % 25)
  const aY = 15 + ((h >> 3) % 25)
  const bX = 60 + ((h >> 5) % 25)
  const bY = 55 + ((h >> 7) % 25)

  // Light mode uses slightly weaker stops so the colors don't overwhelm.
  const a1 = isDark ? "55" : "3a"
  const a2 = isDark ? "1a" : "12"
  const b1 = isDark ? "4a" : "30"
  const b2 = isDark ? "16" : "10"

  const sizeA = intensity === "featured" ? "85% 85%" : "75% 75%"
  const sizeB = intensity === "featured" ? "75% 75%" : "65% 65%"

  return [
    `radial-gradient(${sizeA} at ${aX}% ${aY}%, ${palette[0]}${a1} 0%, ${palette[1]}${a2} 45%, transparent 75%)`,
    `radial-gradient(${sizeB} at ${bX}% ${bY}%, ${palette[2]}${b1} 0%, ${palette[2]}${b2} 45%, transparent 75%)`,
  ].join(", ")
}

interface PostThumbnailProps {
  postId: string
  className?: string
}

export function PostThumbnail({ postId, className = "" }: PostThumbnailProps) {
  const { keys, lightBg, darkBg } = useMemo(() => {
    const h = hashStr(postId)
    const p = PALETTES[h % PALETTES.length]
    const k = KEY_OPTIONS[h % KEY_OPTIONS.length]
    return {
      keys: k,
      lightBg: gradientStack(p, h, "card", false),
      darkBg: gradientStack(p, h, "card", true),
    }
  }, [postId])

  return (
    <div
      className={`pointer-events-none relative overflow-hidden rounded-lg ${className}`}
      style={{ aspectRatio: "16/9" }}
    >
      <div className="absolute inset-0 bg-neutral-100 dark:bg-neutral-950" />
      <div className="absolute inset-0 dark:hidden" style={{ backgroundImage: lightBg }} />
      <div className="absolute inset-0 hidden dark:block" style={{ backgroundImage: darkBg }} />

      <div className="absolute inset-0 flex items-center justify-center gap-1.5">
        {keys.map((key, i) => (
          <span key={i} className="flex items-center">
            <kbd
              className="inline-flex items-center justify-center rounded-md border border-black/[0.08] dark:border-white/10 bg-white/70 dark:bg-white/[0.07] px-2.5 py-1.5 text-xs font-medium text-neutral-600 dark:text-white/70 shadow-[0_1px_2px_rgba(0,0,0,0.05),inset_0_1px_0_rgba(255,255,255,0.6)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.25),inset_0_1px_0_rgba(255,255,255,0.04)]"
              style={{
                minWidth: key.length === 1 ? "28px" : undefined,
                fontSize: key.length === 1 && key.charCodeAt(0) > 127 ? "14px" : undefined,
              }}
            >
              {key}
            </kbd>
            {i < keys.length - 1 && (
              <span className="text-black/15 dark:text-white/20 text-[10px] mx-0.5">+</span>
            )}
          </span>
        ))}
      </div>

      <div
        className="absolute inset-0 hidden dark:block"
        style={{ background: "radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,0.35) 100%)" }}
      />
      <div
        className="absolute inset-0 dark:hidden"
        style={{ background: "radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,0.05) 100%)" }}
      />
    </div>
  )
}

interface FeaturedThumbnailProps {
  postId: string
  className?: string
}

export function FeaturedThumbnail({ postId, className = "" }: FeaturedThumbnailProps) {
  const { keys, lightBg, darkBg } = useMemo(() => {
    const h = hashStr(postId)
    const p = PALETTES[h % PALETTES.length]
    const k = KEY_OPTIONS[h % KEY_OPTIONS.length]
    return {
      keys: k,
      lightBg: gradientStack(p, h, "featured", false),
      darkBg: gradientStack(p, h, "featured", true),
    }
  }, [postId])

  return (
    <div
      className={`pointer-events-none relative overflow-hidden rounded-xl ${className}`}
      style={{ aspectRatio: "21/9" }}
    >
      <div className="absolute inset-0 bg-neutral-100 dark:bg-neutral-950" />
      <div className="absolute inset-0 dark:hidden" style={{ backgroundImage: lightBg }} />
      <div className="absolute inset-0 hidden dark:block" style={{ backgroundImage: darkBg }} />

      <div className="absolute inset-0 flex items-center justify-center gap-2">
        {keys.map((key, i) => (
          <span key={i} className="flex items-center">
            <kbd
              className="inline-flex items-center justify-center rounded-lg border border-black/[0.08] dark:border-white/10 bg-white/70 dark:bg-white/[0.07] px-4 py-2.5 text-sm font-medium text-neutral-600 dark:text-white/70 shadow-[0_2px_4px_rgba(0,0,0,0.04),inset_0_1px_0_rgba(255,255,255,0.6)] dark:shadow-[0_2px_4px_rgba(0,0,0,0.25),inset_0_1px_0_rgba(255,255,255,0.04)]"
              style={{
                minWidth: key.length === 1 ? "40px" : undefined,
                fontSize: key.length === 1 && key.charCodeAt(0) > 127 ? "18px" : undefined,
              }}
            >
              {key}
            </kbd>
            {i < keys.length - 1 && (
              <span className="text-black/15 dark:text-white/20 text-xs mx-1">+</span>
            )}
          </span>
        ))}
      </div>

      <div
        className="absolute inset-0 hidden dark:block"
        style={{ background: "radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.35) 100%)" }}
      />
      <div
        className="absolute inset-0 dark:hidden"
        style={{ background: "radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.05) 100%)" }}
      />
    </div>
  )
}
