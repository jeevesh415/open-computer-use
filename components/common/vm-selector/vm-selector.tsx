"use client"

import { useState, useEffect, useMemo } from "react"
import { CircleNotch, Plus, Desktop, Laptop, WifiHigh, WifiSlash, Monitor, ArrowSquareOut, Check } from "@phosphor-icons/react"
import { MacMiniIcon } from "@/components/icons/mac-mini"
import { WindowsIcon, AppleIcon, LinuxIcon } from "@/components/icons/platform-icons"
import { cn } from "@/lib/utils"
import type { UserMachine } from "@/types/machines.types"
import { CreateMachineDialog } from "@/app/components/machines/create-machine-dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { CaretUpDown } from "@phosphor-icons/react"

interface VMSelectorProps {
  selectedVMId: string | null
  setSelectedVMId: (vmId: string | null) => void
  isUserAuthenticated: boolean
  className?: string
}

type DisplayStatus = UserMachine['status'] | 'initiating' | 'online' | 'offline'

function getStatusStyles(status: DisplayStatus) {
  switch (status) {
    case 'running':
    case 'online':
      return {
        bg: 'bg-green-500/10',
        text: 'text-green-700 dark:text-green-400',
        border: 'border-green-500/20',
        dot: 'bg-green-500',
      }
    case 'creating':
      return {
        bg: 'bg-yellow-500/10',
        text: 'text-yellow-700 dark:text-yellow-400',
        border: 'border-yellow-500/20',
        dot: 'bg-yellow-500',
      }
    case 'starting':
    case 'initiating':
      return {
        bg: 'bg-blue-500/10',
        text: 'text-blue-700 dark:text-blue-400',
        border: 'border-blue-500/20',
        dot: 'bg-blue-500',
      }
    case 'stopping':
      return {
        bg: 'bg-orange-500/10',
        text: 'text-orange-700 dark:text-orange-400',
        border: 'border-orange-500/20',
        dot: 'bg-orange-500',
      }
    case 'stopped':
    case 'offline':
      return {
        bg: 'bg-gray-500/10',
        text: 'text-gray-700 dark:text-gray-400',
        border: 'border-gray-500/20',
        dot: 'bg-gray-400',
      }
    case 'error':
    case 'deleting':
      return {
        bg: 'bg-red-500/10',
        text: 'text-red-700 dark:text-red-400',
        border: 'border-red-500/20',
        dot: 'bg-red-500',
      }
    default:
      return {
        bg: 'bg-gray-500/10',
        text: 'text-gray-700 dark:text-gray-400',
        border: 'border-gray-500/20',
        dot: 'bg-gray-400',
      }
  }
}

function getStatusText(status: DisplayStatus) {
  switch (status) {
    case 'running': return 'Running'
    case 'online': return 'Online'
    case 'creating': return 'Creating'
    case 'starting': return 'Starting'
    case 'initiating': return 'Initiating'
    case 'stopping': return 'Stopping'
    case 'stopped': return 'Stopped'
    case 'offline': return 'Offline'
    case 'error': return 'Error'
    case 'deleting': return 'Deleting'
    default: return 'Unknown'
  }
}

function StatusDot({ status }: { status: DisplayStatus }) {
  const styles = getStatusStyles(status)
  const isAnimated = status === 'running' || status === 'online' || status === 'starting' || status === 'creating' || status === 'initiating'
  return (
    <span className="relative flex h-2 w-2 shrink-0">
      {isAnimated && (
        <span className={cn("absolute inline-flex h-full w-full rounded-full opacity-40 animate-ping", styles.dot)} />
      )}
      <span className={cn("relative inline-flex h-2 w-2 rounded-full", styles.dot)} />
    </span>
  )
}

function OsTag({ machine }: { machine: UserMachine }) {
  const platform = machine.settings?.platform
  const osType = machine.settings?.osType
  const provider = machine.settings?.provider

  let Icon: typeof WindowsIcon | null = null
  let label = ""

  if (platform === "win32" || osType === "windows") {
    Icon = WindowsIcon
    label = "Win"
  } else if (platform === "darwin") {
    Icon = AppleIcon
    label = "Mac"
  } else if (platform === "linux" || osType === "linux" || provider === "aws" || provider === "azure" || provider === "docker") {
    Icon = LinuxIcon
    label = "Linux"
  }

  if (!Icon) return null

  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border/40 bg-foreground/[0.03] px-1.5 py-0.5 shrink-0">
      <Icon className="h-2.5 w-2.5 text-muted-foreground/70" />
      <span className="text-[10px] font-medium text-muted-foreground/80">{label}</span>
    </span>
  )
}

