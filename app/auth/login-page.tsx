"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  signInWithGoogle,

  signUpWithEmail,
  signInWithEmail,
  signInWithMagicLink,
  resetPassword,
} from "@/lib/api"
import { validateEmailForSignup } from "@/lib/email-validation"
import { createClient } from "@/lib/supabase/client"
import Link from "next/link"
import { useState, useEffect, useRef, useMemo, memo } from "react"
import { captureUtmParams, trackSignIn, trackSignUp } from "@/lib/posthog/analytics"
import { HeaderGoBack } from "../components/header-go-back"
import { useRouter, useSearchParams } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"
import { CoastyIcon } from "@/components/icons/coasty"
import { ArrowUp, Copy, Check } from "lucide-react"
import { useTranslations } from "next-intl"
import { detectInAppBrowser } from "@/lib/detect-in-app-browser"

/* ── Cinematic loop constants ── */

const CINE_VIDEO_IDS = [
  "icxgLDephHE",
  "qTvmGfg3HVw",
  "Wbo2o74hVIo",
  "mH-csaCa508",
  "AnHJuRMLCnE",
  "A_OvNh51Npg",
]

const CINE_INITIAL_TEXT = "Show me what\u2019s possible\u2026"
const CINE_TASKS = [
  "Research my competitors",
  "Fill out job applications",
  "Book a flight to Tokyo",
  "Track my website uptime",
  "Schedule social posts",
  "Analyze quarterly trends",
]

const CINE_SPAWN_ORDER = [1, 4, 0, 2, 3, 5]
const CINE_SPAWN_RANK: number[] = []
CINE_SPAWN_ORDER.forEach((thumbIdx, rank) => {
  CINE_SPAWN_RANK[thumbIdx] = rank
})

const CINE_EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const
const CINE_EASE_OUT_BACK = [0.34, 1.3, 0.64, 1] as const
const CINE_EASE_IN_QUAD = [0.26, 0, 0.6, 0.2] as const

const CINE_SHOWCASE = [
  { left: 30, top: 28, rotate: -5, scale: 0.85 },
  { left: 50, top: 24, rotate: 1, scale: 0.9 },
  { left: 70, top: 28, rotate: 4, scale: 0.85 },
  { left: 30, top: 72, rotate: 4, scale: 0.82 },
  { left: 50, top: 76, rotate: -2, scale: 0.85 },
  { left: 70, top: 72, rotate: -4, scale: 0.82 },
]

const CINE_DRIFT = [
  { dx: 5, dy: 4, durX: 6, durY: 5 },
  { dx: -4, dy: 5, durX: 7, durY: 5.5 },
  { dx: -5, dy: -3, durX: 5.5, durY: 6 },
  { dx: 4, dy: -4, durX: 6.5, durY: 5 },
  { dx: 3, dy: 4, durX: 5, durY: 5.8 },
  { dx: -4, dy: -5, durX: 6, durY: 5.2 },
]

const CT = {
  CHAR_INITIAL: 32,
  CHAR_TASK: 24,
  PAUSE_AFTER_TYPE: 200,
  SEND_HOLD: 300,
  CLEAR_DUR: 160,
  HERO_HOLD: 800,
  EXIT_THUMB_DUR: 800,
  EXIT_THUMB_STAGGER: 80,
  EXIT_WAIT: 1300,
  TAGLINE_FADE_IN: 600,
  TAGLINE_HOLD: 2500,
  TAGLINE_FADE_OUT: 500,
  RESET_PAUSE: 1200,
} as const

type CinePhase = "cycling" | "hero" | "exit" | "tagline" | "resetting" | "idle"
type CineStep = "typing" | "sent" | "clearing"

