"use client"

import { useState, useEffect, useMemo } from "react"
import {
  CircleNotch,
  Plus,
  Desktop,
  WifiHigh,
  WifiSlash,
  Check,
  GitFork,
  Lock,
  Lightning,
  ArrowRight,
  Minus,
  CaretUpDown,
  CaretRight,
  CaretDown,
  Cloud,
  House,
} from "@phosphor-icons/react"
import { CloudDesktopIcon } from "@/components/icons/cloud-desktop"
import { LocalLaptopIcon } from "@/components/icons/local-laptop"
import { WindowsIcon, AppleIcon, LinuxIcon } from "@/components/icons/platform-icons"
import { cn } from "@/lib/utils"
import type { UserMachine } from "@/types/machines.types"
import { CreateMachineDialog } from "@/app/components/machines/create-machine-dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { motion, AnimatePresence } from "motion/react"
import { useAccountDialog } from "@/lib/account-dialog-store"

interface VMSelectorProps {
  selectedVMId: string | null
  setSelectedVMId: (vmId: string | null) => void
  isUserAuthenticated: boolean
  className?: string
  // Swarm props (optional — segmented control only renders when onSwarmModeChange is provided)
  swarmMode?: boolean
  onSwarmModeChange?: (enabled: boolean) => void
  swarmCount?: number
  onSwarmCountChange?: (count: number) => void
  isSwarmLocked?: boolean
  maxSwarmMachines?: number
}

type DisplayStatus = UserMachine["status"] | "initiating" | "online" | "offline"
type ViewMode = "computers" | "swarm"

function getStatusStyles(status: DisplayStatus) {
  switch (status) {
    case "running":
    case "online":
      return {
        text: "text-green-700 dark:text-green-400",
        dot: "bg-green-500",
      }
    case "creating":
      return {
        text: "text-yellow-700 dark:text-yellow-400",
        dot: "bg-yellow-500",
      }
    case "starting":
    case "initiating":
      return {
        text: "text-blue-700 dark:text-blue-400",
        dot: "bg-blue-500",
      }
    case "stopping":
      return {
        text: "text-orange-700 dark:text-orange-400",
        dot: "bg-orange-500",
      }
    case "stopped":
    case "offline":
      return {
        text: "text-gray-700 dark:text-gray-400",
        dot: "bg-gray-400",
      }
    case "error":
    case "deleting":
      return {
        text: "text-red-700 dark:text-red-400",
        dot: "bg-red-500",
      }
    default:
      return {
        text: "text-gray-700 dark:text-gray-400",
        dot: "bg-gray-400",
      }
  }
}

function getStatusText(status: DisplayStatus) {
  switch (status) {
    case "running": return "Running"
    case "online": return "Online"
    case "creating": return "Creating"
    case "starting": return "Starting"
    case "initiating": return "Initiating"
    case "stopping": return "Stopping"
    case "stopped": return "Stopped"
    case "offline": return "Offline"
    case "error": return "Error"
    case "deleting": return "Deleting"
    default: return "Unknown"
  }
}

/**
 * FadeRule — hairline separator that fades in at both ends, giving a more
 * "premium" look than a flat border. Pure visual element; aria-hidden.
 */
function FadeRule({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "h-px shrink-0 bg-gradient-to-r from-transparent via-border to-transparent",
        className
      )}
    />
  )
}

/**
 * useScrollEdges — tracks whether a scrollable element has overflow above
 * and/or below the visible region. Reattaches across element re-mounts so
 * AnimatePresence-driven tab swaps keep working without manual wiring.
 */
