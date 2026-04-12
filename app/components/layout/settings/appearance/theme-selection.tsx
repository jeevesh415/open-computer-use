"use client"

import { useTheme } from "next-themes"
import { useState, useEffect } from "react"
import { cn } from "@/lib/utils"
import { Check } from "lucide-react"

function ThemePreview({ mode }: { mode: "light" | "dark" }) {
  const isLight = mode === "light"
  const bg = isLight ? "#ffffff" : "#141414"
  const surface = isLight ? "#f5f5f5" : "#1e1e1e"
  const surfaceAlt = isLight ? "#ebebeb" : "#282828"
  const border = isLight ? "#e5e5e5" : "#2a2a2a"
  const textPrimary = isLight ? "#1a1a1a" : "#e5e5e5"
  const textSecondary = isLight ? "#a0a0a0" : "#666666"
  const textMuted = isLight ? "#d0d0d0" : "#3a3a3a"
  const accent = isLight ? "#333333" : "#cccccc"

  return (
    <svg viewBox="0 0 200 130" fill="none" className="w-full h-auto">
      {/* Background */}
      <rect width="200" height="130" rx="8" fill={bg} />
      <rect x="0.5" y="0.5" width="199" height="129" rx="7.5" stroke={border} strokeOpacity="0.6" />

      {/* Sidebar */}
      <rect x="4" y="4" width="42" height="122" rx="5" fill={surface} />
      {/* Sidebar logo */}
      <circle cx="25" cy="16" r="4" fill={textMuted} />
      {/* Sidebar nav items */}
      <rect x="10" y="28" width="30" height="4" rx="2" fill={surfaceAlt} />
      <rect x="10" y="36" width="24" height="4" rx="2" fill={textMuted} opacity="0.5" />
      <rect x="10" y="44" width="27" height="4" rx="2" fill={textMuted} opacity="0.5" />
      <rect x="10" y="52" width="20" height="4" rx="2" fill={textMuted} opacity="0.5" />
      {/* Sidebar active indicator */}
      <rect x="8" y="27" width="2" height="6" rx="1" fill={accent} opacity="0.6" />
      {/* Sidebar avatar */}
      <circle cx="18" cy="117" r="5" fill={surfaceAlt} />
      <rect x="26" y="114" width="16" height="3" rx="1.5" fill={textMuted} />
      <rect x="26" y="119" width="12" height="2" rx="1" fill={textMuted} opacity="0.4" />

      {/* Main content area */}
      {/* Header bar */}
      <rect x="52" y="4" width="144" height="16" rx="5" fill={surface} />
      <rect x="58" y="9" width="40" height="5" rx="2.5" fill={textMuted} />
      <circle cx="183" cy="12" r="4" fill={surfaceAlt} />

      {/* Chat messages */}
      {/* User message */}
      <rect x="100" y="28" width="88" height="18" rx="6" fill={accent} opacity="0.1" />
      <rect x="108" y="33" width="52" height="3" rx="1.5" fill={textSecondary} opacity="0.6" />
      <rect x="108" y="39" width="36" height="3" rx="1.5" fill={textSecondary} opacity="0.4" />

      {/* AI message */}
      <rect x="58" y="52" width="96" height="30" rx="6" fill={surface} />
      <rect x="66" y="58" width="60" height="3" rx="1.5" fill={textPrimary} opacity="0.5" />
      <rect x="66" y="64" width="72" height="3" rx="1.5" fill={textPrimary} opacity="0.35" />
      <rect x="66" y="70" width="44" height="3" rx="1.5" fill={textPrimary} opacity="0.25" />

      {/* Another user message */}
      <rect x="120" y="88" width="68" height="14" rx="6" fill={accent} opacity="0.1" />
      <rect x="128" y="93" width="40" height="3" rx="1.5" fill={textSecondary} opacity="0.5" />

      {/* Input bar */}
      <rect x="52" y="108" width="144" height="18" rx="5" fill={surface} />
      <rect x="60" y="114" width="56" height="4" rx="2" fill={textMuted} opacity="0.5" />
      {/* Send button */}
      <rect x="172" y="112" width="18" height="10" rx="4" fill={accent} opacity="0.15" />
      <rect x="177" y="115.5" width="8" height="3" rx="1.5" fill={accent} opacity="0.4" />
    </svg>
  )
}

export function ThemeSelection() {
  const { theme, setTheme, resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  const currentTheme = mounted ? (theme === "system" ? resolvedTheme : theme) : "dark"

  const themes: { id: "light" | "dark"; label: string }[] = [
    { id: "light", label: "Light" },
    { id: "dark", label: "Dark" },
  ]

  return (
    <div className="grid grid-cols-2 gap-3">
      {themes.map((t) => {
        const isActive = currentTheme === t.id
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => setTheme(t.id)}
            className={cn(
              "group relative flex flex-col rounded-xl border overflow-hidden transition-all duration-200",
              isActive
                ? "border-foreground/20 ring-1 ring-foreground/[0.08]"
                : "border-border/30 hover:border-border/50"
            )}
          >
            {/* Preview */}
            <div className={cn(
              "p-2.5 pb-0 transition-opacity",
              isActive ? "opacity-100" : "opacity-70 group-hover:opacity-90"
            )}>
              <ThemePreview mode={t.id} />
            </div>

            {/* Label bar */}
            <div className="flex items-center justify-between px-3.5 py-2.5">
              <span className={cn(
                "text-[13px] font-medium",
                isActive ? "text-foreground" : "text-muted-foreground/60"
              )}>
                {t.label}
              </span>
              {isActive && (
                <div className="flex h-4.5 w-4.5 items-center justify-center rounded-full bg-foreground">
                  <Check className="h-3 w-3 text-background" strokeWidth={2.5} />
                </div>
              )}
            </div>
          </button>
        )
      })}
    </div>
  )
}