/* ── Left Brand Panel — Looping Cinematic ── */
function LeftBrandPanel() {
  const [cycle, setCycle] = useState(0)

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
      className="hidden lg:flex relative flex-[1.4] xl:flex-[1.6] flex-col min-h-dvh overflow-hidden bg-black"
    >
      {/* Background — pure black */}

      {/* Cinematic animation */}
      <CinematicLoop key={cycle} onLoop={() => setCycle((c) => c + 1)} />
    </motion.div>
  )
}

/* ── Looping cinematic animation ── */
function CinematicLoop({ onLoop }: { onLoop: () => void }) {
  const [phase, setPhase] = useState<CinePhase>("cycling")
  const [taskIdx, setTaskIdx] = useState(-1)
  const [step, setStep] = useState<CineStep>("typing")
  const [revealed, setRevealed] = useState(0)
  const textRef = useRef<HTMLSpanElement>(null)
  const onLoopRef = useRef(onLoop)
  onLoopRef.current = onLoop

  const text = taskIdx === -1 ? CINE_INITIAL_TEXT : CINE_TASKS[taskIdx]
  const isLast = taskIdx === CINE_TASKS.length - 1

  // Preload thumbnails
  useEffect(() => {
    CINE_VIDEO_IDS.forEach((id) => {
      const img = new window.Image()
      img.src = `https://img.youtube.com/vi/${id}/mqdefault.jpg`
    })
  }, [])

  // 1. Typing
  useEffect(() => {
    if (phase !== "cycling" || step !== "typing") return
    const el = textRef.current
    if (!el) return
    el.textContent = ""
    const charMs = taskIdx === -1 ? CT.CHAR_INITIAL : CT.CHAR_TASK
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
        setTimeout(() => setStep("sent"), CT.PAUSE_AFTER_TYPE)
        return
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [phase, step, text, taskIdx])

  // 2. Sent
  useEffect(() => {
    if (phase !== "cycling" || step !== "sent") return
    if (taskIdx >= 0) setRevealed((c) => c + 1)
    const t = setTimeout(() => {
      if (taskIdx >= 0 && isLast) {
        setPhase("hero")
      } else {
        setStep("clearing")
      }
    }, CT.SEND_HOLD)
    return () => clearTimeout(t)
  }, [phase, step, taskIdx, isLast])

  // 3. Clearing
  useEffect(() => {
    if (phase !== "cycling" || step !== "clearing") return
    const t = setTimeout(() => {
      setTaskIdx((i) => i + 1)
      setStep("typing")
    }, CT.CLEAR_DUR)
    return () => clearTimeout(t)
  }, [phase, step])

  // 4. Phase progression
  useEffect(() => {
    if (phase === "hero") {
      const t = setTimeout(() => setPhase("exit"), CT.HERO_HOLD)
      return () => clearTimeout(t)
    }
    if (phase === "exit") {
      const t = setTimeout(() => setPhase("tagline"), CT.EXIT_WAIT)
      return () => clearTimeout(t)
    }
    if (phase === "tagline") {
      const t = setTimeout(
        () => setPhase("resetting"),
        CT.TAGLINE_FADE_IN + CT.TAGLINE_HOLD + CT.TAGLINE_FADE_OUT
      )
      return () => clearTimeout(t)
    }
    if (phase === "resetting") {
      const t = setTimeout(() => onLoopRef.current(), CT.RESET_PAUSE)
      return () => clearTimeout(t)
    }
  }, [phase])

  const inputVisible = phase === "cycling" || phase === "hero" || phase === "exit"

  return (
    <div
      className="absolute inset-0 z-10 overflow-hidden"
      style={{ perspective: "800px", perspectiveOrigin: "50% 50%" }}
    >
      {/* Drift keyframes */}
      <style dangerouslySetInnerHTML={{
        __html: `
          @keyframes auth-dx{0%,100%{transform:translateX(0)}50%{transform:translateX(var(--dx))}}
          @keyframes auth-dy{0%,100%{transform:translateY(0)}50%{transform:translateY(var(--dy))}}
          .auth-fx{animation:auth-dx var(--tx) ease-in-out infinite}
          .auth-fy{animation:auth-dy var(--ty) ease-in-out infinite}
        `,
      }} />

      {/* Thumbnails */}
      {CINE_VIDEO_IDS.map((id, i) => (
        <CineThumb
          key={id}
          videoId={id}
          index={i}
          phase={phase}
          revealed={CINE_SPAWN_RANK[i] < revealed}
        />
      ))}

      {/* Chat input mock */}
      <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{
            opacity: inputVisible ? 1 : 0,
            y: inputVisible ? 0 : 16,
            scale: inputVisible ? 1 : 0.97,
          }}
          transition={{
            duration: inputVisible ? 0.5 : 0.4,
            ease: CINE_EASE_OUT_EXPO,
          }}
          className="w-[88%] max-w-md"
        >
          <div className="relative rounded-xl bg-white/[0.07] backdrop-blur-sm border border-white/[0.08] shadow-2xl">
            <div className="min-h-[38px] px-3.5 pt-2.5 pb-0.5 text-[14px] leading-[1.3] text-white/90">
              <motion.span
                key={taskIdx}
                ref={textRef}
                initial={taskIdx > -1 ? { opacity: 0 } : false}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.1 }}
              />
              {step === "typing" && phase === "cycling" && (
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [1, 0] }}
                  transition={{ duration: 0.5, repeat: Infinity, repeatType: "reverse", ease: "easeInOut" }}
                  className="ml-px inline-block h-[1.1em] w-[1.5px] rounded-full bg-white/40 align-text-bottom"
                />
              )}
            </div>
            <div className="flex w-full items-center justify-end px-2 pb-2">
              <motion.div
                animate={{ scale: step === "sent" ? [1, 1.15, 1] : 1 }}
                transition={{ duration: 0.25, ease: CINE_EASE_OUT_BACK }}
                className="flex h-6 w-6 items-center justify-center rounded-full bg-white/90"
              >
                <ArrowUp size={12} strokeWidth={2.5} className="text-zinc-900" />
              </motion.div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Tagline */}
      {(phase === "tagline" || phase === "resetting") && (
        <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
          <motion.h1
            initial={{ opacity: 0, y: 10 }}
            animate={{
              opacity: phase === "tagline" ? [0, 1, 1, 0] : 0,
              y: phase === "tagline" ? [10, 0, 0, -4] : -4,
            }}
            transition={{
              duration: (CT.TAGLINE_FADE_IN + CT.TAGLINE_HOLD + CT.TAGLINE_FADE_OUT) / 1000,
              times: [0, 0.18, 0.82, 1],
              ease: CINE_EASE_OUT_EXPO,
            }}
            className="max-w-sm px-8 text-center text-[clamp(20px,2.8vw,32px)] font-semibold leading-[1.2] tracking-[-0.03em] text-white"
          >
            Do anything a human can do with a computer
          </motion.h1>
        </div>
      )}

      {/* Soft vignette */}
      <div
        className="absolute inset-0 z-[2] pointer-events-none"
        style={{
          background: "radial-gradient(ellipse 75% 65% at 50% 50%, transparent 25%, black 85%)",
        }}
      />
    </div>
  )
}

