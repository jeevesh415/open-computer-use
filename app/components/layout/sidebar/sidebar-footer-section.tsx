"use client"

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { useBreakpoint } from "@/app/hooks/use-breakpoint"
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer"
import {
  IconArrowUp,
  IconBook2,
  IconCheck,
  IconCompass,
  IconCreditCard,
  IconGift,
  IconInfinity,
  IconLoader2,
  IconLogout,
  IconMessage2,
  IconSettings,
  IconVideo,
  IconX,
} from "@tabler/icons-react"
import Link from "next/link"
import Image from "next/image"
import { cn } from "@/lib/utils"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
} from "@/components/ui/hover-card"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useCredits } from "@/lib/hooks/use-credits"
import { useSubscription } from "@/lib/hooks/use-subscription"
import { useUser } from "@/lib/user-store/provider"
import { createClient } from "@/lib/supabase/client"
import { AnimatedThemeToggler } from "@/components/magicui/animated-theme-toggler"
import { WindowsIcon, AppleIcon } from "@/components/icons/platform-icons"
import { useAccountDialog } from "@/lib/account-dialog-store"

// ─── Credit health model ──────────────────────────────────────────
type CreditHealth = "healthy" | "low" | "depleted"

function getHealth(balance: number, totalPurchased: number): CreditHealth {
  if (balance <= 0) return "depleted"
  if (balance < 50) return "low"
  if (totalPurchased > 0 && balance / totalPurchased < 0.15) return "low"
  return "healthy"
}

const HEALTH = {
  healthy: {
    dot: "bg-foreground/30",
    text: "text-foreground",
  },
  low: {
    dot: "bg-amber-500 dark:bg-amber-400",
    text: "text-amber-600 dark:text-amber-400",
  },
  depleted: {
    dot: "bg-rose-500 dark:bg-rose-400",
    text: "text-rose-600 dark:text-rose-400",
  },
} as const

// ─── Feedback compose card ────────────────────────────────────────
//   The active compose surface — eyebrow, autoresizing textarea,
//   keyboard hint, send button, sending/sent/error states. Doesn't
//   own its own visibility; the caller mounts/unmounts it. Submits
//   directly to the Supabase `feedback` table under the row-level
//   policy "Users can create feedback".
//
//   Status: idle → sending → sent (auto-dismiss 1.4s) | error.
//   `onActiveChange(false)` fires once status reaches "sent" so a
//   parent popover can unpin and prepare to close gracefully.
//
//   Mobile: textarea is 16px on small screens to defeat the iOS
//   focus-zoom, 12.5px on sm+. Keyboard hint hidden under sm.
function FeedbackComposeCard({
  userId,
  onCancel,
  onSent,
  onActiveChange,
}: {
  userId: string
  onCancel: () => void
  onSent: () => void
  onActiveChange?: (active: boolean) => void
}) {
  const [text, setText] = useState("")
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle")
  const taRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    onActiveChange?.(status !== "sent")
  }, [status, onActiveChange])

  // Autofocus + auto-resize (max ~160px → ~6 lines, then scrolls).
  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.focus()
    ta.style.height = "auto"
    ta.style.height = Math.min(160, ta.scrollHeight) + "px"
  }, [text])

  const submit = useCallback(async () => {
    const trimmed = text.trim()
    if (!trimmed || status === "sending") return
    setStatus("sending")
    try {
      const supabase = await createClient()
      if (!supabase) throw new Error("Supabase unavailable")
      const { error } = await supabase
        .from("feedback")
        .insert({ user_id: userId, message: trimmed })
      if (error) throw error
      setStatus("sent")
      setTimeout(() => {
        setText("")
        setStatus("idle")
        onSent()
      }, 1400)
    } catch {
      setStatus("error")
    }
  }, [text, status, userId, onSent])

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg",
        "bg-foreground/[0.025] dark:bg-white/[0.02]",
        "ring-1 ring-foreground/[0.06] dark:ring-white/[0.05]",
        "animate-in fade-in-0 slide-in-from-top-1 duration-200"
      )}
    >
      <div className="flex items-center justify-between px-2.5 pt-2 pb-1">
        <span className="inline-flex items-center gap-1.5">
          <IconMessage2 size={11} stroke={1.75} className="text-foreground/45" />
          <span className="text-[10px] font-semibold tracking-[0.08em] uppercase text-foreground/45">
            Feedback
          </span>
        </span>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel"
          className="h-5 w-5 flex items-center justify-center rounded text-foreground/40 hover:text-foreground hover:bg-foreground/[0.05] transition-colors"
        >
          <IconX size={11} stroke={1.75} />
        </button>
      </div>

      {status === "sent" ? (
        <div className="flex items-center gap-2 px-3 pt-1 pb-3 animate-in fade-in-0 duration-200">
          <span className="h-5 w-5 rounded-full bg-emerald-500/15 dark:bg-emerald-400/15 flex items-center justify-center shrink-0">
            <IconCheck size={11} stroke={2.5} className="text-emerald-600 dark:text-emerald-400" />
          </span>
          <span className="text-[12px] font-medium text-foreground/80">
            Got it. Thank you.
          </span>
        </div>
      ) : (
        <>
          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault()
                e.stopPropagation()
                onCancel()
              } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                submit()
              }
            }}
            placeholder="What's on your mind?"
            rows={3}
            disabled={status === "sending"}
            className={cn(
              "block w-full resize-none border-0 bg-transparent px-2.5 pt-0 pb-1.5",
              "text-base leading-snug text-foreground placeholder:text-foreground/30 sm:text-[12.5px]",
              "outline-none focus:outline-none focus-visible:outline-none focus:ring-0",
              "max-h-[160px] overflow-y-auto",
              "disabled:opacity-60"
            )}
          />
          <div className="flex items-center justify-between gap-2 border-t border-foreground/[0.05] px-2 py-1.5 dark:border-white/[0.04]">
            {status === "error" ? (
              <span className="text-[10.5px] font-medium text-rose-500 dark:text-rose-400">
                Couldn&rsquo;t send. Try again.
              </span>
            ) : (
              <span className="hidden sm:inline-flex items-center gap-1 text-[10px] tracking-[0.02em] text-foreground/35">
                <kbd className="font-sans">⌘</kbd>
                <span>+</span>
                <kbd className="font-sans">↵</kbd>
                <span className="ml-0.5">to send</span>
              </span>
            )}
            <button
              type="button"
              onClick={submit}
              disabled={!text.trim() || status === "sending"}
              aria-label="Send feedback"
              className={cn(
                "ml-auto inline-flex items-center gap-1 h-7 px-2.5 rounded-md",
                "bg-foreground text-background text-[11.5px] font-semibold tracking-[-0.01em]",
                "shadow-[0_1px_2px_rgba(0,0,0,0.08),inset_0_1px_0_rgba(255,255,255,0.08)]",
                "transition-all duration-150",
                "disabled:opacity-30 disabled:cursor-not-allowed",
                "enabled:hover:opacity-90 enabled:active:scale-[0.97]"
              )}
            >
              {status === "sending" ? (
                <>
                  <IconLoader2 size={12} stroke={2} className="animate-spin" />
                  <span>Sending</span>
                </>
              ) : (
                <>
                  <span>Send</span>
                  <IconArrowUp size={11} stroke={2.25} />
                </>
              )}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Avatar-menu feedback wrapper ─────────────────────────────────
