"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { motion, AnimatePresence } from "framer-motion"
import { Textarea } from "@/components/ui/textarea"
import { useUser } from "@/lib/user-store/provider"
import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { createClient } from "@/lib/supabase/client"
import { PageLoader } from "@/components/common/page-loader"
import {
  Copy,
  Check,
  Gift,
  Users,
  Coins,
  Send,
  ArrowRight,
  Loader2,
  Link2,
  MessageSquare,
} from "lucide-react"
import {
  TwitterLogo,
  LinkedinLogo,
  WhatsappLogo,
  TelegramLogo,
  RedditLogo,
  EnvelopeSimple,
  BookOpen,
} from "@phosphor-icons/react"

const EASE = [0.22, 1, 0.36, 1] as const

interface Referral {
  id: string
  email: string
  credits: number
  date: string
}

interface ReferralStats {
  referrals: Referral[]
  totalEarned: number
  totalReferrals: number
  referredBy: { email: string; credits: number; date: string } | null
}

type TabId = "share" | "feedback"

function buildSocials(shareMessage: string, emailSubject: string, emailBody: string) {
  return [
    {
      id: "twitter",
      label: "X",
      icon: TwitterLogo,
      tint: "#1DA1F2",
      urlFn: (link: string) =>
        `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareMessage)}%20%F0%9F%A4%96&url=${encodeURIComponent(link)}`,
    },
    {
      id: "linkedin",
      label: "LinkedIn",
      icon: LinkedinLogo,
      tint: "#0A66C2",
      urlFn: (link: string) =>
        `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(link)}`,
    },
    {
      id: "whatsapp",
      label: "WhatsApp",
      icon: WhatsappLogo,
      tint: "#25D366",
      urlFn: (link: string) =>
        `https://wa.me/?text=${encodeURIComponent(`${shareMessage}\n\n${link}`)}`,
    },
    {
      id: "telegram",
      label: "Telegram",
      icon: TelegramLogo,
      tint: "#26A5E4",
      urlFn: (link: string) =>
        `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(shareMessage)}`,
    },
    {
      id: "reddit",
      label: "Reddit",
      icon: RedditLogo,
      tint: "#FF4500",
      urlFn: (link: string) =>
        `https://reddit.com/submit?url=${encodeURIComponent(link)}&title=${encodeURIComponent(emailBody)}`,
    },
    {
      id: "email",
      label: "Email",
      icon: EnvelopeSimple,
      tint: null,
      urlFn: (link: string) =>
        `mailto:?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(`${shareMessage}\n\nHere's my link: ${link}`)}`,
    },
  ] as const
}

function maskEmail(email: string) {
  if (!email || !email.includes("@")) return email
  const [local, domain] = email.split("@")
  if (local.length <= 2) return `${local[0]}*@${domain}`
  return `${local[0]}${local[1]}${"*".repeat(Math.min(local.length - 2, 4))}@${domain}`
}

function timeAgo(dateStr: string) {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diff = now - then
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return `${Math.floor(days / 30)}mo ago`
}

