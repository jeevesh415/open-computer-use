"use client"

import { useMemo } from "react"

// Deterministic hash from post ID to get consistent colors/keys per post
function hashStr(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

// Gradient palettes — each is [color1, color2, color3]
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

// Keyboard keys/combos to display
const KEY_OPTIONS = [
  ["Ctrl", "C"],
  ["Cmd", "V"],
  ["\u2318", "Z"],
  ["Alt", "Tab"],
  ["Ctrl", "S"],
  ["\u21E7", "Enter"],
  ["Esc"],
  ["Tab"],
  ["\u2318", "K"],
  ["Ctrl", "A"],
  ["F5"],
  ["Ctrl", "Z"],
  ["\u2318", "N"],
  ["Del"],
  ["Home"],
  ["\u2318", "T"],
  ["Ctrl", "F"],
  ["\u21E7", "Tab"],
  ["Alt", "F4"],
  ["\u2318", "Space"],
  ["Ctrl", "P"],
  ["F12"],
  ["\u2318", "D"],
  ["Ctrl", "R"],
  ["\u2318", "W"],
  ["Pg Up"],
  ["End"],
  ["\u2318", "B"],
  ["Ctrl", "H"],
  ["\u2318", "L"],
]

interface PostThumbnailProps {
  postId: string
  className?: string
}

export function PostThumbnail({ postId, className = "" }: PostThumbnailProps) {
  const { palette, keys, blobPositions } = useMemo(() => {
    const h = hashStr(postId)
    const paletteIdx = h % PALETTES.length
    const keyIdx = h % KEY_OPTIONS.length

    // Deterministic blob positions from hash
    const h2 = hashStr(postId + "pos")
    const h3 = hashStr(postId + "pos2")
    const h4 = hashStr(postId + "pos3")

    return {
      palette: PALETTES[paletteIdx],
      keys: KEY_OPTIONS[keyIdx],
      blobPositions: [
        { x: 15 + (h % 30), y: 10 + (h2 % 30) },
        { x: 50 + (h3 % 30), y: 40 + (h4 % 30) },
        { x: 20 + (h2 % 40), y: 55 + (h3 % 25) },
      ],
    }
  }, [postId])

  return (
    <div className={`relative overflow-hidden rounded-lg ${className}`} style={{ aspectRatio: "16/9" }}>
      {/* Dark base */}
      <div className="absolute inset-0 bg-neutral-950" />

      {/* Smoke blobs */}
      {palette.map((color, i) => (
        <div
          key={i}
          className="absolute rounded-full"
          style={{
            background: `radial-gradient(circle, ${color}40 0%, ${color}15 40%, transparent 70%)`,
            width: "70%",
            height: "70%",
            left: `${blobPositions[i].x}%`,
            top: `${blobPositions[i].y}%`,
            transform: "translate(-50%, -50%)",
            filter: "blur(20px)",
          }}
        />
      ))}

      {/* Subtle noise overlay */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")`,
          backgroundSize: "128px 128px",
        }}
      />

      {/* Keyboard keys */}
      <div className="absolute inset-0 flex items-center justify-center gap-1.5">
        {keys.map((key, i) => (
          <span key={i} className="flex items-center">
            <kbd
              className="inline-flex items-center justify-center rounded-md border border-white/10 bg-white/[0.06] backdrop-blur-sm px-2.5 py-1.5 text-xs font-medium text-white/70 shadow-[0_1px_3px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.05)]"
              style={{
                minWidth: key.length === 1 ? "28px" : undefined,
                fontSize: key.length === 1 && key.charCodeAt(0) > 127 ? "14px" : undefined,
              }}
            >
              {key}
            </kbd>
            {i < keys.length - 1 && (
              <span className="text-white/20 text-[10px] mx-0.5">+</span>
            )}
          </span>
        ))}
      </div>

      {/* Vignette */}
      <div
        className="absolute inset-0"
        style={{
          background: "radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.4) 100%)",
        }}
      />
    </div>
  )
}

interface FeaturedThumbnailProps {
  postId: string
  className?: string
}

export function FeaturedThumbnail({ postId, className = "" }: FeaturedThumbnailProps) {
  const { palette, keys, blobPositions } = useMemo(() => {
    const h = hashStr(postId)
    const paletteIdx = h % PALETTES.length
    const keyIdx = h % KEY_OPTIONS.length

    const h2 = hashStr(postId + "pos")
    const h3 = hashStr(postId + "pos2")
    const h4 = hashStr(postId + "pos3")

    return {
      palette: PALETTES[paletteIdx],
      keys: KEY_OPTIONS[keyIdx],
      blobPositions: [
        { x: 20 + (h % 25), y: 15 + (h2 % 25) },
        { x: 55 + (h3 % 25), y: 45 + (h4 % 25) },
        { x: 25 + (h2 % 35), y: 60 + (h3 % 20) },
      ],
    }
  }, [postId])

  return (
    <div className={`relative overflow-hidden rounded-xl ${className}`} style={{ aspectRatio: "21/9" }}>
      {/* Dark base */}
      <div className="absolute inset-0 bg-neutral-950" />

      {/* Larger, more diffuse smoke blobs for featured */}
      {palette.map((color, i) => (
        <div
          key={i}
          className="absolute rounded-full"
          style={{
            background: `radial-gradient(circle, ${color}35 0%, ${color}12 45%, transparent 70%)`,
            width: "80%",
            height: "80%",
            left: `${blobPositions[i].x}%`,
            top: `${blobPositions[i].y}%`,
            transform: "translate(-50%, -50%)",
            filter: "blur(30px)",
          }}
        />
      ))}

      {/* Noise */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")`,
          backgroundSize: "128px 128px",
        }}
      />

      {/* Keys — larger for featured */}
      <div className="absolute inset-0 flex items-center justify-center gap-2">
        {keys.map((key, i) => (
          <span key={i} className="flex items-center">
            <kbd
              className="inline-flex items-center justify-center rounded-lg border border-white/10 bg-white/[0.06] backdrop-blur-sm px-4 py-2.5 text-sm font-medium text-white/70 shadow-[0_2px_6px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.05)]"
              style={{
                minWidth: key.length === 1 ? "40px" : undefined,
                fontSize: key.length === 1 && key.charCodeAt(0) > 127 ? "18px" : undefined,
              }}
            >
              {key}
            </kbd>
            {i < keys.length - 1 && (
              <span className="text-white/20 text-xs mx-1">+</span>
            )}
          </span>
        ))}
      </div>

      {/* Vignette */}
      <div
        className="absolute inset-0"
        style={{
          background: "radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.4) 100%)",
        }}
      />
    </div>
  )
}
