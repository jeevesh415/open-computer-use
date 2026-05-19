"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { useTheme } from "next-themes"
import { motion } from "framer-motion"
import { Plus, KeyRound, Eye, EyeOff, MoreHorizontal, Pencil, Trash2, ShieldCheck, LockKeyhole, Globe, MousePointerClick, BookOpen, Download } from "lucide-react"
import Link from "next/link"
import { PageLoader } from "@/components/common/page-loader"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { toast } from "sonner"
import type { UserSecret } from "@/types/secrets.types"
import { SecretDialog } from "./secret-dialog"
import { ImportDialog } from "./import-dialog"
import { cn } from "@/lib/utils"

/* ─── SecretCard ─── */

interface SecretCardProps {
  secret: UserSecret
  revealedPassword?: string
  isRevealing: boolean
  onReveal: () => void
  onEdit: () => void
  onDelete: () => void
}

function ServiceAvatar({ domain }: { domain: string }) {
  const { resolvedTheme } = useTheme()
  const [error, setError] = useState(false)
  const coastyLogo = resolvedTheme === "light" ? "/logo_dark.svg" : "/logo_light.svg"
  return (
    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted/60 ring-1 ring-border/30 overflow-hidden">
      {!error ? (
        <img
          src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
          alt={domain}
          className="h-5 w-5 object-contain"
          onError={() => setError(true)}
        />
      ) : (
        <img
          src={coastyLogo}
          alt=""
          className="h-5 w-5 object-contain"
        />
      )}
    </div>
  )
}

function getDomain(service: string): string | null {
  try {
    const url = service.startsWith("http") ? service : `https://${service}`
    const hostname = new URL(url).hostname
    return hostname.includes(".") ? hostname : null
  } catch {
    return service.includes(".") ? service.split("/")[0] : null
  }
}

/* ─── Aurora thumbnail for credential cards (same as machine-card-thumbnail) ─── */

const CRED_PALETTES = [
  { a: "#6366f1", b: "#a78bfa", c: "#818cf8" },
  { a: "#3b82f6", b: "#8b5cf6", c: "#60a5fa" },
  { a: "#06b6d4", b: "#6366f1", c: "#22d3ee" },
  { a: "#8b5cf6", b: "#ec4899", c: "#c084fc" },
  { a: "#f43f5e", b: "#f97316", c: "#fb7185" },
  { a: "#10b981", b: "#06b6d4", c: "#34d399" },
  { a: "#f59e0b", b: "#ef4444", c: "#fbbf24" },
  { a: "#ec4899", b: "#8b5cf6", c: "#f9a8d4" },
  { a: "#14b8a6", b: "#3b82f6", c: "#2dd4bf" },
  { a: "#a855f7", b: "#f43f5e", c: "#d946ef" },
]

function useCredVisuals(id: string) {
  return useMemo(() => {
    let hash = 0
    for (let i = 0; i < id.length; i++) {
      hash = id.charCodeAt(i) + ((hash << 5) - hash)
    }
    const r = (seed: number) => {
      const x = Math.sin(seed * 9301 + 49297) * 49297
      return x - Math.floor(x)
    }
    return {
      palette: CRED_PALETTES[Math.abs(hash) % CRED_PALETTES.length],
      blobPos: {
        x1: 15 + r(hash + 1) * 30,
        y1: 20 + r(hash + 2) * 30,
        x2: 55 + r(hash + 3) * 30,
        y2: 30 + r(hash + 4) * 40,
      },
      uid: id.slice(0, 8),
    }
  }, [id])
}

