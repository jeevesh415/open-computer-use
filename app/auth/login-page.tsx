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
import { useState, useEffect } from "react"
import { captureUtmParams, trackSignIn, trackSignUp } from "@/lib/posthog/analytics"
import { HeaderGoBack } from "../components/header-go-back"
import { useRouter, useSearchParams } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"
import { CoastyIcon } from "@/components/icons/coasty"
import Image from "next/image"
import { useTranslations } from "next-intl"

/* ── Left Brand Panel ── */
function LeftBrandPanel() {
  const t = useTranslations("auth")

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
      className="hidden lg:flex relative flex-[1.4] xl:flex-[1.6] flex-col justify-center items-center min-h-dvh overflow-hidden bg-zinc-950"
    >
      {/* Ambient glow layers */}
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-950/40 via-zinc-950 to-violet-950/30" />
      <div className="absolute top-0 right-0 w-[60%] h-[50%] bg-indigo-500/[0.07] rounded-full blur-[120px]" />
      <div className="absolute bottom-0 left-0 w-[50%] h-[40%] bg-violet-500/[0.05] rounded-full blur-[100px]" />

      {/* Subtle noise texture */}
      <div
        className="absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
        }}
      />

      {/* Demo image — large, floating with perspective */}
      <motion.div
        initial={{ opacity: 0, y: 40, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 1, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 w-[92%] xl:w-[88%] mx-auto"
      >
        {/* Smoke gradient layers behind the image */}
        <div className="absolute -inset-16 rounded-[40px] blur-[80px] opacity-60 bg-gradient-to-br from-indigo-600/20 via-purple-500/10 to-transparent animate-pulse [animation-duration:8s]" />
        <div className="absolute -inset-12 rounded-[40px] blur-[60px] opacity-40 bg-gradient-to-tl from-violet-500/15 via-blue-500/10 to-transparent animate-pulse [animation-duration:12s] [animation-delay:2s]" />
        <div className="absolute -inset-20 rounded-[50px] blur-[100px] opacity-30 bg-gradient-to-r from-fuchsia-500/10 via-indigo-400/15 to-cyan-500/5 animate-pulse [animation-duration:10s] [animation-delay:4s]" />
        <div className="absolute -inset-10 rounded-3xl blur-[40px] opacity-50 bg-gradient-to-b from-indigo-500/10 via-purple-600/8 to-violet-500/10" />

        <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] shadow-[0_32px_80px_-12px_rgba(0,0,0,0.6)] ring-1 ring-white/[0.05]">
          <Image
            src="/demo-3-2.png"
            alt="Coasty desktop app"
            width={1200}
            height={800}
            className="w-full h-auto"
            priority
          />
        </div>
      </motion.div>

      {/* Bottom content overlay */}
      <div className="absolute bottom-0 left-0 right-0 z-20 p-10 xl:p-14">
        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/80 to-transparent" />
        <div className="relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.4, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="flex items-center gap-3 mb-5">
              <CoastyIcon className="size-7 text-white/90" />
              <span className="text-white/50 text-[11px] font-semibold tracking-[0.25em] uppercase">Coasty</span>
            </div>
            <h2 className="text-white text-2xl xl:text-[28px] font-medium leading-[1.3] tracking-[-0.02em] max-w-lg">
              Autopilot computers that work for you. No humans needed.
            </h2>
            <p className="text-white/40 text-[15px] xl:text-base font-normal leading-relaxed max-w-md mt-3">
              Delegate hours of repetitive work to AI agents that research, browse, and execute tasks on your computer — while you focus on what actually matters.
            </p>
          </motion.div>
        </div>
      </div>
    </motion.div>
  )
}

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
  const router = useRouter()
  const searchParams = useSearchParams()

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
        router.push("/")
      }
    } catch (err: unknown) {
      const message = (err as Error).message
      if (message?.includes("Email not confirmed")) {
        setError(te("confirmEmail"))
      } else if (message?.includes("Invalid login credentials")) {
        setError(te("invalidCredentials"))
      } else {
        setError(message || te("signInFailed"))
      }
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
      setSuccess(ts("checkEmailMagicLink"))
    } catch (err: unknown) {
      const message = (err as Error).message
      if (message?.includes("Signups not allowed for otp")) {
        setAuthView("sign-up")
        setError(te("noAccountFound"))
      } else {
        setError(message || te("magicLinkFailed"))
      }
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
        {/* Ambient gradient mesh background — right side only */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div
            className="absolute -top-[40%] -left-[20%] h-[80%] w-[60%] rounded-full opacity-[0.03] dark:opacity-[0.06] blur-[100px]"
            style={{ background: "radial-gradient(circle, currentColor, transparent 70%)" }}
          />
          <div
            className="absolute -bottom-[30%] -right-[10%] h-[70%] w-[50%] rounded-full opacity-[0.025] dark:opacity-[0.05] blur-[100px]"
            style={{ background: "radial-gradient(circle, currentColor, transparent 70%)" }}
          />
          <div
            className="absolute inset-0 opacity-[0.015] dark:opacity-[0.03]"
            style={{
              backgroundImage: `linear-gradient(rgba(128,128,128,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(128,128,128,0.3) 1px, transparent 1px)`,
              backgroundSize: "80px 80px",
            }}
          />
        </div>

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
