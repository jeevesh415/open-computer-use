"use client"

import { Switch } from "@/components/ui/switch"
import { useUserPreferences } from "@/lib/user-preference-store/provider"
import { useTranslations } from "next-intl"

export function InteractionPreferences() {
  const t = useTranslations("accountDialog.appearance.interaction")
  const {
    preferences,
    setShowToolInvocations,
  } = useUserPreferences()

  return (
    <div className="space-y-6 pb-12">
      {/* Tool Invocations */}
      <div>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium">{t("title")}</h3>
            <p className="text-muted-foreground text-xs">
              {t("description")}
            </p>
          </div>
          <Switch
            checked={preferences.showToolInvocations}
            onCheckedChange={setShowToolInvocations}
          />
        </div>
      </div>
    </div>
  )
}