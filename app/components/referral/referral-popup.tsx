"use client"

import { useState, useEffect, useCallback } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useUser } from "@/lib/user-store/provider"
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
} from "@phosphor-icons/react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { CoastyIcon } from "@/components/icons/coasty"

interface ReferralPopupProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

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

const socialConfig = [
  {
    id: "twitter",
    labelKey: "socialLabels.x" as const,
    icon: TwitterLogo,
    hover: "hover:bg-[#1DA1F2] hover:text-white hover:border-[#1DA1F2]",
    urlFn: (link: string, shareMessage: string) =>
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(
        `${shareMessage} 🤖`
      )}&url=${encodeURIComponent(link)}`,
  },
  {
    id: "linkedin",
    labelKey: "socialLabels.linkedin" as const,
    icon: LinkedinLogo,
    hover: "hover:bg-[#0A66C2] hover:text-white hover:border-[#0A66C2]",
    urlFn: (link: string, _shareMessage: string) =>
      `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(
        link
      )}`,
  },
  {
    id: "whatsapp",
    labelKey: "socialLabels.whatsapp" as const,
    icon: WhatsappLogo,
    hover: "hover:bg-[#25D366] hover:text-white hover:border-[#25D366]",
    urlFn: (link: string, shareMessage: string) =>
      `https://wa.me/?text=${encodeURIComponent(
        `${shareMessage}\n\n${link}`
      )}`,
  },
  {
    id: "telegram",
    labelKey: "socialLabels.telegram" as const,
    icon: TelegramLogo,
    hover: "hover:bg-[#26A5E4] hover:text-white hover:border-[#26A5E4]",
    urlFn: (link: string, shareMessage: string) =>
      `https://t.me/share/url?url=${encodeURIComponent(
        link
      )}&text=${encodeURIComponent(shareMessage)}`,
  },
  {
    id: "reddit",
    labelKey: "socialLabels.reddit" as const,
    icon: RedditLogo,
    hover: "hover:bg-[#FF4500] hover:text-white hover:border-[#FF4500]",
    urlFn: (link: string, _shareMessage: string) =>
      `https://reddit.com/submit?url=${encodeURIComponent(
        link
      )}&title=${encodeURIComponent(
        "This AI can actually use a computer for you. Browsing, clicking, typing, all of it."
      )}`,
  },
  {
    id: "email",
    labelKey: "socialLabels.email" as const,
    icon: EnvelopeSimple,
    hover: "hover:bg-foreground hover:text-background hover:border-foreground",
    urlFn: (link: string, shareMessage: string, emailSubject: string) =>
      `mailto:?subject=${encodeURIComponent(
        emailSubject
      )}&body=${encodeURIComponent(
        `${shareMessage}\n\nHere's my link: ${link}`
      )}`,
  },
]

function maskEmail(email: string) {
  if (!email || !email.includes("@")) return email
  const [local, domain] = email.split("@")
  if (local.length <= 2) return `${local[0]}*@${domain}`
  return `${local[0]}${local[1]}${"*".repeat(Math.min(local.length - 2, 4))}@${domain}`
}

function timeAgo(dateStr: string, t: (key: string, values?: Record<string, number>) => string) {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diff = now - then
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return t("timeAgo.justNow")
  if (minutes < 60) return t("timeAgo.minutesAgo", { minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t("timeAgo.hoursAgo", { hours })
  const days = Math.floor(hours / 24)
  if (days < 30) return t("timeAgo.daysAgo", { days })
  return t("timeAgo.monthsAgo", { months: Math.floor(days / 30) })
}

export function ReferralPopup({ open, onOpenChange }: ReferralPopupProps) {
  const t = useTranslations("referralPopup")
  const { user } = useUser()
  const [isCopied, setIsCopied] = useState(false)
  const [stats, setStats] = useState<ReferralStats | null>(null)
  const [isLoadingStats, setIsLoadingStats] = useState(false)

  const baseUrl =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://coasty.ai"
  const referralLink = user ? `${baseUrl}/?ref=${user.id}` : ""
  const displayLink = user
    ? `coasty.ai/?ref=${user.id.slice(0, 8)}...`
    : ""

  const fetchStats = useCallback(async () => {
    setIsLoadingStats(true)
    try {
      const res = await fetch("/api/referral/stats")
      if (res.ok) {
        setStats(await res.json())
      }
    } catch {
      // Silently fail
    } finally {
      setIsLoadingStats(false)
    }
  }, [])

  useEffect(() => {
    if (open && user) {
      fetchStats()
    }
  }, [open, user, fetchStats])

  if (!user) return null

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
    toast.success(t("linkCopied"))
    setTimeout(() => setIsCopied(false), 2500)
  }

  const shareMessage = t("shareMessage")
  const emailSubject = t("emailSubject")

  const handleShare = (urlFn: (link: string, shareMessage: string, emailSubject: string) => string) => {
    window.open(urlFn(referralLink, shareMessage, emailSubject), "_blank", "width=600,height=500")
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Outer wrapper with animated rainbow border beam */}
      <DialogContent
        className="max-w-[calc(100%-2rem)] sm:max-w-[420px] p-0 gap-0 overflow-visible border-0 bg-transparent shadow-none"
        hasCloseButton={false}
      >
        <div className="relative rounded-lg">
          {/* Animated border beam */}
          <div
            className="absolute -inset-[1px] rounded-lg animate-rainbow opacity-60"
            style={{
              background:
                "linear-gradient(90deg, var(--color-1), var(--color-2), var(--color-3), var(--color-4), var(--color-5), var(--color-1))",
              backgroundSize: "200% 100%",
              ["--speed" as string]: "3s",
            }}
          />
          {/* Glow behind the border */}
          <div
            className="absolute -inset-[2px] rounded-lg animate-rainbow opacity-20 blur-md"
            style={{
              background:
                "linear-gradient(90deg, var(--color-1), var(--color-2), var(--color-3), var(--color-4), var(--color-5), var(--color-1))",
              backgroundSize: "200% 100%",
              ["--speed" as string]: "3s",
            }}
          />

          {/* Inner content */}
          <div className="relative rounded-lg bg-popover overflow-hidden">
            {/* Close button */}
            <button
              onClick={() => onOpenChange(false)}
              className="absolute top-4 right-4 z-10 rounded-xs opacity-70 transition-opacity hover:opacity-100 ring-offset-background focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 256 256"
                fill="currentColor"
              >
                <path d="M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z" />
              </svg>
              <span className="sr-only">Close</span>
            </button>

            {/* Animated header area */}
            <div className="relative overflow-hidden px-5 pt-6 pb-4">
              {/* Floating orbs */}
              <div className="pointer-events-none absolute inset-0 overflow-hidden">
                <div className="absolute -top-10 -left-10 h-36 w-36 rounded-full bg-foreground/[0.03] blur-2xl animate-[pulse_4s_ease-in-out_infinite]" />
                <div className="absolute -bottom-8 -right-8 h-32 w-32 rounded-full bg-foreground/[0.04] blur-2xl animate-[pulse_5s_ease-in-out_1s_infinite]" />
                <div className="absolute top-2 right-16 h-20 w-20 rounded-full bg-foreground/[0.02] blur-xl animate-[pulse_6s_ease-in-out_2s_infinite]" />
              </div>

              <DialogHeader className="relative">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted mb-3">
                  <CoastyIcon className="h-6 w-6" />
                </div>
                <DialogTitle className="text-lg font-semibold">
                  {t("headline")}
                </DialogTitle>
                <p className="text-[13px] text-muted-foreground mt-1.5 leading-relaxed">
                  {t("subheadline", { credits: "50" })}
                </p>
              </DialogHeader>
            </div>

            <div className="px-5 pb-5 space-y-4">
              {/* Copy link */}
              <div>
                <p className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-widest mb-1.5">
                  {t("yourLink")}
                </p>
                <button
                  onClick={handleCopy}
                  className={cn(
                    "group flex w-full items-center justify-between rounded-lg border px-3 py-2.5 transition-all duration-150",
                    "active:scale-[0.98]",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    isCopied
                      ? "border-foreground/15 bg-accent/40"
                      : "border-border hover:border-foreground/15 hover:bg-accent/30"
                  )}
                >
                  <span className="text-sm font-mono text-foreground/70 truncate mr-3">
                    {displayLink}
                  </span>
                  <div
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors",
                      isCopied ? "bg-foreground/10" : "bg-muted"
                    )}
                  >
                    {isCopied ? (
                      <Check
                        size={13}
                        weight="bold"
                        className="text-foreground"
                      />
                    ) : (
                      <Copy size={13} className="text-muted-foreground" />
                    )}
                  </div>
                </button>
              </div>

              {/* Social share grid */}
              <div>
                <p className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-widest mb-2">
                  {t("shareDirectly")}
                </p>
                <div className="grid grid-cols-3 gap-1.5">
                  {socialConfig.map((s) => {
                    const Icon = s.icon
                    return (
                      <Button
                        key={s.id}
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleShare(s.urlFn)}
                        className={cn(
                          "h-9 text-xs font-medium transition-all duration-150",
                          s.hover
                        )}
                      >
                        <Icon size={15} weight="bold" className="mr-1.5" />
                        {t(s.labelKey)}
                      </Button>
                    )
                  })}
                </div>
              </div>

              {/* Stats + Referral list */}
              <div>
                <p className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-widest mb-2">
                  {t("yourReferrals")}
                </p>

                {/* Summary bar */}
                <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2.5 mb-2">
                  <div className="text-[11px] text-muted-foreground">
                    {t("referralCount", { count: String(stats?.totalReferrals ?? 0) })}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {t("creditsEarned", { credits: (stats?.totalEarned ?? 0).toLocaleString() })}
                  </div>
                </div>

                {isLoadingStats ? (
                  <div className="flex items-center justify-center py-4">
                    <CircleNotch
                      size={16}
                      className="animate-spin text-muted-foreground"
                    />
                  </div>
                ) : stats &&
                  (stats.totalReferrals > 0 || stats.referredBy) ? (
                  <div className="max-h-[140px] overflow-y-auto space-y-0.5 scrollbar-thin">
                    {stats.referredBy && (
                      <div className="flex items-center justify-between rounded-md px-2.5 py-2 bg-muted/20">
                        <div className="min-w-0">
                          <p className="text-xs font-medium truncate">
                            {maskEmail(stats.referredBy.email)}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            {t("invitedYou")}
                          </p>
                        </div>
                        <div className="text-right shrink-0 ml-3">
                          <p className="text-xs font-medium">
                            +{stats.referredBy.credits.toLocaleString()} credits
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            {timeAgo(stats.referredBy.date, t)}
                          </p>
                        </div>
                      </div>
                    )}
                    {stats.referrals.map((r) => (
                      <div
                        key={r.id}
                        className="flex items-center justify-between rounded-md px-2.5 py-2 hover:bg-muted/20 transition-colors"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-medium truncate">
                            {maskEmail(r.email)}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            {t("joinedViaLink")}
                          </p>
                        </div>
                        <div className="text-right shrink-0 ml-3">
                          <p className="text-xs font-medium">
                            +{r.credits.toLocaleString()} credits
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            {timeAgo(r.date, t)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-4 text-center">
                    <p className="text-xs text-muted-foreground">
                      {t("noInvites")}
                    </p>
                    <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                      {t("noInvitesHint")}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
