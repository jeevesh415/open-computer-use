"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createClient } from "@/lib/supabase/client"

import Link from "next/link"
import { useState } from "react"

import { useRouter } from "next/navigation"
import { HeaderGoBack } from "../../components/header-go-back"
import { useTranslations } from "next-intl"

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const router = useRouter()
  const t = useTranslations("auth.resetPassword")
  const te = useTranslations("auth.errors")
  const ts = useTranslations("auth.success")
  const ta = useTranslations("auth")

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!password || !confirmPassword) {
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

    const supabase = createClient()
    if (!supabase) {
      setError(te("supabaseNotConfigured"))
      return
    }

    try {
      setIsLoading(true)
      setError(null)

      const { error: updateError } = await supabase.auth.updateUser({
        password,
      })

      if (updateError) throw updateError

      setSuccess(true)
      setTimeout(() => router.push("/auth"), 2000)
    } catch (err: unknown) {
      setError((err as Error).message || te("updateFailed"))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="relative bg-background flex h-dvh w-full flex-col">
      <div className="absolute inset-0 bg-gradient-to-t from-blue-100/25 via-blue-50/15 via-blue-25/8 to-transparent dark:from-blue-950/20 dark:via-blue-900/12 dark:via-blue-800/6 dark:to-transparent pointer-events-none z-0" />
      <HeaderGoBack href="/auth" />

      <main className="relative flex flex-1 flex-col items-center justify-center px-4 sm:px-6 z-10">
        <div className="w-full max-w-md space-y-8">
          <div className="text-center">
            <h1 className="text-foreground text-3xl font-medium tracking-tight sm:text-4xl">
              {t("title")}
            </h1>
            <p className="text-muted-foreground mt-3">
              {t("subtitle")}
            </p>
          </div>

          {error && (
            <div className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
              {error}
            </div>
          )}

          {success ? (
            <div className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-md p-3 text-sm text-center">
              {ts("passwordUpdated")}
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="new-password">{t("newPassword")}</Label>
                <Input
                  id="new-password"
                  type="password"
                  placeholder={ta("minChars")}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading}
                  autoComplete="new-password"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm-new-password">{t("confirmNewPassword")}</Label>
                <Input
                  id="confirm-new-password"
                  type="password"
                  placeholder={t("confirmPlaceholder")}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={isLoading}
                  autoComplete="new-password"
                />
              </div>
              <Button
                type="submit"
                className="w-full"
                size="lg"
                disabled={isLoading}
              >
                {isLoading ? t("updating") : t("updatePassword")}
              </Button>
            </form>
          )}
        </div>
      </main>

      <footer className="relative text-muted-foreground py-6 text-center text-sm z-10">
        <p className="mb-3">
          <Link href="/auth" className="text-foreground hover:underline">
            {ta("backToSignIn")}
          </Link>
        </p>
      </footer>
    </div>
  )
}
