"use client"

import { motion, useReducedMotion } from "motion/react"
import { useTranslations } from "next-intl"
import { useState, useEffect, useRef, useCallback, memo } from "react"
import { ArrowUp } from "lucide-react"

// ─────────────────────────────────────────────────────────────────────────────
// Mobile detection
// ─────────────────────────────────────────────────────────────────────────────

function useIsMobile(breakpoint = 640) {
  const [mobile, setMobile] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`)
    setMobile(mq.matches)
    const handler = (e: MediaQueryListEvent) => setMobile(e.matches)
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [breakpoint])
  return mobile
}

// ─────────────────────────────────────────────────────────────────────────────
// Thumbnail data
// ─────────────────────────────────────────────────────────────────────────────

const VIDEO_IDS = [
  "icxgLDephHE",
  "qTvmGfg3HVw",
  "Wbo2o74hVIo",
  "mH-csaCa508",
  "AnHJuRMLCnE",
  "A_OvNh51Npg",
]

// ─────────────────────────────────────────────────────────────────────────────
// Copy
// ─────────────────────────────────────────────────────────────────────────────

// INITIAL_TEXT and TASKS now sourced from the cinematicIntro namespace
// via useTranslations inside the component, so the typed prompts render
// in the user's locale. Length and indexing semantics are unchanged.

// ─────────────────────────────────────────────────────────────────────────────
// Animation constants
// ─────────────────────────────────────────────────────────────────────────────

// Spawn order: top-center, bottom-center, then alternating sides
const SPAWN_ORDER = [1, 4, 0, 2, 3, 5]
const SPAWN_RANK: number[] = []
SPAWN_ORDER.forEach((thumbIdx, rank) => {
  SPAWN_RANK[thumbIdx] = rank
})

// Easing curves
const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const
const EASE_OUT_BACK = [0.34, 1.3, 0.64, 1] as const // gentle overshoot
const EASE_IN_QUAD = [0.26, 0, 0.6, 0.2] as const // smooth accelerate

// Showcase grid: tightly clustered, overlapping like fanned cards
// Top row ~30%, bottom row ~70% — close to the input so they overlap each other
const SHOWCASE_DESKTOP = [
  { left: 35, top: 30, rotate: -5, scale: 0.88 },
  { left: 50, top: 27, rotate: 1, scale: 0.92 },
  { left: 65, top: 30, rotate: 4, scale: 0.88 },
  { left: 35, top: 70, rotate: 4, scale: 0.85 },
  { left: 50, top: 73, rotate: -2, scale: 0.88 },
  { left: 65, top: 70, rotate: -4, scale: 0.85 },
]

// Mobile grid: 2 columns, 3 rows — tighter, no edge clipping
const SHOWCASE_MOBILE = [
  { left: 36, top: 22, rotate: -4, scale: 0.82 },
  { left: 64, top: 20, rotate: 3, scale: 0.85 },
  { left: 34, top: 44, rotate: 2, scale: 0.8 },
  { left: 66, top: 42, rotate: -3, scale: 0.82 },
  { left: 36, top: 66, rotate: -2, scale: 0.8 },
  { left: 64, top: 68, rotate: 4, scale: 0.78 },
]

// Subtle idle drift per thumbnail (different speeds so they feel independent)
const DRIFT_DESKTOP = [
  { dx: 6, dy: 5, durX: 6, durY: 5 },
  { dx: -5, dy: 6, durX: 7, durY: 5.5 },
  { dx: -6, dy: -4, durX: 5.5, durY: 6 },
  { dx: 5, dy: -5, durX: 6.5, durY: 5 },
  { dx: 4, dy: 5, durX: 5, durY: 5.8 },
  { dx: -5, dy: -6, durX: 6, durY: 5.2 },
]

const DRIFT_MOBILE = [
  { dx: 3, dy: 3, durX: 6, durY: 5 },
  { dx: -3, dy: 3, durX: 7, durY: 5.5 },
  { dx: -3, dy: -2, durX: 5.5, durY: 6 },
  { dx: 3, dy: -3, durX: 6.5, durY: 5 },
  { dx: 2, dy: 3, durX: 5, durY: 5.8 },
  { dx: -3, dy: -3, durX: 6, durY: 5.2 },
]

// Exit stagger order — same as spawn so it mirrors
const EXIT_ORDER = SPAWN_ORDER

// ─────────────────────────────────────────────────────────────────────────────
// Timing (ms) — all in one place for easy tuning
// ─────────────────────────────────────────────────────────────────────────────

const T = {
  CHAR_INITIAL: 32, // ms per char for opening line
  CHAR_TASK: 24, // ms per char for task prompts
  PAUSE_AFTER_TYPE: 200, // after text finishes, before "send"
  SEND_HOLD: 300, // how long "sent" state shows
  CLEAR_DUR: 160, // text wipe between tasks
  HERO_HOLD: 500, // pause to admire thumbnails
  EXIT_THUMB_DUR: 900, // each thumbnail's fly-toward-camera duration
  EXIT_THUMB_STAGGER: 90, // ms between each thumbnail exiting
  EXIT_WAIT: 1450, // total wait for all thumbnails to finish
  INPUT_FADE_DUR: 500, // input fade-out duration
  INPUT_FADE_WAIT: 550, // wait for input fade before removing overlay
  TAGLINE_FADE_IN: 600, // tagline text fade in
  TAGLINE_HOLD: 3000, // how long tagline stays visible
  TAGLINE_FADE_OUT: 500, // tagline fade out
  OVERLAY_FADE: 500, // final overlay fade — matches tagline fade-out so no black gap
} as const

// ─────────────────────────────────────────────────────────────────────────────
// State machine
// ─────────────────────────────────────────────────────────────────────────────

type Phase = "cycling" | "hero" | "exit" | "inputFade" | "tagline" | "done"
type CycleStep = "typing" | "sent" | "clearing"

const DISMISS_KEY = "coasty-skip-intro"

export function shouldShowIntro(): boolean {
  if (typeof window === "undefined") return true
  return !localStorage.getItem(DISMISS_KEY)
}

export function isIntroDismissed(): boolean {
  if (typeof window === "undefined") return false
  return !!localStorage.getItem(DISMISS_KEY)
}

export function CinematicIntro({
  onSettled,
  onComplete,
}: {
  onSettled: () => void
  onComplete: () => void
}) {
  const t = useTranslations("cinematicIntro")
  const INITIAL_TEXT = t("initialText")
  const TASKS = t.raw("tasks") as string[]

  const [phase, setPhase] = useState<Phase>("cycling")
  const [taskIdx, setTaskIdx] = useState(-1) // -1 = initial prompt
  const [step, setStep] = useState<CycleStep>("typing")
  const [revealed, setRevealed] = useState(0)
  const reducedMotion = useReducedMotion()
  const isMobile = useIsMobile()
  const textRef = useRef<HTMLSpanElement>(null)

  const onSettledRef = useRef(onSettled)
  const onCompleteRef = useRef(onComplete)
  onSettledRef.current = onSettled
  onCompleteRef.current = onComplete

  const text = taskIdx === -1 ? INITIAL_TEXT : TASKS[taskIdx]
  const isLast = taskIdx === TASKS.length - 1

  // ── 1. Typing — rAF + elapsed time, guarantees identical speed on all devices
  useEffect(() => {
    if (phase !== "cycling" || step !== "typing") return
    const el = textRef.current
    if (!el) return

    el.textContent = ""
    const charMs = taskIdx === -1 ? T.CHAR_INITIAL : T.CHAR_TASK
    let rafId: number
    let start: number | null = null
    let shown = 0

    function tick(ts: number) {
      if (!start) start = ts
      const target = Math.min(Math.floor((ts - start) / charMs), text.length)
      if (target > shown) {
        shown = target
        el!.textContent = text.slice(0, shown)
      }
      if (shown >= text.length) {
        setTimeout(() => setStep("sent"), T.PAUSE_AFTER_TYPE)
        return
      }
      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [phase, step, text, taskIdx])

  // ── 2. Sent → spawn thumbnail → clear or finish ───────────────────────────
  useEffect(() => {
    if (phase !== "cycling" || step !== "sent") return
    if (taskIdx >= 0) setRevealed((c) => c + 1)
    const t = setTimeout(() => {
      if (taskIdx >= 0 && isLast) {
        setPhase("hero")
      } else {
        setStep("clearing")
      }
    }, T.SEND_HOLD)
    return () => clearTimeout(t)
  }, [phase, step, taskIdx, isLast])

  // ── 3. Clearing → next task ────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== "cycling" || step !== "clearing") return
    const t = setTimeout(() => {
      setTaskIdx((i) => i + 1)
      setStep("typing")
    }, T.CLEAR_DUR)
    return () => clearTimeout(t)
  }, [phase, step])

  // ── 4. Phase progression ───────────────────────────────────────────────────
  useEffect(() => {
    if (phase === "hero") {
      const t = setTimeout(() => setPhase("exit"), T.HERO_HOLD)
      return () => clearTimeout(t)
    }
    if (phase === "exit") {
      const t = setTimeout(() => setPhase("inputFade"), T.EXIT_WAIT)
      return () => clearTimeout(t)
    }
    if (phase === "inputFade") {
      const t = setTimeout(() => setPhase("tagline"), T.INPUT_FADE_WAIT)
      return () => clearTimeout(t)
    }
    if (phase === "tagline") {
      onSettledRef.current()
      // Start overlay fade as tagline begins fading out — no black gap
      const t = setTimeout(
        () => setPhase("done"),
        T.TAGLINE_FADE_IN + T.TAGLINE_HOLD
      )
      return () => clearTimeout(t)
    }
  }, [phase])

  // ── Preload thumbnails ─────────────────────────────────────────────────────
  useEffect(() => {
    VIDEO_IDS.forEach((id) => {
      const img = new window.Image()
      img.src = `https://img.youtube.com/vi/${id}/mqdefault.jpg`
    })
  }, [])

  // ── Skip for reduced motion ────────────────────────────────────────────────
  useEffect(() => {
    if (reducedMotion) {
      onSettledRef.current()
      onCompleteRef.current()
    }
  }, [reducedMotion])

  // ── Skip / dismiss ─────────────────────────────────────────────────────────
  const skip = useCallback(() => {
    onSettledRef.current()
    onCompleteRef.current()
  }, [])

  const dismissForever = useCallback(() => {
    localStorage.setItem(DISMISS_KEY, "1")
    setPhase("tagline")
  }, [])

  // ── Derived state ──────────────────────────────────────────────────────────
  const inputVisible = phase === "cycling" || phase === "hero" || phase === "exit"

  if (reducedMotion) return null

  return (
    <motion.div
      initial={{ opacity: 1 }}
      animate={{ opacity: phase === "done" ? 0 : 1 }}
      transition={{ duration: T.OVERLAY_FADE / 1000, ease: "easeInOut" }}
      onAnimationComplete={() => {
        if (phase === "done") onCompleteRef.current()
      }}
      className="fixed inset-0 z-[2147483647] overflow-hidden bg-background"
      style={{ perspective: "900px", perspectiveOrigin: "50% 50%" }}
    >
      {/* Drift keyframes — injected once */}
      <style dangerouslySetInnerHTML={{
        __html: `
          @keyframes cine-dx{0%,100%{transform:translateX(0)}50%{transform:translateX(var(--dx))}}
          @keyframes cine-dy{0%,100%{transform:translateY(0)}50%{transform:translateY(var(--dy))}}
          .cine-fx{animation:cine-dx var(--tx) ease-in-out infinite}
          .cine-fy{animation:cine-dy var(--ty) ease-in-out infinite}
        `,
      }} />

      {/* ── Skip / Don't show again ── */}
      {phase !== "done" && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.8, ease: EASE_OUT_EXPO }}
          className="absolute right-3 top-3 z-50 flex items-center gap-1.5 sm:right-6 sm:top-6 sm:gap-2"
        >
          <button
            type="button"
            onClick={dismissForever}
            className="hidden sm:block rounded-full px-3 py-1.5 text-[11px] font-medium tracking-wide text-muted-foreground/50 transition-colors duration-200 hover:text-muted-foreground/80"
          >
            {t("dontShowAgain")}
          </button>
          <button
            type="button"
            onClick={skip}
            className="rounded-full border border-border/40 bg-foreground/[0.04] px-3 py-1.5 text-[10px] sm:px-3.5 sm:text-[11px] font-medium tracking-wide text-muted-foreground/70 backdrop-blur-sm transition-colors duration-200 hover:bg-foreground/[0.08] hover:text-foreground/90"
          >
            {t("skip")}
          </button>
        </motion.div>
      )}

      {/* ── Thumbnails ── */}
      {VIDEO_IDS.map((id, i) => (
        <Thumb
          key={id}
          videoId={id}
          index={i}
          phase={phase}
          revealed={SPAWN_RANK[i] < revealed}
          isMobile={isMobile}
        />
      ))}

      {/* ── Chat input ── */}
      <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{
            opacity: inputVisible ? 1 : 0,
            y: inputVisible ? 0 : 20,
            scale: inputVisible ? 1 : 0.97,
          }}
          transition={{
            duration: inputVisible ? 0.6 : T.INPUT_FADE_DUR / 1000,
            ease: EASE_OUT_EXPO,
          }}
          className="w-full max-w-3xl px-3 sm:px-6 md:px-8"
        >
          <div className="relative rounded-2xl bg-neutral-100 shadow-lg dark:bg-neutral-800">
            {/* Text area */}
            <div className="min-h-[40px] sm:min-h-[44px] px-3 sm:px-4 pt-2.5 sm:pt-3 pb-1 text-[15px] sm:text-base leading-[1.3] text-foreground">
              <motion.span
                key={taskIdx}
                ref={textRef}
                initial={taskIdx > -1 ? { opacity: 0 } : false}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.1, ease: "easeOut" }}
              />
              {step === "typing" && phase === "cycling" && (
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [1, 0] }}
                  transition={{
                    duration: 0.5,
                    repeat: Infinity,
                    repeatType: "reverse",
                    ease: "easeInOut",
                  }}
                  className="ml-px inline-block h-[1.15em] w-[2px] rounded-full bg-foreground/50 align-text-bottom"
                />
              )}
            </div>

            {/* Send button */}
            <div className="flex w-full items-center justify-end px-2.5 pb-2.5 sm:px-3">
              <motion.div
                animate={{ scale: step === "sent" ? [1, 1.12, 1] : 1 }}
                transition={{ duration: 0.3, ease: EASE_OUT_BACK }}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-background"
              >
                <ArrowUp size={16} strokeWidth={2.5} />
              </motion.div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* ── Tagline ── */}
      {(phase === "tagline" || phase === "done") && (
        <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            animate={{
              opacity: [0, 1, 1, 0],
              y: [12, 0, 0, -6],
            }}
            transition={{
              duration:
                (T.TAGLINE_FADE_IN + T.TAGLINE_HOLD + T.TAGLINE_FADE_OUT) / 1000,
              times: [
                0,
                T.TAGLINE_FADE_IN / (T.TAGLINE_FADE_IN + T.TAGLINE_HOLD + T.TAGLINE_FADE_OUT),
                (T.TAGLINE_FADE_IN + T.TAGLINE_HOLD) / (T.TAGLINE_FADE_IN + T.TAGLINE_HOLD + T.TAGLINE_FADE_OUT),
                1,
              ],
              ease: EASE_OUT_EXPO,
            }}
            className="max-w-2xl px-5 sm:px-8 text-center text-[clamp(22px,5vw,44px)] font-semibold leading-[1.15] tracking-[-0.02em] sm:tracking-[-0.03em] text-shine text-foreground"
          >
            {t("tagline")}
          </motion.h1>
        </div>
      )}
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Thumbnail
// ─────────────────────────────────────────────────────────────────────────────

