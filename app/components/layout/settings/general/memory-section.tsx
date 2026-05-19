"use client"

import { Brain } from "lucide-react"
import { motion } from "framer-motion"
import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import { MemoryEditor } from "./memory-editor"

const fadeUp = (delay: number) => ({
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.32, delay, ease: [0.22, 1, 0.36, 1] as const },
})

/**
 * MemorySection — the Memory entry inside the Account dialog.
 *
 * Just a thin header card around the shared <MemoryEditor>. The editor
 * carries all the logic (fetch, debounced auto-save, presets, status,
 * disclosure) and is reused by the sidebar quick-edit popup.
 *
 * The header card's status pip mirrors the editor's saved/empty
 * indicator — we poll the server once to know whether to show it green
 * or neutral on mount. After that we rely on the editor's own status
 * row, so the pip is just a coarse at-a-glance hint, not a live mirror.
 */
export function MemorySection() {
  const t = useTranslations("memory")
  const [hasMemory, setHasMemory] = useState<boolean>(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch("/api/user-memory", { cache: "no-store" })
        if (!res.ok || cancelled) return
        const data = (await res.json()) as { memory?: string }
        if (!cancelled) setHasMemory(Boolean(data.memory && data.memory.trim()))
      } catch {
        // Best-effort — the pip just defaults to neutral on failure.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="space-y-7">
      <motion.div {...fadeUp(0)}>
        <div className="rounded-2xl border border-border/30 bg-card/20 p-5 overflow-hidden">
          <div className="flex items-start gap-3.5">
            <div className="relative h-10 w-10 rounded-xl bg-foreground/[0.04] flex items-center justify-center shrink-0">
              <Brain className="h-[18px] w-[18px] text-foreground/50" strokeWidth={1.6} />
              <span
                className={cn(
                  "absolute top-0 right-0 -translate-y-0.5 translate-x-0.5 h-1.5 w-1.5 rounded-full transition-colors",
                  hasMemory
                    ? "bg-emerald-500/80 shadow-[0_0_0_2px_rgba(0,0,0,0.04)]"
                    : "bg-foreground/15"
                )}
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <h3 className="text-[14px] font-medium tracking-tight text-foreground">
                  {t("section.title")}
                </h3>
                <span className="text-[11px] text-muted-foreground/45">
                  {t("section.tag")}
                </span>
              </div>
              <p className="text-[12px] text-muted-foreground/55 mt-1 leading-relaxed">
                {t("section.description")}
              </p>
            </div>
          </div>
        </div>
      </motion.div>

      <motion.div {...fadeUp(0.06)}>
        <MemoryEditor />
      </motion.div>
    </div>
  )
}
