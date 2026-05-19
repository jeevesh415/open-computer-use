"use client"

import { useEffect, useState } from "react"

export interface LiteMode {
  /** User prefers reduced motion — honour this as a hard stop for all animation. */
  reducedMotion: boolean
  /** Narrow viewport — used for layout decisions, not performance ones. */
  mobile: boolean
  /** Low-end device signal: <=4 cores or <=4 GB RAM, or the Save-Data hint. */
  lowEnd: boolean
  /**
   * Composite flag: disable expensive effects (WebGL backgrounds, always-on
   * canvas loops, heavy scroll parallax) when true. A superset of reducedMotion
   * and lowEnd. Prefer this for gating decorative-but-heavy work.
   */
  lite: boolean
}

const DEFAULT: LiteMode = {
  reducedMotion: false,
  mobile: false,
  lowEnd: false,
  lite: false,
}

type NavigatorWithHints = Navigator & {
  deviceMemory?: number
  connection?: { saveData?: boolean; effectiveType?: string }
}

/**
 * Detect whether decorative effects should be disabled or downgraded.
 * Server-renders as non-lite to avoid hydration mismatch, then upgrades
 * to the real value on mount.
 */
export function useLiteMode(): LiteMode {
  const [mode, setMode] = useState<LiteMode>(DEFAULT)

  useEffect(() => {
    const nav = navigator as NavigatorWithHints
    const mqMotion = window.matchMedia("(prefers-reduced-motion: reduce)")
    const mqMobile = window.matchMedia("(max-width: 767px)")

    const evaluate = () => {
      const reducedMotion = mqMotion.matches
      const mobile = mqMobile.matches
      const cores = nav.hardwareConcurrency ?? 8
      const memory = nav.deviceMemory ?? 8
      const saveData = nav.connection?.saveData === true
      const slowNet =
        nav.connection?.effectiveType === "2g" ||
        nav.connection?.effectiveType === "slow-2g"
      const lowEnd = cores <= 4 || memory <= 4 || saveData || slowNet

      setMode({
        reducedMotion,
        mobile,
        lowEnd,
        lite: reducedMotion || lowEnd,
      })
    }

    evaluate()
    mqMotion.addEventListener("change", evaluate)
    mqMobile.addEventListener("change", evaluate)
    return () => {
      mqMotion.removeEventListener("change", evaluate)
      mqMobile.removeEventListener("change", evaluate)
    }
  }, [])

  return mode
}
