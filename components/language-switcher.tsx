"use client"

import { useLocale } from "next-intl"
import { useRouter } from "next/navigation"
import { useTransition, useRef, useEffect, useState } from "react"
import { localeNames, type Locale } from "@/i18n/config"
import { cn } from "@/lib/utils"
import { Globe, Check, X } from "lucide-react"
import { AnimatePresence, motion } from "framer-motion"

const orderedLocales: Locale[] = [
  'en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh', 'ar', 'hi', 'ru',
  'nl', 'pl', 'uk', 'th', 'vi', 'tr', 'id', 'sv', 'da', 'no', 'fi',
  'cs', 'ro', 'hu', 'el', 'he', 'ms', 'fil',
]

/** Native script hint shown alongside each language name */
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

function useLocaleChange() {
  const locale = useLocale()
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

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

  return { locale: locale as Locale, isPending, changeLocale }
}

/**
 * Full horizontal pill strip — used in footer
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const { locale, isPending, changeLocale } = useLocaleChange()
  const scrollRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (activeRef.current && scrollRef.current) {
      const container = scrollRef.current
      const active = activeRef.current
      const scrollLeft = active.offsetLeft - container.offsetWidth / 2 + active.offsetWidth / 2
      container.scrollTo({ left: scrollLeft, behavior: "smooth" })
    }
  }, [locale])

  return (
    <div className={cn("w-full", className)}>
      <div className="flex items-center gap-1.5 mb-3">
        <Globe className="h-3.5 w-3.5 text-muted-foreground/40" />
        <span className="text-[11px] font-medium text-muted-foreground/40 uppercase tracking-widest">
          {localeNames[locale] ?? locale}
        </span>
      </div>

      <div className="relative">
        <div className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-background to-transparent z-10" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-background to-transparent z-10" />

        <div
          ref={scrollRef}
          className="flex gap-1.5 overflow-x-auto no-scrollbar py-1 px-1"
          style={{ scrollbarWidth: "none" }}
        >
          {orderedLocales.map((l) => {
            const isActive = l === locale
            return (
              <button
                key={l}
                ref={isActive ? activeRef : undefined}
                onClick={() => changeLocale(l)}
                disabled={isPending}
                className={cn(
                  "relative flex-shrink-0 rounded-full px-3 py-1.5 text-[12px] font-medium",
                  "transition-all duration-200 cursor-pointer select-none",
                  "border whitespace-nowrap",
                  isActive
                    ? "bg-foreground text-background border-foreground/80 shadow-sm"
                    : "border-border/30 text-muted-foreground/50 hover:text-foreground hover:border-border/60 hover:bg-muted/30",
                  isPending && !isActive && "opacity-40 pointer-events-none"
                )}
              >
                {localeNames[l]}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/**
 * Compact globe button with centered modal — used in header/nav
 */
export function LanguageSwitcherCompact({
  className,
  open: controlledOpen,
  onOpenChange,
}: {
  className?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const { locale, isPending, changeLocale } = useLocaleChange()
  const [internalOpen, setInternalOpen] = useState(false)
  const activeRef = useRef<HTMLButtonElement>(null)

  const open = controlledOpen ?? internalOpen
  const setOpen = onOpenChange ?? setInternalOpen
  const showTrigger = controlledOpen === undefined

  // Close on escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [open])

  // Scroll active language into view when modal opens
  useEffect(() => {
    if (open && activeRef.current) {
      requestAnimationFrame(() => {
        activeRef.current?.scrollIntoView({ block: "center", behavior: "instant" })
      })
    }
  }, [open])

  return (
    <div className={cn("relative", className)}>
      {/* Trigger */}
      {showTrigger && (
        <button
          onClick={() => setOpen(!open)}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 rounded-full h-8 px-2.5",
            "text-muted-foreground/50 hover:text-foreground/80",
            "hover:bg-foreground/[0.05]",
            "transition-all duration-200 cursor-pointer",
            open && "text-foreground/80 bg-foreground/[0.06]",
            isPending && "opacity-50 pointer-events-none",
          )}
          aria-label="Change language"
          aria-expanded={open}
        >
          <Globe className="h-[15px] w-[15px]" />
          <span className="text-[11px] font-semibold uppercase tracking-wider leading-none">{locale}</span>
        </button>
      )}

      {/* Centered modal */}
      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-[100] bg-black/30 backdrop-blur-[2px]"
              onClick={() => setOpen(false)}
            />

            {/* Modal — centered on all devices */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="fixed z-[101] inset-0 flex items-center justify-center p-3 sm:p-6 pointer-events-none"
            >
              <div
                className={cn(
                  "pointer-events-auto w-full max-w-[420px]",
                  "max-h-[min(480px,calc(100dvh-24px))] sm:max-h-[min(480px,80vh)]",
                  "flex flex-col",
                  "rounded-2xl border border-border/40",
                  "bg-popover/95 backdrop-blur-2xl",
                  "shadow-2xl shadow-black/[0.12] dark:shadow-black/40",
                  "ring-1 ring-black/[0.03] dark:ring-white/[0.03]",
                )}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Header */}
                <div className="flex-shrink-0 px-4 pt-3.5 pb-2.5 border-b border-border/20">
                  <div className="flex items-center gap-2">
                    <div className="flex h-6 w-6 items-center justify-center rounded-md bg-foreground/[0.05]">
                      <Globe className="h-3.5 w-3.5 text-muted-foreground/50" />
                    </div>
                    <span className="text-[13px] font-semibold text-foreground/70">
                      Language
                    </span>
                    <span className="ml-auto text-[10px] text-muted-foreground/30 font-medium tabular-nums mr-1">
                      {orderedLocales.length}
                    </span>
                    <button
                      onClick={() => setOpen(false)}
                      className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/40 hover:text-foreground hover:bg-foreground/[0.05] transition-colors"
                      aria-label="Close"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Grid — scrollable */}
                <div className="flex-1 overflow-y-auto overscroll-contain scrollbar-thin scrollbar-thumb-border/40 scrollbar-track-transparent">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-0.5 p-1.5">
                  {orderedLocales.map((l) => {
                    const isActive = l === locale
                    const hint = localeHints[l]
                    return (
                      <button
                        key={l}
                        ref={isActive ? activeRef : undefined}
                        onClick={() => {
                          changeLocale(l)
                          setOpen(false)
                        }}
                        disabled={isPending}
                        className={cn(
                          "group relative flex items-center gap-2 rounded-lg px-2.5 py-2 text-left",
                          "transition-all duration-150 cursor-pointer select-none",
                          isActive
                            ? "bg-foreground/[0.07] text-foreground"
                            : "text-muted-foreground/60 hover:text-foreground hover:bg-foreground/[0.04]",
                          isPending && !isActive && "opacity-40 pointer-events-none"
                        )}
                      >
                        <span className={cn(
                          "flex h-6 w-6 items-center justify-center rounded-md text-[11px] font-bold shrink-0 transition-colors",
                          isActive
                            ? "bg-foreground/10 text-foreground"
                            : "bg-foreground/[0.04] text-muted-foreground/40 group-hover:bg-foreground/[0.06] group-hover:text-muted-foreground/60",
                        )}>
                          {hint || l.toUpperCase()}
                        </span>
                        <span className="truncate text-[12px] font-medium flex-1 leading-tight">{localeNames[l]}</span>
                        {isActive && (
                          <Check className="h-3 w-3 text-foreground/60 flex-shrink-0" />
                        )}
                      </button>
                    )
                  })}
                </div>
                <div className="h-1" />
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
