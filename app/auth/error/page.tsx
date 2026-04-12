"use client"

import { Button } from "@/components/ui/button"
import { ArrowLeft } from "@phosphor-icons/react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Suspense } from "react"
import { GridBackground } from "@/components/ui/grid-background"
import { useTranslations } from "next-intl"

export const dynamic = "force-dynamic"

function AuthErrorContent() {
  const searchParams = useSearchParams()
  const t = useTranslations("auth.errorPage")
  const tc = useTranslations("common")
  const message = searchParams.get("message") || t("defaultMessage")

  return (
    <div className="w-full max-w-md space-y-8">
      <div className="text-center">
        <h1 className="text-3xl font-medium tracking-tight text-foreground sm:text-4xl">
          {t("title")}
        </h1>
        <div className="mt-6 rounded-md bg-red-500/10 p-4">
          <p className="text-red-400">{message}</p>
        </div>
        <div className="mt-8">
          <Button
            variant="secondary"
            className="w-full text-base sm:text-base"
            size="lg"
            asChild
          >
            <Link href="/auth">{t("tryAgain")}</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}

export default function AuthErrorPage() {
  const t = useTranslations("auth.errorPage")
  const tc = useTranslations("common")

  return (
    <div className="flex h-screen flex-col bg-background relative">
      <GridBackground />
      <header className="p-4 relative z-10">
        <Link
          href="/"
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-foreground hover:bg-accent"
        >
          <ArrowLeft className="size-5" />
          <span className="font-base ml-2 hidden text-sm sm:inline-block">
            {t("backToChat")}
          </span>
        </Link>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-4 sm:px-6 relative z-10">
        <Suspense fallback={<div>Loading...</div>}>
          <AuthErrorContent />
        </Suspense>
      </main>

      <footer className="py-6 text-center text-sm text-muted-foreground relative z-10">
        <p className="mb-3">
          {t("needHelp")}{" "}
          <Link href="/" className="text-muted-foreground hover:underline">
            {t("contactSupport")}
          </Link>
        </p>
        <div className="flex gap-4 justify-center text-xs">
          <Link href="/privacy" className="hover:text-foreground transition-colors">
            {tc("privacy")}
          </Link>
          <Link href="/terms" className="hover:text-foreground transition-colors">
            {tc("terms")}
          </Link>
        </div>
      </footer>
    </div>
  )
}