/* ── Cinematic thumbnail ── */
const CineThumb = memo(function CineThumb({
  videoId,
  index,
  phase,
  revealed,
}: {
  videoId: string
  index: number
  phase: CinePhase
  revealed: boolean
}) {
  const s = CINE_SHOWCASE[index]
  const d = CINE_DRIFT[index]
  const exiting = phase === "exit" || phase === "tagline" || phase === "resetting"
  const floating = revealed && !exiting

  const exitRank = CINE_SPAWN_ORDER.indexOf(index)

  const target = (() => {
    if (exiting && revealed) {
      return { x: "-50%", y: "-50%", z: 700, scale: 2.5, rotate: s.rotate, opacity: 0 }
    }
    if (revealed) {
      return { x: "-50%", y: "-50%", z: 0, scale: s.scale, rotate: s.rotate, opacity: 0.8 }
    }
    return { x: "-50%", y: "-50%", z: 0, scale: 0, rotate: -15 + index * 5, opacity: 0 }
  })()

  const transition = exiting
    ? {
        duration: CT.EXIT_THUMB_DUR / 1000,
        ease: CINE_EASE_IN_QUAD,
        delay: exitRank * (CT.EXIT_THUMB_STAGGER / 1000),
        opacity: { ease: [0.7, 0, 1, 1], duration: CT.EXIT_THUMB_DUR / 1000 },
      }
    : { duration: 0.75, ease: CINE_EASE_OUT_BACK }

  return (
    <motion.div
      className="absolute z-[5]"
      style={{ left: `${s.left}%`, top: `${s.top}%` }}
      initial={{ x: "-50%", y: "-50%", z: 0, scale: 0, rotate: -15 + index * 5, opacity: 0 }}
      animate={target}
      transition={transition}
    >
      <div
        className={floating ? "auth-fx" : undefined}
        style={floating ? ({ "--dx": `${d.dx}px`, "--tx": `${d.durX}s` } as React.CSSProperties) : undefined}
      >
        <div
          className={floating ? "auth-fy" : undefined}
          style={floating ? ({ "--dy": `${d.dy}px`, "--ty": `${d.durY}s` } as React.CSSProperties) : undefined}
        >
          <div className="w-[140px] xl:w-[170px] aspect-video rounded-lg overflow-hidden shadow-md ring-1 ring-white/[0.06]">
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
            <div className="absolute inset-0 bg-black/20" />
          </div>
        </div>
      </div>
    </motion.div>
  )
})

