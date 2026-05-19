"use client"

/**
 * MemoryEditor — the reusable editor body used both by the account
 * dialog's Memory section and by the sidebar quick-edit popup.
 *
 * Owns all state (fetch, debounced auto-save, value, status). Renders
 * the suggestions row, the textarea with the hairline progress bar,
 * the save-status row, and the "How memory is used" disclosure.
 *
 * Does NOT render a header card or dialog title — wrappers are
 * responsible for their own outer chrome so each surface can tune
 * spacing/typography. This keeps the editor identical visually wherever
 * it's used while letting the surfaces feel native.
 */

import { Textarea } from "@/components/ui/textarea"
import { Check } from "lucide-react"
import { AnimatePresence, motion } from "framer-motion"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"

export const MAX_MEMORY_CHARS = 4000
const AUTOSAVE_DEBOUNCE_MS = 800

type FetchedMemory = {
  memory: string
  length: number
  max_length: number
  truncated: boolean
}

// Suggestion preset i18n keys. Each entry has a *label* key (chip text)
// and a *sentence* key (the line appended to the memory when clicked).
// Both are localized so a French user clicking "Sois concis" gets the
// French sentence injected, not the English one.
const PRESET_KEYS: Array<{ labelKey: string; sentenceKey: string }> = [
  { labelKey: "presets.useFirstName", sentenceKey: "presets.useFirstNameSentence" },
  { labelKey: "presets.beTerse", sentenceKey: "presets.beTerseSentence" },
  { labelKey: "presets.imDeveloper", sentenceKey: "presets.imDeveloperSentence" },
  { labelKey: "presets.noEmojis", sentenceKey: "presets.noEmojisSentence" },
  { labelKey: "presets.metricUnits", sentenceKey: "presets.metricUnitsSentence" },
  { labelKey: "presets.citeSources", sentenceKey: "presets.citeSourcesSentence" },
]

// Compact mode (sidebar popup) shows only the most-clickable presets in
// a single tidy row. The account section shows all of them.
const MAX_COMPACT_PRESETS = 4

/** Render a relative-time label using i18n strings.
 *
 * Returns the resolved string for the `time.*` namespace; we keep the
 * decision tree in JS (rather than via ICU MessageFormat plural) because
 * not every locale supports `next-intl`'s plural syntax in its current
 * setup, and a tiny if-ladder is more readable across 30 locales. */
function buildRelativeLabel(
  ts: number,
  t: (key: string, values?: Record<string, string | number>) => string,
): string {
  const diff = Math.max(0, Date.now() - ts)
  const s = Math.floor(diff / 1000)
  if (s < 5) return t("time.justNow")
  if (s < 60) return t("time.secondsAgo", { n: s })
  const m = Math.floor(s / 60)
  if (m < 60) return t("time.minutesAgo", { n: m })
  const h = Math.floor(m / 60)
  if (h < 24) return t("time.hoursAgo", { n: h })
  return t("time.daysAgo", { n: Math.floor(h / 24) })
}

export type MemoryEditorProps = {
  /** Compact = tighter spacing for use inside a dialog popup. */
  compact?: boolean
  /** Optional footer slot rendered below the disclosure (e.g. an
   *  "Open full settings" link in the dialog variant). */
  footerSlot?: React.ReactNode
  /** Auto-focus the textarea on mount (true for the dialog popup so
   *  the user can immediately start typing). */
  autoFocus?: boolean
}

