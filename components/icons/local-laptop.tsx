import * as React from "react"
import type { SVGProps } from "react"
import { cn } from "@/lib/utils"

/**
 * LocalLaptopIcon — open laptop drawn in the same visual register as
 * CloudDesktopIcon (gradient frame, hairline strokes, drop shadow,
 * subtle screen content). Reads as "your computer" alongside the cloud
 * icon's "hosted workstation."
 */
export function LocalLaptopIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  const id = React.useId().replace(/:/g, "")

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      fill="none"
      className={cn("shrink-0", className)}
      {...props}
    >
      <defs>
        <linearGradient id={`frame${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.12" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.22" />
        </linearGradient>
        <linearGradient id={`screen${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.04" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.14" />
        </linearGradient>
      </defs>

      {/* Drop shadow under the base */}
      <ellipse cx="16" cy="27.5" rx="11" ry="0.55" fill="currentColor" opacity="0.08" />

      {/* Screen panel */}
      <rect
        x="4" y="4" width="24" height="14.5" rx="1.4"
        fill={`url(#frame${id})`}
        stroke="currentColor"
        strokeOpacity="0.42"
        strokeWidth="0.9"
        strokeLinejoin="round"
      />

      {/* Screen interior */}
      <rect
        x="5.2" y="5.2" width="21.6" height="10.7" rx="0.9"
        fill={`url(#screen${id})`}
        stroke="currentColor"
        strokeOpacity="0.18"
        strokeWidth="0.5"
      />

      {/* Traffic-light dots — top-left of screen */}
      <circle cx="7" cy="7.2" r="0.55" fill="currentColor" opacity="0.42" />
      <circle cx="8.7" cy="7.2" r="0.55" fill="currentColor" opacity="0.32" />
      <circle cx="10.4" cy="7.2" r="0.55" fill="currentColor" opacity="0.24" />

      {/* Subtle UI text-bars */}
      <rect x="6.5" y="9.3" width="10" height="0.7" rx="0.35" fill="currentColor" opacity="0.18" />
      <rect x="6.5" y="11" width="13" height="0.6" rx="0.3" fill="currentColor" opacity="0.14" />
      <rect x="6.5" y="12.5" width="9" height="0.6" rx="0.3" fill="currentColor" opacity="0.12" />
      <rect x="6.5" y="14" width="11" height="0.6" rx="0.3" fill="currentColor" opacity="0.10" />

      {/* Bezel chin separator */}
      <line
        x1="5" y1="16.3" x2="27" y2="16.3"
        stroke="currentColor" strokeOpacity="0.18" strokeWidth="0.5"
      />

      {/* Power LED */}
      <circle cx="25.5" cy="17.5" r="0.5" fill="currentColor" opacity="0.5" />

      {/* Hinge line — joins screen and base */}
      <line
        x1="3.2" y1="18.8" x2="28.8" y2="18.8"
        stroke="currentColor" strokeOpacity="0.28" strokeWidth="0.6"
      />

      {/* Base — trapezoid for open-laptop perspective */}
      <path
        d="M 3.5 19 L 28.5 19 L 30 23 Q 30 23.5 29.55 23.5 L 2.45 23.5 Q 2 23.5 2 23 Z"
        fill={`url(#frame${id})`}
        stroke="currentColor"
        strokeOpacity="0.42"
        strokeWidth="0.9"
        strokeLinejoin="round"
      />

      {/* Trackpad */}
      <rect x="12" y="20.7" width="8" height="1.3" rx="0.55" fill="currentColor" opacity="0.25" />
    </svg>
  )
}