type AuthView = "sign-in" | "sign-up" | "magic-link" | "forgot-password"

export default function LoginPage() {
  const t = useTranslations("auth")
  const te = useTranslations("auth.errors")
  const ts = useTranslations("auth.success")

  const viewTitleMap: Record<AuthView, string> = {
    "sign-in": t("viewTitles.signIn"),
    "sign-up": t("viewTitles.signUp"),
    "magic-link": t("viewTitles.magicLink"),
    "forgot-password": t("viewTitles.forgotPassword"),
  }

  const viewDescriptionMap: Record<AuthView, string> = {
    "sign-in": t("viewDescriptions.signIn"),
    "sign-up": t("viewDescriptions.signUp"),
    "magic-link": t("viewDescriptions.magicLink"),
    "forgot-password": t("viewDescriptions.forgotPassword"),
  }

  const [isLoading, setIsLoading] = useState(false)
  const isAnonymousLoading = false // guest system removed
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [authView, setAuthView] = useState<AuthView>("sign-in")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showInAppBrowserNotice, setShowInAppBrowserNotice] = useState(false)
  const [copied, setCopied] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const inAppBrowser = useMemo(() => detectInAppBrowser(), [])

  useEffect(() => {
    const ref = searchParams.get("ref")
    if (ref) {
      localStorage.setItem("coasty_referral_code", ref)
    }
    captureUtmParams()
  }, [searchParams])

  function switchView(view: AuthView) {
    setAuthView(view)
    setError(null)
    setSuccess(null)
  }

  async function handleSignInWithGoogle() {
    // In-app browsers (LinkedIn, Facebook, etc.) block Google OAuth
    if (inAppBrowser.isInApp) {
      setShowInAppBrowserNotice(true)
      setError(null)
      return
    }

    const supabase = createClient()
    if (!supabase) {
      throw new Error(te("supabaseNotConfigured"))
    }

    try {
      setIsLoading(true)
      setError(null)
      setSuccess(null)

      const data = await signInWithGoogle(supabase)

      if (data?.url) {
        trackSignIn("google")
        window.location.href = data.url
      }
    } catch (err: unknown) {
      console.error("Error signing in with Google:", err)
      setError(
        (err as Error).message ||
          te("unexpectedError")
      )
    } finally {
      setIsLoading(false)
    }
  }

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback for older browsers
      const input = document.createElement("input")
      input.value = window.location.href
      document.body.appendChild(input)
      input.select()
      document.execCommand("copy")
      document.body.removeChild(input)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  async function handleEmailSignIn(e: React.FormEvent) {
    e.preventDefault()
    const supabase = createClient()
    if (!supabase) {
      setError(te("supabaseNotConfigured"))
      return
    }

    if (!email || !password) {
      setError(te("fillAllFields"))
      return
    }

    try {
      setIsLoading(true)
      setError(null)
      setSuccess(null)

      const data = await signInWithEmail(supabase, email, password)

      if (data?.user) {
        trackSignIn("email")
        // Hard navigation, not router.push.
        //
        // Why: signInWithPassword sets the auth cookie via a Set-Cookie
        // response, but the React Server Component cache for "/" was
        // already populated (unauthenticated) when the user landed on
        // /auth/login. router.push does a client-side nav that reuses
        // that cached RSC payload, so the home page renders with
        // isAuthenticated=false and shows the LandingPage cinematic.
        // Only on a manual refresh does Next.js re-fetch "/" with the
        // new cookie, see the user, and render the chat.
        //
        // We saw the symmetrical bug for sign-OUT — see the comment in
        // lib/user-store/provider.tsx around `signOut`. Same fix
        // applies here: full-page navigation guarantees the auth cookie
        // is on the request, every server component re-runs, every
        // provider re-initializes with the fresh user, and the URL is
        // replaced (not pushed) so Back doesn't return to /auth/login.
        if (typeof window !== "undefined") {
          window.location.replace("/")
        }
        return
      }
    } catch (err: unknown) {
      const message = (err as Error).message
      // SECURITY (P1-05): Do NOT differentiate "Email not confirmed" vs
      // "Invalid login credentials" — both leak account existence to a
      // network-observer. Show a single generic error to the user; log the
      // underlying reason locally for operator diagnostics only.
      console.error("[auth] Sign-in failed:", message)
      setError(te("invalidCredentials"))
    } finally {
      setIsLoading(false)
    }
  }

  async function handleEmailSignUp(e: React.FormEvent) {
    e.preventDefault()
    const supabase = createClient()
    if (!supabase) {
      setError(te("supabaseNotConfigured"))
      return
    }

    if (!email || !password || !confirmPassword) {
      setError(te("fillAllFields"))
      return
    }

    if (password.length < 6) {
      setError(te("passwordMinLength"))
      return
    }

    if (password !== confirmPassword) {
      setError(te("passwordsDoNotMatch"))
      return
    }

    try {
      setIsLoading(true)
      setError(null)
      setSuccess(null)

      // Validate email against 121k+ disposable domains (server-side check)
      const validation = await validateEmailForSignup(email)
      if (!validation.valid) {
        setError(validation.error || te("invalidEmail"))
        return
      }

      const data = await signUpWithEmail(supabase, validation.normalized || email, password)

      if (data?.user?.identities?.length === 0) {
        setError(te("emailAlreadyExists"))
        return
      }

      trackSignUp("email")
      setSuccess(ts("checkEmailConfirm"))
      setEmail("")
      setPassword("")
      setConfirmPassword("")
    } catch (err: unknown) {
      setError((err as Error).message || te("signUpFailed"))
    } finally {
      setIsLoading(false)
    }
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault()
    const supabase = createClient()
    if (!supabase) {
      setError(te("supabaseNotConfigured"))
      return
    }

    if (!email) {
      setError(te("enterEmail"))
      return
    }

    try {
      setIsLoading(true)
      setError(null)
      setSuccess(null)

      await signInWithMagicLink(supabase, email)
      trackSignIn("magic_link")
      // SECURITY (P1-02): Always show the same "check your email" success
      // toast — the lib/api wrapper swallows the "Signups not allowed for
      // otp" error so the existing-user and unknown-user paths are
      // indistinguishable client-side.
      setSuccess(ts("checkEmailMagicLink"))
    } catch (err: unknown) {
      // Genuine errors only at this point (network, throttling, malformed
      // email). The account-enumeration error has already been swallowed
      // upstream in lib/api.signInWithMagicLink.
      const message = (err as Error).message
      setError(message || te("magicLinkFailed"))
    } finally {
      setIsLoading(false)
    }
  }

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault()
    const supabase = createClient()
    if (!supabase) {
      setError(te("supabaseNotConfigured"))
      return
    }

    if (!email) {
      setError(te("enterEmail"))
      return
    }

    try {
      setIsLoading(true)
      setError(null)
      setSuccess(null)

      await resetPassword(supabase, email)
      setSuccess(ts("checkEmailReset"))
    } catch (err: unknown) {
      setError((err as Error).message || te("resetFailed"))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="relative flex min-h-dvh w-full flex-row bg-background">
      {/* Left brand panel — visible on lg+ */}
      <LeftBrandPanel />

      {/* Right form panel */}
      <div className="relative flex flex-1 flex-col min-h-dvh">
        <HeaderGoBack href="/" />

        <main className="relative flex flex-1 flex-col items-center justify-center z-10 py-4 sm:py-10 px-4 sm:px-6 lg:px-16">
          <div className="flex items-center justify-center w-full max-w-[420px]">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="w-full max-w-[420px]"
          >
            {/* Mobile-only heading */}
            <div className="lg:hidden text-center mb-5 sm:mb-8">
              <div className="flex justify-center mb-3">
                <CoastyIcon className="size-7 sm:size-8" />
              </div>
              <h1 className="text-foreground text-2xl sm:text-4xl font-medium tracking-tight">
                {t("mobileHeading")}
              </h1>
              <p className="text-muted-foreground mt-2 text-sm sm:text-base">
                {t("mobileSubheading")}
              </p>
            </div>

            {/* Form card */}
            <div className="rounded-2xl border border-border/50 bg-card/50 backdrop-blur-sm p-5 sm:p-8 shadow-sm">
              {/* Dynamic title */}
              <AnimatePresence mode="wait">
                <motion.div
                  key={authView}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.2 }}
                  className="mb-4 sm:mb-6"
                >
                  <h2 className="text-foreground text-xl font-medium tracking-tight">
                    {viewTitleMap[authView]}
                  </h2>
                  <p className="text-muted-foreground text-sm mt-1">
                    {viewDescriptionMap[authView]}
                  </p>
                </motion.div>
              </AnimatePresence>

              {/* Error / Success banners */}
              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mb-4 overflow-hidden"
                  >
                    <div className="bg-destructive/10 text-destructive rounded-lg px-4 py-3 text-sm">
                      {error}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence>
                {success && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mb-4 overflow-hidden"
                  >
                    <div className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-lg px-4 py-3 text-sm">
                      {success}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="space-y-4">
                {/* In-app browser notice */}
                <AnimatePresence>
                  {showInAppBrowserNotice && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-4 space-y-3">
                        <p className="text-sm text-foreground/80 leading-relaxed">
                          {inAppBrowser.appName
                            ? t("inAppBrowser.blockedNamed", { app: inAppBrowser.appName })
                            : t("inAppBrowser.blocked")}
                        </p>
                        <div className="flex gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            className="flex-1 h-9 text-xs gap-1.5 rounded-lg"
                            onClick={handleCopyLink}
                          >
                            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                            {copied ? t("inAppBrowser.copied") : t("inAppBrowser.copyLink")}
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            className="flex-1 h-9 text-xs gap-1.5 rounded-lg"
                            onClick={() => {
                              setShowInAppBrowserNotice(false)
                              switchView("magic-link")
                            }}
                          >
                            {t("inAppBrowser.useMagicLink")}
                          </Button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Google OAuth */}
                <Button
                  variant="secondary"
                  className="w-full h-11 text-sm font-medium gap-3 rounded-xl"
                  onClick={handleSignInWithGoogle}
                  disabled={isLoading || isAnonymousLoading}
                >
                  <svg className="size-4" viewBox="0 0 24 24">
                    <path
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                      fill="#4285F4"
                    />
                    <path
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      fill="#34A853"
                    />
                    <path
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      fill="#FBBC05"
                    />
                    <path
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      fill="#EA4335"
                    />
                  </svg>
                  <span>
                    {isLoading && authView === "sign-in" && !email
                      ? t("google.connecting")
                      : t("google.continueWithGoogle")}
                  </span>
                </Button>

                {/* Divider */}
                <div className="relative flex items-center gap-3 py-1">
                  <div className="h-px flex-1 bg-border/60" />
                  <span className="text-[11px] uppercase tracking-widest text-muted-foreground/50 font-medium select-none">
                    {t("or")}
                  </span>
                  <div className="h-px flex-1 bg-border/60" />
                </div>

                {/* Forms */}
                <AnimatePresence mode="wait">
                  <motion.div
                    key={authView}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                  >
                    {authView === "sign-in" && (
                      <form onSubmit={handleEmailSignIn} className="space-y-3">
                        <div className="space-y-1.5">
                          <Label htmlFor="email" className="text-xs font-medium text-muted-foreground">
                            {t("email")}
                          </Label>
                          <Input
                            id="email"
                            type="email"
                            placeholder={t("emailPlaceholder")}
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            disabled={isLoading}
                            autoComplete="email"
                            className="h-11 rounded-xl bg-background/50"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="password" className="text-xs font-medium text-muted-foreground">
                            {t("password")}
                          </Label>
                          <Input
                            id="password"
                            type="password"
                            placeholder={t("passwordPlaceholder")}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            disabled={isLoading}
                            autoComplete="current-password"
                            className="h-11 rounded-xl bg-background/50"
                          />
                        </div>
                        <Button
                          type="submit"
                          className="w-full h-11 rounded-xl font-medium"
                          disabled={isLoading}
                        >
                          {isLoading ? t("signingIn") : t("signIn")}
                        </Button>
                        <div className="flex items-center justify-between text-[13px] pt-1">
                          <button
                            type="button"
                            onClick={() => switchView("forgot-password")}
                            className="text-muted-foreground hover:text-foreground transition-colors"
                          >
                            {t("forgotPassword")}
                          </button>
                          <button
                            type="button"
                            onClick={() => switchView("magic-link")}
                            className="text-muted-foreground hover:text-foreground transition-colors"
                          >
                            {t("useMagicLink")}
                          </button>
                        </div>
                        <p className="text-center text-[13px] text-muted-foreground pt-2">
                          {t("dontHaveAccount")}{" "}
                          <button
                            type="button"
                            onClick={() => switchView("sign-up")}
                            className="text-foreground hover:underline font-medium"
                          >
                            {t("signUp")}
                          </button>
                        </p>
                      </form>
                    )}

                    {authView === "sign-up" && (
                      <form onSubmit={handleEmailSignUp} className="space-y-3">
                        <div className="space-y-1.5">
                          <Label htmlFor="signup-email" className="text-xs font-medium text-muted-foreground">
                            {t("email")}
                          </Label>
                          <Input
                            id="signup-email"
                            type="email"
                            placeholder={t("emailPlaceholder")}
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            disabled={isLoading}
                            autoComplete="email"
                            className="h-11 rounded-xl bg-background/50"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="signup-password" className="text-xs font-medium text-muted-foreground">
                            {t("password")}
                          </Label>
                          <Input
                            id="signup-password"
                            type="password"
                            placeholder={t("minChars")}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            disabled={isLoading}
                            autoComplete="new-password"
                            className="h-11 rounded-xl bg-background/50"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="signup-confirm" className="text-xs font-medium text-muted-foreground">
                            {t("confirmPassword")}
                          </Label>
                          <Input
                            id="signup-confirm"
                            type="password"
                            placeholder={t("confirmPasswordPlaceholder")}
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            disabled={isLoading}
                            autoComplete="new-password"
                            className="h-11 rounded-xl bg-background/50"
                          />
                        </div>
                        <Button
                          type="submit"
                          className="w-full h-11 rounded-xl font-medium"
                          disabled={isLoading}
                        >
                          {isLoading ? t("creatingAccount") : t("createAccount")}
                        </Button>
                        <p className="text-center text-[13px] text-muted-foreground pt-2">
                          {t("alreadyHaveAccount")}{" "}
                          <button
                            type="button"
                            onClick={() => switchView("sign-in")}
                            className="text-foreground hover:underline font-medium"
                          >
                            {t("signIn")}
                          </button>
                        </p>
                      </form>
                    )}

                    {authView === "magic-link" && (
                      <form onSubmit={handleMagicLink} className="space-y-3">
                        <div className="space-y-1.5">
                          <Label htmlFor="magic-email" className="text-xs font-medium text-muted-foreground">
                            {t("email")}
                          </Label>
                          <Input
                            id="magic-email"
                            type="email"
                            placeholder={t("emailPlaceholder")}
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            disabled={isLoading}
                            autoComplete="email"
                            className="h-11 rounded-xl bg-background/50"
                          />
                        </div>
                        <Button
                          type="submit"
                          className="w-full h-11 rounded-xl font-medium"
                          disabled={isLoading}
                        >
                          {isLoading ? t("sending") : t("sendMagicLink")}
                        </Button>
                        <p className="text-center text-[13px] text-muted-foreground pt-2">
                          <button
                            type="button"
                            onClick={() => switchView("sign-in")}
                            className="text-foreground hover:underline font-medium"
                          >
                            {t("backToSignIn")}
                          </button>
                        </p>
                      </form>
                    )}

                    {authView === "forgot-password" && (
                      <form onSubmit={handleForgotPassword} className="space-y-3">
                        <div className="space-y-1.5">
                          <Label htmlFor="reset-email" className="text-xs font-medium text-muted-foreground">
                            {t("email")}
                          </Label>
                          <Input
                            id="reset-email"
                            type="email"
                            placeholder={t("emailPlaceholder")}
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            disabled={isLoading}
                            autoComplete="email"
                            className="h-11 rounded-xl bg-background/50"
                          />
                        </div>
                        <Button
                          type="submit"
                          className="w-full h-11 rounded-xl font-medium"
                          disabled={isLoading}
                        >
                          {isLoading ? t("sending") : t("sendResetLink")}
                        </Button>
                        <p className="text-center text-[13px] text-muted-foreground pt-2">
                          <button
                            type="button"
                            onClick={() => switchView("sign-in")}
                            className="text-foreground hover:underline font-medium"
                          >
                            {t("backToSignIn")}
                          </button>
                        </p>
                      </form>
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>

            {/* Footer */}
            <div className="mt-4 sm:mt-6 text-center">
              <p className="text-[12px] text-muted-foreground/60 leading-relaxed">
                {t("termsAgreement")}{" "}
                <Link href="/terms" className="text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2">
                  {t("terms")}
                </Link>{" "}
                {t("and")}{" "}
                <Link href="/privacy" className="text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2">
                  {t("privacyPolicy")}
                </Link>
              </p>
            </div>
          </motion.div>
          </div>
        </main>
      </div>
    </div>
  )
}