//   Trigger row sits above Account in the avatar popover. Click
//   expands inline into the compose card; while typing, the popover
//   is pinned open so a stray pointer-out can't lose the draft.
function FeedbackCompose({
  userId,
  onPinOpen = () => {},
  onClose = () => {},
}: {
  userId: string
  onPinOpen?: (pin: boolean) => void
  onClose?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(true)

  useEffect(() => {
    onPinOpen(open && active)
  }, [open, active, onPinOpen])

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-2.5 px-2 py-[7px] rounded-md text-left transition-colors duration-100 text-muted-foreground/75 hover:text-foreground hover:bg-foreground/[0.04] dark:hover:bg-white/[0.04]"
      >
        <IconMessage2 size={14} stroke={1.5} className="shrink-0" />
        <span className="text-[12px] font-medium flex-1 truncate">Send feedback</span>
      </button>
    )
  }

  return (
    <div className="mt-0.5 mb-1">
      <FeedbackComposeCard
        userId={userId}
        onActiveChange={setActive}
        onCancel={() => {
          setOpen(false)
          setActive(true)
        }}
        onSent={() => {
          setOpen(false)
          setActive(true)
          onClose()
        }}
      />
    </div>
  )
}

// ─── Avatar menu ──────────────────────────────────────────────────
//   Progressive disclosure: at-rest the footer shows just identity.
//   Everything else (feedback, account, billing, referral, talk-to-us,
//   sign out) lives one click away. The trigger uses Popover (not
//   HoverCard) so it works on touch and can stay pinned while the
//   feedback compose is open.
function AvatarMenu({
  user,
  onAction,
  onPinOpen,
  chrome = "popover",
}: {
  user: { id: string; display_name?: string | null; email?: string | null; profile_image?: string | null } | null | undefined
  onAction: () => void
  onPinOpen: (pin: boolean) => void
  /** "popover" (desktop, default): self-contained card with border,
   *  shadow, rounded corners, fixed 240px width.
   *  "drawer" (mobile bottom sheet): full-width content, no card chrome
   *  — the parent <DrawerContent> already provides the surface,
   *  drag-handle pill, and rounded top edges. */
  chrome?: "popover" | "drawer"
}) {
  const t = useTranslations("sidebar")
  const openDialog = useAccountDialog((s) => s.open)
  const { signOut } = useUser()
  const displayName = user?.display_name || user?.email?.split("@")[0] || t("user")

  type Item =
    | { kind: "button"; icon: typeof IconSettings; label: string; onClick: () => void }
    | { kind: "link"; icon: typeof IconSettings; label: string; href: string }
    | { kind: "external"; icon: typeof IconSettings; label: string; href: string }

  const items: Item[] = [
    { kind: "button", icon: IconSettings, label: t("account"), onClick: () => { openDialog("account"); onAction() } },
    { kind: "button", icon: IconCreditCard, label: t("credits.buy"), onClick: () => { openDialog("billing"); onAction() } },
    { kind: "link", icon: IconBook2, label: t("guide"), href: "/guide" },
    { kind: "link", icon: IconCompass, label: "Community", href: "/discover" },
    { kind: "link", icon: IconGift, label: t("inviteEarn"), href: "/referral" },
    { kind: "external", icon: IconVideo, label: t("talkToUs"), href: "https://cal.com/coasty/15min" },
  ]

  // Drawer rows are slightly taller for comfortable thumb tap targets;
  // popover rows stay compact since they're mouse-hit. Same
  // px/gap/colors otherwise so the menu reads identically across both.
  const rowClass = cn(
    "w-full flex items-center gap-2.5 px-2 rounded-md text-left transition-colors duration-100",
    "text-muted-foreground/75 hover:text-foreground hover:bg-foreground/[0.04] dark:hover:bg-white/[0.04]",
    chrome === "drawer" ? "py-2.5" : "py-[7px]",
  )

  // Outer chrome.
  //   popover: card (border + shadow + rounded + bg + fixed width).
  //   drawer:  bare; the <DrawerContent> provides the surface so this
  //            component can grow to the sheet's full width and skip the
  //            card decorations.
  const outerClass = cn(
    "overflow-hidden",
    chrome === "popover"
      ? "w-60 rounded-xl border border-border/60 bg-popover shadow-2xl dark:border-white/[0.06]"
      : "w-full",
  )

  // Header padding tightens slightly on drawer so the avatar + name +
  // email row doesn't read as a separate "card" on top of the sheet.
  const headerClass = cn(
    "flex items-center gap-3 border-b border-border/30 dark:border-white/[0.05]",
    chrome === "drawer" ? "px-3 pt-2 pb-3" : "px-3.5 pt-3.5 pb-3",
  )

  return (
    <div className={outerClass}>
      <div className={headerClass}>
        <Avatar className="h-9 w-9 ring-1 ring-border/40">
          <AvatarImage src={user?.profile_image || undefined} />
          <AvatarFallback className="bg-foreground/[0.06] text-foreground text-[11px] font-semibold">
            {displayName[0].toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-[12.5px] font-semibold text-foreground truncate leading-tight">
            {displayName}
          </span>
          {user?.email && (
            <span className="text-[10.5px] text-muted-foreground/70 truncate mt-0.5">
              {user.email}
            </span>
          )}
        </div>
      </div>

      <div className="p-1.5">
        {/* Inline feedback — sits directly above Account so it reads
            as "tell us, then settle the rest". */}
        {user?.id && (
          <FeedbackCompose
            userId={user.id}
            onPinOpen={onPinOpen}
            onClose={onAction}
          />
        )}

        {items.map((item, i) => {
          const Icon = item.icon
          const inner = (
            <>
              <Icon size={14} stroke={1.5} className="shrink-0" />
              <span className="text-[12px] font-medium flex-1 truncate">{item.label}</span>
            </>
          )
          if (item.kind === "link") {
            return (
              <Link key={i} href={item.href} onClick={onAction} className={rowClass}>
                {inner}
              </Link>
            )
          }
          if (item.kind === "external") {
            return (
              <a
                key={i}
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={onAction}
                className={rowClass}
              >
                {inner}
              </a>
            )
          }
          return (
            <button key={i} type="button" onClick={item.onClick} className={rowClass}>
              {inner}
            </button>
          )
        })}
      </div>

      <div className="p-1.5 border-t border-border/30 dark:border-white/[0.05]">
        <button
          type="button"
          onClick={() => {
            signOut()
            onAction()
          }}
          className="w-full flex items-center gap-2.5 px-2 py-[7px] rounded-md text-left transition-colors duration-100 text-muted-foreground/75 hover:text-rose-500 dark:hover:text-rose-400 hover:bg-rose-500/[0.06]"
        >
          <IconLogout size={14} stroke={1.5} className="shrink-0" />
          <span className="text-[12px] font-medium">Sign out</span>
        </button>
      </div>
    </div>
  )
}

// ─── Desktop app hover-card popup ─────────────────────────────────
function DesktopAppPopup({ onAction }: { onAction?: () => void }) {
  const t = useTranslations("sidebar")
  return (
    <Link
      href="/download"
      onClick={onAction}
      className="block w-72 rounded-xl overflow-hidden border border-border/60 bg-popover shadow-2xl dark:border-white/[0.06] group/popup"
    >
      <div className="relative h-[148px] overflow-hidden">
        <Image
          src="/demo-screenshot.png"
          alt="Coasty Desktop"
          width={576}
          height={296}
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-3.5">
          <p className="text-[12px] font-semibold text-white leading-tight">
            {t("desktopApp.controlRemotely")}
          </p>
          <p className="text-[10.5px] text-white/55 leading-snug mt-1">
            {t("desktopApp.controlDescription")}
          </p>
        </div>
      </div>
      <div className="px-3.5 py-2.5 flex items-center justify-between border-t border-border/30 dark:border-white/[0.05]">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
            <WindowsIcon width={9} height={9} className="opacity-70" />
            {t("desktopApp.windows")}
          </span>
          <span className="inline-flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
            <AppleIcon width={9} height={9} className="opacity-70" />
            {t("desktopApp.macos")}
          </span>
        </div>
        <span className="text-[10.5px] font-medium text-blue-500 dark:text-blue-400 group-hover/popup:underline">
          {t("desktopApp.download")}
        </span>
      </div>
    </Link>
  )
}

// ─── Feedback submit hook ────────────────────────────────────────
//   Owns the actual `text` + `status` state plus the supabase POST.
//   Lives in the parent of the panel body so the form survives a
//   responsive switch between the desktop modal and the mobile drawer
//   when the viewport crosses 640px (rotate, window resize).
function useFeedbackSubmit({
  userId,
  onSent,
}: {
  userId: string
  onSent: () => void
}) {
  const [text, setText] = useState("")
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle")

  const submit = useCallback(async () => {
    const trimmed = text.trim()
    if (!trimmed || status === "sending") return
    setStatus("sending")
    try {
      const supabase = await createClient()
      if (!supabase) throw new Error("Supabase unavailable")
      const { error } = await supabase
        .from("feedback")
        .insert({ user_id: userId, message: trimmed })
      if (error) throw error
      setStatus("sent")
      setTimeout(() => {
        setText("")
        setStatus("idle")
        onSent()
      }, 1400)
    } catch {
      setStatus("error")
    }
  }, [text, status, userId, onSent])

  return { text, setText, status, submit }
}

// ─── Feedback panel body (shared by modal + drawer) ──────────────
//   Title bar → big textarea → footer with keyboard hint and Send.
//   Layout is `flex flex-col h-full` so the textarea fills whatever
//   vertical space the wrapping surface gives it. Same body works
//   inside the desktop modal (resizable) and the mobile drawer (78vh).
function FeedbackPanelBody({
  text,
  setText,
  status,
  submit,
  onClose,
  chrome,
}: {
  text: string
  setText: (v: string) => void
  status: "idle" | "sending" | "sent" | "error"
  submit: () => void
  onClose: () => void
  /** "dialog" shows an X close button; "drawer" hides it (drag-down dismisses). */
  chrome: "dialog" | "drawer"
}) {
  const taRef = useRef<HTMLTextAreaElement>(null)

  // Autofocus on mount; refocus when status returns from sent → idle.
  useEffect(() => {
    if (status !== "sending" && status !== "sent") {
      taRef.current?.focus()
    }
  }, [status])

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Title bar ─────────────────────────────────────────────
          Typography-forward: a 14px semibold title with an 11px
          quiet subtitle stacked beneath. No icon chip — the popup
          itself is the affordance. The hairline is whisper-thin so
          the title and body read as one breathing surface. */}
      <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3.5 border-b border-border/30 dark:border-white/[0.04]">
        <div className="flex flex-col leading-tight min-w-0">
          <span className="text-[14px] font-semibold text-foreground tracking-[-0.015em]">
            Send feedback
          </span>
          <span className="hidden sm:block text-[11px] text-foreground/50 mt-1">
            Read by the team. Every word.
          </span>
        </div>
        {chrome === "dialog" && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 h-7 w-7 inline-flex shrink-0 items-center justify-center rounded-md text-foreground/45 hover:text-foreground hover:bg-foreground/[0.06] transition-colors"
          >
            <IconX size={14} stroke={1.75} />
          </button>
        )}
      </div>

      {/* ── Body ──────────────────────────────────────────────── */}
      {status === "sent" ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3.5 px-6 animate-in fade-in-0 duration-300">
          <span className="h-12 w-12 rounded-full bg-emerald-500/15 dark:bg-emerald-400/15 flex items-center justify-center">
            <IconCheck size={22} stroke={2} className="text-emerald-600 dark:text-emerald-400" />
          </span>
          <span className="text-[15px] font-semibold text-foreground/90 tracking-[-0.01em]">
            Thanks, we hear you.
          </span>
          <span className="text-[12px] text-foreground/55 text-center max-w-[280px] leading-relaxed">
            Every word lands with the team. We&rsquo;ll follow up if there&rsquo;s more to say.
          </span>
        </div>
      ) : (
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              submit()
            }
          }}
          placeholder="Tell us what you love, what's broken, or what you wish existed. We're listening."
          disabled={status === "sending"}
          className={cn(
            "flex-1 min-h-0 w-full resize-none border-0 bg-transparent",
            "px-5 py-4",
            // 16px on mobile defeats iOS focus-zoom; 13.5px on sm+
            // for a calmer reading rhythm. 1.6 leading lets multi-line
            // notes breathe.
            "text-base sm:text-[13.5px] leading-[1.6]",
            "text-foreground placeholder:text-foreground/30",
            "outline-none focus:outline-none focus-visible:outline-none focus:ring-0",
            "disabled:opacity-60"
          )}
        />
      )}

      {/* ── Footer ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 border-t border-border/30 dark:border-white/[0.04] px-3.5 py-3">
        <div className="text-[10.5px] tracking-[0.02em] text-foreground/50 min-h-[14px] pl-1.5">
          {status === "error" ? (
            <span className="font-medium text-rose-500 dark:text-rose-400">
              Couldn&rsquo;t send. Try again?
            </span>
          ) : status === "sending" ? (
            <span className="font-medium text-foreground/60">Sending&hellip;</span>
          ) : status === "sent" ? (
            <span className="font-medium text-emerald-600 dark:text-emerald-400">
              Sent
            </span>
          ) : (
            <span className="hidden sm:inline-flex items-center gap-1">
              <kbd className="font-sans">⌘</kbd>
              <span>+</span>
              <kbd className="font-sans">↵</kbd>
              <span className="ml-0.5">to send</span>
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={!text.trim() || status === "sending" || status === "sent"}
          aria-label="Send feedback"
          className={cn(
            "inline-flex items-center gap-1.5 h-8 px-3.5 rounded-md",
            "bg-foreground text-background text-[12px] font-semibold tracking-[-0.01em]",
            "shadow-[0_1px_2px_rgba(0,0,0,0.08),inset_0_1px_0_rgba(255,255,255,0.08)]",
            "transition-all duration-150",
            "disabled:opacity-30 disabled:cursor-not-allowed",
            "enabled:hover:opacity-90 enabled:active:scale-[0.97]"
          )}
        >
          {status === "sending" ? (
            <>
              <IconLoader2 size={13} stroke={2} className="animate-spin" />
              <span>Sending</span>
            </>
          ) : (
            <>
              <span>Send</span>
              <IconArrowUp size={12} stroke={2.25} />
            </>
          )}
        </button>
      </div>

      {/* ── "Talk to us" subtle CTA ─────────────────────────────
          The very last row, separated by its own whisper-thin
          hairline so it reads as an alternative channel, not part
          of the main send action. Hover is a pure text-color shift
          (no bg fill) — keeps the row visually quiet. Hides during
          sending/sent so it doesn't compete with the in-flight or
          success state. Opens cal.com in a new tab; the user's
          draft (if any) survives. */}
      {status !== "sending" && status !== "sent" && (
        <a
          href="https://cal.com/coasty/15min"
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "group/talk flex items-center justify-center gap-1.5 px-3.5 py-2.5",
            "border-t border-border/25 dark:border-white/[0.03]",
            "text-[11px] text-foreground/45 hover:text-foreground/85",
            "transition-colors"
          )}
        >
          <IconVideo
            size={11}
            stroke={1.75}
            className="shrink-0 text-foreground/30 group-hover/talk:text-foreground/65 transition-colors"
          />
          <span className="font-medium tracking-[-0.005em]">
            <span className="hidden sm:inline">
              Rather talk? Book 15 min with the team
            </span>
            <span className="sm:hidden">Book a 15-min call</span>
          </span>
        </a>
      )}
    </div>
  )
}