function useScrollEdges(el: HTMLElement | null) {
  const [edges, setEdges] = useState({ top: false, bottom: false })

  useEffect(() => {
    if (!el) {
      setEdges({ top: false, bottom: false })
      return
    }

    const update = () => {
      const { scrollTop, scrollHeight, clientHeight } = el
      const next = {
        top: scrollTop > 4,
        bottom: scrollTop + clientHeight < scrollHeight - 4,
      }
      setEdges((prev) =>
        prev.top === next.top && prev.bottom === next.bottom ? prev : next
      )
    }

    update()
    el.addEventListener("scroll", update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    const mo = new MutationObserver(update)
    mo.observe(el, { childList: true, subtree: true })

    return () => {
      el.removeEventListener("scroll", update)
      ro.disconnect()
      mo.disconnect()
    }
  }, [el])

  return edges
}

/**
 * ScrollFades — premium scroll affordance. Renders gradient masks at the
 * top and bottom of a scrollable region to suggest "more content". The
 * bottom edge also gets a subtle bouncing chevron when there's more below.
 * Both fade out cleanly once the user scrolls to that edge.
 */
function ScrollFades({ top, bottom }: { top: boolean; bottom: boolean }) {
  return (
    <>
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 h-5 bg-gradient-to-b from-popover via-popover/85 to-transparent transition-opacity duration-200",
          top ? "opacity-100" : "opacity-0"
        )}
      />
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 transition-opacity duration-200",
          bottom ? "opacity-100" : "opacity-0"
        )}
      >
        <div className="h-7 bg-gradient-to-t from-popover via-popover/85 to-transparent" />
        <motion.div
          aria-hidden="true"
          initial={false}
          animate={{ y: [0, 2.5, 0] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
          className="absolute bottom-1 left-1/2 -translate-x-1/2"
        >
          <CaretDown className="size-3 text-muted-foreground/55" weight="bold" />
        </motion.div>
      </div>
    </>
  )
}

function StatusDot({ status }: { status: DisplayStatus }) {
  const styles = getStatusStyles(status)
  const isAnimated = status === "running" || status === "online" || status === "starting" || status === "creating" || status === "initiating"
  return (
    <span className="relative flex h-2 w-2 shrink-0">
      {isAnimated && (
        <span className={cn("absolute inline-flex h-full w-full rounded-full opacity-40 animate-ping", styles.dot)} />
      )}
      <span className={cn("relative inline-flex h-2 w-2 rounded-full", styles.dot)} />
    </span>
  )
}

type OsInfo = { Icon: typeof WindowsIcon; name: string }

function getOsInfo(machine: UserMachine): OsInfo | null {
  const platform = machine.settings?.platform
  const osType = machine.settings?.osType
  const provider = machine.settings?.provider

  if (platform === "win32" || osType === "windows") {
    return { Icon: WindowsIcon, name: "Windows" }
  }
  if (platform === "darwin") {
    return { Icon: AppleIcon, name: "macOS" }
  }
  if (
    platform === "linux" ||
    osType === "linux" ||
    provider === "aws" ||
    provider === "azure" ||
    provider === "docker"
  ) {
    return { Icon: LinuxIcon, name: "Linux" }
  }
  return null
}

/**
 * OsLine — inline OS glyph + name used as a subtitle under the machine
 * name. Neutral, low-contrast, never wraps.
 */
function OsLine({ machine }: { machine: UserMachine }) {
  const os = getOsInfo(machine)
  if (!os) return null
  return (
    <span className="inline-flex items-center gap-1 mt-0.5 leading-none">
      <os.Icon className="h-2.5 w-2.5 text-muted-foreground/55 shrink-0" />
      <span className="text-[10px] text-muted-foreground/65 truncate">{os.name}</span>
    </span>
  )
}

