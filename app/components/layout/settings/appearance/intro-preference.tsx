"use client"

import { Switch } from "@/components/ui/switch"
import { useState, useEffect } from "react"
import { Film } from "lucide-react"
import { useTranslations } from "next-intl"

const DISMISS_KEY = "coasty-skip-intro"

export function IntroPreference() {
  const t = useTranslations("accountDialog.appearance.intro")
  const [enabled, setEnabled] = useState(true)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setEnabled(!localStorage.getItem(DISMISS_KEY))
    setMounted(true)
  }, [])

  const toggle = (checked: boolean) => {
    setEnabled(checked)
    if (checked) {
      localStorage.removeItem(DISMISS_KEY)
    } else {
      localStorage.setItem(DISMISS_KEY, "1")
    }
  }

  if (!mounted) return null

  return (
    <div className="rounded-xl border border-border/30 bg-card/20 overflow-hidden">
      <div className="flex items-center gap-3.5 px-4 py-3.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground/[0.04] shrink-0">
          <Film className="h-3.5 w-3.5 text-muted-foreground/40" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium text-foreground leading-tight">{t("title")}</p>
          <p className="text-[11px] text-muted-foreground/40 mt-0.5 leading-relaxed">
            {t("description")}
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={toggle} />
      </div>
    </div>
  )
}