// ─── Resizable feedback modal (desktop sm+) ──────────────────────
//   Centered modal with a custom drag-to-resize handle in the bottom-
//   right corner. Position is anchored (not centered via translate)
//   so the cursor tracks the corner 1:1 during a resize. Width/height
//   are persisted to localStorage so power users keep their preferred
//   layout across sessions.
//
//   Window resize defensively clamps the modal to the new viewport.
//   Initial open recenters; reopens recenter too — simpler than
//   tracking a free-form moved position.
const FB_DIALOG_STORAGE_KEY = "coasty:feedback-dialog-size"
const FB_DIALOG_DEFAULT = { width: 480, height: 420 }
const FB_DIALOG_MIN = { width: 360, height: 300 }

function clampSize(s: { width: number; height: number }) {
  if (typeof window === "undefined") return s
  return {
    width: Math.max(FB_DIALOG_MIN.width, Math.min(window.innerWidth - 32, s.width)),
    height: Math.max(FB_DIALOG_MIN.height, Math.min(window.innerHeight - 32, s.height)),
  }
}

function loadDialogSize(): { width: number; height: number } {
  if (typeof window === "undefined") return FB_DIALOG_DEFAULT
  try {
    const raw = window.localStorage.getItem(FB_DIALOG_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (typeof parsed.width === "number" && typeof parsed.height === "number") {
        return clampSize(parsed)
      }
    }
  } catch {}
  return FB_DIALOG_DEFAULT
}