export function VMSelector({
  selectedVMId,
  setSelectedVMId,
  isUserAuthenticated,
  className,
  swarmMode = false,
  onSwarmModeChange,
  swarmCount = 2,
  onSwarmCountChange,
  isSwarmLocked = false,
  maxSwarmMachines = 3,
}: VMSelectorProps) {
  const [allMachines, setAllMachines] = useState<UserMachine[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [agentReady, setAgentReady] = useState<Record<string, boolean>>({})
  const [open, setOpen] = useState(false)

  const showSwarmTab = !!onSwarmModeChange
  const swarmActive = swarmMode && !isSwarmLocked
  const [viewMode, setViewMode] = useState<ViewMode>(swarmActive ? "swarm" : "computers")

  useEffect(() => {
    setViewMode(swarmActive ? "swarm" : "computers")
  }, [swarmActive])

  useEffect(() => {
    if (isUserAuthenticated) {
      fetchMachines()
      const interval = setInterval(fetchMachines, 10000)
      return () => clearInterval(interval)
    }
  }, [isUserAuthenticated])

  // Check agent health for selected running machine
  useEffect(() => {
    if (!selectedVMId || selectedVMId === "none") return

    const machine = allMachines.find(m => m.id === selectedVMId)
    if (!machine || machine.status !== "running") return

    const checkAgentHealth = async () => {
      try {
        const res = await fetch(`/api/machines/${selectedVMId}/agent-health`)
        if (res.ok) {
          const data = await res.json()
          setAgentReady(prev => ({ ...prev, [selectedVMId]: data.agentReady }))
        }
      } catch {
        setAgentReady(prev => ({ ...prev, [selectedVMId]: false }))
      }
    }

    checkAgentHealth()

    const isReady = agentReady[selectedVMId]
    if (!isReady) {
      const healthInterval = setInterval(checkAgentHealth, 5000)
      return () => clearInterval(healthInterval)
    }
  }, [selectedVMId, allMachines, agentReady[selectedVMId ?? ""]])

  const fetchMachines = async () => {
    try {
      setIsLoading(true)
      const response = await fetch("/api/machines")
      if (response.ok) {
        const data = await response.json()
        setAllMachines(data.machines || [])
      }
    } catch (error) {
      console.error("Failed to fetch machines:", error)
    } finally {
      setIsLoading(false)
    }
  }

  const { electronMachines, cloudMachines } = useMemo(() => {
    const electron: UserMachine[] = []
    const cloud: UserMachine[] = []

    for (const m of allMachines) {
      if (m.settings?.provider === "electron") {
        electron.push(m)
      } else if (!m.settings?.isLocal || m.settings?.provider === "docker") {
        if (["running", "creating", "starting", "stopped"].includes(m.status)) {
          cloud.push(m)
        }
      }
    }

    return { electronMachines: electron, cloudMachines: cloud }
  }, [allMachines])

  const getDisplayStatus = (machine: UserMachine): DisplayStatus => {
    if (machine.settings?.provider === "electron") {
      return (machine as any).electronConnected ? "online" : "offline"
    }
    if (machine.status === "running" && agentReady[machine.id] === false) {
      return "initiating"
    }
    return machine.status
  }

  if (!isUserAuthenticated) {
    return null
  }

  const selectedMachine = allMachines.find(m => m.id === selectedVMId)
  const isElectronSelected = selectedMachine?.settings?.provider === "electron"
  const hasAnyMachines = electronMachines.length > 0 || cloudMachines.length > 0

  const handleSelect = (machineId: string) => {
    setSelectedVMId(machineId === "none" ? null : machineId)
    setOpen(false)
  }

  const handleSelectMode = (mode: ViewMode) => {
    setViewMode(mode)
    if (mode === "swarm") {
      if (!isSwarmLocked) onSwarmModeChange?.(true)
    } else if (swarmMode) {
      onSwarmModeChange?.(false)
    }
  }

  // Tracks whichever motion.div is currently mounted (computers or swarm),
  // so the scroll-edge fades follow tab switches automatically.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  const scrollEdges = useScrollEdges(scrollEl)

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            id="vm-selector-button"
            className={cn(
              "inline-flex items-center gap-1.5 h-9 px-3 rounded-full text-xs font-medium transition-all duration-200",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "max-w-[160px] sm:max-w-[280px]",
              swarmActive
                ? "bg-amber-500 hover:bg-amber-600 text-white border border-amber-500 shadow-sm shadow-amber-500/20"
                : "bg-gray-200 hover:bg-gray-300 dark:bg-accent/90 dark:hover:bg-accent/70 border border-gray-300 dark:border-transparent",
              className
            )}
          >
            {swarmActive ? (
              <>
                <GitFork className="h-4 w-4 shrink-0" weight="duotone" />
                <span className="font-semibold">Swarm</span>
                <span className="opacity-80">×</span>
                <span className="font-semibold tabular-nums">{swarmCount}</span>
              </>
            ) : isLoading && !selectedMachine ? (
              <CircleNotch className="h-3.5 w-3.5 animate-spin shrink-0" />
            ) : selectedMachine ? (
              <>
                {isElectronSelected ? (
                  <LocalLaptopIcon className="h-[18px] w-[18px] shrink-0" />
                ) : (
                  <CloudDesktopIcon className="h-[18px] w-[18px] shrink-0" />
                )}
                <StatusDot status={getDisplayStatus(selectedMachine)} />
                <span className="truncate">{selectedMachine.displayName}</span>
              </>
            ) : (
              <>
                <CloudDesktopIcon className="h-[18px] w-[18px] opacity-50 shrink-0" />
                <span className="hidden sm:inline truncate">Select a Computer</span>
                <span className="sm:hidden">Select</span>
              </>
            )}
            <CaretUpDown className={cn("h-3 w-3 shrink-0", swarmActive ? "opacity-70" : "opacity-50")} />
          </button>
        </PopoverTrigger>

        <PopoverContent
          align="start"
          side="top"
          sideOffset={8}
          collisionPadding={12}
          avoidCollisions
          className="w-[calc(100vw-2rem)] max-w-[340px] sm:min-w-[320px] p-0 overflow-hidden rounded-2xl border border-border/60 shadow-2xl flex flex-col max-h-[min(560px,var(--radix-popover-content-available-height,calc(100vh-8rem)))]"
        >
          {/* ── Mode switcher ── */}
          {showSwarmTab && (
            <>
              <div className="p-2.5 shrink-0">
                <div className="relative flex p-1 rounded-full bg-neutral-100 dark:bg-neutral-800/60">
                <motion.div
                  className={cn(
                    "absolute top-1 bottom-1 rounded-full",
                    viewMode === "swarm"
                      ? "bg-amber-500 shadow-sm shadow-amber-500/25"
                      : "bg-white dark:bg-neutral-700 shadow-sm"
                  )}
                  initial={false}
                  animate={{
                    left: viewMode === "computers" ? "4px" : "50%",
                    right: viewMode === "computers" ? "50%" : "4px",
                  }}
                  transition={{ type: "spring", stiffness: 500, damping: 38 }}
                />
                <button
                  type="button"
                  onClick={() => handleSelectMode("computers")}
                  className={cn(
                    "relative z-10 flex-1 flex items-center justify-center gap-1.5 h-7 rounded-full text-xs font-medium transition-colors",
                    viewMode === "computers" ? "text-foreground" : "text-muted-foreground hover:text-foreground/80"
                  )}
                >
                  <Desktop className="size-3.5" weight="duotone" />
                  Computers
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectMode("swarm")}
                  className={cn(
                    "relative z-10 flex-1 flex items-center justify-center gap-1.5 h-7 rounded-full text-xs font-medium transition-colors",
                    viewMode === "swarm" ? "text-white" : "text-muted-foreground hover:text-foreground/80"
                  )}
                >
                  <GitFork className="size-3.5" weight="duotone" />
                  Swarm
                  {isSwarmLocked && <Lock className="size-2.5" weight="fill" />}
                </button>
              </div>
              </div>
              <FadeRule />
            </>
          )}

          {/* ── Body ── */}
          <div className="relative flex-1 min-h-0 flex flex-col">
            <AnimatePresence mode="wait" initial={false}>
              {viewMode === "computers" ? (
                <motion.div
                  key="computers"
                  ref={setScrollEl}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -6 }}
                  transition={{ duration: 0.16, ease: "easeOut" }}
                  className="flex-1 min-h-0 overflow-y-auto overscroll-contain"
                >
                  <ComputersBody
                    cloudMachines={cloudMachines}
                    electronMachines={electronMachines}
                    selectedVMId={selectedVMId}
                    handleSelect={handleSelect}
                    getDisplayStatus={getDisplayStatus}
                    hasAnyMachines={hasAnyMachines}
                    isLoading={isLoading}
                  />
                </motion.div>
              ) : (
                <motion.div
                  key="swarm"
                  ref={setScrollEl}
                  initial={{ opacity: 0, x: 6 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 6 }}
                  transition={{ duration: 0.16, ease: "easeOut" }}
                  className="flex-1 min-h-0 overflow-y-auto overscroll-contain"
                >
                  <SwarmBody
                    isSwarmLocked={isSwarmLocked}
                    swarmCount={swarmCount}
                    onSwarmCountChange={onSwarmCountChange}
                    maxSwarmMachines={maxSwarmMachines}
                    onClose={() => setOpen(false)}
                  />
                </motion.div>
              )}
            </AnimatePresence>
            <ScrollFades top={scrollEdges.top} bottom={scrollEdges.bottom} />
          </div>

          {/* ── Footer ── */}
          {viewMode === "computers" && (
            <>
              <FadeRule />
              <div className="p-2 shrink-0">
              <button
                id="create-machine-button"
                onClick={() => { setOpen(false); setShowCreateDialog(true) }}
                className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-left hover:bg-accent transition-colors"
              >
                <div className="flex items-center justify-center size-7 rounded-md bg-primary/10 shrink-0">
                  <Plus className="h-3.5 w-3.5 text-primary" weight="bold" />
                </div>
                <span className="text-sm font-medium text-primary">Create Machine</span>
              </button>
              </div>
            </>
          )}
        </PopoverContent>
      </Popover>

      <CreateMachineDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onMachineCreated={() => {
          fetchMachines()
          setShowCreateDialog(false)
        }}
      />
    </>
  )
}