function canViewScreen(machine: UserMachine): boolean {
  return (
    machine.status === "running" &&
    !!machine.publicIpAddress &&
    machine.settings?.provider !== "electron"
  )
}

function openMachineScreen(machine: UserMachine) {
  const websocketPort = machine.websocketPort || 6080
  const vncPw = machine.vncPassword?.substring(0, 8) || ''
  const encodedPassword = encodeURIComponent(vncPw)
  const url = `http://${machine.publicIpAddress}:${websocketPort}/vnc.html?autoconnect=1&resize=scale&password=${encodedPassword}`
  window.open(url, '_blank')
}

export function VMSelector({
  selectedVMId,
  setSelectedVMId,
  isUserAuthenticated,
  className,
}: VMSelectorProps) {
  const [allMachines, setAllMachines] = useState<UserMachine[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [agentReady, setAgentReady] = useState<Record<string, boolean>>({})
  const [open, setOpen] = useState(false)

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
      if (m.settings?.provider === 'electron') {
        electron.push(m)
      } else if (!m.settings?.isLocal || m.settings?.provider === 'docker') {
        if (['running', 'creating', 'starting', 'stopped'].includes(m.status)) {
          cloud.push(m)
        }
      }
    }

    return { electronMachines: electron, cloudMachines: cloud }
  }, [allMachines])

  const getDisplayStatus = (machine: UserMachine): DisplayStatus => {
    if (machine.settings?.provider === 'electron') {
      return (machine as any).electronConnected ? 'online' : 'offline'
    }
    if (machine.status === "running" && agentReady[machine.id] === false) {
      return 'initiating'
    }
    return machine.status
  }

  if (!isUserAuthenticated) {
    return null
  }

  const selectedMachine = allMachines.find(m => m.id === selectedVMId)
  const isElectronSelected = selectedMachine?.settings?.provider === 'electron'
  const hasAnyMachines = electronMachines.length > 0 || cloudMachines.length > 0

  const handleSelect = (machineId: string) => {
    setSelectedVMId(machineId === "none" ? null : machineId)
    setOpen(false)
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            id="vm-selector-button"
            className={cn(
              "inline-flex items-center gap-1.5 h-9 px-3 rounded-full text-xs font-medium transition-colors",
              "bg-gray-200 hover:bg-gray-300 dark:bg-accent/90 dark:hover:bg-accent/70",
              "border border-gray-300 dark:border-0",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "max-w-[140px] sm:max-w-[280px]",
              className
            )}
          >
            {isLoading ? (
              <CircleNotch className="h-3.5 w-3.5 animate-spin shrink-0" />
            ) : selectedMachine ? (
              <>
                {isElectronSelected ? (
                  <Laptop className="h-4 w-4 shrink-0" weight="duotone" />
                ) : (
                  <MacMiniIcon className="h-4 w-4 shrink-0" />
                )}
                <StatusDot status={getDisplayStatus(selectedMachine)} />
                <span className="truncate">{selectedMachine.displayName}</span>
              </>
            ) : (
              <>
                <MacMiniIcon className="h-4 w-4 opacity-50 shrink-0" />
                <span className="hidden sm:inline truncate">Select a Computer</span>
                <span className="sm:hidden">Select</span>
              </>
            )}
            <CaretUpDown className="h-3 w-3 shrink-0 opacity-50" />
          </button>
        </PopoverTrigger>

        <PopoverContent
          align="start"
          sideOffset={6}
          className="w-[calc(100vw-2rem)] max-w-[340px] sm:min-w-[300px] p-0 overflow-hidden"
        >
          {/* ── Selected machine quick actions ── */}
          {selectedMachine && canViewScreen(selectedMachine) && (
            <div className="px-2 pt-2 pb-1">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  openMachineScreen(selectedMachine)
                }}
                className={cn(
                  "flex items-center gap-2.5 w-full px-3 py-2.5 rounded-lg text-left transition-all duration-150",
                  "bg-gradient-to-r from-blue-500/10 to-indigo-500/10 hover:from-blue-500/15 hover:to-indigo-500/15",
                  "dark:from-blue-500/15 dark:to-indigo-500/15 dark:hover:from-blue-500/20 dark:hover:to-indigo-500/20",
                  "border border-blue-500/15 dark:border-blue-400/15",
                  "group"
                )}
              >
                <div className="flex items-center justify-center size-8 rounded-lg bg-blue-500/15 dark:bg-blue-400/15 shrink-0 group-hover:bg-blue-500/25 transition-colors">
                  <Monitor className="size-4 text-blue-600 dark:text-blue-400" weight="duotone" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-foreground">View Screen</div>
                  <div className="text-[10px] text-muted-foreground truncate">
                    Watch {selectedMachine.displayName} live
                  </div>
                </div>
                <ArrowSquareOut className="size-3.5 text-blue-500/60 dark:text-blue-400/60 shrink-0 group-hover:text-blue-500 transition-colors" weight="bold" />
              </button>
            </div>
          )}

          {/* ── Machine list ── */}
          <div className="p-2 max-h-[320px] overflow-y-auto">
            {/* Create Machine */}
            <button
              id="create-machine-button"
              onClick={() => { setOpen(false); setShowCreateDialog(true) }}
              className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-left hover:bg-primary/5 transition-colors mb-1"
            >
              <div className="flex items-center justify-center size-7 rounded-md bg-primary/10 shrink-0">
                <Plus className="h-3.5 w-3.5 text-primary" weight="bold" />
              </div>
              <span className="text-sm font-medium text-primary">Create Machine</span>
            </button>

            {/* Cloud Machines */}
            {cloudMachines.length > 0 && (
              <>
                {electronMachines.length > 0 && (
                  <div className="flex items-center gap-1.5 px-3 pt-2 pb-1">
                    <Desktop className="h-3 w-3 text-muted-foreground/60" weight="duotone" />
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold">Cloud</span>
                  </div>
                )}
                {cloudMachines.map((machine) => {
                  const displayStatus = getDisplayStatus(machine)
                  const isSelected = selectedVMId === machine.id
                  return (
                    <button
                      key={machine.id}
                      onClick={() => handleSelect(machine.id)}
                      className={cn(
                        "flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-left transition-colors",
                        isSelected ? "bg-accent" : "hover:bg-accent/50"
                      )}
                    >
                      <div className="relative shrink-0">
                        <MacMiniIcon className="h-5 w-5" />
                      </div>
                      <div className="flex-1 min-w-0 flex items-center gap-1.5">
                        <span className="text-sm font-medium truncate">{machine.displayName}</span>
                        <OsTag machine={machine} />
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <StatusDot status={displayStatus} />
                        <span className={cn("text-[10px] font-medium", getStatusStyles(displayStatus).text)}>
                          {getStatusText(displayStatus)}
                        </span>
                      </div>
                      {isSelected && <Check className="h-3.5 w-3.5 shrink-0 text-primary" weight="bold" />}
                    </button>
                  )
                })}
              </>
            )}

            {/* Separator */}
            {electronMachines.length > 0 && cloudMachines.length > 0 && (
              <div className="my-1.5 border-t border-border/50" />
            )}

            {/* Electron (Your Computers) */}
            {electronMachines.length > 0 && (
              <>
                <div className="flex items-center gap-1.5 px-3 pt-2 pb-1">
                  <Laptop className="h-3 w-3 text-muted-foreground/60" weight="duotone" />
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold">Your Computers</span>
                </div>
                {electronMachines.map((machine) => {
                  const displayStatus = getDisplayStatus(machine)
                  const isOnline = displayStatus === 'online'
                  const isSelected = selectedVMId === machine.id
                  return (
                    <button
                      key={machine.id}
                      onClick={() => isOnline && handleSelect(machine.id)}
                      disabled={!isOnline}
                      className={cn(
                        "flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-left transition-colors",
                        !isOnline && "opacity-50 cursor-not-allowed",
                        isSelected ? "bg-accent" : isOnline ? "hover:bg-accent/50" : ""
                      )}
                    >
                      <div className="relative shrink-0">
                        <Laptop className="h-5 w-5" weight="duotone" />
                        {isOnline ? (
                          <WifiHigh className="h-2.5 w-2.5 text-green-500 absolute -bottom-0.5 -right-0.5" weight="bold" />
                        ) : (
                          <WifiSlash className="h-2.5 w-2.5 text-gray-400 absolute -bottom-0.5 -right-0.5" weight="bold" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0 flex items-center gap-1.5">
                        <span className={cn("text-sm font-medium truncate", !isOnline && "text-muted-foreground")}>
                          {machine.displayName}
                        </span>
                        <OsTag machine={machine} />
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <StatusDot status={displayStatus} />
                        <span className={cn("text-[10px] font-medium", getStatusStyles(displayStatus).text)}>
                          {getStatusText(displayStatus)}
                        </span>
                      </div>
                      {isSelected && <Check className="h-3.5 w-3.5 shrink-0 text-primary" weight="bold" />}
                    </button>
                  )
                })}
              </>
            )}

            {!hasAnyMachines && !isLoading && (
              <div className="py-4 px-3 text-center">
                <p className="text-xs text-muted-foreground">No computers available</p>
                <p className="text-[10px] text-muted-foreground/70 mt-0.5">Install the desktop app or create a cloud machine</p>
              </div>
            )}
          </div>
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
