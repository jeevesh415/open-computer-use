"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  createSchedule,
  type ScheduleConfig,
  type ScheduleResponse,
} from "@/lib/services/schedules-api"
import { trackScheduleCreated } from "@/lib/posthog/analytics"
import type { UserMachine } from "@/types/machines.types"
import { createClient } from "@/lib/supabase/client"
import {
  KeyRound,
  ArrowRight,
  ArrowLeft,
  PenLine,
  AlertCircle,
  Sparkles,
  User,
  Check,
  Repeat,
  Monitor,
  Globe,
  Clock,
  CalendarDays,
  Terminal,
  MapPin,
  ChevronDown,
} from "lucide-react"
import { AgentIcon } from "@/components/icons/agent"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command"
import type { ScheduleConfigState } from "./schedule-config-block"

/* ─── Constants ─── */

const EMPLOYEE_NAMES = [
  "Atlas", "Echo", "Nova", "Sage", "Onyx", "Cleo", "Milo", "Aria",
  "Dash", "Flux", "Iris", "Juno", "Koda", "Luna", "Neon", "Orion",
  "Pixel", "Quinn", "Rune", "Scout", "Taro", "Vale", "Wren", "Zara",
  "Blaze", "Coral", "Dune", "Ember", "Frost", "Haze", "Ivy", "Kit",
]

function randomEmployeeName() {
  return EMPLOYEE_NAMES[Math.floor(Math.random() * EMPLOYEE_NAMES.length)]
}

const FREQUENCY_PILLS = [
  { value: "every_15_minutes", label: "15min", icon: "15" },
  { value: "every_30_minutes", label: "30min", icon: "30" },
  { value: "hourly", label: "Hourly", icon: "1h" },
  { value: "every_6_hours", label: "6 hours", icon: "6h" },
  { value: "every_12_hours", label: "12 hours", icon: "12h" },
  { value: "daily", label: "Daily", icon: "1d" },
  { value: "weekly", label: "Weekly", icon: "1w" },
  { value: "monthly", label: "Monthly", icon: "1M" },
  { value: "custom", label: "Cron", icon: "></>" },
] as const

const COMMON_TIMEZONES = [
  { value: "America/New_York", label: "Eastern Time", abbr: "ET", region: "Americas" },
  { value: "America/Chicago", label: "Central Time", abbr: "CT", region: "Americas" },
  { value: "America/Denver", label: "Mountain Time", abbr: "MT", region: "Americas" },
  { value: "America/Los_Angeles", label: "Pacific Time", abbr: "PT", region: "Americas" },
  { value: "America/Anchorage", label: "Alaska Time", abbr: "AKT", region: "Americas" },
  { value: "Pacific/Honolulu", label: "Hawaii Time", abbr: "HT", region: "Americas" },
  { value: "America/Toronto", label: "Toronto", abbr: "ET", region: "Americas" },
  { value: "America/Vancouver", label: "Vancouver", abbr: "PT", region: "Americas" },
  { value: "America/Sao_Paulo", label: "Sao Paulo", abbr: "BRT", region: "Americas" },
  { value: "America/Mexico_City", label: "Mexico City", abbr: "CST", region: "Americas" },
  { value: "Europe/London", label: "London", abbr: "GMT/BST", region: "Europe" },
  { value: "Europe/Paris", label: "Paris", abbr: "CET", region: "Europe" },
  { value: "Europe/Berlin", label: "Berlin", abbr: "CET", region: "Europe" },
  { value: "Europe/Amsterdam", label: "Amsterdam", abbr: "CET", region: "Europe" },
  { value: "Europe/Madrid", label: "Madrid", abbr: "CET", region: "Europe" },
  { value: "Europe/Rome", label: "Rome", abbr: "CET", region: "Europe" },
  { value: "Europe/Zurich", label: "Zurich", abbr: "CET", region: "Europe" },
  { value: "Europe/Stockholm", label: "Stockholm", abbr: "CET", region: "Europe" },
  { value: "Europe/Moscow", label: "Moscow", abbr: "MSK", region: "Europe" },
  { value: "Europe/Istanbul", label: "Istanbul", abbr: "TRT", region: "Europe" },
  { value: "Asia/Dubai", label: "Dubai", abbr: "GST", region: "Asia & Pacific" },
  { value: "Asia/Kolkata", label: "India (IST)", abbr: "IST", region: "Asia & Pacific" },
  { value: "Asia/Singapore", label: "Singapore", abbr: "SGT", region: "Asia & Pacific" },
  { value: "Asia/Shanghai", label: "Shanghai", abbr: "CST", region: "Asia & Pacific" },
  { value: "Asia/Tokyo", label: "Tokyo", abbr: "JST", region: "Asia & Pacific" },
  { value: "Asia/Seoul", label: "Seoul", abbr: "KST", region: "Asia & Pacific" },
  { value: "Australia/Sydney", label: "Sydney", abbr: "AEST", region: "Asia & Pacific" },
  { value: "Australia/Melbourne", label: "Melbourne", abbr: "AEST", region: "Asia & Pacific" },
  { value: "Pacific/Auckland", label: "Auckland", abbr: "NZST", region: "Asia & Pacific" },
  { value: "UTC", label: "UTC", abbr: "UTC", region: "Other" },
]