// ─────────────────────────────────────────────
// Body components
// ─────────────────────────────────────────────

type ComputersBodyProps = {
  cloudMachines: UserMachine[]
  electronMachines: UserMachine[]
  selectedVMId: string | null
  handleSelect: (id: string) => void
  getDisplayStatus: (m: UserMachine) => DisplayStatus
  hasAnyMachines: boolean
  isLoading: boolean
}

export function ComputersBody({
  cloudMachines,
  electronMachines,
  selectedVMId,
  handleSelect,
  getDisplayStatus,
  hasAnyMachines,
  isLoading,
}: ComputersBodyProps) {
  return (
    <div className="p-2">
      {cloudMachines.length > 0 && (
        <section>
          <SectionHeader
            variant="cloud"
            title="Cloud"
            subtitle="Hosted by Coasty"
          />
          <div className="space-y-0.5">
            {cloudMachines.map((machine, i) => (
              <CloudMachineRow
                key={machine.id}
                machine={machine}
                isSelected={selectedVMId === machine.id}
                status={getDisplayStatus(machine)}
                onClick={() => handleSelect(machine.id)}
                index={i}
              />
            ))}
          </div>
        </section>
      )}

      {cloudMachines.length > 0 && electronMachines.length > 0 && (
        <FadeRule className="my-2.5" />
      )}

      {electronMachines.length > 0 && (
        <section>
          <SectionHeader
            variant="local"
            title="Your Computers"
            subtitle="Connected via the desktop app"
          />
          <div className="space-y-0.5">
            {electronMachines.map((machine, i) => (
              <LocalMachineRow
                key={machine.id}
                machine={machine}
                isSelected={selectedVMId === machine.id}
                status={getDisplayStatus(machine)}
                onClick={() => handleSelect(machine.id)}
                index={i}
              />
            ))}
          </div>
          {electronMachines.every((m) => getDisplayStatus(m) === "offline") && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15, duration: 0.2 }}
              className="mt-1.5 mx-1 flex items-start gap-1.5 px-2.5 py-2 rounded-md bg-muted/40 border border-border/50"
            >
              <WifiSlash className="size-3 mt-0.5 text-muted-foreground/60 shrink-0" weight="bold" />
              <span className="text-[10px] text-muted-foreground/85 leading-relaxed">
                Launch the Coasty desktop app on a device to bring it online here.
              </span>
            </motion.div>
          )}
        </section>
      )}

      {!hasAnyMachines && !isLoading && (
        <div className="py-7 px-3 text-center">
          <motion.div
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 320, damping: 22 }}
            className="mx-auto size-11 rounded-2xl bg-muted/50 flex items-center justify-center mb-2.5"
          >
            <Desktop className="size-5 text-muted-foreground/55" weight="duotone" />
          </motion.div>
          <p className="text-xs font-medium">No computers yet</p>
          <p className="text-[10px] text-muted-foreground/75 mt-1 leading-relaxed max-w-[220px] mx-auto">
            Spin up a cloud machine below or install the desktop app to use this device.
          </p>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────