function SecretCard({ secret, revealedPassword, isRevealing, onReveal, onEdit, onDelete }: SecretCardProps) {
  const t = useTranslations("secrets")
  const { resolvedTheme } = useTheme()
  const [faviconError, setFaviconError] = useState(false)
  const domain = getDomain(secret.service)
  const faviconUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=64` : null
  const coastyLogo = resolvedTheme === "light" ? "/logo_dark.svg" : "/logo_light.svg"
  const { palette, blobPos, uid } = useCredVisuals(secret.id)

  return (
    <div className={cn(
      "group relative h-full flex flex-col rounded-2xl overflow-hidden",
      "bg-card border border-border/40",
      "transition-all duration-300 ease-out",
      "hover:border-border/80 hover:shadow-lg hover:shadow-black/[0.04] dark:hover:shadow-black/[0.12]",
    )}>
      {/* Aurora thumbnail header */}
      <div className="relative h-24 w-full overflow-hidden shrink-0">
        <style dangerouslySetInnerHTML={{ __html: `
          @keyframes cr-drift-${uid} {
            0%, 100% { transform: translate(0, 0) scale(1); }
            33% { transform: translate(8px, -6px) scale(1.05); }
            66% { transform: translate(-6px, 8px) scale(0.97); }
          }
          @keyframes cr-drift2-${uid} {
            0%, 100% { transform: translate(0, 0) scale(1); }
            50% { transform: translate(-10px, 6px) scale(1.04); }
          }
          @keyframes cr-shimmer-${uid} {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(200%); }
          }
        ` }} />

        <div
          className="absolute inset-0"
          style={{ background: `linear-gradient(135deg, ${palette.a}15 0%, transparent 50%, ${palette.b}10 100%)` }}
        />
        <div
          className="absolute will-change-transform rounded-full"
          style={{
            width: "70%", height: "140%",
            left: `${blobPos.x1}%`, top: `${blobPos.y1 - 40}%`,
            background: `radial-gradient(ellipse at center, ${palette.a}30, transparent 70%)`,
            filter: "blur(24px)",
            animation: `cr-drift-${uid} 10s ease-in-out infinite`,
          }}
        />
        <div
          className="absolute will-change-transform rounded-full"
          style={{
            width: "60%", height: "120%",
            left: `${blobPos.x2}%`, top: `${blobPos.y2 - 30}%`,
            background: `radial-gradient(ellipse at center, ${palette.b}25, transparent 70%)`,
            filter: "blur(20px)",
            animation: `cr-drift2-${uid} 8s ease-in-out infinite`,
          }}
        />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `linear-gradient(105deg, transparent 40%, ${palette.c}08 50%, transparent 60%)`,
            animation: `cr-shimmer-${uid} 6s ease-in-out infinite`,
          }}
        />
        <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-card to-transparent" />
      </div>

      {/* Card body */}
      <div className="flex flex-col flex-1 px-5 pb-4 pt-0.5 relative">
        {/* Header */}
        <div className="flex justify-between items-start mb-3">
          <div className="space-y-1 min-w-0 flex-1">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/60 overflow-hidden">
                {faviconUrl && !faviconError ? (
                  <img
                    src={faviconUrl}
                    alt=""
                    className="h-4.5 w-4.5 object-contain"
                    onError={() => setFaviconError(true)}
                  />
                ) : (
                  <img
                    src={coastyLogo}
                    alt=""
                    className="h-4.5 w-4.5 object-contain"
                  />
                )}
              </div>
              <p className="text-base font-semibold truncate">{secret.name}</p>
            </div>
            <p className="text-xs text-muted-foreground truncate pl-[42px]">{secret.service}</p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit} className="gap-2">
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onDelete} className="gap-2 text-destructive focus:text-destructive">
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Credential fields */}
        <div className="space-y-3 flex-1">
          <div className="space-y-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">{t("username")}</span>
            <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2">
              <span className="text-sm font-mono text-foreground truncate flex-1">{secret.username}</span>
            </div>
          </div>
          <div className="space-y-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">{t("password")}</span>
            <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2">
              <span className="text-sm font-mono text-foreground truncate flex-1">
                {revealedPassword ?? "••••••••••••"}
              </span>
              <button
                onClick={onReveal}
                disabled={isRevealing}
                className="h-6 w-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors duration-150 shrink-0 disabled:opacity-40"
                title={revealedPassword ? t("hide") : t("revealFor10s")}
              >
                {revealedPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          {secret.notes && (
            <p className="text-xs text-muted-foreground leading-relaxed pt-1">{secret.notes}</p>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-border/30 px-5 py-3 flex items-center gap-1.5">
        <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground/30 shrink-0" />
        <span className="text-[11px] text-muted-foreground/40">{t("encrypted")}</span>
      </div>
    </div>
  )
}

/* ─── Main content ─── */

export function SecretsContent() {
  const t = useTranslations("secrets")
  const tLoader = useTranslations("pageLoaders.secrets")
  const [secrets, setSecrets] = useState<UserSecret[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingSecret, setEditingSecret] = useState<UserSecret | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<UserSecret | null>(null)
  const [revealedPasswords, setRevealedPasswords] = useState<Record<string, string>>({})
  const [revealingId, setRevealingId] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const hideTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const fetchSecrets = useCallback(async () => {
    try {
      const res = await fetch("/api/secrets")
      const data = await res.json()
      setSecrets(data.secrets ?? [])
    } catch {
      toast.error(t("toasts.loadFailed"))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSecrets()
  }, [fetchSecrets])

  useEffect(() => {
    return () => {
      Object.values(hideTimers.current).forEach(clearTimeout)
    }
  }, [])

  async function handleReveal(secret: UserSecret) {
    if (revealedPasswords[secret.id]) {
      setRevealedPasswords((prev) => {
        const next = { ...prev }
        delete next[secret.id]
        return next
      })
      clearTimeout(hideTimers.current[secret.id])
      return
    }

    setRevealingId(secret.id)
    try {
      const res = await fetch(`/api/secrets/${secret.id}`)
      if (!res.ok) throw new Error("Failed")
      const data = await res.json()
      setRevealedPasswords((prev) => ({ ...prev, [secret.id]: data.password }))

      clearTimeout(hideTimers.current[secret.id])
      hideTimers.current[secret.id] = setTimeout(() => {
        setRevealedPasswords((prev) => {
          const next = { ...prev }
          delete next[secret.id]
          return next
        })
      }, 10000)
    } catch {
      toast.error(t("toasts.revealFailed"))
    } finally {
      setRevealingId(null)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      const res = await fetch(`/api/secrets/${deleteTarget.id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Failed")
      toast.success(t("toasts.deleted"))
      setSecrets((prev) => prev.filter((s) => s.id !== deleteTarget.id))
      setRevealedPasswords((prev) => {
        const next = { ...prev }
        delete next[deleteTarget.id]
        return next
      })
    } catch {
      toast.error(t("toasts.deleteFailed"))
    } finally {
      setDeleteTarget(null)
    }
  }

  function handleEdit(secret: UserSecret) {
    setEditingSecret(secret)
    setDialogOpen(true)
  }

  function handleAdd() {
    setEditingSecret(null)
    setDialogOpen(true)
  }

  return (
    <PageLoader
      isLoading={loading}
      title={tLoader("title")}
      description={tLoader("description")}
    >
    <div className="h-full overflow-y-auto overflow-x-hidden scrollbar-invisible relative bg-transparent">
      {/* Ambient background — soft blur orbs only; grid removed for calm */}
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute -top-1/4 -right-1/4 h-[600px] w-[600px] rounded-full bg-foreground/[0.02] dark:bg-foreground/[0.04] blur-3xl" />
        <div className="absolute -bottom-1/4 -left-1/4 h-[500px] w-[500px] rounded-full bg-foreground/[0.02] dark:bg-foreground/[0.04] blur-3xl" />
      </div>

      <div className="container mx-auto p-4 sm:p-6 lg:p-8 max-w-7xl space-y-6 relative">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4"
        >
          <div>
            <h1 className="text-2xl sm:text-3xl font-medium tracking-tight">{t("title")}</h1>
            <div className="flex items-center gap-3 mt-1.5">
              <p className="text-muted-foreground text-sm">
                {t("subtitle")}
              </p>
              <Link
                href="/guide?tab=credentials"
                className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-foreground/[0.05] px-2.5 py-1 text-xs font-medium text-foreground/70 hover:text-foreground hover:border-border hover:bg-foreground/[0.08] transition-all"
              >
                <BookOpen className="h-3.5 w-3.5" />
                {t("guide")}
              </Link>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setImportOpen(true)}
              className="inline-flex h-9 items-center justify-center rounded-xl px-4 text-sm font-medium gap-2 transition-all border border-border/60 bg-foreground/[0.05] text-foreground/80 hover:text-foreground hover:border-border hover:bg-foreground/[0.08]"
            >
              <Download className="h-4 w-4" />
              {t("import")}
            </button>
            <button
              onClick={handleAdd}
              className="inline-flex h-9 items-center justify-center rounded-xl px-5 text-sm font-medium gap-2 transition-all bg-foreground text-background hover:bg-foreground/90"
            >
              <Plus className="h-4 w-4" />
              {t("addCredential")}
            </button>
          </div>
        </motion.div>

        {/* Security Banner */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
          className="relative flex flex-col sm:flex-row items-start sm:items-center gap-3 rounded-xl border border-border/30 bg-card/50 backdrop-blur-sm px-3 sm:px-4 py-3 overflow-hidden"
        >
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/[0.06] to-transparent" />
          <div className="flex items-start sm:items-center gap-2 sm:gap-3 min-w-0">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-muted-foreground mt-0.5 sm:mt-0" />
            <p className="text-xs sm:text-sm text-muted-foreground">
              {t("securityNote")}
            </p>
          </div>
        </motion.div>

        {/* Credentials Grid */}
        {secrets.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
            className="relative rounded-2xl border border-border/30 bg-card/50 backdrop-blur-sm overflow-hidden"
          >
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute -top-12 right-1/4 h-56 w-56 rounded-full bg-foreground/[0.02] blur-3xl" />
              <div className="absolute -bottom-12 left-1/4 h-48 w-48 rounded-full bg-foreground/[0.02] blur-3xl" />
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/[0.08] to-transparent" />
            </div>

            <div className="relative flex flex-col items-center py-14 px-6 text-center">
              {/* Popular service icons row */}
              <div className="flex items-center gap-2.5 mb-8">
                {[
                  "gmail.com", "github.com", "linkedin.com",
                  "notion.so", "figma.com", "shopify.com",
                ].map((domain, i) => (
                  <motion.div
                    key={domain}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.3, delay: 0.15 + i * 0.04, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <ServiceAvatar domain={domain} />
                  </motion.div>
                ))}
                <motion.div
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.3, delay: 0.39, ease: [0.22, 1, 0.36, 1] }}
                  className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted/40 ring-1 ring-border/20"
                >
                  <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground/30" />
                </motion.div>
              </div>

              <h3 className="text-xl font-bold mb-2">{t("emptyState.title")}</h3>
              <p className="text-sm text-muted-foreground max-w-sm mb-10">
                {t("emptyState.description")}
              </p>

              {/* Feature cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-10 text-left w-full max-w-xl">
                {[
                  {
                    icon: MousePointerClick,
                    title: t("emptyState.feature1.title"),
                    desc: t("emptyState.feature1.description"),
                  },
                  {
                    icon: ShieldCheck,
                    title: t("emptyState.feature2.title"),
                    desc: t("emptyState.feature2.description"),
                  },
                  {
                    icon: Globe,
                    title: t("emptyState.feature3.title"),
                    desc: t("emptyState.feature3.description"),
                  },
                ].map(({ icon: Icon, title, desc }, i) => (
                  <motion.div
                    key={title}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.2 + i * 0.06, ease: [0.22, 1, 0.36, 1] }}
                    className="relative flex flex-col gap-2 rounded-xl p-4 overflow-hidden border border-border/30 bg-card/50 backdrop-blur-sm"
                  >
                    <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/[0.08] to-transparent" />
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted/60">
                      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                    <p className="text-xs font-semibold text-foreground/80">{title}</p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">{desc}</p>
                  </motion.div>
                ))}
              </div>

              <button
                onClick={handleAdd}
                className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-all text-background bg-foreground hover:bg-foreground/90 hover:scale-[1.02] active:scale-[0.98]"
              >
                <Plus className="h-4 w-4" />
                {t("emptyState.cta")}
              </button>
            </div>
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {secrets.map((secret, i) => (
              <motion.div
                key={secret.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.05 + i * 0.04, ease: [0.22, 1, 0.36, 1] }}
              >
                <SecretCard
                  secret={secret}
                  revealedPassword={revealedPasswords[secret.id]}
                  isRevealing={revealingId === secret.id}
                  onReveal={() => handleReveal(secret)}
                  onEdit={() => handleEdit(secret)}
                  onDelete={() => setDeleteTarget(secret)}
                />
              </motion.div>
            ))}
          </div>
        )}
      </div>

      <SecretDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        secret={editingSecret}
        onSaved={fetchSecrets}
      />

      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={fetchSecrets}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteDialog.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteDialog.description", { name: deleteTarget?.name ?? "", service: deleteTarget?.service ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("deleteDialog.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("deleteDialog.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </PageLoader>
  )
}