const DAYS_OF_WEEK = [
  { value: 0, label: "M", full: "Monday" },
  { value: 1, label: "T", full: "Tuesday" },
  { value: 2, label: "W", full: "Wednesday" },
  { value: 3, label: "T", full: "Thursday" },
  { value: 4, label: "F", full: "Friday" },
  { value: 5, label: "S", full: "Saturday" },
  { value: 6, label: "S", full: "Sunday" },
]

const STEPS = [
  { id: "identity", title: "Identity", icon: User, description: "Name & instructions" },
  { id: "schedule", title: "Schedule", icon: Repeat, description: "Frequency & timing" },
  { id: "workstation", title: "Workstation", icon: Monitor, description: "Machine & timezone" },
] as const

/* ─── Step indicator ─── */

function StepIndicator({ currentStep, totalSteps }: { currentStep: number; totalSteps: number }) {
  return (
    <div className="flex items-center justify-center gap-1 py-1">
      {Array.from({ length: totalSteps }, (_, i) => {
        const isCompleted = i < currentStep
        const isActive = i === currentStep
        return (
          <div key={i} className="flex items-center gap-1">
            <motion.div
              className={cn(
                "relative flex items-center justify-center rounded-full transition-colors duration-300",
                isActive
                  ? "h-8 w-8 bg-muted-foreground text-muted shadow-lg"
                  : isCompleted
                  ? "h-8 w-8 bg-muted-foreground/70 text-muted"
                  : "h-8 w-8 bg-muted/60 text-muted-foreground border border-border/40"
              )}
              animate={isActive ? { scale: [1, 1.08, 1] } : {}}
              transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
            >
              {isCompleted ? (
                <Check className="h-3.5 w-3.5" strokeWidth={3} />
              ) : (
                <span className="text-xs font-bold">{i + 1}</span>
              )}
              {isActive && (
                <motion.div
                  className="absolute inset-0 rounded-full border-2 border-muted-foreground/30"
                  initial={{ scale: 1, opacity: 0.5 }}
                  animate={{ scale: 1.4, opacity: 0 }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: "easeOut" }}
                />
              )}
            </motion.div>
            {i < totalSteps - 1 && (
              <div className="relative w-8 sm:w-12 h-0.5 mx-0.5">
                <div className="absolute inset-0 rounded-full bg-border/30" />
                <motion.div
                  className="absolute inset-y-0 left-0 rounded-full bg-muted-foreground/60"
                  initial={{ width: "0%" }}
                  animate={{ width: i < currentStep ? "100%" : "0%" }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/* ─── Timezone Combobox ─── */

function TimezoneCombobox({
  value,
  onValueChange,
}: {
  value: string
  onValueChange: (tz: string) => void
}) {
  const [open, setOpen] = useState(false)
  const found = COMMON_TIMEZONES.find((tz) => tz.value === value)
  const selectedLabel = found ? `${found.label} (${found.abbr})` : value || "Select timezone"

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "group/tz flex h-11 w-full items-center justify-between rounded-xl px-4 text-sm transition-all duration-200",
            "bg-muted/40 border border-border/40",
            "hover:border-border/60",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            !value && "text-muted-foreground"
          )}
        >
          <span className="flex items-center gap-2.5 truncate">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-muted/60">
              <MapPin className="h-3 w-3 text-foreground/50" />
            </div>
            <span className="truncate font-medium text-foreground/90">{selectedLabel}</span>
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0 ml-2 transition-transform duration-200 group-data-[state=open]/tz:rotate-180" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0 rounded-xl border-border/30 bg-background shadow-lg" align="start">
        <Command className="bg-transparent">
          <div className="border-b border-border/20">
            <CommandInput placeholder="Search timezones..." className="h-10" />
          </div>
          <CommandList className="max-h-[240px]">
            <CommandEmpty>No timezone found.</CommandEmpty>
            <CommandGroup>
              {COMMON_TIMEZONES.map((tz) => (
                <CommandItem
                  key={tz.value}
                  value={`${tz.label} ${tz.value} ${tz.abbr}`}
                  onSelect={() => { onValueChange(tz.value); setOpen(false) }}
                  className="rounded-lg mx-1 my-0.5"
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="text-sm">{tz.label}</span>
                    <span className="text-[11px] text-muted-foreground font-mono tracking-wider">{tz.abbr}</span>
                  </div>
                  {value === tz.value && <Check className="h-3.5 w-3.5 text-foreground shrink-0" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/* ─── Slide variants ─── */

const slideVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? 80 : -80, opacity: 0, scale: 0.98 }),
  center: { x: 0, opacity: 1, scale: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? -80 : 80, opacity: 0, scale: 0.98 }),
}

/* ─── Main Component ─── */

interface CreateScheduleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  machines: UserMachine[]
  onScheduleCreated?: (schedule: ScheduleResponse) => void
}

export function CreateScheduleDialog({
  open,
  onOpenChange,
  machines,
  onScheduleCreated,
}: CreateScheduleDialogProps) {
  const [step, setStep] = useState(0)
  const [direction, setDirection] = useState(1)
  const [employeeName, setEmployeeName] = useState(randomEmployeeName)
  const [taskDescription, setTaskDescription] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [config, setConfig] = useState<ScheduleConfigState>({
    frequency: "daily",
    time: "09:00",
    dayOfWeek: 1,
    dayOfMonth: 1,
    customCron: "",
    timezone: "",
    machineId: "",
  })

  useEffect(() => {
    try {
      setConfig((prev) => ({ ...prev, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }))
    } catch {
      setConfig((prev) => ({ ...prev, timezone: "UTC" }))
    }
  }, [])

  useEffect(() => {
    if (open) {
      setStep(0)
      setDirection(1)
      setEmployeeName(randomEmployeeName())
      setTaskDescription("")
      setError(null)
      const firstRunning = machines.find((m) => m.status === "running")
      setConfig((prev) => ({
        ...prev,
        frequency: "daily",
        time: "09:00",
        dayOfWeek: 1,
        dayOfMonth: 1,
        customCron: "",
        machineId: firstRunning?.id ?? machines[0]?.id ?? "",
      }))
    }
  }, [open, machines])

  const handleConfigChange = useCallback(
    (updates: Partial<ScheduleConfigState>) => {
      setConfig((prev) => ({ ...prev, ...updates }))
    },
    []
  )

  const showTimePicker = ["daily", "weekly", "monthly"].includes(config.frequency)
  const showDayOfWeek = config.frequency === "weekly"
  const showDayOfMonth = config.frequency === "monthly"

  const goNext = () => {
    if (step === 0 && !taskDescription.trim()) {
      setError("Please describe what the employee should do")
      return
    }
    setError(null)
    setDirection(1)
    setStep((s) => Math.min(s + 1, STEPS.length - 1))
  }

  const goBack = () => {
    setError(null)
    setDirection(-1)
    setStep((s) => Math.max(s - 1, 0))
  }

  async function handleSave() {
    if (!config.machineId) {
      setError("Please select a workstation")
      return
    }
    if (config.frequency === "custom" && !config.customCron) {
      setError("Please enter a cron expression")
      return
    }

    setLoading(true)
    setError(null)

    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error("Not authenticated")

      const chatRes = await fetch("/api/create-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: employeeName.trim() || randomEmployeeName(),
          model: null,
        }),
      })
      const chatData = await chatRes.json()
      if (!chatRes.ok || !chatData.chat) {
        throw new Error(chatData.error || "Failed to hire employee")
      }

      const scheduleConfig: ScheduleConfig = {
        frequency: config.frequency,
        timezone: config.timezone,
        machineId: config.machineId,
        taskPrompt: taskDescription.trim(),
      }
      if (config.frequency === "custom") scheduleConfig.cron = config.customCron
      if (showTimePicker) scheduleConfig.time = config.time
      if (showDayOfWeek) scheduleConfig.dayOfWeek = config.dayOfWeek
      if (showDayOfMonth) scheduleConfig.dayOfMonth = config.dayOfMonth

      const schedule = await createSchedule(chatData.chat.id, scheduleConfig)
      trackScheduleCreated(chatData.chat.id, config.frequency)
      onScheduleCreated?.(schedule)
      onOpenChange(false)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to hire employee")
    } finally {
      setLoading(false)
    }
  }

  const canSubmit = taskDescription.trim() && config.machineId && (config.frequency !== "custom" || config.customCron)
  const isLastStep = step === STEPS.length - 1

  const selectableMachines = machines.filter(
    (m) => m.status !== "deleting" && m.status !== "error"
  )

  /* ─── Step content ─── */

  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <div className="space-y-6">
            {/* Employee Name */}
            <div className="space-y-3">
              <div className="flex items-center gap-2.5">
                <div className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-lg",
                  "bg-gradient-to-br from-muted/80 to-muted/40 ring-1 ring-border/20",
                )}>
                  <User className="h-3.5 w-3.5 text-foreground/60" />
                </div>
                <label className="text-xs font-semibold text-foreground/70 tracking-wide">
                  Employee Name
                </label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={employeeName}
                  onChange={(e) => setEmployeeName(e.target.value)}
                  placeholder="Employee name"
                  autoFocus
                  className={cn(
                    "flex-1 h-12 rounded-xl px-4 text-sm font-medium",
                    "bg-muted/30 text-foreground",
                    "border border-border/30 hover:border-border/50 focus-visible:border-foreground/30",
                    "placeholder:text-muted-foreground/60",
                    "focus:outline-none transition-all duration-300",
                    "shadow-sm focus:shadow-md",
                  )}
                />
                <motion.button
                  type="button"
                  onClick={() => setEmployeeName(randomEmployeeName())}
                  whileTap={{ scale: 0.9, rotate: -15 }}
                  className={cn(
                    "shrink-0 h-12 w-12 flex items-center justify-center rounded-xl",
                    "bg-muted/30 border border-border/30",
                    "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                    "hover:scale-105 hover:rotate-[15deg]",
                    "transition-all duration-200",
                  )}
                  title="Randomize name"
                >
                  <Sparkles className="h-4 w-4" />
                </motion.button>
              </div>
            </div>

            {/* Instructions */}
            <div className="space-y-3">
              <div className="flex items-center gap-2.5">
                <div className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-lg",
                  "bg-gradient-to-br from-muted/80 to-muted/40 ring-1 ring-border/20",
                )}>
                  <PenLine className="h-3.5 w-3.5 text-foreground/60" />
                </div>
                <label className="text-xs font-semibold text-foreground/70 tracking-wide">
                  Instructions
                </label>
              </div>
              <Textarea
                placeholder="e.g. Check my emails and summarise unread messages, then send a daily digest to #team-updates on Slack"
                value={taskDescription}
                onChange={(e) => {
                  setTaskDescription(e.target.value)
                  if (error) setError(null)
                }}
                rows={4}
                className={cn(
                  "resize-none text-sm leading-relaxed rounded-xl",
                  "bg-muted/30 text-foreground",
                  "border-border/30 hover:border-border/50 focus-visible:border-foreground/30",
                  "placeholder:text-muted-foreground/60",
                  "transition-all duration-300",
                  "shadow-sm focus:shadow-md",
                )}
              />
              <p className="text-[11px] text-muted-foreground/70 pl-0.5">
                These instructions are used every time the employee runs.
              </p>
            </div>
          </div>
        )

      case 1:
        return (
          <div className="space-y-5">
            {/* Frequency pills */}
            <div className="space-y-3">
              <div className="flex items-center gap-2.5">
                <div className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-lg",
                  "bg-gradient-to-br from-muted/80 to-muted/40 ring-1 ring-border/20",
                )}>
                  <Repeat className="h-3.5 w-3.5 text-foreground/60" />
                </div>
                <label className="text-xs font-semibold text-foreground/70 tracking-wide">
                  How often?
                </label>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {FREQUENCY_PILLS.map((pill) => {
                  const isSelected = config.frequency === pill.value
                  return (
                    <motion.button
                      key={pill.value}
                      type="button"
                      onClick={() => handleConfigChange({ frequency: pill.value })}
                      whileTap={{ scale: 0.97 }}
                      className={cn(
                        "relative px-3 py-3 rounded-xl text-xs font-semibold transition-all duration-300 hover:scale-[1.03]",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        isSelected
                          ? "text-foreground bg-muted ring-1 ring-border shadow-sm"
                          : "text-muted-foreground bg-muted/30 border border-border/30 hover:border-border/50 hover:text-foreground hover:bg-muted/50"
                      )}
                    >
                      <span className="block text-[10px] font-mono text-current/60 mb-0.5">{pill.icon}</span>
                      {pill.label}
                    </motion.button>
                  )
                })}
              </div>
            </div>

            {/* Time + Day pickers */}
            {showTimePicker && (
              <div className="space-y-3">
                <div className="flex items-center gap-2.5">
                  <div className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-lg",
                    "bg-gradient-to-br from-muted/80 to-muted/40 ring-1 ring-border/20",
                  )}>
                    <Clock className="h-3.5 w-3.5 text-foreground/60" />
                  </div>
                  <label className="text-xs font-semibold text-foreground/70 tracking-wide">
                    What time?
                  </label>
                </div>
                <Input
                  type="time"
                  value={config.time}
                  onChange={(e) => handleConfigChange({ time: e.target.value })}
                  className={cn(
                    "h-12 text-sm font-mono rounded-xl text-foreground",
                    "!bg-muted/30",
                    "border-border/30 hover:border-border/50",
                    "shadow-sm focus:shadow-md",
                    "transition-all duration-300",
                  )}
                />
              </div>
            )}

            {showDayOfWeek && (
              <div className="space-y-3">
                <div className="flex items-center gap-2.5">
                  <div className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-lg",
                    "bg-gradient-to-br from-muted/80 to-muted/40 ring-1 ring-border/20",
                  )}>
                    <CalendarDays className="h-3.5 w-3.5 text-foreground/60" />
                  </div>
                  <label className="text-xs font-semibold text-foreground/70 tracking-wide">
                    Which day?
                  </label>
                </div>
                <div className="flex gap-1.5">
                  {DAYS_OF_WEEK.map((d) => (
                    <motion.button
                      key={d.value}
                      type="button"
                      onClick={() => handleConfigChange({ dayOfWeek: d.value })}
                      whileTap={{ scale: 0.92 }}
                      title={d.full}
                      className={cn(
                        "flex-1 h-12 rounded-xl text-xs font-bold transition-all duration-300 hover:scale-[1.08]",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        config.dayOfWeek === d.value
                          ? "text-foreground bg-muted ring-1 ring-border shadow-sm"
                          : "bg-muted/30 text-muted-foreground border border-border/30 hover:bg-muted/50 hover:text-foreground"
                      )}
                    >
                      {d.label}
                    </motion.button>
                  ))}
                </div>
              </div>
            )}

            {showDayOfMonth && (
              <div className="space-y-3">
                <div className="flex items-center gap-2.5">
                  <div className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-lg",
                    "bg-gradient-to-br from-muted/80 to-muted/40 ring-1 ring-border/20",
                  )}>
                    <CalendarDays className="h-3.5 w-3.5 text-foreground/60" />
                  </div>
                  <label className="text-xs font-semibold text-foreground/70 tracking-wide">
                    Day of month
                  </label>
                </div>
                <Select
                  value={String(config.dayOfMonth)}
                  onValueChange={(v) => handleConfigChange({ dayOfMonth: Number(v) })}
                >
                  <SelectTrigger className={cn(
                    "h-12 rounded-xl text-foreground",
                    "!bg-muted/30",
                    "border-border/30 hover:border-border/50",
                    "shadow-sm",
                  )}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                      <SelectItem key={d} value={String(d)}>
                        {d}{d === 1 ? "st" : d === 2 ? "nd" : d === 3 ? "rd" : "th"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {config.frequency === "custom" && (
              <div className="space-y-3">
                <div className="flex items-center gap-2.5">
                  <div className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-lg",
                    "bg-gradient-to-br from-muted/80 to-muted/40 ring-1 ring-border/20",
                  )}>
                    <Terminal className="h-3.5 w-3.5 text-foreground/60" />
                  </div>
                  <label className="text-xs font-semibold text-foreground/70 tracking-wide">
                    Cron Expression
                  </label>
                </div>
                <Input
                  placeholder="*/15 * * * *"
                  value={config.customCron}
                  onChange={(e) => handleConfigChange({ customCron: e.target.value })}
                  className={cn(
                    "h-12 font-mono text-sm rounded-xl text-foreground",
                    "!bg-muted/30",
                    "border-border/30 hover:border-border/50",
                    "shadow-sm focus:shadow-md",
                  )}
                />
                <p className="text-[11px] text-muted-foreground/70 font-mono tracking-wider pl-0.5">
                  minute &middot; hour &middot; day &middot; month &middot; weekday
                </p>
              </div>
            )}
          </div>
        )

      case 2:
        return (
          <div className="space-y-6">
            {/* Workstation */}
            <div className="space-y-3">
              <div className="flex items-center gap-2.5">
                <div className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-lg",
                  "bg-gradient-to-br from-muted/80 to-muted/40 ring-1 ring-border/20",
                )}>
                  <Monitor className="h-3.5 w-3.5 text-foreground/60" />
                </div>
                <label className="text-xs font-semibold text-foreground/70 tracking-wide">
                  Workstation
                </label>
              </div>

              {selectableMachines.length === 0 ? (
                <div className={cn(
                  "rounded-2xl border border-dashed border-border/30 p-8 text-center",
                  "bg-muted/20",
                )}>
                  <Monitor className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground font-medium">No workstations available</p>
                  <p className="text-[11px] text-muted-foreground/60 mt-1">
                    Set up a machine from My Computers first.
                  </p>
                </div>
              ) : (
                <div className="grid gap-2">
                  {selectableMachines.map((m) => {
                    const isSelected = config.machineId === m.id
                    const statusColor =
                      m.status === "running"
                        ? "bg-emerald-500"
                        : m.status === "stopped"
                        ? "bg-muted-foreground/50"
                        : "bg-muted-foreground/30"

                    return (
                      <motion.button
                        key={m.id}
                        type="button"
                        onClick={() => handleConfigChange({ machineId: m.id })}
                        whileTap={{ scale: 0.99 }}
                        className={cn(
                          "group/machine relative flex items-center gap-3.5 rounded-xl px-4 py-3.5 text-left transition-all duration-300 hover:scale-[1.01]",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          isSelected
                            ? "bg-muted border-2 border-border shadow-sm"
                            : "bg-muted/20 border border-border/30 hover:border-border/50 hover:bg-muted/30 hover:shadow-sm"
                        )}
                      >
                        <div className="relative">
                          <div className={cn(
                            "h-10 w-10 rounded-xl flex items-center justify-center text-sm font-bold transition-all duration-300",
                            isSelected
                              ? "bg-muted-foreground/15 text-foreground shadow-sm"
                              : "bg-muted/50 text-muted-foreground group-hover/machine:bg-muted/70"
                          )}>
                            {m.displayName?.charAt(0)?.toUpperCase() || "M"}
                          </div>
                          <div className={cn(
                            "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-[2.5px] border-background transition-all",
                            statusColor,
                          )} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={cn(
                            "text-sm font-semibold truncate transition-colors",
                            isSelected ? "text-foreground" : "text-foreground/70 group-hover/machine:text-foreground"
                          )}>
                            {m.displayName}
                          </p>
                          <p className="text-[11px] text-muted-foreground/70 capitalize mt-0.5">{m.status}</p>
                        </div>
                        <div className={cn(
                          "h-5 w-5 rounded-full transition-all duration-300 shrink-0 flex items-center justify-center",
                          isSelected
                            ? "bg-muted-foreground shadow-sm"
                            : "border-2 border-border/40 group-hover/machine:border-border/60"
                        )}>
                          {isSelected && <Check className="h-3 w-3 text-background" strokeWidth={3} />}
                        </div>
                      </motion.button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Timezone */}
            <div className="space-y-3">
              <div className="flex items-center gap-2.5">
                <div className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-lg",
                  "bg-gradient-to-br from-muted/80 to-muted/40 ring-1 ring-border/20",
                )}>
                  <Globe className="h-3.5 w-3.5 text-foreground/60" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground/70 tracking-wide">
                    Timezone
                  </label>
                  <p className="text-[10px] text-muted-foreground/60">Auto-detected — change if needed</p>
                </div>
              </div>
              <TimezoneCombobox
                value={config.timezone}
                onValueChange={(tz) => handleConfigChange({ timezone: tz })}
              />
            </div>

            {/* Credentials hint */}
            <div className={cn(
              "flex items-center gap-3 rounded-xl px-4 py-3",
              "border border-border/20 bg-muted/20",
            )}>
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted/50">
                <KeyRound className="h-3.5 w-3.5 text-foreground/30" />
              </div>
              <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
                Need auto-login?{" "}
                <Link
                  href="/secrets"
                  className="inline-flex items-center gap-0.5 font-semibold text-foreground/60 hover:text-foreground transition-colors"
                >
                  Add credentials
                  <ArrowRight className="h-2.5 w-2.5" />
                </Link>
              </p>
            </div>
          </div>
        )

      default:
        return null
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex flex-col max-w-[calc(100vw-2rem)] sm:max-w-[540px] max-h-[90dvh] p-0 gap-0 overflow-hidden",
          "bg-background text-foreground",
          "border-border/20",
          "shadow-2xl",
        )}
      >
        {/* Header */}
        <div className="relative shrink-0 overflow-hidden">
          <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-foreground/[0.06] to-transparent" />

          <div className="relative px-5 sm:px-7 pt-5 sm:pt-6 pb-4 sm:pb-5">
            <DialogHeader>
              <div className="flex items-center gap-3.5">
                <motion.div
                  className={cn(
                    "flex h-11 w-11 sm:h-12 sm:w-12 items-center justify-center rounded-2xl",
                    "bg-gradient-to-br from-muted-foreground/10 to-muted/40 ring-1 ring-border/30",
                  )}
                  initial={{ rotate: -10, scale: 0.9 }}
                  animate={{ rotate: 0, scale: 1 }}
                  transition={{ type: "spring", stiffness: 200, damping: 15 }}
                >
                  <AgentIcon className="h-5 w-5 sm:h-6 sm:w-6 text-foreground/70" />
                </motion.div>
                <div>
                  <DialogTitle className="text-base sm:text-lg font-bold tracking-tight">
                    Hire New Employee
                  </DialogTitle>
                  <DialogDescription className="text-[11px] sm:text-xs text-muted-foreground/70 mt-0.5">
                    {STEPS[step].description}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            {/* Step indicator */}
            <div className="mt-5">
              <StepIndicator currentStep={step} totalSteps={STEPS.length} />
            </div>
          </div>
        </div>

        {/* Scrollable content with animated steps */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 sm:px-7 pb-5 sm:pb-6 pt-4 sm:pt-5 scrollbar-invisible">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={step}
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
            >
              {renderStep()}
            </motion.div>
          </AnimatePresence>

          {/* Error */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: 10, height: 0 }}
                animate={{ opacity: 1, y: 0, height: "auto" }}
                exit={{ opacity: 0, y: -10, height: 0 }}
                className="mt-4"
              >
                <div className={cn(
                  "flex items-center gap-2.5 rounded-xl px-4 py-3",
                  "border border-red-500/20 bg-red-500/5",
                )}>
                  <AlertCircle className="h-4 w-4 text-red-500/70 shrink-0" />
                  <p className="text-xs text-red-600 dark:text-red-400 font-medium">{error}</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className={cn(
          "shrink-0 px-5 sm:px-7 py-3.5 sm:py-4 flex items-center justify-between gap-2",
          "border-t border-border/20",
          "bg-muted/20",
        )}>
          <div>
            {step > 0 ? (
              <motion.button
                onClick={goBack}
                whileTap={{ scale: 0.95 }}
                className={cn(
                  "h-10 px-4 rounded-xl text-sm font-medium transition-all duration-200 hover:-translate-x-0.5",
                  "text-muted-foreground hover:text-foreground",
                  "hover:bg-muted/50",
                  "flex items-center gap-2",
                )}
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back
              </motion.button>
            ) : (
              <Button
                variant="ghost"
                onClick={() => onOpenChange(false)}
                className="h-10 px-4 text-sm rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/50"
              >
                Cancel
              </Button>
            )}
          </div>

          <motion.button
            onClick={isLastStep ? handleSave : goNext}
            disabled={loading || (isLastStep && !canSubmit)}
            whileTap={!loading && (isLastStep ? canSubmit : true) ? { scale: 0.97 } : {}}
            className={cn(
              "relative h-10 px-6 rounded-xl text-sm font-semibold transition-all duration-300",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:opacity-40 disabled:cursor-not-allowed",
              (isLastStep ? canSubmit : true) && !loading
                ? "text-foreground bg-muted hover:bg-muted/80 ring-1 ring-border shadow-sm hover:shadow-md hover:scale-[1.03]"
                : "text-muted-foreground bg-muted/50"
            )}
          >
            <span className="flex items-center gap-2">
              {isLastStep ? (
                <>
                  <AgentIcon className="h-4 w-4" />
                  {loading ? "Hiring..." : "Hire Employee"}
                </>
              ) : (
                <>
                  Continue
                  <ArrowRight className="h-3.5 w-3.5" />
                </>
              )}
            </span>
          </motion.button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