// Section header with cloud/local variants
// ─────────────────────────────────────────────

type SectionHeaderProps = {
  variant: "cloud" | "local"
  title: string
  subtitle: string
}

export function SectionHeader({ variant, title, subtitle }: SectionHeaderProps) {
  const Icon = variant === "cloud" ? Cloud : House
  return (
    <motion.div
      initial={{ opacity: 0, y: -3 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className="flex items-center gap-1.5 px-3 pt-2 pb-1.5"
    >
      <Icon className="h-3 w-3 text-muted-foreground/60 shrink-0" weight="duotone" />
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold">
        {title}
      </span>
      <span className="text-muted-foreground/35 select-none" aria-hidden="true">·</span>
      <span className="text-[10px] text-muted-foreground/55 truncate">
        {subtitle}
      </span>
    </motion.div>
  )
}

// ─────────────────────────────────────────────
// Cloud machine row
// ─────────────────────────────────────────────

type CloudRowProps = {
  machine: UserMachine
  isSelected: boolean
  status: DisplayStatus
  onClick: () => void
  index: number
}

function CloudMachineRow({ machine, isSelected, status, onClick, index }: CloudRowProps) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      initial={{ opacity: 0, x: -4 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.18, delay: 0.02 * index, ease: "easeOut" }}
      whileTap={{ scale: 0.985 }}
      className={cn(
        "group relative flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg text-left transition-transform duration-150 hover:translate-x-0.5",
        isSelected ? "bg-accent" : "hover:bg-accent/55"
      )}
    >
      <CloudDesktopIcon className="h-7 w-7 shrink-0" />
      <div className="flex-1 min-w-0 flex flex-col">
        <span className="text-sm font-medium truncate leading-tight">{machine.displayName}</span>
        <OsLine machine={machine} />
      </div>
      <RowStatus status={status} />
      <RowAffordance isSelected={isSelected} />
    </motion.button>
  )
}

