"use client"

import { useEffect, useRef, useCallback, useState } from "react"

/**
 * Swarm of terminal characters that flow along paths forming a computer shape
 * (monitor + stand + keyboard). Canvas-based for performance.
 */

// ─── Character pool ───
const CHARS = "{}[]()<>$#@&|/\\=+-*~^%!?.,:;01_>λ→←↑↓"
const rchar = () => CHARS[Math.floor(Math.random() * CHARS.length)]

// ─── Shape paths (normalised 0–1 coordinates) ───

const MONITOR: [number, number][] = [
  [0.15, 0.06], [0.85, 0.06], [0.85, 0.52], [0.15, 0.52],
]
const SCREEN: [number, number][] = [
  [0.19, 0.10], [0.81, 0.10], [0.81, 0.48], [0.19, 0.48],
]
const KEYBOARD: [number, number][] = [
  [0.10, 0.66], [0.90, 0.66], [0.90, 0.80], [0.10, 0.80],
]

// Open segments (stand + base)
const STAND_L: [number, number][] = [[0.44, 0.52], [0.44, 0.61]]
const STAND_R: [number, number][] = [[0.56, 0.52], [0.56, 0.61]]
const STAND_BASE: [number, number][] = [[0.36, 0.61], [0.64, 0.61]]

// Keyboard key row guides (inside keyboard outline)
const KEY_ROWS: [number, number][][] = [
  [[0.13, 0.69], [0.87, 0.69]],
  [[0.14, 0.72], [0.86, 0.72]],
  [[0.15, 0.75], [0.85, 0.75]],
  [[0.20, 0.78], [0.80, 0.78]], // spacebar row – shorter
]

const LOOPS = [MONITOR, SCREEN, KEYBOARD]
const SEGMENTS = [STAND_L, STAND_R, STAND_BASE, ...KEY_ROWS]

// ─── Path math ───

function onLoop(path: [number, number][], t: number): [number, number] {
  t = ((t % 1) + 1) % 1
  const n = path.length
  const raw = t * n
  const i = Math.floor(raw)
  const f = raw - i
  const [ax, ay] = path[i % n]
  const [bx, by] = path[(i + 1) % n]
  return [ax + (bx - ax) * f, ay + (by - ay) * f]
}

function onSeg(seg: [number, number][], t: number): [number, number] {
  t = Math.max(0, Math.min(1, t))
  return [
    seg[0][0] + (seg[1][0] - seg[0][0]) * t,
    seg[0][1] + (seg[1][1] - seg[0][1]) * t,
  ]
}

// ─── Particle structs ───

interface Swarm {
  kind: 0 // loop
  loop: number
  t: number
  spd: number
  ch: string
  a: number
  sz: number
  ttl: number
  spark: number
}
interface Seg {
  kind: 1 // segment
  seg: number
  t: number
  spd: number
  ch: string
  a: number
  sz: number
  ttl: number
}
interface Screen {
  kind: 2
  x: number // normalised inside screen rect
  y: number
  ch: string
  a: number
  ttl: number
}
interface Ambient {
  kind: 3
  x: number
  y: number
  vx: number
  vy: number
  ch: string
  a: number
  sz: number
  ttl: number
}

type Particle = Swarm | Seg | Screen | Ambient

// ─── Component ───