export function MemoryEditor({
  compact = false,
  footerSlot,
  autoFocus = false,
}: MemoryEditorProps) {
  const t = useTranslations("memory")

  // Build the localized preset list. We resolve via the translations
  // namespace at render time so locale changes (e.g. user switching
  // language with the dialog open) repaint correctly.
  const PRESETS = useMemo(
    () =>
      PRESET_KEYS.map(({ labelKey, sentenceKey }) => ({
        label: t(labelKey),
        sentence: t(sentenceKey),
      })),
    [t],
  )

  // ─── Core state ────────────────────────────────────────────────────────
  const [value, setValue] = useState<string>("")
  const [serverValue, setServerValue] = useState<string>("")
  const [loading, setLoading] = useState<boolean>(true)
  const [saving, setSaving] = useState<boolean>(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [, forceTick] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Re-render every 30s so the relative-time label stays fresh.
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  // ─── Initial fetch ─────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch("/api/user-memory", { cache: "no-store" })
        if (!res.ok) {
          if (!cancelled) setError(t("errorLoad"))
          return
        }
        const data = (await res.json()) as FetchedMemory
        if (cancelled) return
        setValue(data.memory ?? "")
        setServerValue(data.memory ?? "")
      } catch {
        if (!cancelled) setError(t("errorLoad"))
      } finally {
        if (!cancelled) {
          setLoading(false)
          // Focus AFTER the loading flag clears so the textarea isn't
          // disabled at the moment we try to focus it.
          if (autoFocus) {
            // Defer one frame so the disabled→enabled flip lands before focus.
            requestAnimationFrame(() => textareaRef.current?.focus())
          }
        }
      }
    })()
    return () => {
      cancelled = true
    }
    // `t` from next-intl is stable for the lifetime of the component;
    // listing it here keeps the lint rule satisfied without changing
    // behaviour (the effect still runs only once on mount).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus])

  // ─── Debounced auto-save ───────────────────────────────────────────────
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedValue = useRef<string>("")

  useEffect(() => {
    lastSavedValue.current = serverValue
  }, [serverValue])

  const dirty = value.trim() !== serverValue.trim()
  const overCap = value.length > MAX_MEMORY_CHARS
  const capRatio = Math.min(1, value.length / MAX_MEMORY_CHARS)

  const doSave = useCallback(async (text: string) => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/user-memory", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memory: text }),
      })
      if (!res.ok) {
        setError(t("errorSave"))
        return
      }
      const data = (await res.json()) as FetchedMemory
      setValue(data.memory ?? "")
      setServerValue(data.memory ?? "")
      setSavedAt(Date.now())
    } catch {
      setError(t("errorSave"))
    } finally {
      setSaving(false)
    }
  }, [t])

  useEffect(() => {
    if (loading) return
    if (value.trim() === lastSavedValue.current.trim()) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      doSave(value)
    }, AUTOSAVE_DEBOUNCE_MS)
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [value, loading, doSave])

  // Force-flush any pending save when the editor unmounts (e.g. dialog
  // close). Otherwise a user who types and immediately closes the popup
  // would lose the last debounce window.
  useEffect(() => {
    return () => {
      if (
        saveTimer.current &&
        // Compare trimmed forms so a trailing-space-only diff doesn't
        // trigger a save on every unmount.
        textareaRef.current &&
        textareaRef.current.value.trim() !== lastSavedValue.current.trim()
      ) {
        clearTimeout(saveTimer.current)
        // Fire-and-forget — we're unmounting and won't observe the result.
        // The server's PUT is idempotent; a failure here is acceptable
        // and will be reflected next time the editor is opened.
        const pending = textareaRef.current.value
        void fetch("/api/user-memory", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ memory: pending }),
          keepalive: true,
        })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── Preset insertion ──────────────────────────────────────────────────
  const addPreset = useCallback((sentence: string) => {
    setValue((current) => {
      if (current.includes(sentence)) return current
      const trimmed = current.trimEnd()
      if (!trimmed) return sentence
      return `${trimmed}\n${sentence}`
    })
  }, [])

  const handleClear = useCallback(() => {
    setValue("")
  }, [])

  // ─── Derived UI bits ───────────────────────────────────────────────────
  const savedLabel = useMemo(() => {
    if (saving) return t("saving")
    if (error) return error
    if (savedAt) {
      // "Saved · just now" / "Saved · 2m ago" — localized via the
      // savedRelative template + the time.* sub-namespace.
      return t("savedRelative", { time: buildRelativeLabel(savedAt, t) })
    }
    if (loading) return t("loading")
    if (dirty) return t("unsavedChanges")
    if (serverValue) return t("saved")
    return t("empty")
  }, [saving, error, savedAt, loading, dirty, serverValue, t])

  const indicatorTone =
    error
      ? "text-red-500"
      : saving
      ? "text-foreground/60"
      : savedAt
      ? "text-emerald-500/70"
      : dirty
      ? "text-amber-500/80"
      : "text-muted-foreground/50"

  // Filter out presets that are already in the memory, then cap in
  // compact mode so the chip row stays on a single line in the popup.
  const visiblePresets = useMemo(() => {
    const filtered = PRESETS.filter((p) => !value.includes(p.sentence))
    return compact ? filtered.slice(0, MAX_COMPACT_PRESETS) : filtered
  }, [value, compact])

  return (
    <div className={cn(compact ? "space-y-4" : "space-y-7")}>
      {/* ─── Suggestion chips ──────────────────────────────────────────
          Standardized pill row. One line, soft background, no border or
          icon noise. In compact mode (sidebar popup) we cap to the first
          MAX_COMPACT_PRESETS so they fit on a single tidy row at 500px.
          The "Try" label is inline rather than a stacked header to keep
          the whole row visually one element. */}
      <AnimatePresence initial={false}>
        {visiblePresets.length > 0 && (
          <motion.div
            key="presets"
            initial={{ opacity: 0, y: 6, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, y: -4, height: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="flex items-center flex-wrap gap-x-2 gap-y-1.5">
              <span className="text-[10.5px] uppercase tracking-[0.1em] text-muted-foreground/50 font-medium shrink-0">
                {t("presetsLabel")}
              </span>
              {visiblePresets.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => addPreset(p.sentence)}
                  disabled={loading}
                  className={cn(
                    "rounded-full px-2.5 py-[3px]",
                    "text-[11.5px] font-medium tracking-tight",
                    "bg-foreground/[0.04] dark:bg-white/[0.04]",
                    "text-foreground/65",
                    "transition-colors duration-150",
                    "hover:bg-foreground/[0.08] hover:text-foreground",
                    "dark:hover:bg-white/[0.08]",
                    "disabled:opacity-40 disabled:pointer-events-none",
                    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/20"
                  )}
                  aria-label={p.label}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Editor (signature element) ────────────────────────────────── */}
      <div className="space-y-2.5">
        <div
          className={cn(
            "relative rounded-2xl border bg-card/20 transition-colors",
            "border-border/40 focus-within:border-foreground/30",
            // Subtle inset highlight for a "lit-from-above" feel — the
            // detail that registers as premium without naming itself.
            "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]",
            error && "border-red-500/50",
            overCap && "border-amber-500/60"
          )}
        >
          <Textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={loading ? t("loading") : t("placeholder")}
            disabled={loading}
            rows={compact ? 6 : 9}
            className={cn(
              // Compact mode is for the sidebar popup — bounded height so
              // the dialog never expands beyond the viewport. The bounds
              // are min-h to keep the surface present and max-h to clamp
              // user-driven growth. resize-none in compact prevents the
              // browser's drag handle from defeating the viewport cap.
              compact
                ? "min-h-[140px] max-h-[240px] resize-none"
                : "min-h-[180px] resize-y",
              "border-0 bg-transparent",
              "text-[13.5px] leading-[1.65] text-foreground",
              "placeholder:text-muted-foreground/35",
              "focus-visible:ring-0 focus-visible:ring-offset-0",
              compact ? "px-4 py-3" : "px-4 py-3.5"
            )}
          />

          {/* Hairline progress bar — the signature element. */}
          <div className="absolute bottom-0 left-0 right-0 h-px overflow-hidden rounded-b-2xl">
            <motion.div
              initial={false}
              animate={{
                width: `${capRatio * 100}%`,
                backgroundColor: overCap
                  ? "rgba(245, 158, 11, 0.6)"
                  : capRatio > 0.85
                  ? "rgba(245, 158, 11, 0.35)"
                  : "rgba(16, 185, 129, 0.45)",
              }}
              transition={{ duration: 0.4, ease: "easeOut" }}
              className="h-full"
            />
          </div>
        </div>

        {/* ─── Status row ─────────────────────────────────────────────── */}
        <div className="flex items-center justify-between text-[11.5px]">
          <div className={cn("flex items-center gap-1.5 transition-colors", indicatorTone)}>
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full transition-all",
                saving && "bg-foreground/40 animate-pulse",
                !saving && savedAt && "bg-emerald-500/70",
                !saving && !savedAt && dirty && "bg-amber-500/70",
                !saving && !savedAt && !dirty && "bg-muted-foreground/30"
              )}
            />
            <span>{savedLabel}</span>
            {savedAt && !saving && !dirty && (
              <Check className="h-3 w-3 text-emerald-500/60" strokeWidth={2} />
            )}
          </div>

          <div className="flex items-center gap-3">
            <span
              className={cn(
                "tabular-nums tracking-tight",
                overCap ? "text-amber-500/90" : "text-muted-foreground/45"
              )}
            >
              {value.length.toLocaleString()} / {MAX_MEMORY_CHARS.toLocaleString()}
              {overCap && ` · ${t("willBeShortened")}`}
            </span>
            {value.length > 0 && !loading && (
              <button
                type="button"
                onClick={handleClear}
                className={cn(
                  "text-muted-foreground/45 hover:text-foreground/75",
                  "transition-colors underline-offset-2 hover:underline"
                )}
              >
                {t("clear")}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* One quiet line — friendly note about how memory is applied. */}
      <p className="text-[11.5px] leading-relaxed text-muted-foreground/55">
        {t("footerNote")}
      </p>

      {/* Optional surface-specific footer (e.g. "Open full settings"). */}
      {footerSlot}
    </div>
  )
}