// ─────────────────────────────────────────────
// Local (Electron) machine row
// ─────────────────────────────────────────────

type LocalRowProps = {
  machine: UserMachine
  isSelected: boolean
  status: DisplayStatus
  onClick: () => void
  index: number
}

function LocalMachineRow({ machine, isSelected, status, onClick, index }: LocalRowProps) {
  const isOnline = status === "online"
  return (
    <motion.button
      type="button"
      onClick={() => isOnline && onClick()}
      disabled={!isOnline}
      initial={{ opacity: 0, x: -4 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.18, delay: 0.02 * index, ease: "easeOut" }}
      whileTap={isOnline ? { scale: 0.985 } : undefined}
      className={cn(
        "group relative flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg text-left transition-transform duration-150",
        isOnline && "hover:translate-x-0.5",
        !isOnline && "cursor-not-allowed opacity-60",
        isSelected ? "bg-accent" : isOnline ? "hover:bg-accent/55" : ""
      )}
    >
      <div className="relative shrink-0">
        <LocalLaptopIcon className="h-7 w-7" />
        <span className="absolute -bottom-0.5 -right-0.5 flex items-center justify-center">
          <AnimatePresence mode="wait" initial={false}>
            {isOnline ? (
              <motion.span
                key="online"
                initial={{ scale: 0, rotate: -45, opacity: 0 }}
                animate={{ scale: 1, rotate: 0, opacity: 1 }}
                exit={{ scale: 0, opacity: 0 }}
                transition={{ type: "spring", stiffness: 520, damping: 22 }}
                className="relative flex"
              >
                <span className="absolute inset-0 rounded-full bg-green-500/40 animate-ping" />
                <WifiHigh className="relative h-2.5 w-2.5 text-green-500" weight="bold" />
              </motion.span>
            ) : (
              <motion.span
                key="offline"
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0, opacity: 0 }}
                transition={{ duration: 0.14, ease: "easeOut" }}
                className="flex"
              >
                <WifiSlash className="h-2.5 w-2.5 text-gray-400" weight="bold" />
              </motion.span>
            )}
          </AnimatePresence>
        </span>
      </div>
      <div className="flex-1 min-w-0 flex flex-col">
        <span className={cn("text-sm font-medium truncate leading-tight", !isOnline && "text-muted-foreground")}>
          {machine.displayName}
        </span>
        <OsLine machine={machine} />
      </div>
      <RowStatus status={status} />
      <RowAffordance isSelected={isSelected} />
    </motion.button>
  )
}

// ─────────────────────────────────────────────
// Shared row pieces
// ─────────────────────────────────────────────

function RowStatus({ status }: { status: DisplayStatus }) {
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <StatusDot status={status} />
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={status}
          initial={{ opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -3 }}
          transition={{ duration: 0.16, ease: "easeOut" }}
          className={cn("text-[10px] font-medium tabular-nums", getStatusStyles(status).text)}
        >
          {getStatusText(status)}
        </motion.span>
      </AnimatePresence>
    </div>
  )
}