function formatNum(n: number): string {
  if (n < 1000) return n.toLocaleString()
  if (n < 10_000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k"
  if (n < 1_000_000) return Math.round(n / 1000) + "k"
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M"
}

/* ═══════════════════════════════════════════════════════════════════
   Stat Tile — same language as developers page
   ═══════════════════════════════════════════════════════════════════ */

function StatTile({
  label,
  value,
  suffix,
  hint,
  accent,
}: {
  label: string
  value: string
  suffix?: string
  hint?: string
  accent?: "emerald" | "default"
}) {
  return (
    <div className="group relative rounded-2xl border border-foreground/[0.06] bg-foreground/[0.015] dark:bg-foreground/[0.02] p-5 overflow-hidden transition-colors hover:border-foreground/[0.1]">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/[0.08] to-transparent" />

      <div className="flex items-center justify-between mb-3">
        <span className="text-[10.5px] font-medium uppercase tracking-[0.16em] text-muted-foreground/45">
          {label}
        </span>
        {accent === "emerald" && (
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]" />
        )}
      </div>

      <div className="flex items-baseline gap-1.5">
        <span className="text-[26px] font-medium tracking-tight text-foreground leading-none tabular-nums">
          {value}
        </span>
        {suffix && (
          <span className="text-[11px] text-muted-foreground/45 leading-none">{suffix}</span>
        )}
      </div>

      {hint && (
        <div className="mt-2.5 h-3.5 flex items-center">
          <span className="text-[10.5px] text-muted-foreground/45 truncate">{hint}</span>
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   Section card with hairline accent — shared chrome
   ═══════════════════════════════════════════════════════════════════ */

function Section({
  eyebrow,
  title,
  meta,
  children,
}: {
  eyebrow?: string
  title?: string
  meta?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="relative rounded-2xl border border-foreground/[0.06] bg-foreground/[0.015] dark:bg-foreground/[0.02] overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/[0.08] to-transparent" />
      <div className="px-5 sm:px-6 pt-4 pb-5">
        {(eyebrow || title || meta) && (
          <div className="flex items-baseline justify-between gap-3 mb-4">
            <div className="min-w-0">
              {eyebrow && (
                <div className="text-[10.5px] font-medium uppercase tracking-[0.16em] text-muted-foreground/45 mb-1.5">
                  {eyebrow}
                </div>
              )}
              {title && (
                <h2 className="text-[15px] font-medium text-foreground tracking-[-0.005em]">
                  {title}
                </h2>
              )}
            </div>
            {meta && <div className="shrink-0">{meta}</div>}
          </div>
        )}
        {children}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   Hero referral-link card — signature aurora surface
   ═══════════════════════════════════════════════════════════════════ */

function ReferralLinkCard({
  link,
  copied,
  onCopy,
  eyebrow,
  perInviteCopy,
}: {
  link: string
  copied: boolean
  onCopy: () => void
  eyebrow: string
  perInviteCopy: string
}) {
  return (
    <div className="relative rounded-2xl border border-foreground/[0.06] bg-foreground/[0.015] dark:bg-foreground/[0.02] overflow-hidden">
      {/* Signature emerald hairline */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-500/35 to-transparent" />

      {/* Soft aurora blobs */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-20 left-1/4 h-56 w-56 rounded-full bg-emerald-500/[0.05] blur-3xl" />
        <div className="absolute -bottom-24 -right-12 h-64 w-64 rounded-full bg-foreground/[0.025] blur-3xl" />
      </div>

      <div className="relative px-5 sm:px-6 pt-5 pb-5">
        <div className="flex items-baseline justify-between gap-3 mb-3.5">
          <span className="text-[10.5px] font-medium uppercase tracking-[0.16em] text-muted-foreground/45">
            {eyebrow}
          </span>
          <span className="inline-flex items-center gap-1.5 text-[10.5px] tabular-nums text-muted-foreground/55">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]" />
            {perInviteCopy}
          </span>
        </div>

        <button
          type="button"
          onClick={onCopy}
          aria-label={copied ? "Link copied" : "Copy referral link"}
          className={cn(
            "group/copy flex w-full items-center gap-3 rounded-xl border bg-background/60 px-4 py-3 transition-all active:scale-[0.995]",
            copied
              ? "border-emerald-500/25 bg-emerald-500/[0.04]"
              : "border-foreground/[0.08] hover:border-foreground/15 hover:bg-background/80",
          )}
        >
          <Link2
            className={cn(
              "h-3.5 w-3.5 shrink-0 transition-colors",
              copied ? "text-emerald-500/70" : "text-muted-foreground/40",
            )}
            strokeWidth={1.8}
          />
          <code className="flex-1 min-w-0 font-mono text-[12.5px] sm:text-[13px] text-foreground/75 overflow-x-auto whitespace-nowrap scrollbar-invisible text-left select-all">
            {link}
          </code>
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 h-7 px-2.5 rounded-md text-[11px] font-medium transition-colors",
              copied
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "bg-foreground/[0.06] text-foreground/75 group-hover/copy:bg-foreground/[0.1]",
            )}
          >
            {copied ? <Check className="h-3 w-3" strokeWidth={2.4} /> : <Copy className="h-3 w-3" />}
            {copied ? "Copied" : "Copy"}
          </span>
        </button>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   Main
   ═══════════════════════════════════════════════════════════════════ */

export function ReferralContent() {
  const t = useTranslations("referralPage")
  const tLoader = useTranslations("pageLoaders.referral")
  const router = useRouter()
  const { user, isLoading } = useUser()
  const [isCopied, setIsCopied] = useState(false)
  const [stats, setStats] = useState<ReferralStats | null>(null)
  const [isLoadingStats, setIsLoadingStats] = useState(true)
  const [activeTab, setActiveTab] = useState<TabId>("share")

  const [feedbackText, setFeedbackText] = useState("")
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false)
  const [feedbackSent, setFeedbackSent] = useState(false)

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "https://coasty.ai"
  const referralLink = user ? `${baseUrl}/?ref=${user.id}` : ""

  const socials = buildSocials(t("shareMessage"), t("emailSubject"), t("emailBody"))

  const fetchStats = useCallback(async () => {
    setIsLoadingStats(true)
    try {
      const res = await fetch("/api/referral/stats")
      if (res.ok) setStats(await res.json())
    } catch {
      // Silently fail
    } finally {
      setIsLoadingStats(false)
    }
  }, [])

  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/auth?redirectTo=/referral")
    }
  }, [user, isLoading, router])

  useEffect(() => {
    if (user) fetchStats()
  }, [user, fetchStats])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(referralLink)
    } catch {
      const textArea = document.createElement("textarea")
      textArea.value = referralLink
      textArea.style.position = "fixed"
      textArea.style.opacity = "0"
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand("copy")
      document.body.removeChild(textArea)
    }
    setIsCopied(true)
    toast.success("Referral link copied!")
    setTimeout(() => setIsCopied(false), 2500)
  }

  const handleShare = (urlFn: (link: string) => string) => {
    window.open(urlFn(referralLink), "_blank", "width=600,height=500")
  }

  const handleFeedback = async () => {
    if (!feedbackText.trim() || !user) return
    setFeedbackSubmitting(true)
    try {
      const supabase = createClient()
      if (!supabase) {
        toast.error("Feedback is not available right now.")
        return
      }
      const { error } = await supabase.from("feedback").insert({
        message: feedbackText.trim(),
        user_id: user.id,
      })
      if (error) {
        toast.error("Failed to send feedback. Please try again.")
      } else {
        setFeedbackSent(true)
        setFeedbackText("")
        toast.success("Thanks for your feedback!")
      }
    } catch {
      toast.error("Failed to send feedback. Please try again.")
    } finally {
      setFeedbackSubmitting(false)
    }
  }

  if (!isLoading && !user) return null

  const howSteps = t.raw("howSteps") as string[]
  const features = t.raw("features") as string[]

  const tabs: { id: TabId; label: string; icon: typeof Gift }[] = [
    { id: "share", label: t("tabs.invite"), icon: Gift },
    { id: "feedback", label: t("tabs.feedback"), icon: MessageSquare },
  ]

  return (
    <PageLoader
      isLoading={isLoading}
      title={tLoader("title")}
      description={tLoader("description")}
    >
      <div className="h-full overflow-y-auto overflow-x-hidden scrollbar-invisible relative">
        {/* Ambient background — matches /history and /machines. Two soft
            radial blooms plus a faint grid so the page reads as part of
            the same surface family. */}
        <div className="pointer-events-none fixed inset-0 overflow-hidden">
          <div
            className="absolute -top-[30%] -right-[15%] h-[60%] w-[50%] rounded-full opacity-[0.02] dark:opacity-[0.04] blur-[120px]"
            style={{ background: "radial-gradient(circle, currentColor, transparent 70%)" }}
          />
          <div
            className="absolute -bottom-[20%] -left-[10%] h-[50%] w-[40%] rounded-full opacity-[0.015] dark:opacity-[0.035] blur-[100px]"
            style={{ background: "radial-gradient(circle, currentColor, transparent 70%)" }}
          />
          <div
            className="absolute inset-0 opacity-[0.012] dark:opacity-[0.025]"
            style={{
              backgroundImage:
                "linear-gradient(rgba(128,128,128,.3) 1px, transparent 1px), linear-gradient(90deg, rgba(128,128,128,.3) 1px, transparent 1px)",
              backgroundSize: "80px 80px",
            }}
          />
        </div>

        <div className="container mx-auto p-4 sm:p-6 lg:p-8 max-w-7xl space-y-6 relative z-10">
          {/* ── Header — mirrors /history: a single page title with an
                inline count badge, short subtitle, and a Guide link.
                The primary action (Copy link) sits on the right at md+. ── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: EASE }}
            className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4"
          >
            <div className="min-w-0">
              <h1 className="text-2xl sm:text-3xl font-medium tracking-tight flex items-center gap-2.5">
                Referrals
                {stats && stats.totalReferrals > 0 && (
                  <span className="text-sm font-normal text-muted-foreground ml-1">
                    ({stats.totalReferrals})
                  </span>
                )}
              </h1>
              <div className="flex items-center gap-3 mt-1.5">
                <p className="text-muted-foreground text-sm">
                  {t("shareDescription")}
                </p>
                <Link
                  href="/guide"
                  className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-foreground/[0.05] px-2.5 py-1 text-xs font-medium text-foreground/70 hover:text-foreground hover:border-border hover:bg-foreground/[0.08] transition-all"
                >
                  <BookOpen size={14} weight="duotone" />
                  Guide
                </Link>
              </div>
            </div>
            <button
              onClick={handleCopy}
              className={cn(
                "hidden sm:inline-flex h-9 items-center justify-center rounded-xl px-4 text-[12.5px] font-medium gap-1.5 transition-all shrink-0 shadow-sm",
                "bg-foreground text-background hover:bg-foreground/90 active:scale-[0.98]"
              )}
            >
              {isCopied ? <Check className="h-3.5 w-3.5" strokeWidth={2.4} /> : <Copy className="h-3.5 w-3.5" />}
              {isCopied ? "Copied" : "Copy link"}
            </button>
          </motion.div>

          {/* ── Stats row ── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.05, ease: EASE }}
            className="grid grid-cols-3 gap-3"
          >
            <StatTile
              label={t("stats.invited")}
              value={formatNum(stats?.totalReferrals ?? 0)}
              suffix={(stats?.totalReferrals ?? 0) === 1 ? "friend" : "friends"}
              hint={stats && stats.totalReferrals > 0 ? "Joined via your link" : "Share your link to start"}
            />
            <StatTile
              label={t("stats.earned")}
              value={formatNum(stats?.totalEarned ?? 0)}
              suffix="credits"
              hint={stats && stats.totalEarned > 0 ? `+${formatNum(stats.totalEarned)} from referrals` : "No earnings yet"}
              accent="emerald"
            />
            <StatTile
              label={t("stats.perInvite")}
              value="50"
              suffix="credits"
              hint="Both of you earn"
            />
          </motion.div>

          {/* ── Tab nav ── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1, ease: EASE }}
            className="rounded-2xl border border-foreground/[0.06] bg-background/60 dark:bg-background/40 backdrop-blur-2xl p-1.5 shadow-sm w-fit"
          >
            <nav className="flex items-center gap-0.5" role="tablist">
              {tabs.map((tab) => {
                const Icon = tab.icon
                const isActive = activeTab === tab.id
                return (
                  <button
                    key={tab.id}
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      "relative flex items-center justify-center gap-1.5 rounded-xl px-3 sm:px-3.5 py-1.5 text-[11px] sm:text-[12.5px] font-medium transition-all duration-200",
                      isActive
                        ? "bg-foreground/[0.08] dark:bg-foreground/[0.12] text-foreground"
                        : "text-muted-foreground/55 hover:text-foreground/80 hover:bg-foreground/[0.04]",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={isActive ? 2.2 : 1.8} />
                    <span className="truncate">{tab.label}</span>
                  </button>
                )
              })}
            </nav>
          </motion.div>

          {/* ── Tab content ── */}
          <AnimatePresence mode="wait">
            {activeTab === "share" ? (
              <motion.div
                key="share"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.3, ease: EASE }}
                className="space-y-5"
              >
                {/* Hero link card — signature surface */}
                <ReferralLinkCard
                  link={referralLink}
                  copied={isCopied}
                  onCopy={handleCopy}
                  eyebrow={t("referralLink")}
                  perInviteCopy={t("giveGet")}
                />

                {/* How it works — horizontal stepper */}
                <Section eyebrow="Steps" title={t("howItWorks")}>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {howSteps.map((step, i) => (
                      <motion.div
                        key={step}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.35, delay: 0.05 + i * 0.06, ease: EASE }}
                        className="relative rounded-xl border border-foreground/[0.06] bg-background/40 px-4 py-3.5"
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-foreground/[0.08] text-[10px] font-semibold text-foreground/60 tabular-nums">
                            {i + 1}
                          </span>
                          {i < howSteps.length - 1 && (
                            <div className="hidden sm:block flex-1 h-px bg-foreground/[0.06]" />
                          )}
                          {i === howSteps.length - 1 && (
                            <span className="ml-auto inline-flex items-center gap-0.5 text-[9.5px] font-medium text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
                              <Coins className="h-2.5 w-2.5" strokeWidth={2} />
                              +50
                            </span>
                          )}
                        </div>
                        <p className="text-[12px] text-foreground/70 leading-snug">{step}</p>
                      </motion.div>
                    ))}
                  </div>
                </Section>

                {/* Share directly */}
                <Section eyebrow="Channels" title={t("shareDirectly")}>
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                    {socials.map((s, i) => {
                      const Icon = s.icon
                      return (
                        <motion.button
                          key={s.id}
                          type="button"
                          onClick={() => handleShare(s.urlFn)}
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.3, delay: 0.05 + i * 0.04, ease: EASE }}
                          style={s.tint ? ({ ["--tint" as string]: s.tint } as React.CSSProperties) : undefined}
                          className={cn(
                            "group/social relative flex flex-col items-center gap-2 rounded-xl border border-foreground/[0.06] bg-background/40 px-3 py-3.5 transition-all overflow-hidden",
                            s.tint
                              ? "hover:border-[color:var(--tint)]/30 hover:bg-[color:var(--tint)]/[0.04]"
                              : "hover:border-foreground/15 hover:bg-background/70",
                          )}
                        >
                          <Icon
                            size={18}
                            weight="bold"
                            className={cn(
                              "transition-colors",
                              s.tint
                                ? "text-foreground/65 group-hover/social:text-[color:var(--tint)]"
                                : "text-foreground/65 group-hover/social:text-foreground",
                            )}
                          />
                          <span
                            className={cn(
                              "text-[10.5px] font-medium transition-colors",
                              s.tint
                                ? "text-muted-foreground/60 group-hover/social:text-[color:var(--tint)]"
                                : "text-muted-foreground/60 group-hover/social:text-foreground",
                            )}
                          >
                            {s.label}
                          </span>
                        </motion.button>
                      )
                    })}
                  </div>
                </Section>

                {/* Your referrals — activity list */}
                <Section
                  eyebrow="Activity"
                  title={t("yourReferrals")}
                  meta={
                    stats && (stats.totalReferrals > 0 || stats.referredBy) ? (
                      <span className="text-[10.5px] tabular-nums text-muted-foreground/35">
                        {stats.totalReferrals} {stats.totalReferrals === 1 ? "referral" : "referrals"}
                        {stats.totalEarned > 0 && <> · +{formatNum(stats.totalEarned)} cr</>}
                      </span>
                    ) : null
                  }
                >
                  {isLoadingStats ? (
                    <div className="flex items-center justify-center py-10">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground/30" />
                    </div>
                  ) : stats && (stats.totalReferrals > 0 || stats.referredBy) ? (
                    <div className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.015] overflow-hidden divide-y divide-foreground/[0.04]">
                      {stats.referredBy && (
                        <div className="flex items-center gap-3 px-4 py-3">
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 ring-1 ring-emerald-500/20">
                            <ArrowRight className="h-3 w-3 text-emerald-600 dark:text-emerald-400 -rotate-45" strokeWidth={2.2} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-[12.5px] font-medium text-foreground/85 truncate">
                              {maskEmail(stats.referredBy.email)}
                            </p>
                            <p className="text-[10.5px] text-muted-foreground/50">{t("invitedYou")}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-[12.5px] font-medium tabular-nums text-emerald-600 dark:text-emerald-400">
                              +{stats.referredBy.credits.toLocaleString()}
                            </p>
                            <p className="text-[10.5px] tabular-nums text-muted-foreground/40">
                              {timeAgo(stats.referredBy.date)}
                            </p>
                          </div>
                        </div>
                      )}
                      {stats.referrals.map((r) => (
                        <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.05]">
                            <Users className="h-3 w-3 text-muted-foreground/60" strokeWidth={1.8} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-[12.5px] font-medium text-foreground/85 truncate">
                              {maskEmail(r.email)}
                            </p>
                            <p className="text-[10.5px] text-muted-foreground/50">{t("joinedViaLink")}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-[12.5px] font-medium tabular-nums text-emerald-600 dark:text-emerald-400">
                              +{r.credits.toLocaleString()}
                            </p>
                            <p className="text-[10.5px] tabular-nums text-muted-foreground/40">
                              {timeAgo(r.date)}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="relative rounded-xl border border-foreground/[0.06] bg-foreground/[0.012] overflow-hidden">
                      <div className="pointer-events-none absolute inset-0">
                        <div className="absolute -top-10 left-1/2 -translate-x-1/2 h-32 w-48 rounded-full bg-foreground/[0.02] blur-3xl" />
                      </div>
                      <div className="relative flex flex-col items-center justify-center py-10 px-6 text-center">
                        <div className="relative h-10 w-10 mb-3 flex items-center justify-center">
                          <div className="absolute inset-0 rounded-xl border border-foreground/[0.08] bg-foreground/[0.03]" />
                          <Users className="relative h-4 w-4 text-foreground/55" strokeWidth={1.6} />
                          <motion.span
                            className="absolute inset-0 rounded-xl border border-foreground/15"
                            animate={{ opacity: [0, 0.5, 0], scale: [1, 1.18, 1.3] }}
                            transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
                          />
                        </div>
                        <p className="text-[13px] font-medium text-foreground/85">{t("noReferrals")}</p>
                        <p className="text-[11px] text-muted-foreground/50 mt-1 max-w-xs leading-relaxed">
                          {t("noReferralsHint")}
                        </p>
                      </div>
                    </div>
                  )}
                </Section>

                {/* Why share — features list, restrained */}
                {features?.length > 0 && (
                  <Section eyebrow="Why" title={t("friendsCould")}>
                    <div className="space-y-2.5">
                      {features.map((feature, i) => (
                        <motion.div
                          key={feature}
                          initial={{ opacity: 0, x: -6 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ duration: 0.3, delay: 0.05 + i * 0.05, ease: EASE }}
                          className="flex items-center gap-3"
                        >
                          <div className="h-px w-4 bg-foreground/[0.12] shrink-0" />
                          <span className="text-[12.5px] text-muted-foreground/70 leading-relaxed">
                            {feature}
                          </span>
                        </motion.div>
                      ))}
                    </div>
                  </Section>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="feedback"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.3, ease: EASE }}
              >
                {feedbackSent ? (
                  <div className="relative rounded-2xl border border-foreground/[0.06] bg-foreground/[0.015] dark:bg-foreground/[0.02] overflow-hidden">
                    <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-500/35 to-transparent" />
                    <div className="pointer-events-none absolute inset-0">
                      <div className="absolute -top-16 left-1/2 -translate-x-1/2 h-40 w-72 rounded-full bg-emerald-500/[0.04] blur-3xl" />
                    </div>
                    <div className="relative flex flex-col items-center px-6 py-14 text-center">
                      <div className="relative h-12 w-12 mb-5 flex items-center justify-center">
                        <div className="absolute inset-0 rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.08]" />
                        <Check className="relative h-5 w-5 text-emerald-500" strokeWidth={2.2} />
                      </div>
                      <p className="text-[15px] font-medium tracking-[-0.005em]">
                        {t("feedbackThanks")}
                      </p>
                      <p className="text-[12.5px] text-muted-foreground/55 mt-1 max-w-xs leading-relaxed">
                        {t("feedbackWeRead")}
                      </p>
                      <button
                        onClick={() => setFeedbackSent(false)}
                        className="mt-5 inline-flex items-center gap-1.5 h-8 px-3.5 rounded-lg border border-foreground/[0.08] text-[11.5px] font-medium text-muted-foreground/70 hover:text-foreground hover:border-foreground/20 hover:bg-foreground/[0.03] transition-all"
                      >
                        {t("sendAnother")}
                        <ArrowRight className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <Section eyebrow="Direct line" title={t("feedbackTitle")}>
                    <p className="text-[12.5px] text-muted-foreground/60 leading-relaxed mb-4">
                      {t("feedbackSubtitle")}
                    </p>
                    <Textarea
                      placeholder={t("feedbackPlaceholder")}
                      value={feedbackText}
                      onChange={(e) => setFeedbackText(e.target.value)}
                      rows={6}
                      className={cn(
                        "resize-none text-[13px] leading-relaxed rounded-xl mb-3",
                        "bg-background/60 text-foreground",
                        "border-foreground/[0.08] hover:border-foreground/15 focus-visible:border-foreground/25",
                        "placeholder:text-muted-foreground/40",
                        "transition-all duration-200",
                      )}
                    />
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[10.5px] text-muted-foreground/40">
                        {t("weReadEvery")}
                      </p>
                      <button
                        onClick={handleFeedback}
                        disabled={!feedbackText.trim() || feedbackSubmitting}
                        className={cn(
                          "inline-flex h-9 items-center justify-center rounded-xl px-4 text-[12.5px] font-medium gap-1.5 transition-all",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20",
                          "disabled:opacity-40 disabled:cursor-not-allowed",
                          feedbackText.trim() && !feedbackSubmitting
                            ? "bg-foreground text-background hover:bg-foreground/90 shadow-sm"
                            : "bg-foreground/[0.08] text-muted-foreground/60",
                        )}
                      >
                        {feedbackSubmitting ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <>
                            <Send className="h-3.5 w-3.5" strokeWidth={1.9} />
                            {t("send")}
                          </>
                        )}
                      </button>
                    </div>
                  </Section>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </PageLoader>
  )
}
