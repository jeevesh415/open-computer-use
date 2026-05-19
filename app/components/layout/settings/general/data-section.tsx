"use client"

import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import {
  Warning,
  CircleNotch,
  ShieldCheck,
  Camera,
  ChatCircleText,
  Wrench,
  Brain,
  LockKey,
  LockKeyOpen,
  Cpu,
} from "@phosphor-icons/react"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"

/**
 * DataSection — Account dialog tab for per-user data controls.
 *
 * Surfaces:
 *   1. A short enterprise-friendly trust header explaining what we
 *      store, the standards we use in transit and at rest, and that
 *      we never train on customer data.
 *   2. The encryption-preferences card (per-category opt-in at-rest
 *      encryption).
 *
 * The export and delete-all-my-data flows that used to live here have
 * been removed along with their backing API routes
 * (/api/me/data/export, /api/me/data/delete).
 */

const fadeUp = (delay: number) => ({
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.32, delay, ease: [0.22, 1, 0.36, 1] as const },
})

export function DataSection() {
  return (
    <div className="space-y-7">
      <motion.div {...fadeUp(0)}>
        <SecurityHeroCard />
      </motion.div>
      <motion.div {...fadeUp(0.06)}>
        <EncryptionPrefsCard />
      </motion.div>
    </div>
  )
}

// ===========================================================================
// SecurityHeroCard — enterprise-friendly trust header. Calm, factual copy +
// three monochrome standards pills. Avoids marketing language and only
// references controls we actually implement.
// ===========================================================================

function SecurityHeroCard() {
  const t = useTranslations("dataSection")
  return (
    <div className="rounded-2xl border border-border/30 bg-card/20 p-5">
      <div className="flex items-start gap-3.5">
        <div className="h-10 w-10 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0">
          <ShieldCheck className="h-5 w-5 text-emerald-500/90" weight="duotone" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold tracking-tight">
            {t("heroTitle")}
          </h3>
          <p className="text-[12px] text-muted-foreground/70 mt-1 leading-relaxed">
            {t("heroDescription")}
          </p>
        </div>
      </div>

      {/* Standards pills — keep the visual quiet so the encryption-prefs
          card below remains the actionable surface. */}
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2">
        <TrustPill icon={LockKey} label={t("trustTransit")} />
        <TrustPill icon={ShieldCheck} label={t("trustAtRest")} />
        <TrustPill icon={Cpu} label={t("trustNoTraining")} />
      </div>
    </div>
  )
}

function TrustPill({
  icon: Icon,
  label,
}: {
  icon: typeof ShieldCheck
  label: string
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border/25 bg-background/40">
      <Icon
        className="size-3.5 text-foreground/55 shrink-0"
        weight="duotone"
      />
      <span className="text-[11.5px] text-foreground/75 leading-tight">
        {label}
      </span>
    </div>
  )
}

// ===========================================================================
// EncryptionPrefsCard — per-user, opt-in encryption toggles.
// ===========================================================================

type Category = "screenshots" | "messages" | "tool_calls" | "memory"

type CategoryMeta = {
  id: Category
  label: string
  description: string
  icon: typeof Camera
}

const CATEGORY_META: CategoryMeta[] = [
  {
    id: "screenshots",
    label: "API-trajectory screenshots",
    description:
      "Input + step screenshots saved by the public Coasty API for debugging and trajectory replay (the api_screenshots audit table). Chat-history screenshots inside messages are not yet covered — coming next.",
    icon: Camera,
  },
  {
    id: "messages",
    label: "Chat messages & screenshots",
    description:
      "User prompts, assistant replies, and the screenshots embedded in tool results. The largest surface — encrypting here requires a frontend decryption path; on the roadmap.",
    icon: ChatCircleText,
  },
  {
    id: "tool_calls",
    label: "Tool calls & results",
    description:
      "Every tool invocation an agent makes — terminal commands, browser navigation, file operations, and their outputs.",
    icon: Wrench,
  },
  {
    id: "memory",
    label: "AI memory",
    description:
      "Your saved instructions to the assistant (the memory string in Account → Memory).",
    icon: Brain,
  },
]

type PrefsResponse = {
  prefs: Record<Category, boolean>
  available: { id: Category; wired: boolean }[]
  encryption_key_configured: boolean
  propagation_delay_seconds: number
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: PrefsResponse; pendingSaves: Set<Category> }