function RowAffordance({ isSelected }: { isSelected: boolean }) {
  return (
    <div className="relative size-3.5 shrink-0 flex items-center justify-center">
      <AnimatePresence mode="wait" initial={false}>
        {isSelected ? (
          <motion.span
            key="check"
            initial={{ scale: 0, rotate: -90, opacity: 0 }}
            animate={{ scale: 1, rotate: 0, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 600, damping: 22 }}
            className="absolute inset-0 flex items-center justify-center"
          >
            <Check className="h-3.5 w-3.5 text-primary" weight="bold" />
          </motion.span>
        ) : (
          <motion.span
            key="caret"
            initial={false}
            className="absolute inset-0 flex items-center justify-center text-muted-foreground/45 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-200"
          >
            <CaretRight className="h-3 w-3" weight="bold" />
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  )
}

type SwarmBodyProps = {
  isSwarmLocked: boolean
  swarmCount: number
  onSwarmCountChange?: (n: number) => void
  maxSwarmMachines: number
  onClose: () => void
}

function SwarmBody({
  isSwarmLocked,
  swarmCount,
  onSwarmCountChange,
  maxSwarmMachines,
  onClose,
}: SwarmBodyProps) {
  if (isSwarmLocked) {
    return (
      <div className="p-5 text-center space-y-3">
        <div className="relative mx-auto size-12 rounded-2xl bg-amber-500/10 flex items-center justify-center">
          <GitFork className="size-6 text-amber-500" weight="duotone" />
          <Lock className="size-3 absolute -bottom-0.5 -right-0.5 text-amber-600 bg-background rounded-full p-0.5 box-content" weight="fill" />
        </div>
        <div className="space-y-1">
          <h4 className="text-sm font-semibold tracking-tight">Swarm Mode</h4>
          <p className="text-xs text-muted-foreground leading-relaxed max-w-[260px] mx-auto">
            Run a single prompt across multiple machines in parallel for faster results.
          </p>
        </div>
        <button
          onClick={() => { onClose(); useAccountDialog.getState().open("billing") }}
          className="w-full h-9 rounded-full text-xs font-semibold text-white bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 shadow-sm shadow-amber-500/20 hover:shadow-amber-500/30 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
        >
          Upgrade to unlock
          <ArrowRight className="size-3.5" weight="bold" />
        </button>
        <p className="text-[10px] text-muted-foreground/80">
          Need custom limits?{" "}
          <a href="mailto:founders@coasty.ai" className="text-amber-600 dark:text-amber-400 hover:underline">
            founders@coasty.ai
          </a>
        </p>
      </div>
    )
  }

  const canDecrement = swarmCount > 2
  const canIncrement = swarmCount < maxSwarmMachines

  return (
    <div className="p-4 space-y-4">
      {/* Count meter */}
      <div>
        <div className="flex items-baseline justify-between mb-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold">Machines</span>
          <span className="text-[10px] text-muted-foreground/60 tabular-nums">
            {swarmCount} of {maxSwarmMachines}
          </span>
        </div>

        <div className="flex items-center gap-1 mb-4">
          {Array.from({ length: maxSwarmMachines }).map((_, i) => (
            <div
              key={i}
              className={cn(
                "h-1.5 flex-1 rounded-full transition-all duration-300",
                i < swarmCount
                  ? "bg-amber-500"
                  : "bg-neutral-200 dark:bg-neutral-700/60"
              )}
            />
          ))}
        </div>

        <div className="flex items-center justify-center gap-4">
          <button
            type="button"
            onClick={() => canDecrement && onSwarmCountChange?.(swarmCount - 1)}
            disabled={!canDecrement}
            className="size-9 rounded-full border border-border bg-secondary hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
            aria-label="Decrease machines"
          >
            <Minus className="size-3.5" weight="bold" />
          </button>
          <div className="flex items-baseline gap-1.5 min-w-[88px] justify-center">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={swarmCount}
                initial={{ y: 8, opacity: 0, scale: 0.85 }}
                animate={{ y: 0, opacity: 1, scale: 1 }}
                exit={{ y: -8, opacity: 0, scale: 0.85 }}
                transition={{ type: "spring", stiffness: 480, damping: 26 }}
                className="text-3xl font-semibold tabular-nums tracking-tight text-amber-600 dark:text-amber-400"
              >
                {swarmCount}
              </motion.span>
            </AnimatePresence>
            <span className="text-[11px] text-muted-foreground">parallel</span>
          </div>
          <button
            type="button"
            onClick={() => canIncrement && onSwarmCountChange?.(swarmCount + 1)}
            disabled={!canIncrement}
            className="size-9 rounded-full border border-border bg-secondary hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
            aria-label="Increase machines"
          >
            <Plus className="size-3.5" weight="bold" />
          </button>
        </div>
      </div>

      {/* Hint */}
      <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/[0.06] border border-amber-500/15">
        <Lightning className="size-3.5 text-amber-500 mt-0.5 shrink-0" weight="duotone" />
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Your prompt fans out across {swarmCount} fresh machines and results merge back into one answer.
        </p>
      </div>
    </div>
  )
}
