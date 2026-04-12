"use client"

import { useEffect } from "react"
import { useTranslations } from "next-intl"

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const t = useTranslations("errorPages")

  useEffect(() => {
    console.error("Application error:", error)
  }, [error])

  return (
    <div className="flex h-screen w-screen items-center justify-center">
      <div className="text-center max-w-md px-6">
        <h1 className="text-xl font-semibold">{t("error.title")}</h1>
        <p className="text-muted-foreground mt-2">
          {t("error.description")}
        </p>
        <button
          onClick={reset}
          className="mt-4 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
        >
          {t("error.tryAgain")}
        </button>
      </div>
    </div>
  )
}
