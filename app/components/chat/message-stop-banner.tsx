"use client"

import { cn } from "@/lib/utils"
import {
  Stop,
  CoinVertical,
  ArrowClockwise,
  CreditCard,
  CalendarCheck,
  HandPalm,
} from "@phosphor-icons/react"
import { useAccountDialog } from "@/lib/account-dialog-store"

type StopReason = "stopped_by_user" | "insufficient_credits" | "scheduled_insufficient_credits" | "awaiting_human_timeout"

interface StopReasonConfig {
  tag: string
  reason: StopReason
  icon: React.ComponentType<any>
  title: string
  description: string
  color: {
    bg: string
    border: string
    icon: string
    title: string
    description: string
  }
  actions: Array<{
    label: string
    icon: React.ComponentType<any>
    href?: string
    onClick?: string
  }>
}

const STOP_REASONS: StopReasonConfig[] = [
  {
    tag: "[Response stopped by user]",
    reason: "stopped_by_user",
    icon: Stop,
    title: "Response stopped",
    description: "You stopped this response before it finished.",
    color: {
      bg: "bg-zinc-500/5 dark:bg-zinc-400/5",
      border: "border-zinc-200/60 dark:border-zinc-700/60",
      icon: "text-zinc-500 dark:text-zinc-400",
      title: "text-zinc-700 dark:text-zinc-300",
      description: "text-zinc-500 dark:text-zinc-400",
    },
    actions: [],
  },
  {
    tag: "[Session ended: insufficient credits]",
    reason: "insufficient_credits",
    icon: CoinVertical,
    title: "Ran out of credits",
    description: "This session ended because your credit balance ran out.",
    color: {
      bg: "bg-amber-500/5 dark:bg-amber-400/5",
      border: "border-amber-200/60 dark:border-amber-700/40",
      icon: "text-amber-500 dark:text-amber-400",
      title: "text-amber-700 dark:text-amber-300",
      description: "text-amber-600 dark:text-amber-400/80",
    },
    actions: [
      {
        label: "Add credits",
        icon: CreditCard,
        onClick: "billing",
      },
      {
        label: "Retry",
        icon: ArrowClockwise,
        onClick: "retry",
      },
    ],
  },
  {
    tag: "[Agent paused: waiting for human]",
    reason: "awaiting_human_timeout" as StopReason,
    icon: HandPalm,
    title: "Agent waited for you",
    description: "The agent paused for human intervention but no response was received in time.",
    color: {
      bg: "bg-amber-500/5 dark:bg-amber-400/5",
      border: "border-amber-200/60 dark:border-amber-700/40",
      icon: "text-amber-500 dark:text-amber-400",
      title: "text-amber-700 dark:text-amber-300",
      description: "text-amber-600 dark:text-amber-400/80",
    },
    actions: [],
  },
  {
    tag: "[Scheduled run ended: insufficient credits]",
    reason: "scheduled_insufficient_credits",
    icon: CoinVertical,
    title: "Employee run stopped",
    description: "This employee run ended because your credit balance ran out.",
    color: {
      bg: "bg-amber-500/5 dark:bg-amber-400/5",
      border: "border-amber-200/60 dark:border-amber-700/40",
      icon: "text-amber-500 dark:text-amber-400",
      title: "text-amber-700 dark:text-amber-300",
      description: "text-amber-600 dark:text-amber-400/80",
    },
    actions: [
      {
        label: "Add credits",
        icon: CreditCard,
        onClick: "billing",
      },
      {
        label: "View employees",
        icon: CalendarCheck,
        href: "/schedules",
      },
    ],
  },
]

/** All known stop tags for stripping from rendered content */
export const STOP_TAGS = STOP_REASONS.map((r) => r.tag)

/** Detect which stop reason (if any) is present in content */
export function detectStopReason(content: string): StopReasonConfig | null {
  for (const config of STOP_REASONS) {
    if (content.includes(config.tag)) {
      return config
    }
  }
  return null
}

/** Strip all stop tags from content for clean rendering */
export function stripStopTags(content: string): string {
  let cleaned = content
  for (const tag of STOP_TAGS) {
    cleaned = cleaned.replaceAll(tag, "")
  }
  return cleaned.trimEnd()
}

interface MessageStopBannerProps {
  config: StopReasonConfig
  onRetry?: () => void
  className?: string
}

export function MessageStopBanner({
  config,
  onRetry,
  className,
}: MessageStopBannerProps) {
  const Icon = config.icon

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-2xl border px-4 py-3",
        config.color.bg,
        config.color.border,
        className
      )}
    >
      <div className={cn("mt-0.5 shrink-0", config.color.icon)}>
        <Icon className="size-[18px]" weight="fill" />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={cn("text-sm font-medium", config.color.title)}>
          {config.title}
        </span>
        <span className={cn("text-xs", config.color.description)}>
          {config.description}
        </span>

        {config.actions.length > 0 && (
          <div className="mt-1.5 flex items-center gap-2">
            {config.actions.map((action) => {
              const ActionIcon = action.icon

              if (action.onClick === "billing") {
                return (
                  <button
                    key={action.label}
                    onClick={() => useAccountDialog.getState().open("billing")}
                    type="button"
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
                      "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50",
                      "dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                    )}
                  >
                    <ActionIcon className="size-3.5" />
                    {action.label}
                  </button>
                )
              }

              if (action.onClick === "retry" && onRetry) {
                return (
                  <button
                    key={action.label}
                    onClick={onRetry}
                    type="button"
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
                      "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50",
                      "dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                    )}
                  >
                    <ActionIcon className="size-3.5" />
                    {action.label}
                  </button>
                )
              }

              return null
            })}
          </div>
        )}
      </div>
    </div>
  )
}