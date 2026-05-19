import * as React from "react"
import type { SVGProps } from "react"
import { cn } from "@/lib/utils"

/**
 * CloudDesktopIcon — a full monitor + stand with a small cloud accent
 * inside the screen. Reads as a complete workstation (not a puck) at all
 * sizes, with the cloud detail surfacing the "cloud-hosted" intent at 20px+.
 */
export function CloudDesktopIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
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

      {/* Drop shadow under base */}
      <ellipse cx="16" cy="28.6" rx="8" ry="0.55" fill="currentColor" opacity="0.08" />

      {/* Monitor frame */}
      <rect
        x="2.5" y="4.5" width="27" height="17" rx="2.4"
        fill={`url(#frame${id})`}
        stroke="currentColor"
        strokeOpacity="0.42"
        strokeWidth="0.9"
        strokeLinejoin="round"
      />

      {/* Screen interior */}
      <rect
        x="4" y="6" width="24" height="12" rx="1.3"
        fill={`url(#screen${id})`}
        stroke="currentColor"
        strokeOpacity="0.18"
        strokeWidth="0.5"
      />

      {/* Cloud accent — desktop-wallpaper style, top-left of screen */}
      <g opacity="0.6">
        <ellipse cx="6.6" cy="9.1" rx="1.0" ry="0.85" fill="currentColor" />
        <ellipse cx="8.1" cy="8.4" rx="1.25" ry="1.1" fill="currentColor" />
        <ellipse cx="9.6" cy="9.25" rx="0.9" ry="0.75" fill="currentColor" />
        <rect x="5.7" y="9" width="4.6" height="1.4" rx="0.7" fill="currentColor" />
      </g>

      {/* Subtle UI text-lines */}
      <rect x="13" y="9.4" width="11" height="0.7" rx="0.35" fill="currentColor" opacity="0.18" />
      <rect x="13" y="11.4" width="8" height="0.7" rx="0.35" fill="currentColor" opacity="0.14" />
      <rect x="6" y="13.6" width="14" height="0.7" rx="0.35" fill="currentColor" opacity="0.12" />
      <rect x="6" y="15.4" width="10" height="0.7" rx="0.35" fill="currentColor" opacity="0.10" />

      {/* Bezel chin separator */}
      <line
        x1="3" y1="18.4" x2="29" y2="18.4"
        stroke="currentColor" strokeOpacity="0.2" strokeWidth="0.5"
      />

      {/* Power LED */}
      <circle cx="26.5" cy="20.2" r="0.55" fill="currentColor" opacity="0.55" />

      {/* Stand neck (trapezoid) */}
      <path
        d="M 13.2 21.5 L 18.8 21.5 L 19.8 25.4 L 12.2 25.4 Z"
        fill={`url(#frame${id})`}
        stroke="currentColor"
        strokeOpacity="0.4"
        strokeWidth="0.8"
        strokeLinejoin="round"
      />

      {/* Stand base */}
      <rect
        x="7.5" y="25.4" width="17" height="2.3" rx="1.15"
        fill={`url(#frame${id})`}
        stroke="currentColor"
        strokeOpacity="0.4"
        strokeWidth="0.8"
      />
    </svg>
  )
}
