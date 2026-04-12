"use client"

import { useLocale } from "next-intl"
import { useRouter } from "next/navigation"
import { useTransition, useRef, useEffect, useState } from "react"
import { localeNames, type Locale } from "@/i18n/config"
import { cn } from "@/lib/utils"
import { Check, ChevronDown, Search } from "lucide-react"

const orderedLocales: Locale[] = [
  'en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh', 'ar', 'hi', 'ru',
  'nl', 'pl', 'uk', 'th', 'vi', 'tr', 'id', 'sv', 'da', 'no', 'fi',
  'cs', 'ro', 'hu', 'el', 'he', 'ms', 'fil',
]

const localeHints: Partial<Record<Locale, string>> = {
  ja: "あ",
  ko: "가",
  zh: "字",
  ar: "ع",
  hi: "अ",
  ru: "Я",
  uk: "Ї",
  th: "ก",
  he: "א",
  el: "Ω",
}

/** Grouped by region for the expanded grid */
const localeGroups = [
  { label: "Popular", locales: ['en', 'es', 'fr', 'de', 'pt', 'ja', 'ko', 'zh'] as Locale[] },
  { label: "European", locales: ['it', 'nl', 'pl', 'ru', 'uk', 'sv', 'da', 'no', 'fi', 'cs', 'ro', 'hu', 'el'] as Locale[] },
  { label: "Asian & Middle Eastern", locales: ['ar', 'hi', 'th', 'vi', 'tr', 'id', 'he', 'ms', 'fil'] as Locale[] },
]

export function LanguageSelection() {
  const locale = useLocale() as Locale
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [expanded, setExpanded] = useState(false)
  const [search, setSearch] = useState("")
  const searchRef = useRef<HTMLInputElement>(null)

  const changeLocale = (newLocale: Locale) => {
    if (newLocale === locale || isPending) return
    startTransition(async () => {
      await fetch("/api/locale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: newLocale }),
      })
      router.refresh()
    })
  }

  useEffect(() => {
    if (expanded && searchRef.current) {
      searchRef.current.focus()
    }
  }, [expanded])

  const filteredLocales = search.trim()
    ? orderedLocales.filter(l =>
        localeNames[l].toLowerCase().includes(search.toLowerCase()) ||
        l.toLowerCase().includes(search.toLowerCase())
      )
    : null

  return (
    <div>
      {/* Current language display + expand button */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "w-full flex items-center gap-3 px-3.5 py-3 rounded-xl border transition-all duration-200",
          expanded
            ? "border-foreground/15 bg-foreground/[0.03]"
            : "border-border/30 hover:border-border/50 hover:bg-foreground/[0.02]"
        )}
      >
        <span className={cn(
          "flex h-8 w-8 items-center justify-center rounded-lg text-[13px] font-bold shrink-0",
          "bg-foreground/[0.06] text-foreground/60"
        )}>
          {localeHints[locale] || locale.toUpperCase()}
        </span>
        <div className="flex-1 text-left min-w-0">
          <p className="text-[13px] font-medium text-foreground leading-tight">{localeNames[locale]}</p>
          <p className="text-[11px] text-muted-foreground/40 mt-0.5">{locale.toUpperCase()} — Click to change</p>
        </div>
        <ChevronDown className={cn(
          "h-3.5 w-3.5 text-muted-foreground/30 transition-transform duration-200",
          expanded && "rotate-180"
        )} />
      </button>

      {/* Expanded language grid */}
      {expanded && (
        <div className="mt-2 rounded-xl border border-border/30 bg-card/30 overflow-hidden">
          {/* Search */}
          <div className="px-3 pt-3 pb-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/30" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search languages..."
                className="w-full h-8 pl-8 pr-3 rounded-lg bg-foreground/[0.03] border border-border/20 text-[12px] text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-foreground/15 focus:ring-1 focus:ring-foreground/[0.06] transition-colors"
              />
            </div>
          </div>

          {/* Language grid */}
          <div className="max-h-[280px] overflow-y-auto overscroll-contain px-1.5 pb-1.5">
            {filteredLocales ? (
              /* Search results */
              <div className="grid grid-cols-2 gap-0.5 px-1">
                {filteredLocales.map((l) => (
                  <LanguageOption
                    key={l}
                    locale={l}
                    isActive={l === locale}
                    isPending={isPending}
                    onClick={() => changeLocale(l)}
                  />
                ))}
                {filteredLocales.length === 0 && (
                  <div className="col-span-2 py-6 text-center text-[12px] text-muted-foreground/30">
                    No languages found
                  </div>
                )}
              </div>
            ) : (
              /* Grouped view */
              localeGroups.map((group) => (
                <div key={group.label} className="mb-1.5 last:mb-0">
                  <p className="text-[9px] font-semibold tracking-[0.12em] uppercase text-muted-foreground/30 px-2.5 py-1.5">
                    {group.label}
                  </p>
                  <div className="grid grid-cols-2 gap-0.5 px-1">
                    {group.locales.map((l) => (
                      <LanguageOption
                        key={l}
                        locale={l}
                        isActive={l === locale}
                        isPending={isPending}
                        onClick={() => changeLocale(l)}
                      />
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function LanguageOption({
  locale,
  isActive,
  isPending,
  onClick,
}: {
  locale: Locale
  isActive: boolean
  isPending: boolean
  onClick: () => void
}) {
  const hint = localeHints[locale]
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isPending && !isActive}
      className={cn(
        "group relative flex items-center gap-2 rounded-lg px-2.5 py-2 text-left",
        "transition-all duration-150 cursor-pointer select-none",
        isActive
          ? "bg-foreground/[0.07] text-foreground"
          : "text-muted-foreground/55 hover:text-foreground hover:bg-foreground/[0.04]",
        isPending && !isActive && "opacity-40 pointer-events-none"
      )}
    >
      <span className={cn(
        "flex h-6 w-6 items-center justify-center rounded-md text-[11px] font-bold shrink-0 transition-colors",
        isActive
          ? "bg-foreground/10 text-foreground"
          : "bg-foreground/[0.04] text-muted-foreground/35 group-hover:bg-foreground/[0.06] group-hover:text-muted-foreground/55",
      )}>
        {hint || locale.toUpperCase()}
      </span>
      <span className="truncate text-[12px] font-medium flex-1 leading-tight">{localeNames[locale]}</span>
      {isActive && (
        <Check className="h-3 w-3 text-foreground/60 flex-shrink-0" />
      )}
    </button>
  )
}