function ResizableFeedbackModal({
  open,
  onOpenChange,
  panel,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  panel: React.ReactNode
}) {
  const [size, setSize] = useState(FB_DIALOG_DEFAULT)
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 })
  const dragStartRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null)

  // Recompute size + centered position whenever the modal opens. We
  // re-read the persisted size so any cross-tab updates are picked up.
  useLayoutEffect(() => {
    if (!open) return
    const loaded = clampSize(loadDialogSize())
    setSize(loaded)
    setPos({
      left: Math.max(16, Math.round((window.innerWidth - loaded.width) / 2)),
      top: Math.max(16, Math.round((window.innerHeight - loaded.height) / 2)),
    })
  }, [open])

  // Defensive clamp on viewport resize so a shrunk window can't strand
  // the modal off-screen.
  useEffect(() => {
    if (!open) return
    const onResize = () => {
      setSize((s) => clampSize(s))
      setPos((p) => ({
        left: Math.max(16, Math.min(p.left, window.innerWidth - 64)),
        top: Math.max(16, Math.min(p.top, window.innerHeight - 64)),
      }))
    }
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [open])

  const onResizeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragStartRef.current = { x: e.clientX, y: e.clientY, w: size.width, h: size.height }
  }

  const onResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current) return
    const dx = e.clientX - dragStartRef.current.x
    const dy = e.clientY - dragStartRef.current.y
    setSize(
      clampSize({
        width: dragStartRef.current.w + dx,
        height: dragStartRef.current.h + dy,
      })
    )
  }

  const onResizeUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    dragStartRef.current = null
    try {
      window.localStorage.setItem(
        FB_DIALOG_STORAGE_KEY,
        JSON.stringify({ width: size.width, height: size.height })
      )
    } catch {}
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-[10000] bg-black/35 backdrop-blur-[6px]",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "duration-200"
          )}
        />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onCloseAutoFocus={(e) => e.preventDefault()}
          style={{
            left: pos.left,
            top: pos.top,
            width: size.width,
            height: size.height,
          }}
          className={cn(
            "fixed z-[10001] flex flex-col overflow-hidden rounded-2xl",
            "bg-popover text-popover-foreground",
            "border border-border/40 dark:border-white/[0.06]",
            // Layered shadow: a tight contact shadow + a long
            // ambient one. Softer than a single big drop, gives the
            // popup a real "lifted" feel without looking like a card.
            "shadow-[0_1px_2px_rgba(0,0,0,0.04),0_24px_60px_-16px_rgba(0,0,0,0.18)]",
            "dark:shadow-[0_1px_2px_rgba(0,0,0,0.4),0_24px_60px_-16px_rgba(0,0,0,0.6)]",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            "duration-200"
          )}
        >
          <DialogPrimitive.Title className="sr-only">
            Send feedback
          </DialogPrimitive.Title>
          {panel}
          {/* Resize handle — three diagonal hairlines in the bottom-right
              corner. Sits above the dialog body so pointer events on the
              corner go to the handle, not the textarea. */}
          <div
            onPointerDown={onResizeDown}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeUp}
            onPointerCancel={onResizeUp}
            role="separator"
            aria-label="Resize feedback dialog"
            className="absolute bottom-0 right-0 z-10 h-5 w-5 cursor-nwse-resize group/rh"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              className="absolute bottom-1 right-1 text-foreground/25 group-hover/rh:text-foreground/65 transition-colors"
              aria-hidden
            >
              <line x1="13" y1="3" x2="3" y2="13" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
              <line x1="13" y1="7" x2="7" y2="13" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
              <line x1="13" y1="11" x2="11" y2="13" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
            </svg>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

