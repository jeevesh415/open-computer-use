"use client"

import { useEffect } from "react"
import { FAVICON_SERIF_STACK } from "@/lib/fonts"

const SIZE = 128
const CYCLE_MS = 7000
const FPS = 24
const WORD = "COASTY"
const SLIDE_END = 0.58 // word slide finishes at this fraction of cycle

const easeInOut = (t: number) => t * t * (3 - 2 * t)

export function AnimatedFavicon() {
  useEffect(() => {
    if (typeof window === "undefined") return

    const canvas = document.createElement("canvas")
    canvas.width = SIZE
    canvas.height = SIZE
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const links = Array.from(
      document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')
    )
    if (links.length === 0) {
      const l = document.createElement("link")
      l.rel = "icon"
      document.head.appendChild(l)
      links.push(l)
    }
    links.forEach((l) => (l.type = "image/png"))

    const cx = SIZE / 2
    const cy = SIZE / 2
    const orbR = SIZE * (160 / 512)
    const cornerR = SIZE * (108 / 512)

    const FONT = `200 ${SIZE * 0.82}px ${FAVICON_SERIF_STACK}`

    // Pre-measure the full word so we know exactly where it enters/exits
    ctx.font = FONT
    const wordWidth = ctx.measureText(WORD).width
    const slideStartX = SIZE + wordWidth / 2 + SIZE * 0.04 // off-right
    const slideEndX = -wordWidth / 2 - SIZE * 0.04 // off-left

    const drawRoundedRect = (r: number) => {
      ctx.beginPath()
      ctx.moveTo(r, 0)
      ctx.lineTo(SIZE - r, 0)
      ctx.quadraticCurveTo(SIZE, 0, SIZE, r)
      ctx.lineTo(SIZE, SIZE - r)
      ctx.quadraticCurveTo(SIZE, SIZE, SIZE - r, SIZE)
      ctx.lineTo(r, SIZE)
      ctx.quadraticCurveTo(0, SIZE, 0, SIZE - r)
      ctx.lineTo(0, r)
      ctx.quadraticCurveTo(0, 0, r, 0)
      ctx.closePath()
    }

    const bgGrad = ctx.createLinearGradient(0, 0, SIZE, SIZE)
    bgGrad.addColorStop(0, "#0a0a0a")
    bgGrad.addColorStop(1, "#171717")

    const drawOrb = (scale: number, glow: number, alpha = 1) => {
      const r = Math.max(0.5, orbR * scale)
      ctx.save()
      ctx.globalAlpha = alpha

      if (glow > 0.01) {
        const bloomR = r * (1.4 + glow * 1.8)
        const bloom = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, bloomR)
        bloom.addColorStop(0, `rgba(255,255,255,${0.55 * glow})`)
        bloom.addColorStop(0.4, `rgba(255,255,255,${0.18 * glow})`)
        bloom.addColorStop(1, "rgba(255,255,255,0)")
        ctx.fillStyle = bloom
        ctx.beginPath()
        ctx.arc(cx, cy, bloomR, 0, Math.PI * 2)
        ctx.fill()
      }

      const lift = glow * 0.35
      const orbGrad = ctx.createLinearGradient(cx, cy - r, cx, cy + r)
      orbGrad.addColorStop(0, `rgba(255,255,255,${lift * 0.3})`)
      orbGrad.addColorStop(0.25, `rgba(255,255,255,${0.06 + lift * 0.4})`)
      orbGrad.addColorStop(0.45, `rgba(255,255,255,${0.18 + lift * 0.4})`)
      orbGrad.addColorStop(0.6, `rgba(255,255,255,${0.4 + lift * 0.3})`)
      orbGrad.addColorStop(0.8, `rgba(255,255,255,${0.75 + lift * 0.2})`)
      orbGrad.addColorStop(1, "rgba(255,255,255,1)")
      ctx.fillStyle = orbGrad
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.fill()

      ctx.strokeStyle = `rgba(255,255,255,${0.18 + 0.7 * glow})`
      ctx.lineWidth = 1 + glow * 1.4
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.stroke()

      ctx.restore()
    }

    const drawWordSlide = (xCenter: number, alpha: number) => {
      ctx.save()
      // Clip to rounded rect so the word feathers cleanly at the corners
      drawRoundedRect(cornerR)
      ctx.clip()
      ctx.font = FONT
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      ctx.shadowColor = `rgba(255,255,255,${0.45 * alpha})`
      ctx.shadowBlur = SIZE * 0.18
      ctx.fillStyle = `rgba(255,255,255,${alpha})`
      ctx.fillText(WORD, xCenter, cy + SIZE * 0.02)
      ctx.restore()

      // Soft horizontal feather at left/right canvas edges so partial letters
      // dissolve into the background instead of hard-clipping
      ctx.save()
      drawRoundedRect(cornerR)
      ctx.clip()
      const featherW = SIZE * 0.14
      const leftFade = ctx.createLinearGradient(0, 0, featherW, 0)
      leftFade.addColorStop(0, "rgba(10,10,10,1)")
      leftFade.addColorStop(1, "rgba(10,10,10,0)")
      ctx.fillStyle = leftFade
      ctx.fillRect(0, 0, featherW, SIZE)
      const rightFade = ctx.createLinearGradient(SIZE - featherW, 0, SIZE, 0)
      rightFade.addColorStop(0, "rgba(23,23,23,0)")
      rightFade.addColorStop(1, "rgba(23,23,23,1)")
      ctx.fillStyle = rightFade
      ctx.fillRect(SIZE - featherW, 0, featherW, SIZE)
      ctx.restore()
    }

    const drawVignette = () => {
      ctx.save()
      drawRoundedRect(cornerR)
      ctx.clip()
      const v = ctx.createRadialGradient(cx, cy, SIZE * 0.25, cx, cy, SIZE * 0.72)
      v.addColorStop(0, "rgba(0,0,0,0)")
      v.addColorStop(1, "rgba(0,0,0,0.35)")
      ctx.fillStyle = v
      ctx.fillRect(0, 0, SIZE, SIZE)
      ctx.restore()
    }

    let raf = 0
    let lastDraw = 0
    const frameInterval = 1000 / FPS
    const start = performance.now()

    const render = (now: number) => {
      raf = requestAnimationFrame(render)
      if (now - lastDraw < frameInterval) return
      lastDraw = now
      if (document.hidden) return

      // Modulo guarantees the cycle restarts indefinitely
      const t = ((now - start) % CYCLE_MS) / CYCLE_MS

      ctx.clearRect(0, 0, SIZE, SIZE)
      ctx.fillStyle = bgGrad
      drawRoundedRect(cornerR)
      ctx.fill()
      ctx.strokeStyle = "rgba(255,255,255,0.07)"
      ctx.lineWidth = 1
      drawRoundedRect(cornerR)
      ctx.stroke()

      // Cinematic timeline (7s, repeats):
      // 0.000–0.580  COASTY slides as a single unit, off-right → off-left
      // 0.580–0.700  bright nucleus blooms at center
      // 0.700–0.800  orb dissolves up at full size
      // 0.800–0.950  glow swells on a long bell curve, then settles
      // 0.950–1.000  ambient hold before loop
      if (t < SLIDE_END) {
        const raw = t / SLIDE_END
        // Gentle ease at very start and very end, near-linear in the middle —
        // cinematic glide without the word lingering at the edges.
        const p =
          raw < 0.12
            ? easeInOut(raw / 0.12) * 0.12
            : raw > 0.88
              ? 0.88 + easeInOut((raw - 0.88) / 0.12) * 0.12
              : raw
        const xCenter = slideStartX + (slideEndX - slideStartX) * p
        drawWordSlide(xCenter, 1)
      } else if (t < 0.70) {
        const p = easeInOut((t - SLIDE_END) / (0.70 - SLIDE_END))
        const nR = orbR * (0.4 + 0.7 * p)
        const nucleus = ctx.createRadialGradient(cx, cy, 0, cx, cy, nR)
        nucleus.addColorStop(0, `rgba(255,255,255,${Math.min(1, 0.85 * p)})`)
        nucleus.addColorStop(0.4, `rgba(255,255,255,${0.35 * p})`)
        nucleus.addColorStop(1, "rgba(255,255,255,0)")
        ctx.fillStyle = nucleus
        ctx.beginPath()
        ctx.arc(cx, cy, nR, 0, Math.PI * 2)
        ctx.fill()
      } else if (t < 0.80) {
        const p = easeInOut((t - 0.70) / 0.10)
        drawOrb(1, 0.4 + 0.4 * (1 - p), p)
      } else if (t < 0.95) {
        const p = (t - 0.80) / 0.15
        const pulse = Math.exp(-Math.pow((p - 0.30) / 0.28, 2)) * 0.75
        drawOrb(1, pulse + 0.08)
      } else {
        drawOrb(1, 0.08)
      }

      drawVignette()

      const url = canvas.toDataURL("image/png")
      links.forEach((l) => (l.href = url))
    }

    raf = requestAnimationFrame(render)
    return () => cancelAnimationFrame(raf)
  }, [])

  return null
}