const Thumb = memo(function Thumb({
  videoId,
  index,
  phase,
  revealed,
  isMobile,
}: {
  videoId: string
  index: number
  phase: Phase
  revealed: boolean
  isMobile: boolean
}) {
  const s = isMobile ? SHOWCASE_MOBILE[index] : SHOWCASE_DESKTOP[index]
  const d = isMobile ? DRIFT_MOBILE[index] : DRIFT_DESKTOP[index]
  const exiting = phase === "exit" || phase === "inputFade" || phase === "tagline" || phase === "done"
  const floating = revealed && !exiting

  const exitRank = EXIT_ORDER.indexOf(index)

  const target = (() => {
    if (exiting && revealed) {
      return {
        x: "-50%",
        y: "-50%",
        z: isMobile ? 500 : 880,
        scale: isMobile ? 2.2 : 3,
        rotate: s.rotate,
        opacity: 0,
      }
    }
    if (revealed) {
      return {
        x: "-50%",
        y: "-50%",
        z: 0,
        scale: s.scale,
        rotate: s.rotate,
        opacity: isMobile ? 0.75 : 0.85,
      }
    }
    return {
      x: "-50%",
      y: "-50%",
      z: 0,
      scale: 0,
      rotate: -15 + index * 5,
      opacity: 0,
    }
  })()

  const transition = exiting
    ? {
        duration: T.EXIT_THUMB_DUR / 1000,
        ease: EASE_IN_QUAD,
        delay: exitRank * (T.EXIT_THUMB_STAGGER / 1000),
        opacity: { ease: [0.7, 0, 1, 1], duration: T.EXIT_THUMB_DUR / 1000 },
      }
    : {
        duration: 0.85,
        ease: EASE_OUT_BACK,
      }

  return (
    <motion.div
      className="absolute z-[5]"
      style={{
        left: `${s.left}%`,
        top: `${s.top}%`,
      }}
      initial={{
        x: "-50%",
        y: "-50%",
        z: 0,
        scale: 0,
        rotate: -15 + index * 5,
        opacity: 0,
      }}
      animate={target}
      transition={transition}
    >
      <div
        className={floating ? "cine-fx" : undefined}
        style={
          floating
            ? ({ "--dx": `${d.dx}px`, "--tx": `${d.durX}s` } as React.CSSProperties)
            : undefined
        }
      >
        <div
          className={floating ? "cine-fy" : undefined}
          style={
            floating
              ? ({ "--dy": `${d.dy}px`, "--ty": `${d.durY}s` } as React.CSSProperties)
              : undefined
          }
        >
          <div className="w-[130px] sm:w-[180px] md:w-[220px] aspect-video rounded-lg sm:rounded-xl overflow-hidden shadow-md ring-1 ring-foreground/[0.06]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`https://img.youtube.com/vi/${videoId}/mqdefault.jpg`}
              alt=""
              width={320}
              height={180}
              decoding="async"
              draggable={false}
              className="h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-background/10 dark:bg-background/20" />
          </div>
        </div>
      </div>
    </motion.div>
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// Tagline-only intro — shown when full intro was previously dismissed
// ─────────────────────────────────────────────────────────────────────────────

export function TaglineIntro({
  onSettled,
  onComplete,
}: {
  onSettled: () => void
  onComplete: () => void
}) {
  const t = useTranslations("cinematicIntro")
  const [phase, setPhase] = useState<"tagline" | "done">("tagline")
  const reducedMotion = useReducedMotion()

  const onSettledRef = useRef(onSettled)
  const onCompleteRef = useRef(onComplete)
  onSettledRef.current = onSettled
  onCompleteRef.current = onComplete

  useEffect(() => {
    if (reducedMotion) {
      onSettledRef.current()
      onCompleteRef.current()
      return
    }
    onSettledRef.current()
    // Start overlay fade as tagline begins fading out
    const t = setTimeout(
      () => setPhase("done"),
      T.TAGLINE_FADE_IN + T.TAGLINE_HOLD
    )
    return () => clearTimeout(t)
  }, [reducedMotion])

  if (reducedMotion) return null

  return (
    <motion.div
      initial={{ opacity: 1 }}
      animate={{ opacity: phase === "done" ? 0 : 1 }}
      transition={{ duration: T.OVERLAY_FADE / 1000, ease: "easeInOut" }}
      onAnimationComplete={() => {
        if (phase === "done") onCompleteRef.current()
      }}
      className="fixed inset-0 z-[2147483647] overflow-hidden bg-background"
    >
      <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
        <motion.h1
          initial={{ opacity: 0, y: 12 }}
          animate={{
            opacity: [0, 1, 1, 0],
            y: [12, 0, 0, -6],
          }}
          transition={{
            duration:
              (T.TAGLINE_FADE_IN + T.TAGLINE_HOLD + T.TAGLINE_FADE_OUT) / 1000,
            times: [
              0,
              T.TAGLINE_FADE_IN / (T.TAGLINE_FADE_IN + T.TAGLINE_HOLD + T.TAGLINE_FADE_OUT),
              (T.TAGLINE_FADE_IN + T.TAGLINE_HOLD) / (T.TAGLINE_FADE_IN + T.TAGLINE_HOLD + T.TAGLINE_FADE_OUT),
              1,
            ],
            ease: EASE_OUT_EXPO,
          }}
          className="max-w-2xl px-5 sm:px-8 text-center text-[clamp(22px,5vw,44px)] font-semibold leading-[1.15] tracking-[-0.02em] sm:tracking-[-0.03em] text-shine text-foreground"
        >
          {t("tagline")}
        </motion.h1>
      </div>
    </motion.div>
  )
}