export function TerminalBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef(0)
  const particlesRef = useRef<Particle[]>([])
  const [mobile, setMobile] = useState(true)

  // Build particle set
  const init = useCallback(() => {
    const p: Particle[] = []

    // Loop particles (monitor, screen, keyboard outlines)
    const loopCfg: [number, number, number][] = [
      // [loopIdx, count, direction]
      [0, 120, 1],  // monitor CW
      [1, 90, -1],  // screen CCW (contrast)
      [2, 60, 1],   // keyboard CW
    ]
    for (const [li, n, dir] of loopCfg) {
      for (let i = 0; i < n; i++) {
        p.push({
          kind: 0,
          loop: li,
          t: Math.random(),
          spd: (0.00015 + Math.random() * 0.00035) * dir,
          ch: rchar(),
          a: 0.35 + Math.random() * 0.55,
          sz: 7.5 + Math.random() * 4.5,
          ttl: 20 + Math.floor(Math.random() * 100),
          spark: Math.random() > 0.92 ? 0.4 + Math.random() * 0.6 : 0,
        })
      }
    }

    // Segment particles (stand + keyboard key rows)
    for (let si = 0; si < SEGMENTS.length; si++) {
      const n = si < 3 ? 7 : 12 // more on key rows
      for (let i = 0; i < n; i++) {
        p.push({
          kind: 1,
          seg: si,
          t: Math.random(),
          spd: 0.0008 + Math.random() * 0.002,
          ch: rchar(),
          a: si < 3 ? 0.3 + Math.random() * 0.35 : 0.15 + Math.random() * 0.25,
          sz: 7 + Math.random() * 3,
          ttl: 30 + Math.floor(Math.random() * 80),
        })
      }
    }

    // Screen content (faint grid drifting upward)
    const cols = 32, rows = 14
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (Math.random() > 0.45) continue
        p.push({
          kind: 2,
          x: c / cols,
          y: r / rows + Math.random() * (1 / rows),
          ch: rchar(),
          a: 0.10 + Math.random() * 0.20,
          ttl: 30 + Math.floor(Math.random() * 150),
        })
      }
    }

    // Ambient floating characters
    for (let i = 0; i < 40; i++) {
      p.push({
        kind: 3,
        x: 0.04 + Math.random() * 0.92,
        y: 0.02 + Math.random() * 0.94,
        vx: (Math.random() - 0.5) * 0.00012,
        vy: (Math.random() - 0.5) * 0.00012,
        ch: rchar(),
        a: 0.04 + Math.random() * 0.09,
        sz: 6 + Math.random() * 3,
        ttl: 60 + Math.floor(Math.random() * 200),
      })
    }

    particlesRef.current = p
  }, [])

  // Responsive check
  useEffect(() => {
    const chk = () => setMobile(window.innerWidth < 768)
    chk()
    window.addEventListener("resize", chk)
    return () => window.removeEventListener("resize", chk)
  }, [])

  // Canvas animation
  useEffect(() => {
    if (mobile) return
    const cvs = canvasRef.current
    if (!cvs) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const resize = () => {
      const r = cvs.getBoundingClientRect()
      cvs.width = r.width * dpr
      cvs.height = r.height * dpr
      const c = cvs.getContext("2d")
      if (c) c.scale(dpr, dpr)
    }
    resize()
    init()

    const ctx = cvs.getContext("2d")
    if (!ctx) return

    // Screen pixel bounds
    const screenRect = () => {
      const r = cvs.getBoundingClientRect()
      return {
        x0: 0.19 * r.width,
        x1: 0.81 * r.width,
        y0: 0.10 * r.height,
        y1: 0.48 * r.height,
      }
    }

    const frame = () => {
      const r = cvs.getBoundingClientRect()
      const w = r.width, h = r.height
      ctx.clearRect(0, 0, w, h)
      ctx.textBaseline = "middle"
      ctx.textAlign = "center"

      const sr = screenRect()
      const sw = sr.x1 - sr.x0, sh = sr.y1 - sr.y0

      for (const p of particlesRef.current) {
        // Refresh character
        p.ttl--
        if (p.ttl <= 0) {
          p.ch = rchar()
          p.ttl = 20 + Math.floor(Math.random() * 120)
        }

        if (p.kind === 0) {
          // ── Loop swarm ──
          p.t += p.spd
          if (p.t > 1) p.t -= 1
          if (p.t < 0) p.t += 1

          // Spark lifecycle
          if (p.spark > 0) p.spark *= 0.9975
          if (p.spark < 0.005) p.spark = 0
          if (Math.random() > 0.9996) p.spark = 0.4 + Math.random() * 0.6

          const [nx, ny] = onLoop(LOOPS[p.loop], p.t)
          const x = nx * w, y = ny * h
          const fa = Math.min(p.a + p.spark * 0.7, 1)

          // Glow halo for sparks
          if (p.spark > 0.25) {
            ctx.font = `${p.sz + 4}px ui-monospace,SFMono-Regular,monospace`
            ctx.fillStyle = `rgba(128,128,128,${fa * 0.08})`
            ctx.fillText(p.ch, x, y)
          }
          ctx.font = `${p.sz}px ui-monospace,SFMono-Regular,monospace`
          ctx.fillStyle = `rgba(128,128,128,${fa})`
          ctx.fillText(p.ch, x, y)

        } else if (p.kind === 1) {
          // ── Segment bounce ──
          p.t += p.spd
          if (p.t > 1 || p.t < 0) {
            p.spd *= -1
            p.t = Math.max(0, Math.min(1, p.t))
          }
          const [nx, ny] = onSeg(SEGMENTS[p.seg], p.t)
          ctx.font = `${p.sz}px ui-monospace,SFMono-Regular,monospace`
          ctx.fillStyle = `rgba(128,128,128,${p.a})`
          ctx.fillText(p.ch, nx * w, ny * h)

        } else if (p.kind === 2) {
          // ── Screen content drift ──
          p.y -= 0.00012
          if (p.y < -0.02) { p.y += 1.04; p.ch = rchar() }

          const px = sr.x0 + p.x * sw + 6
          const py = sr.y0 + p.y * sh

          // Feather at top/bottom screen edges
          const fade = Math.min(
            (py - sr.y0) / (sh * 0.12),
            (sr.y1 - py) / (sh * 0.12),
            1,
          )
          if (fade <= 0) continue

          ctx.font = "7px ui-monospace,SFMono-Regular,monospace"
          ctx.fillStyle = `rgba(128,128,128,${p.a * Math.max(0, fade)})`
          ctx.fillText(p.ch, px, py)

        } else {
          // ── Ambient ──
          p.x += p.vx
          p.y += p.vy
          if (p.x < 0.02 || p.x > 0.98) p.vx *= -1
          if (p.y < 0.01 || p.y > 0.97) p.vy *= -1

          ctx.font = `${p.sz}px ui-monospace,SFMono-Regular,monospace`
          ctx.fillStyle = `rgba(128,128,128,${p.a})`
          ctx.fillText(p.ch, p.x * w, p.y * h)
        }
      }

      rafRef.current = requestAnimationFrame(frame)
    }

    frame()

    const onResize = () => { resize(); init() }
    window.addEventListener("resize", onResize)
    return () => {
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener("resize", onResize)
    }
  }, [mobile, init])

  if (mobile) return null

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none"
      aria-hidden="true"
      style={{
        width: "100%",
        height: "100%",
        opacity: 0.22,
        maskImage:
          "radial-gradient(ellipse 42% 32% at 50% 36%, rgba(0,0,0,0.10) 0%, rgba(0,0,0,0.45) 50%, black 100%)",
        WebkitMaskImage:
          "radial-gradient(ellipse 42% 32% at 50% 36%, rgba(0,0,0,0.10) 0%, rgba(0,0,0,0.45) 50%, black 100%)",
      }}
    />
  )
}