// ─── Mobile feedback drawer (< sm) ───────────────────────────────
//   Bottom sheet via vaul. Drag-down dismisses; the drag-handle pill
//   is provided by `DrawerContent`. Height is fixed at 78vh so the
//   keyboard has room to open without collapsing the textarea.
function MobileFeedbackDrawer({
  open,
  onOpenChange,
  panel,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  panel: React.ReactNode
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="h-[78vh] max-h-[88vh] flex flex-col focus:outline-none">
        <DrawerTitle className="sr-only">Send feedback</DrawerTitle>
        {/* The drawer's drag-handle pill (rendered by DrawerContent)
            sits above this body. We give the body flex-1 so the
            textarea fills the rest of the sheet. */}
        <div className="flex-1 min-h-0">{panel}</div>
      </DrawerContent>
    </Drawer>
  )
}

// ─── Responsive feedback dialog ──────────────────────────────────
//   One entry point for callers. Picks the right surface based on
//   viewport width. Form state (text, status) lives at this level so
//   it survives the responsive switch when the viewport crosses 640px.
function FeedbackDialog({
  open,
  onOpenChange,
  userId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  userId: string
}) {
  const isMobile = useBreakpoint(640)
  const close = useCallback(() => onOpenChange(false), [onOpenChange])
  const { text, setText, status, submit } = useFeedbackSubmit({
    userId,
    onSent: close,
  })

  const panel = (
    <FeedbackPanelBody
      text={text}
      setText={setText}
      status={status}
      submit={submit}
      onClose={close}
      chrome={isMobile ? "drawer" : "dialog"}
    />
  )

  return isMobile ? (
    <MobileFeedbackDrawer open={open} onOpenChange={onOpenChange} panel={panel} />
  ) : (
    <ResizableFeedbackModal open={open} onOpenChange={onOpenChange} panel={panel} />
  )
}

