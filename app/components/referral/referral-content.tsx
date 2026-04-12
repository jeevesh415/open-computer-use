"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"
import { Textarea } from "@/components/ui/textarea"
import { useUser } from "@/lib/user-store/provider"
import { useChats } from "@/lib/chat-store/chats/provider"
import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { createClient } from "@/lib/supabase/client"
import { CoastyIcon } from "@/components/icons/coasty"
import {
  Copy,
  Check,
  TwitterLogo,
  LinkedinLogo,
  WhatsappLogo,
  TelegramLogo,
  RedditLogo,
  EnvelopeSimple,
  CircleNotch,
  Gift,
  Users,
  Coins,
  PaperPlaneTilt,
  ChatCircleDots,
  ArrowRight,
} from "@phosphor-icons/react"

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

function buildSocials(shareMessage: string, emailSubject: string, emailBody: string) {
  return [
    {
      id: "twitter",
      label: "X",
      icon: TwitterLogo,
      color: "hover:bg-[#1DA1F2]/10 hover:text-[#1DA1F2] hover:border-[#1DA1F2]/30",
      urlFn: (link: string) =>
        `https://twitter.com/intent/tweet?text=${encodeURIComponent(`${shareMessage}`)}%20%F0%9F%A4%96&url=${encodeURIComponent(link)}`,
    },
    {
      id: "linkedin",
      label: "LinkedIn",
      icon: LinkedinLogo,
      color: "hover:bg-[#0A66C2]/10 hover:text-[#0A66C2] hover:border-[#0A66C2]/30",
      urlFn: (link: string) =>
        `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(link)}`,
    },
    {
      id: "whatsapp",
      label: "WhatsApp",
      icon: WhatsappLogo,
      color: "hover:bg-[#25D366]/10 hover:text-[#25D366] hover:border-[#25D366]/30",
      urlFn: (link: string) =>
        `https://wa.me/?text=${encodeURIComponent(`${shareMessage}\n\n${link}`)}`,
    },
    {
      id: "telegram",
      label: "Telegram",
      icon: TelegramLogo,
      color: "hover:bg-[#26A5E4]/10 hover:text-[#26A5E4] hover:border-[#26A5E4]/30",
      urlFn: (link: string) =>
        `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(shareMessage)}`,
    },
    {
      id: "reddit",
      label: "Reddit",
      icon: RedditLogo,
      color: "hover:bg-[#FF4500]/10 hover:text-[#FF4500] hover:border-[#FF4500]/30",
      urlFn: (link: string) =>
        `https://reddit.com/submit?url=${encodeURIComponent(link)}&title=${encodeURIComponent(emailBody)}`,
    },
    {
      id: "email",
      label: "Email",
      icon: EnvelopeSimple,
      color: "hover:bg-foreground/[0.06] hover:text-foreground hover:border-border/50",
      urlFn: (link: string) =>
        `mailto:?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(`${shareMessage}\n\nHere's my link: ${link}`)}`,
    },
  ]
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

const easeOut = [0.22, 1, 0.36, 1] as const


export function ReferralContent() {
  const t = useTranslations("referralPage")
  const router = useRouter()
  const { user, isLoading } = useUser()
  const { chats } = useChats()
  const [isCopied, setIsCopied] = useState(false)
  const [stats, setStats] = useState<ReferralStats | null>(null)
  const [isLoadingStats, setIsLoadingStats] = useState(true)
  const [activeTab, setActiveTab] = useState<"share" | "feedback">("share")

  // Feedback state
  const [feedbackText, setFeedbackText] = useState("")
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false)
  const [feedbackSent, setFeedbackSent] = useState(false)

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "https://coasty.ai"
  const referralLink = user ? `${baseUrl}/?ref=${user.id}` : ""

  const socials = buildSocials(t("shareMessage"), t("emailSubject"), t("emailBody"))

  // Get recent chats for the activity showcase
  const recentChats = chats
    .filter((c) => c.title && c.title !== "New Chat")
    .slice(0, 5)

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

  if (isLoading) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <CircleNotch size={20} className="animate-spin text-foreground/20" />
      </div>
    )
  }

  if (!user) return null

  return (
    <div className="relative w-full h-full overflow-hidden">
      {/* Ambient background */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute -top-[40%] -left-[20%] h-[80%] w-[60%] rounded-full opacity-[0.02] dark:opacity-[0.05] blur-[100px]"
          style={{ background: "radial-gradient(circle, currentColor, transparent 70%)" }}
        />
        <div
          className="absolute -bottom-[30%] -right-[10%] h-[70%] w-[50%] rounded-full opacity-[0.02] dark:opacity-[0.04] blur-[100px]"
          style={{ background: "radial-gradient(circle, currentColor, transparent 70%)" }}
        />
        <div
          className="absolute inset-0 opacity-[0.012] dark:opacity-[0.025]"
          style={{
            backgroundImage: `linear-gradient(rgba(128,128,128,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(128,128,128,0.3) 1px, transparent 1px)`,
            backgroundSize: "80px 80px",
          }}
        />
      </div>

      <div className="relative flex flex-col lg:flex-row h-full">
        {/* Left brand panel — lg+ */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6, ease: easeOut }}
          className="hidden lg:flex flex-col justify-center flex-1 px-12 xl:px-16 max-w-[540px] overflow-y-auto py-12"
        >
          <h1 className="text-4xl xl:text-[2.75rem] font-medium tracking-tight leading-[1.1] text-foreground">
            {t("shareTitle")}
            <br />
            <span className="text-muted-foreground">{t("earnTitle")}</span>
          </h1>

          <p className="text-muted-foreground mt-5 text-[15px] leading-relaxed max-w-sm">
            {t("shareDescription")}
          </p>

          <div className="mt-12 flex flex-col gap-4 text-sm text-muted-foreground/70">
            {(t.raw("features") as string[]).map((feature, i) => (
              <motion.div
                key={feature}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.4, delay: 0.4 + i * 0.1, ease: easeOut }}
                className="flex items-center gap-3"
              >
                <div className="h-px w-5 bg-border" />
                <span>{feature}</span>
              </motion.div>
            ))}
          </div>

          {/* Recent activity — user's chats */}
          {recentChats.length > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.7, ease: easeOut }}
              className="mt-10"
            >
              <p className="text-[11px] font-semibold tracking-[0.1em] uppercase text-muted-foreground/40 mb-3">
                {t("recentActivity")}
              </p>
              <div className="space-y-1.5">
                {recentChats.map((chat, i) => (
                  <motion.div
                    key={chat.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.3, delay: 0.8 + i * 0.06, ease: easeOut }}
                    className="flex items-center gap-2.5 py-1.5 group"
                  >
                    <ChatCircleDots size={13} weight="duotone" className="text-muted-foreground/30 shrink-0" />
                    <p className="text-[13px] text-muted-foreground/50 truncate group-hover:text-muted-foreground/70 transition-colors">
                      {chat.title}
                    </p>
                  </motion.div>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground/30 mt-3">
                {t("friendsCould")}
              </p>
            </motion.div>
          )}
        </motion.div>

        {/* Right action panel */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-lg mx-auto px-4 sm:px-6 lg:px-10 py-8 sm:py-10 lg:py-12">
            {/* Mobile header */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: easeOut }}
              className="lg:hidden mb-8"
            >
              <div className="flex justify-center mb-4">
                <CoastyIcon className="size-8" />
              </div>
              <h1 className="text-3xl sm:text-4xl font-medium tracking-tight text-center">
                {t("shareTitle")}{" "}
                <span className="text-muted-foreground">{t("earnTitle")}</span>
              </h1>
              <p className="text-muted-foreground mt-3 text-sm sm:text-base text-center">
                {t("giveGet")}
              </p>
            </motion.div>

            {/* Stats row */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.05, ease: easeOut }}
              className="grid grid-cols-3 gap-3 mb-8"
            >
              {[
                { icon: Users, value: stats?.totalReferrals ?? 0, label: t("stats.invited") },
                { icon: Coins, value: stats?.totalEarned ?? 0, label: t("stats.earned") },
                { icon: Gift, value: 50, label: t("stats.perInvite") },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-xl border border-border/30 bg-card/50 backdrop-blur-sm p-4 text-center"
                >
                  <stat.icon size={15} weight="duotone" className="mx-auto mb-2 text-muted-foreground/40" />
                  <p className="text-2xl font-bold tracking-tight">{stat.value.toLocaleString()}</p>
                  <p className="text-[11px] text-muted-foreground/50 mt-0.5">{stat.label}</p>
                </div>
              ))}
            </motion.div>

            {/* Tabs */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.09, ease: easeOut }}
              className="flex gap-1 p-1 rounded-xl bg-muted/40 mb-6"
            >
              {[
                { id: "share" as const, label: t("tabs.invite"), icon: Gift },
                { id: "feedback" as const, label: t("tabs.feedback"), icon: PaperPlaneTilt },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
                    activeTab === tab.id
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground/60 hover:text-muted-foreground"
                  )}
                >
                  <tab.icon size={15} weight={activeTab === tab.id ? "duotone" : "regular"} />
                  {tab.label}
                </button>
              ))}
            </motion.div>

            <AnimatePresence mode="wait">
              {activeTab === "share" ? (
                <motion.div
                  key="share"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.25, ease: easeOut }}
                >
                  {/* Referral link */}
                  <div className="mb-6">
                    <p className="text-[11px] font-semibold text-muted-foreground/50 tracking-widest uppercase mb-2">
                      {t("referralLink")}
                    </p>
                    <button
                      onClick={handleCopy}
                      className={cn(
                        "group flex w-full items-center justify-between rounded-xl border px-4 py-3.5 transition-all duration-150",
                        "active:scale-[0.99]",
                        isCopied
                          ? "border-foreground/15 bg-foreground/[0.04]"
                          : "border-border/30 bg-card/50 backdrop-blur-sm hover:border-border/50"
                      )}
                    >
                      <span className="text-sm font-mono text-foreground/60 truncate mr-3">
                        {referralLink}
                      </span>
                      <div
                        className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors",
                          isCopied ? "bg-foreground/10" : "bg-muted/60"
                        )}
                      >
                        {isCopied ? (
                          <Check size={14} weight="bold" className="text-foreground" />
                        ) : (
                          <Copy size={14} className="text-muted-foreground" />
                        )}
                      </div>
                    </button>
                  </div>

                  {/* What they get */}
                  <div className="mb-6 rounded-xl border border-border/30 bg-card/50 backdrop-blur-sm p-4">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10 ring-1 ring-emerald-500/20">
                        <Gift size={13} weight="duotone" className="text-emerald-500" />
                      </div>
                      <p className="text-sm font-medium">{t("howItWorks")}</p>
                    </div>
                    <div className="space-y-2.5">
                      {(t.raw("howSteps") as string[]).map((text, i) => ({ step: String(i + 1), text })).map((item) => (
                        <div key={item.step} className="flex items-center gap-3">
                          <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-foreground/[0.06] text-[10px] font-bold text-muted-foreground/60">
                            {item.step}
                          </div>
                          <p className="text-[13px] text-muted-foreground/70">{item.text}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Social share */}
                  <div className="mb-6">
                    <p className="text-[11px] font-semibold text-muted-foreground/50 tracking-widest uppercase mb-2">
                      {t("shareDirectly")}
                    </p>
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                      {socials.map((s) => {
                        const Icon = s.icon
                        return (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => handleShare(s.urlFn)}
                            className={cn(
                              "flex flex-col items-center gap-1.5 rounded-xl border border-border/30 bg-card/50 backdrop-blur-sm px-3 py-3 transition-all duration-200",
                              "text-muted-foreground",
                              s.color
                            )}
                          >
                            <Icon size={18} weight="bold" />
                            <span className="text-[10px] font-medium">{s.label}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* Referral history */}
                  <div>
                    <p className="text-[11px] font-semibold text-muted-foreground/50 tracking-widest uppercase mb-2">
                      {t("yourReferrals")}
                    </p>
                    <div className="rounded-xl border border-border/30 bg-card/50 backdrop-blur-sm overflow-hidden">
                      {isLoadingStats ? (
                        <div className="flex items-center justify-center py-10">
                          <CircleNotch size={18} className="animate-spin text-foreground/20" />
                        </div>
                      ) : stats && (stats.totalReferrals > 0 || stats.referredBy) ? (
                        <div className="divide-y divide-border/20">
                          {stats.referredBy && (
                            <div className="flex items-center justify-between px-4 py-3">
                              <div className="min-w-0">
                                <p className="text-sm font-medium truncate">{maskEmail(stats.referredBy.email)}</p>
                                <p className="text-[11px] text-muted-foreground/50">{t("invitedYou")}</p>
                              </div>
                              <div className="text-right shrink-0 ml-3">
                                <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                                  +{stats.referredBy.credits.toLocaleString()}
                                </p>
                                <p className="text-[11px] text-muted-foreground/50">{timeAgo(stats.referredBy.date)}</p>
                              </div>
                            </div>
                          )}
                          {stats.referrals.map((r) => (
                            <div key={r.id} className="flex items-center justify-between px-4 py-3">
                              <div className="min-w-0">
                                <p className="text-sm font-medium truncate">{maskEmail(r.email)}</p>
                                <p className="text-[11px] text-muted-foreground/50">{t("joinedViaLink")}</p>
                              </div>
                              <div className="text-right shrink-0 ml-3">
                                <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                                  +{r.credits.toLocaleString()}
                                </p>
                                <p className="text-[11px] text-muted-foreground/50">{timeAgo(r.date)}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center py-10 text-center">
                          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted/60 ring-1 ring-border/30 mb-3">
                            <Users size={18} className="text-muted-foreground/40" />
                          </div>
                          <p className="text-sm text-muted-foreground/60">{t("noReferrals")}</p>
                          <p className="text-[11px] text-muted-foreground/40 mt-1">
                            {t("noReferralsHint")}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Mobile recent chats */}
                  {recentChats.length > 0 && (
                    <div className="lg:hidden mt-6">
                      <p className="text-[11px] font-semibold text-muted-foreground/50 tracking-widest uppercase mb-2">
                        {t("recentActivity")}
                      </p>
                      <div className="rounded-xl border border-border/30 bg-card/50 backdrop-blur-sm p-3">
                        <div className="space-y-1">
                          {recentChats.slice(0, 3).map((chat) => (
                            <div key={chat.id} className="flex items-center gap-2.5 py-1.5">
                              <ChatCircleDots size={13} weight="duotone" className="text-muted-foreground/30 shrink-0" />
                              <p className="text-[13px] text-muted-foreground/50 truncate">{chat.title}</p>
                            </div>
                          ))}
                        </div>
                        <p className="text-[11px] text-muted-foreground/30 mt-2 pt-2 border-t border-border/20">
                          {t("friendsCould")}
                        </p>
                      </div>
                    </div>
                  )}
                </motion.div>
              ) : (
                <motion.div
                  key="feedback"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.25, ease: easeOut }}
                >
                  {feedbackSent ? (
                    <div className="rounded-xl border border-border/30 bg-card/50 backdrop-blur-sm p-8 text-center">
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10 ring-1 ring-emerald-500/20 mx-auto mb-4">
                        <Check size={20} weight="bold" className="text-emerald-500" />
                      </div>
                      <p className="text-lg font-medium mb-1">{t("feedbackThanks")}</p>
                      <p className="text-sm text-muted-foreground/50 mb-6">{t("feedbackWeRead")}</p>
                      <button
                        onClick={() => setFeedbackSent(false)}
                        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {t("sendAnother")}
                        <ArrowRight size={14} />
                      </button>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-border/30 bg-card/50 backdrop-blur-sm p-5">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted/60 ring-1 ring-border/30">
                          <PaperPlaneTilt size={15} weight="duotone" className="text-foreground/60" />
                        </div>
                        <div>
                          <p className="text-sm font-medium">{t("feedbackTitle")}</p>
                          <p className="text-[12px] text-muted-foreground/50">
                            {t("feedbackSubtitle")}
                          </p>
                        </div>
                      </div>

                      <Textarea
                        placeholder={t("feedbackPlaceholder")}
                        value={feedbackText}
                        onChange={(e) => setFeedbackText(e.target.value)}
                        rows={5}
                        className={cn(
                          "resize-none text-sm leading-relaxed rounded-lg mb-3",
                          "bg-muted/40 text-foreground",
                          "border-border/30 hover:border-border/50 focus-visible:border-border",
                          "placeholder:text-muted-foreground/40",
                          "transition-all duration-200",
                        )}
                      />
                      <div className="flex items-center justify-between">
                        <p className="text-[11px] text-muted-foreground/40">
                          {t("weReadEvery")}
                        </p>
                        <button
                          onClick={handleFeedback}
                          disabled={!feedbackText.trim() || feedbackSubmitting}
                          className={cn(
                            "h-9 px-5 rounded-lg text-sm font-semibold transition-all duration-200",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            "disabled:opacity-40 disabled:cursor-not-allowed",
                            feedbackText.trim() && !feedbackSubmitting
                              ? "text-background bg-foreground hover:bg-foreground/90"
                              : "text-muted-foreground bg-muted/60"
                          )}
                        >
                          {feedbackSubmitting ? (
                            <CircleNotch size={14} className="animate-spin" />
                          ) : (
                            t("send")
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  )
}