function EncryptionPrefsCard() {
  const [state, setState] = useState<LoadState>({ kind: "loading" })

  // Initial fetch.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch("/api/user/encryption-prefs", { cache: "no-store" })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as PrefsResponse
        if (!cancelled) {
          setState({ kind: "ready", data, pendingSaves: new Set() })
        }
      } catch (e) {
        if (!cancelled) {
          setState({
            kind: "error",
            message: e instanceof Error ? e.message : "Failed to load preferences",
          })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function toggle(category: Category, next: boolean) {
    if (state.kind !== "ready") return
    // Optimistic update with pending marker so the spinner can show.
    const optimisticPrefs = { ...state.data.prefs, [category]: next }
    const pending = new Set(state.pendingSaves)
    pending.add(category)
    setState({
      kind: "ready",
      data: { ...state.data, prefs: optimisticPrefs },
      pendingSaves: pending,
    })

    try {
      const res = await fetch("/api/user/encryption-prefs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefs: { [category]: next } }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as PrefsResponse
      setState((prev) => {
        if (prev.kind !== "ready") return prev
        const nextPending = new Set(prev.pendingSaves)
        nextPending.delete(category)
        return { kind: "ready", data, pendingSaves: nextPending }
      })
    } catch (e) {
      // Roll back optimistic change.
      setState((prev) => {
        if (prev.kind !== "ready") return prev
        const rolled = { ...prev.data.prefs, [category]: !next }
        const nextPending = new Set(prev.pendingSaves)
        nextPending.delete(category)
        return {
          kind: "ready",
          data: { ...prev.data, prefs: rolled },
          pendingSaves: nextPending,
        }
      })
      console.error("encryption-prefs PUT failed:", e)
    }
  }

  // -------------------- render -----------------------------------------
  return (
    <div className="rounded-2xl border border-border/30 bg-card/20 p-5">
      <div className="flex items-start gap-3.5">
        <div className="h-9 w-9 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0">
          <ShieldCheck className="h-4 w-4 text-blue-500" weight="duotone" />
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-medium">Encryption preferences</h4>
          <p className="text-xs text-muted-foreground/65 mt-1 leading-relaxed">
            Choose which categories of your data we encrypt at rest with
            AES-256-GCM. Off by default. Toggling on applies to{" "}
            <strong>new</strong> data only — existing records keep whatever
            form they were written in. Encryption uses a platform-managed key;
            this protects your data against database leaks but not against us
            (for that, ask about CMK).
          </p>
        </div>
      </div>

      {/* status pill — what the deployment is capable of right now */}
      {state.kind === "ready" && !state.data.encryption_key_configured && (
        <div className="mt-3 inline-flex items-start gap-2 px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-500/5 text-[11px] text-amber-700 dark:text-amber-300 leading-relaxed">
          <Warning className="size-3.5 shrink-0 mt-px" weight="fill" />
          <span>
            <strong>ENCRYPTION_KEY is not configured</strong> on this deployment.
            Your toggles will be saved, but encryption won't actually run until
            an operator sets the key. Ask your admin if you expected this to be live.
          </span>
        </div>
      )}

      {state.kind === "loading" && (
        <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground/60">
          <CircleNotch className="size-3.5 animate-spin" />
          Loading preferences…
        </div>
      )}

      {state.kind === "error" && (
        <div className="mt-4 text-xs text-red-500 flex items-center gap-1.5">
          <Warning className="size-3" weight="fill" />
          {state.message}
        </div>
      )}

      {state.kind === "ready" && (
        <div className="mt-4 divide-y divide-border/25 border border-border/25 rounded-xl overflow-hidden bg-background/40">
          {CATEGORY_META
            // Hide categories that aren't wired up on the backend yet — we
            // don't want to show "Soon" placeholders in the popup for now.
            // Remove the filter once every category actually encrypts at rest.
            .filter((cat) => state.data.available.find((a) => a.id === cat.id)?.wired)
            .map((cat) => {
            const Icon = cat.icon
            const enabled = state.data.prefs[cat.id]
            const wired = state.data.available.find((a) => a.id === cat.id)?.wired ?? false
            const saving = state.pendingSaves.has(cat.id)
            return (
              <div
                key={cat.id}
                className={cn(
                  "flex items-start gap-3 px-3.5 py-3 transition-colors",
                  enabled && wired && "bg-blue-500/[0.03]"
                )}
              >
                <div
                  className={cn(
                    "h-8 w-8 rounded-lg flex items-center justify-center shrink-0 transition-colors",
                    enabled
                      ? "bg-blue-500/10 text-blue-500"
                      : "bg-muted/40 text-muted-foreground/60"
                  )}
                >
                  {enabled ? (
                    <LockKey className="size-4" weight="duotone" />
                  ) : (
                    <LockKeyOpen className="size-4" weight="duotone" />
                  )}
                </div>
                <div className="min-w-0 flex-1 pt-0.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Icon className="size-3.5 text-muted-foreground/55 shrink-0" />
                    <span className="text-sm font-medium text-foreground/90">
                      {cat.label}
                    </span>
                    {/* "Soon" badge for non-wired categories is commented
                        out — non-wired categories are filtered out above
                        for now, so this branch is unreachable. Restore
                        both together when bringing back coming-soon items.
                    {!wired && (
                      <span
                        className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-muted/60 text-muted-foreground/65"
                        title="Your toggle is saved, but the backend doesn't yet act on it for this category. Coming in a future release."
                      >
                        Soon
                      </span>
                    )}
                    */}
                    {enabled && wired && (
                      <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-600 dark:text-blue-400">
                        Encrypting
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground/60 mt-1 leading-relaxed pr-4">
                    {cat.description}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 pt-1 shrink-0">
                  {saving && (
                    <CircleNotch className="size-3.5 animate-spin text-muted-foreground/50" />
                  )}
                  <Switch
                    checked={enabled}
                    disabled={saving}
                    onCheckedChange={(v) => toggle(cat.id, v)}
                    aria-label={`Encrypt ${cat.label}`}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {state.kind === "ready" && (
        <p className="mt-3 text-[10.5px] text-muted-foreground/50 leading-relaxed">
          Changes propagate to new writes within ~{state.data.propagation_delay_seconds}s.
          Records written before a toggle was flipped are unaffected.
        </p>
      )}
    </div>
  )
}