// ─── Footer outbound-actions duo ──────────────────────────────────
//   The footer's two outbound CTAs — "Run locally" and "Feedback" —
//   presented as a single segmented row of equal-width cells split
//   by an inset 1px hairline. Reads as one composed group rather
//   than two stacked sections, and saves a row of vertical space.
//
//   At rest there's no chrome — just two icon+label clusters with
//   an inset divider between, sitting under the same hairline that
//   used to separate the desktop link from credits. On hover, each
//   cell paints a soft rounded fill, like a TouchBar segment lighting
//   up. No chevrons, no eyebrows: the cell shape itself is the
//   affordance.
//
//   When the Feedback cell is tapped, a centered modal (desktop) or
//   bottom drawer (mobile) opens for compose — the segmented row
//   itself stays put. The user gets a roomy, focused surface to
//   write on instead of fighting for space inside the sidebar rail.
//
//   For unauthenticated users, the feedback half drops out and the
//   desktop cell fills the full width — keeping the row functional
//   without surfacing an auth-gated control.
function FooterDuoRow({
  userId,
  closeMobileIfNeeded,
}: {
  userId: string | undefined
  closeMobileIfNeeded: () => void
}) {
  const [feedbackOpen, setFeedbackOpen] = useState(false)

  const wrapper =
    "mt-3 pt-3 border-t border-border/30 dark:border-white/[0.05]"

  // Shared cell visuals: equal flex-1 cells, centered icon+label,
  // soft rounded hover fill. Same color scale as the rest of the
  // footer so both halves match the desktop-link's hover treatment.
  const cellClass = cn(
    "flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md",
    "text-foreground/45 hover:text-foreground/85 hover:bg-foreground/[0.035] dark:hover:bg-white/[0.03]",
    "transition-colors duration-150"
  )
  const iconClass = "shrink-0 text-foreground/35 transition-colors"
  const labelClass = "text-[11px] font-medium tracking-[-0.005em]"

  return (
    <>
      <div className={wrapper}>
        <div className="flex items-stretch">
          {/* ── Run locally ── */}
          <HoverCard openDelay={300} closeDelay={200}>
            <HoverCardTrigger asChild>
              <Link
                href="/download"
                onClick={closeMobileIfNeeded}
                className={cn(cellClass, "group/dl")}
              >
                <svg
                  width={13}
                  height={13}
                  viewBox="0 0 24 24"
                  fill="none"
                  className={cn(iconClass, "group-hover/dl:text-foreground/70")}
                >
                  <rect
                    x="2"
                    y="3"
                    width="20"
                    height="14"
                    rx="2.5"
                    stroke="currentColor"
                    strokeWidth="1.6"
                  />
                  <path
                    d="M8 21h8M12 17v4"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                  <path
                    d="M12 7.5v4.5m0 0l-2-2m2 2l2-2"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span className={labelClass}>Run locally</span>
              </Link>
            </HoverCardTrigger>
            <HoverCardContent
              side="right"
              align="end"
              sideOffset={12}
              className="w-auto p-0 border-0 bg-transparent shadow-none"
            >
              <DesktopAppPopup onAction={closeMobileIfNeeded} />
            </HoverCardContent>
          </HoverCard>

          {userId && (
            <>
              {/* Inset divider — `my-1.5` keeps endpoints clear of the
                  surrounding hairlines so the row reads as composed. */}
              <div
                aria-hidden
                className="w-px bg-foreground/[0.08] dark:bg-white/[0.06] my-1.5"
              />

              {/* ── Feedback ── */}
              <button
                type="button"
                onClick={() => setFeedbackOpen(true)}
                aria-label="Share feedback"
                className={cn(cellClass, "group/fb")}
              >
                <svg
                  width={13}
                  height={13}
                  viewBox="0 0 24 24"
                  fill="none"
                  className={cn(iconClass, "group-hover/fb:text-foreground/70")}
                >
                  <path
                    d="M5 5h14a2 2 0 012 2v8a2 2 0 01-2 2h-7l-4 3v-3H5a2 2 0 01-2-2V7a2 2 0 012-2z"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinejoin="round"
                  />
                  <circle cx="9" cy="11" r="0.9" fill="currentColor" />
                  <circle cx="12" cy="11" r="0.9" fill="currentColor" />
                  <circle cx="15" cy="11" r="0.9" fill="currentColor" />
                </svg>
                <span className={labelClass}>Feedback</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Feedback popup — desktop modal / mobile drawer. Portal'd, so
          it's free to overflow the sidebar's narrow rail. */}
      {userId && (
        <FeedbackDialog
          open={feedbackOpen}
          onOpenChange={setFeedbackOpen}
          userId={userId}
        />
      )}
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════
//  SidebarFooterSection
//  ─────────────────────
//  Three hairline-separated rows. No cards. No decorative backgrounds.
//  A single 2px vertical bar on the left edge represents credit health
//  as ambient art. Everything secondary lives in the avatar hover menu.
// ═══════════════════════════════════════════════════════════════════
export const SidebarFooterSection = memo(function SidebarFooterSection({
  user,
  expanded,
  isMobile,
  closeMobileIfNeeded,
}: {
  user: { id: string; display_name?: string | null; email?: string | null; profile_image?: string | null } | null | undefined
  expanded: boolean
  isMobile: boolean
  closeMobileIfNeeded: () => void
}) {
  const t = useTranslations("sidebar")
  const openAccountDialog = useAccountDialog((s) => s.open)
  const { credits } = useCredits()
  const { isUnlimitedPlan } = useSubscription()

  const balance = credits?.balance ?? 0
  const totalPurchased = credits?.total_purchased ?? 0
  // For unlimited plans, force "healthy" — the sentinel balance would
  // always read healthy anyway, but the visual must render "Unlimited"
  // (with the amber accent) instead of a number.
  const health = isUnlimitedPlan ? "healthy" : getHealth(balance, totalPurchased)
  const c = HEALTH[health]

  const displayName = user?.display_name || user?.email?.split("@")[0] || t("user")

  // Avatar menu open + pin state (pinned while feedback is composing
  // so a stray pointer-out or outside-click can't dismiss the draft).
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPinned, setMenuPinned] = useState(false)

  // ─── Collapsed icon rail ───────────────────────────────────────
  // CRITICAL: do NOT use `items-center` on the flex-col container.
  // The sidebar's outer panel animates its `width` over 280ms when
  // toggling between expanded (216px) and collapsed (48px). During
  // that transit the COLLAPSED branch is what's rendered (React
  // flips the `expanded` flag instantly while the width tweens).
  // If children were `items-center`'d, they'd be re-centered inside
  // whatever the *current* container width happens to be on each
  // animation frame, sliding horizontally from the wide center down
  // to the narrow center.
  //
  // Instead, anchor everything to the left edge — buttons are
  // `w-full`, content sits at the button's left content edge with
  // no centering. The icon's x-position is then a pure function of
  // SidebarFooter padding (8) + section padding (4) = sidebar-x=12,
  // independent of container width. The avatar lands at x=12..36
  // (center 24) at every frame of the animation, exactly like the
  // header logo and the expanded identity row.
  if (!expanded) {
    return (
      <div className="flex flex-col gap-1 px-1 pt-3 pb-2">
        {user && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => openAccountDialog("billing")}
                className="flex h-8 w-full items-center rounded-md hover:bg-foreground/[0.04] transition-colors"
              >
                {/* The 24×24 wrapper places the credit dot in the
                    same column as the avatar below — keeps the icon
                    rail visually aligned at sidebar-x=24. */}
                <span className="flex h-6 w-6 shrink-0 items-center justify-center">
                  <span className={cn("h-1.5 w-1.5 rounded-full", c.dot)} />
                </span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              {isUnlimitedPlan ? (
                <span className="inline-flex items-center gap-1 font-semibold text-amber-600 dark:text-amber-400">
                  <IconInfinity size={12} stroke={2.5} />
                  Unlimited credits
                </span>
              ) : (
                <>
                  <span className="font-semibold tabular-nums">{balance.toLocaleString()}</span>
                  <span className="text-muted-foreground ml-1">{t("credits.creditsLeft")}</span>
                </>
              )}
            </TooltipContent>
          </Tooltip>
        )}

        {user && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => openAccountDialog()}
                className="flex h-8 w-full items-center rounded-md hover:bg-foreground/[0.04] transition-colors"
              >
                <Avatar className="h-6 w-6 shrink-0 ring-1 ring-border/40">
                  <AvatarImage src={user?.profile_image || undefined} />
                  <AvatarFallback className="bg-foreground/[0.06] text-foreground text-[9px] font-semibold">
                    {displayName[0].toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              {displayName}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    )
  }

  // ─── Expanded ──────────────────────────────────────────────────
  // Padding math (the avatar's pixel position must match collapsed):
  //   sidebar-x=0 → SidebarFooter p-2 (8px) → section px-1 (4px)
  //   → identity row no padding → avatar h-6 (24×24)
  //   left edge: 8 + 4 = 12. center: 12 + 12 = 24. ✓
  // In collapsed mode the avatar (h-6 inside h-8 button, items-center
  // in a 48px sidebar) lands at the same x=12..36 box. So the avatar
  // does not move during the expand/collapse animation — only the
  // display name fades in/out beside it, exactly like nav rows.
  //
  // Section padding is px-1 (not px-2.5) precisely so the footer's
  // left column aligns with the header logo at sidebar-x=12 and with
  // the avatar's collapsed position. The credits "REMAINING" eyebrow
  // and big balance number now share the same left rail as the logo
  // above and the avatar below.
  return (
    <div className="pt-3 pb-2.5 px-1">
      {/* ── Row 1: Credits — the hero element ── */}
      {user && (
        <button
          type="button"
          onClick={() => {
            openAccountDialog("billing")
            if (isMobile) closeMobileIfNeeded()
          }}
          className="group block w-full text-left rounded-md px-1 py-1 -mx-1 transition-colors hover:bg-foreground/[0.025]"
        >
          <div className="flex items-baseline justify-between mb-[5px]">
            <span className="text-[9.5px] font-medium uppercase tracking-[0.1em] text-foreground/35">
              {isUnlimitedPlan ? "Plan" : t("credits.remaining")}
            </span>
            <span className={cn("h-1 w-1 rounded-full transition-colors", isUnlimitedPlan ? "bg-amber-500 dark:bg-amber-400" : c.dot)} />
          </div>
          <div className="flex items-baseline gap-2">
            {isUnlimitedPlan ? (
              <span className="inline-flex items-center gap-1.5 text-[24px] font-semibold tracking-[-0.025em] leading-none text-amber-600 dark:text-amber-400">
                <IconInfinity size={26} stroke={2.4} />
                <span>Unlimited</span>
              </span>
            ) : (
              <>
                <span
                  className={cn(
                    "text-[28px] font-semibold tabular-nums tracking-[-0.025em] leading-none transition-colors",
                    c.text
                  )}
                >
                  {balance.toLocaleString()}
                </span>
                {totalPurchased > 0 && totalPurchased > balance && (
                  <span className="text-[10px] text-foreground/30 tabular-nums leading-none">
                    / {totalPurchased.toLocaleString()}
                  </span>
                )}
              </>
            )}
          </div>
        </button>
      )}

      {/* ── Row 2: Outbound actions duo ──
          Segmented "Run locally · Feedback" pair. Replaces the old
          stacked rows; reads as one composed group and saves vertical
          space. Morphs in place into the feedback compose card when
          the right cell is tapped. */}
      <FooterDuoRow userId={user?.id} closeMobileIfNeeded={closeMobileIfNeeded} />

      {/* ── Row 3: Identity ──
          Avatar is locked to h-6 w-6 (24×24) in both modes — same
          size as the sidebar header logo. With the section's px-1
          and the button's net-zero `-mx-1 px-1`, the avatar lands
          at sidebar-x=12..36 (center 24) — pixel-identical to its
          collapsed position. The display name just fades in/out
          beside it, exactly how the nav rows behave. */}
      <div className="mt-2.5 pt-2.5 flex items-center gap-1 border-t border-border/30 dark:border-white/[0.05]">
        {user ? (
          // Visual surface is identical across both viewports — only
          // the menu container changes:
          //   • Desktop: <Popover side="right"> (240px card, pinned to
          //     the trigger).
          //   • Mobile:  <Drawer> bottom sheet. We can't use the
          //     popover on a phone — the sidebar itself is already a
          //     left-edge drawer covering most of the viewport, so a
          //     `side="right"` 240px popover would render across the
          //     dimmed page edge or off-screen. The bottom sheet is
          //     the native phone pattern for "menu I tapped at the
          //     bottom".
          //
          //   Pin behavior is preserved on both surfaces:
          //   • Popover: `onInteractOutside.preventDefault()` while
          //     `menuPinned`.
          //   • Drawer: `dismissible={!menuPinned}` so drag-down and
          //     scrim-tap do nothing while the feedback composer has
          //     a draft in flight.
          isMobile ? (
            <>
              <button
                type="button"
                aria-label="Open account menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen(true)}
                data-state={menuOpen ? "open" : "closed"}
                className="flex items-center gap-2.5 flex-1 min-w-0 rounded-md px-1 py-1 -mx-1 transition-colors hover:bg-foreground/[0.03] data-[state=open]:bg-foreground/[0.04]"
              >
                <Avatar className="h-6 w-6 shrink-0 ring-1 ring-border/40">
                  <AvatarImage src={user?.profile_image || undefined} />
                  <AvatarFallback className="bg-foreground/[0.06] text-foreground text-[9px] font-semibold">
                    {displayName[0].toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="text-[12.5px] font-medium text-foreground/85 truncate flex-1 text-left">
                  {displayName}
                </span>
              </button>
              <Drawer
                open={menuOpen}
                onOpenChange={setMenuOpen}
                dismissible={!menuPinned}
              >
                <DrawerContent className="max-h-[82vh] focus:outline-none">
                  <DrawerTitle className="sr-only">Account menu</DrawerTitle>
                  <div className="flex-1 min-h-0 overflow-y-auto pb-2">
                    <AvatarMenu
                      chrome="drawer"
                      user={user}
                      onAction={() => {
                        setMenuPinned(false)
                        setMenuOpen(false)
                        closeMobileIfNeeded()
                      }}
                      onPinOpen={setMenuPinned}
                    />
                  </div>
                </DrawerContent>
              </Drawer>
            </>
          ) : (
            <Popover
              open={menuOpen}
              onOpenChange={(o) => {
                if (!o && menuPinned) return
                setMenuOpen(o)
              }}
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="Open account menu"
                  className="flex items-center gap-2.5 flex-1 min-w-0 rounded-md px-1 py-1 -mx-1 transition-colors hover:bg-foreground/[0.03] data-[state=open]:bg-foreground/[0.04]"
                >
                  <Avatar className="h-6 w-6 shrink-0 ring-1 ring-border/40">
                    <AvatarImage src={user?.profile_image || undefined} />
                    <AvatarFallback className="bg-foreground/[0.06] text-foreground text-[9px] font-semibold">
                      {displayName[0].toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-[12.5px] font-medium text-foreground/85 truncate flex-1 text-left">
                    {displayName}
                  </span>
                </button>
              </PopoverTrigger>
              <PopoverContent
                side="right"
                align="end"
                sideOffset={12}
                collisionPadding={16}
                onInteractOutside={(e) => { if (menuPinned) e.preventDefault() }}
                onEscapeKeyDown={(e) => { if (menuPinned) e.preventDefault() }}
                className="w-auto p-0 border-0 bg-transparent shadow-none"
              >
                <AvatarMenu
                  user={user}
                  onAction={() => {
                    setMenuPinned(false)
                    setMenuOpen(false)
                    closeMobileIfNeeded()
                  }}
                  onPinOpen={setMenuPinned}
                />
              </PopoverContent>
            </Popover>
          )
        ) : (
          <div className="flex-1" />
        )}
        <AnimatedThemeToggler
          className={cn(
            "flex h-7 w-7 items-center justify-center shrink-0 rounded-md",
            "text-foreground/35 hover:text-foreground/75",
            "hover:bg-foreground/[0.04]",
            "transition-colors duration-150 cursor-pointer"
          )}
        />
      </div>
    </div>
  )
})
