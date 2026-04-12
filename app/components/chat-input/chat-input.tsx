"use client"

import {
  PromptInput,
  PromptInputAction,
  PromptInputActions,
  PromptInputTextarea,
} from "@/components/prompt-kit/prompt-input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { VMSelector } from "@/components/common/vm-selector/vm-selector"
import { ArrowUpIcon, StopIcon, WarningCircle, CircleNotch, ArrowsClockwise, GitFork, Lock, Lightning, ArrowRight, Monitor } from "@phosphor-icons/react"
import { MacMiniIcon } from "@/components/icons/mac-mini"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card"
import { useCallback, useMemo, useState, useEffect } from "react"
import { useTranslations } from "next-intl"
import { useAccountDialog } from "@/lib/account-dialog-store"
import { PromptSystem } from "../suggestions/prompt-system"
import { AnimatePresence, motion } from "motion/react"
import type { UserMachine } from "@/types/machines.types"
import { themeConfig } from "@/lib/theme-config"
// File upload imports
import { ButtonVMFileUpload } from "./button-vm-file-upload"
import { FileList } from "./file-list"

type ChatInputProps = {
  value: string
  onValueChange: (value: string) => void
  onSend: () => void
  isSubmitting?: boolean
  hasMessages?: boolean
  // File upload props
  files: File[]
  onFileUpload: (files: File[]) => void
  onFileRemove: (file: File) => void
  onSuggestion: (suggestion: string) => void
  hasSuggestions?: boolean
  selectedVMId: string | null
  setSelectedVMId: (vmId: string | null) => void
  isUserAuthenticated: boolean
  stop: () => void
  status?: "submitted" | "streaming" | "ready" | "error"
  onAuthRequired: () => void
  hasToolInvocations?: boolean
  // Swarm mode
  swarmMode?: boolean
  onSwarmModeChange?: (enabled: boolean) => void
  swarmCount?: number
  onSwarmCountChange?: (count: number) => void
  // Subscription tier — determines whether swarm is locked
  userTier?: string | null
  // Max swarm machines (3x plan max_machines, capped at 10)
  maxSwarmMachines?: number
}

// startupMessages is loaded from translations inside the component


// Beautiful VM status bar component
function VMStatusBar({ isVisible, machineName, status, startupMessages, t }: { isVisible: boolean; machineName?: string; status?: string; startupMessages: string[]; t: (key: string, values?: Record<string, string>) => string }) {
  const [messageIndex, setMessageIndex] = useState(() => 
    Math.floor(Math.random() * startupMessages.length)
  )
  
  useEffect(() => {
    if (!isVisible) return
    
    // Change message every 2 seconds
    const interval = setInterval(() => {
      setMessageIndex(prev => (prev + 1) % startupMessages.length)
    }, 2000)
    
    return () => clearInterval(interval)
  }, [isVisible])
  
  if (!isVisible) return null
  
  const getStatusMessage = () => {
    const name = machineName || "computer"
    switch (status) {
      case "creating":
        return t("status.creating", { name })
      case "starting":
      case "stopped": // When stopped but starting
        return `${startupMessages[messageIndex]}...`
      case "initiating":
        return t("status.initiating", { name })
      case "stopping":
        return t("status.stopping", { name })
      default:
        return t("status.preparing", { name })
    }
  }

  const getStatusColor = () => {
    switch (status) {
      case "creating":
        return `bg-${themeConfig.primary.tw.bg.medium} dark:bg-${themeConfig.primary.tw.bg.strong} text-${themeConfig.primary.tw.dark} dark:text-purple-300`
      case "starting":
      case "initiating":
        return "bg-blue-500/10 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300"
      case "stopped":
        return "bg-blue-500/10 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300"
      case "stopping":
        return "bg-orange-500/10 dark:bg-orange-500/20 text-orange-700 dark:text-orange-300"
      default:
        return "bg-gray-500/10 dark:bg-gray-500/20 text-gray-700 dark:text-gray-300"
    }
  }

  const getIconColor = () => {
    switch (status) {
      case "creating":
        return themeConfig.primary.tw.text.base
      case "starting":
      case "initiating":
        return "text-blue-600 dark:text-blue-400"
      case "stopped":
        return "text-blue-600 dark:text-blue-400"
      case "stopping":
        return "text-orange-600 dark:text-orange-400"
      default:
        return "text-gray-600 dark:text-gray-400"
    }
  }
  
  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ type: "spring", duration: 0.5 }}
          className="absolute -top-12 left-0 right-0 z-40"
        >
          <div className="mx-auto max-w-fit">
            <div className={`flex items-center gap-2 px-4 py-2 backdrop-blur-sm rounded-full shadow-lg ${getStatusColor()}`}>
              <CircleNotch className={`h-4 w-4 animate-spin ${getIconColor()}`} />
              <span className="text-sm font-medium">
                {getStatusMessage()}
              </span>
              <MacMiniIcon className={`h-5 w-5 ${getIconColor()}`} />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// Beautiful VM error dialog component (for other error states)
function VMErrorDialog({ isOpen, onClose, t }: { isOpen: boolean; onClose: () => void; t: (key: string) => string }) {
  if (!isOpen) return null
  
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: "spring", duration: 0.3 }}
            className="relative max-w-md w-full bg-background rounded-2xl shadow-2xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col items-center text-center gap-4">
              <div className="relative">
                <div className="absolute inset-0 animate-ping">
                  <WarningCircle className="h-16 w-16 text-red-500/30" />
                </div>
                <WarningCircle className="h-16 w-16 text-red-500" />
              </div>
              
              <div className="space-y-2">
                <h3 className="text-lg font-semibold">{t("vmError.title")}</h3>
                <p className="text-sm text-muted-foreground">
                  {t("vmError.description")}
                </p>
                <p className="text-xs text-muted-foreground mt-3">
                  {t("vmError.hint")}
                </p>
              </div>
              
              <Button
                onClick={onClose}
                className="mt-2 w-full"
                variant="outline"
              >
                {t("vmError.gotIt")}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function ChatInput({
  value,
  onValueChange,
  onSend,
  isSubmitting,
  // File upload props
  files,
  onFileUpload,
  onFileRemove,
  onSuggestion,
  hasSuggestions,
  selectedVMId,
  setSelectedVMId,
  isUserAuthenticated,
  stop,
  status,
  onAuthRequired,
  hasToolInvocations,
  swarmMode,
  onSwarmModeChange,
  swarmCount,
  onSwarmCountChange,
  userTier,
  maxSwarmMachines = 3,
}: ChatInputProps) {
  const t = useTranslations("chatInput")
  const tl = useTranslations()
  const startupMessages = tl.raw("loadingMessages") as string[]
  const isOnlyWhitespace = (text: string) => !/[^\s]/.test(text)
  const isSwarmLocked = !userTier || userTier === "free"
  const [machineStatus, setMachineStatus] = useState<UserMachine['status'] | null>(null)
  const [machineName, setMachineName] = useState<string | null>(null)
  const [showVMError, setShowVMError] = useState(false)
  const [showVMStatusBar, setShowVMStatusBar] = useState(false)
  const [currentMachine, setCurrentMachine] = useState<UserMachine | null>(null)
  const [agentReady, setAgentReady] = useState(false)
  const [isMachineBusy, setIsMachineBusy] = useState(false)
  const [isStoppingMachine, setIsStoppingMachine] = useState(false)

  // Derive isElectronMachine from currentMachine to avoid stale state
  const isElectronMachine = currentMachine?.settings?.provider === 'electron'

  // Reset agentReady and busy state whenever VM selection changes
  useEffect(() => {
    setAgentReady(false)
    setIsMachineBusy(false)
    setIsStoppingMachine(false)
  }, [selectedVMId])

  // Fetch machine status when VM is selected
  useEffect(() => {
    if (selectedVMId && selectedVMId !== "none" && isUserAuthenticated) {
      const fetchMachineStatus = async () => {
        try {
          const response = await fetch("/api/machines")
          if (response.ok) {
            const data = await response.json()
            const machine = data.machines.find((m: UserMachine) => m.id === selectedVMId)
            if (machine) {
              setMachineStatus(machine.status)
              setMachineName(machine.displayName)
              setCurrentMachine(machine)

              const isElectron = machine.settings?.provider === 'electron'

              if (isElectron) {
                // Electron machines: check live connection status via backend
                const isConnected = (machine as any).electronConnected === true
                setAgentReady(isConnected)
                setShowVMStatusBar(false)
                return
              }

              // Show status bar for creating, starting states
              if (machine.status === "creating" || machine.status === "starting") {
                setShowVMStatusBar(true)
              } else if (machine.status === "running") {
                // Machine is running — check if agent is actually ready
                try {
                  const healthRes = await fetch(`/api/machines/${selectedVMId}/agent-health`)
                  if (healthRes.ok) {
                    const healthData = await healthRes.json()
                    setAgentReady(healthData.agentReady)
                    // Show status bar while agent is initiating
                    if (!healthData.agentReady) {
                      setShowVMStatusBar(true)
                    } else {
                      setShowVMStatusBar(false)
                    }
                  }
                } catch {
                  setAgentReady(false)
                  setShowVMStatusBar(true)
                }
              }
            }
          }
        } catch (error) {
          console.error("Failed to fetch machine status:", error)
        }
      }

      fetchMachineStatus()
      // Poll for status updates — 3s when actively provisioning, 10s otherwise
      const interval = setInterval(fetchMachineStatus, showVMStatusBar ? 3000 : 10000)
      return () => clearInterval(interval)
    } else {
      setMachineStatus(null)
      setMachineName(null)
      setCurrentMachine(null)
      setShowVMStatusBar(false)
      setAgentReady(false)

    }
    // NOTE: showVMStatusBar intentionally excluded from deps — it only affects
    // the polling interval, not whether we should poll. Including it caused a
    // cascade: fetch → setState → showVMStatusBar changes → effect re-runs →
    // immediate fetch → repeat, exhausting the hourly rate limit on login.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVMId, isUserAuthenticated])
  

  // Start VM if it's stopped
  const startVMIfNeeded = async (): Promise<boolean> => {
    if (!selectedVMId || selectedVMId === "none") {
      return false // A machine must be selected to send messages
    }
    
    // If machine status hasn't been loaded yet, fetch it but don't allow sending
    if (machineStatus === null) {
      console.log("Machine status not loaded yet, fetching...")
      try {
        const response = await fetch("/api/machines")
        if (response.ok) {
          const data = await response.json()
          const machine = data.machines.find((m: UserMachine) => m.id === selectedVMId)
          if (machine) {
            setMachineStatus(machine.status)
            setMachineName(machine.displayName)
          }
        }
      } catch (error) {
        console.error("Failed to fetch machine status:", error)
      }
      // Don't allow sending — the polling useEffect will update state and re-enable the button
      return false
    }
    
    console.log(`VM Status Check - ID: ${selectedVMId}, Status: ${machineStatus}, Electron: ${isElectronMachine}`)

    // Electron machines: no startup needed — just check if connected
    if (isElectronMachine) {
      return agentReady // true if Electron app is connected, false if offline
    }

    if (machineStatus === "running") {
      if (!agentReady) {
        setShowVMStatusBar(true)
        return false // VM is running but agent is still initiating
      }
      return true // VM is running and agent is ready
    }
    
    if (machineStatus === "creating") {
      setShowVMStatusBar(true)
      return false // VM is being created, don't allow message to be sent
    }
    
    if (machineStatus === "starting") {
      setShowVMStatusBar(true)
      return false // VM is still starting, don't allow message yet
    }
    
    if (machineStatus === "stopped") {
      // Start the VM
      console.log(`Attempting to start VM ${selectedVMId}`)
      setShowVMStatusBar(true)
      try {
        const requestBody = JSON.stringify({ action: "start" })
        console.log(`Sending request body: ${requestBody}`)
        
        const response = await fetch(`/api/machines/${selectedVMId}`, {
          method: "POST",
          headers: { 
            "Content-Type": "application/json",
            "Accept": "application/json"
          },
          body: requestBody
        })
        
        console.log(`Start VM response status: ${response.status}`)
        
        if (response.ok) {
          // VM start initiated, the polling will update the status
          console.log("VM start initiated successfully")
          // Update the local status to starting immediately
          setMachineStatus("starting")
          return false // Don't allow sending yet — wait for running + agent ready
        } else {
          let errorMessage = "Failed to start VM"
          try {
            const errorData = await response.json()
            errorMessage = errorData.error || errorMessage
          } catch {
            // If response is not JSON, try text
            try {
              errorMessage = await response.text() || errorMessage
            } catch {}
          }
          console.error(`Failed to start VM - Status: ${response.status}, Error: ${errorMessage}`)
          setShowVMStatusBar(false)
          // Don't show error dialog for temporary failures, just prevent sending
          return false
        }
      } catch (error) {
        console.error("Failed to start VM - Network error:", error)
        setShowVMStatusBar(false)
        // Don't show error dialog for network issues, just prevent sending
        return false
      }
    }
    
    if (machineStatus === "stopping") {
      // VM is stopping, wait for it to complete then it will be in stopped state
      setShowVMStatusBar(true)
      return false // Don't allow sending while stopping
    }
    
    // Only show error for truly problematic states
    if (machineStatus === "error" || machineStatus === "deleting") {
      setShowVMError(true)
      return false
    }
    
    // For any unknown state, don't allow proceeding
    return false
  }

  // Typing participants removed - no longer collaborative
  const typingParticipants = []

  const checkMachineBusy = useCallback(async (): Promise<boolean> => {
    if (!selectedVMId || selectedVMId === "none") return false
    try {
      const res = await fetch(`/api/chat/machine-status/${selectedVMId}`)
      if (res.ok) {
        const data = await res.json()
        setIsMachineBusy(data.busy)
        return data.busy
      }
    } catch (error) {
      console.error("Failed to check machine busy status:", error)
    }
    return false
  }, [selectedVMId])

  const forceStopAndSend = useCallback(async () => {
    if (isStoppingMachine || !selectedVMId || selectedVMId === "none") return
    setIsStoppingMachine(true)
    try {
      const stopRes = await fetch(`/api/chat/stop-machine/${selectedVMId}`, {
        method: "POST",
      })
      if (stopRes.ok) {
        const data = await stopRes.json()
        if (data.stopped && data.released) {
          // Lock released — small delay to let cleanup finish before new request
          await new Promise(r => setTimeout(r, 300))
          setIsMachineBusy(false)
          onSend()
        } else if (data.stopped && !data.released) {
          // Lock didn't release in time — backend will handle via stale lock replacement
          await new Promise(r => setTimeout(r, 1000))
          setIsMachineBusy(false)
          onSend()
        } else {
          // Machine wasn't actually busy — just send normally
          setIsMachineBusy(false)
          onSend()
        }
      }
    } catch (error) {
      console.error("Failed to stop machine:", error)
    } finally {
      setIsStoppingMachine(false)
    }
  }, [isStoppingMachine, selectedVMId, onSend])

  const handleSend = useCallback(async () => {
    // Allow stopping even if isSubmitting is true
    if (status === "streaming") {
      stop()
      return
    }

    if (isSubmitting) {
      return
    }

    // Check authentication before allowing send
    if (!isUserAuthenticated) {
      onAuthRequired()
      return
    }

    // Swarm mode bypasses VM checks — it creates its own machines
    if (swarmMode) {
      onSend()
      return
    }

    // Start VM if needed and validate
    const canProceed = await startVMIfNeeded()
    if (!canProceed) {
      return
    }

    // Check if machine is busy with another task
    const busy = await checkMachineBusy()
    if (busy) {
      // Don't send — UI will re-render with the "Stop & Start" button
      return
    }

    // Send message - VM ID is already being sent through use-chat-core
    onSend()

  }, [isSubmitting, onSend, status, stop, isUserAuthenticated, onAuthRequired, selectedVMId, machineStatus, agentReady, startVMIfNeeded, checkMachineBusy, swarmMode, isElectronMachine])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (isSubmitting) {
        e.preventDefault()
        return
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        
        // If streaming, stop the stream
        if (status === "streaming") {
          stop()
          return
        }
        
        // Otherwise, check if we can send a new message
        if (isOnlyWhitespace(value)) {
          return
        }
        
        // Check authentication before allowing send via Enter key
        if (!isUserAuthenticated) {
          onAuthRequired()
          return
        }

        // Swarm mode bypasses VM checks
        if (swarmMode) {
          handleSend()
          return
        }

        // Don't allow sending unless machine is running and agent is ready
        if (!selectedVMId || selectedVMId === "none") {
          return
        }

        // If machine is busy, trigger force-stop-and-send
        if (isMachineBusy) {
          forceStopAndSend()
          return
        }

        // Electron: check agentReady directly (no startup sequence)
        // Cloud: check running + agentReady
        const machineReady = isElectronMachine ? agentReady : (machineStatus === "running" && agentReady)
        if (!machineReady) {
          return
        }

        // Handle send with async function
        handleSend()
      }
    },
    [isSubmitting, status, value, isUserAuthenticated, onAuthRequired, handleSend, stop, selectedVMId, machineStatus, agentReady, isMachineBusy, forceStopAndSend, swarmMode, isElectronMachine]
  )

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent) => {
      // File upload feature - only when VM is selected
      const items = e.clipboardData?.items
      if (!items) return

      const hasImageContent = Array.from(items).some((item) =>
        item.type.startsWith("image/")
      )

      // Only allow image paste when authenticated and VM is selected
      if (!isUserAuthenticated || !selectedVMId || selectedVMId === "none") {
        if (hasImageContent) {
          e.preventDefault()
        }
        return
      }

      if (hasImageContent) {
        const imageFiles: File[] = []

        for (const item of Array.from(items)) {
          if (item.type.startsWith("image/")) {
            const file = item.getAsFile()
            if (file) {
              const newFile = new File(
                [file],
                `pasted-image-${Date.now()}.${file.type.split("/")[1]}`,
                { type: file.type }
              )
              imageFiles.push(newFile)
            }
          }
        }

        if (imageFiles.length > 0) {
          onFileUpload(imageFiles)
        }
      }
      // Text pasting will work by default for everyone
    },
    [isUserAuthenticated, onFileUpload, selectedVMId]
  )

  return (
    <>
      <VMErrorDialog isOpen={showVMError} onClose={() => setShowVMError(false)} t={t} />
      <div className="relative flex w-full flex-col gap-4">
        <VMStatusBar isVisible={showVMStatusBar} machineName={machineName || undefined} status={machineStatus === "running" && !agentReady ? "initiating" : (machineStatus || undefined)} startupMessages={startupMessages} t={t} />
      {hasSuggestions && (
        <PromptSystem
          onValueChange={onValueChange}
          onSuggestion={onSuggestion}
          value={value}
        />
      )}
      
      {/* Typing indicators for collaborative rooms - will be implemented with real-time data */}

      <div className="relative order-2 pb-0 sm:pb-2 md:order-1">
        <PromptInput
            className={cn("relative shadow-xl hover:shadow-2xl focus-within:shadow-2xl focus-within:ring-0 !border-0 [&>*]:border-0 transition-all duration-300 z-10 bg-neutral-100 dark:bg-neutral-800 border border-border/50", hasToolInvocations ? "rounded-b-2xl rounded-t-none" : "rounded-2xl")}
            maxHeight={200}
            value={value}
            onValueChange={onValueChange}
          >
          {/* File list - only show when VM is selected */}
          {selectedVMId && selectedVMId !== "none" && (
            <FileList files={files} onFileRemove={onFileRemove} />
          )}
          <PromptInputTextarea
            placeholder={
              selectedVMId && selectedVMId !== "none"
                ? t("placeholder")
                : t("placeholderAlt")
            }
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            className="min-h-[44px] pt-3 px-4 text-base leading-[1.3] sm:text-base md:text-base"
          />
          <PromptInputActions className="mt-5 w-full justify-between px-2 sm:px-3 pb-3">
            <div className="flex gap-1 sm:gap-2 overflow-hidden">
              {!swarmMode && (
                <VMSelector
                  selectedVMId={selectedVMId}
                  setSelectedVMId={setSelectedVMId}
                  isUserAuthenticated={isUserAuthenticated}
                  className="h-9 min-w-0 flex-shrink"
                />
              )}
              {/* Swarm mode toggle — next to machine selector */}
              {onSwarmModeChange && (
                <div className="flex items-center gap-1">
                  <HoverCard openDelay={200} closeDelay={150}>
                    <HoverCardTrigger asChild>
                      <Button
                        size="sm"
                        variant={!isSwarmLocked && swarmMode ? "default" : "secondary"}
                        type="button"
                        onClick={() => !isSwarmLocked && onSwarmModeChange(!swarmMode)}
                        className={cn(
                          "border-border h-9 rounded-full border px-2.5 sm:px-3 transition-all duration-200",
                          isSwarmLocked
                            ? "bg-transparent dark:bg-secondary opacity-70 hover:opacity-100 cursor-default"
                            : swarmMode
                              ? "bg-amber-500 hover:bg-amber-600 text-white border-amber-500"
                              : "bg-transparent dark:bg-secondary"
                        )}
                        aria-label={isSwarmLocked ? t("swarm.upgradeLabel") : swarmMode ? t("swarm.disableLabel") : t("swarm.enableLabel")}
                      >
                        <div className="relative">
                          <GitFork className="size-4 flex-shrink-0" weight={!isSwarmLocked && swarmMode ? "duotone" : "regular"} />
                          {isSwarmLocked && (
                            <Lock className="size-2.5 absolute -bottom-0.5 -right-1 text-amber-500" weight="fill" />
                          )}
                        </div>
                        <span className="hidden sm:inline text-xs ml-1.5">Swarm</span>
                      </Button>
                    </HoverCardTrigger>
                    <HoverCardContent
                      side="top"
                      align="center"
                      sideOffset={8}
                      className="w-[340px] p-0 rounded-xl border border-amber-500/20 dark:border-amber-500/15 !bg-background dark:!bg-neutral-900 shadow-2xl shadow-amber-500/5 overflow-hidden"
                    >
                      {/* Animated graph header */}
                      <div className="relative px-5 pt-5 pb-3 overflow-hidden">
                        <div className="absolute inset-0 bg-gradient-to-b from-amber-500/[0.06] to-transparent dark:from-amber-500/[0.04]" />

                        {/* Mini swarm visualization — animated node graph */}
                        <div className="relative mb-3">
                          <svg viewBox="0 0 300 100" className="w-full h-[80px]" fill="none">
                            {[0, 25, 50, 75, 100].map((y) => (
                              <line key={`grid-${y}`} x1="0" y1={y} x2="300" y2={y} stroke="currentColor" strokeOpacity="0.04" strokeWidth="0.5" />
                            ))}

                            <circle cx="30" cy="50" r="8" className="fill-amber-500/20 stroke-amber-500" strokeWidth="1.5">
                              <animate attributeName="r" values="7;8.5;7" dur="3s" repeatCount="indefinite" />
                            </circle>
                            <circle cx="30" cy="50" r="3" className="fill-amber-500" />

                            {[
                              { x: 120, y: 15 },
                              { x: 120, y: 50 },
                              { x: 120, y: 85 },
                            ].map((target, i) => (
                              <line
                                key={`conn-${i}`}
                                x1="38"
                                y1="50"
                                x2={target.x - 12}
                                y2={target.y}
                                className="stroke-amber-500/40"
                                strokeWidth="1"
                                strokeDasharray="4 3"
                              >
                                <animate attributeName="stroke-dashoffset" values="0;-14" dur={`${1.2 + i * 0.3}s`} repeatCount="indefinite" />
                              </line>
                            ))}

                            {[
                              { x: 120, y: 15, delay: "0s" },
                              { x: 120, y: 50, delay: "0.15s" },
                              { x: 120, y: 85, delay: "0.3s" },
                            ].map((node, i) => (
                              <g key={`machine-${i}`}>
                                <rect x={node.x - 10} y={node.y - 8} width="20" height="16" rx="3" className="fill-amber-500/10 stroke-amber-500/60" strokeWidth="1">
                                  <animate attributeName="opacity" values="0.6;1;0.6" dur="2.5s" begin={node.delay} repeatCount="indefinite" />
                                </rect>
                                <rect x={node.x - 6} y={node.y - 3} width="0" height="2" rx="1" className="fill-amber-400">
                                  <animate attributeName="width" values="0;12;12;0" dur={`${2 + i * 0.5}s`} begin={node.delay} repeatCount="indefinite" />
                                </rect>
                                <rect x={node.x - 6} y={node.y + 1} width="0" height="2" rx="1" className="fill-amber-400/60">
                                  <animate attributeName="width" values="0;8;8;0" dur={`${2.3 + i * 0.4}s`} begin={node.delay} repeatCount="indefinite" />
                                </rect>
                              </g>
                            ))}

                            {[
                              { x1: 130, y1: 15, x2: 200, y2: 15 },
                              { x1: 130, y1: 50, x2: 200, y2: 50 },
                              { x1: 130, y1: 85, x2: 200, y2: 85 },
                            ].map((line, i) => (
                              <line
                                key={`out-${i}`}
                                x1={line.x1}
                                y1={line.y1}
                                x2={line.x2}
                                y2={line.y2}
                                className="stroke-amber-500/30"
                                strokeWidth="1"
                                strokeDasharray="4 3"
                              >
                                <animate attributeName="stroke-dashoffset" values="0;-14" dur={`${1.5 + i * 0.2}s`} repeatCount="indefinite" />
                              </line>
                            ))}

                            {[
                              { x: 200, y: 15, width: 80, speed: "3s" },
                              { x: 200, y: 50, width: 65, speed: "3.5s" },
                              { x: 200, y: 85, width: 90, speed: "2.8s" },
                            ].map((bar, i) => (
                              <g key={`result-${i}`}>
                                <rect x={bar.x} y={bar.y - 5} width="90" height="10" rx="3" className="fill-muted/50 stroke-border/50" strokeWidth="0.5" />
                                <rect x={bar.x + 2} y={bar.y - 3} width="0" height="6" rx="2" className="fill-amber-500/50">
                                  <animate attributeName="width" values={`0;${bar.width};${bar.width}`} dur={bar.speed} repeatCount="indefinite" />
                                </rect>
                                <circle cx={bar.x + 82} cy={bar.y} r="0" className="fill-green-500/70">
                                  <animate attributeName="r" values="0;0;0;3.5;3.5" dur={bar.speed} repeatCount="indefinite" />
                                </circle>
                              </g>
                            ))}

                            <text x="30" y="72" textAnchor="middle" className="fill-muted-foreground text-[7px]" fontFamily="system-ui" opacity="0.6">Prompt</text>
                            <text x="120" y="105" textAnchor="middle" className="fill-muted-foreground text-[7px]" fontFamily="system-ui" opacity="0.6">Machines</text>
                            <text x="245" y="105" textAnchor="middle" className="fill-muted-foreground text-[7px]" fontFamily="system-ui" opacity="0.6">Parallel tasks</text>
                          </svg>
                        </div>

                        <div className="relative flex items-center gap-2 mb-1">
                          <div className="flex items-center justify-center size-6 rounded-md bg-amber-500/15">
                            <GitFork className="size-3.5 text-amber-500" weight="duotone" />
                          </div>
                          <h4 className="text-sm font-semibold tracking-tight">{t("swarm.title")}</h4>
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">{t("swarm.pro")}</span>
                        </div>
                      </div>

                      {/* Feature list */}
                      <div className="px-5 pb-2">
                        <p className="text-xs text-muted-foreground leading-relaxed mb-3">
                          {t("swarm.description")}
                        </p>
                        <div className="space-y-2">
                          {[
                            { icon: Lightning, text: t("swarm.feature1") },
                            { icon: GitFork, text: t("swarm.feature2") },
                            { icon: Monitor, text: t("swarm.feature3") },
                          ].map((feature, i) => (
                            <div key={i} className="flex items-center gap-2.5">
                              <div className="flex items-center justify-center size-5 rounded bg-amber-500/10 flex-shrink-0">
                                <feature.icon className="size-3 text-amber-500" weight="duotone" />
                              </div>
                              <span className="text-[11px] text-muted-foreground">{feature.text}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Footer — differs by tier */}
                      {isSwarmLocked ? (
                        <div className="px-4 pb-4 pt-3 space-y-2">
                          <button
                            onClick={() => useAccountDialog.getState().open("billing")}
                            className="flex items-center justify-center gap-2 w-full h-9 rounded-lg text-xs font-semibold text-white bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 shadow-sm shadow-amber-500/20 hover:shadow-amber-500/30 transition-all duration-200 active:scale-[0.98]"
                          >
                            Upgrade to unlock Swarm
                            <ArrowRight className="size-3.5" weight="bold" />
                          </button>
                          <p className="text-[10px] text-muted-foreground text-center">
                            Need custom limits?{" "}
                            <a href="mailto:founders@coasty.ai" className="text-amber-600 dark:text-amber-400 hover:underline">founders@coasty.ai</a>
                          </p>
                        </div>
                      ) : (
                        <div className="px-4 pb-4 pt-3">
                          <button
                            onClick={() => onSwarmModeChange(!swarmMode)}
                            className={cn(
                              "flex items-center justify-center gap-2 w-full h-9 rounded-lg text-xs font-semibold transition-all duration-200 active:scale-[0.98]",
                              swarmMode
                                ? "text-amber-700 dark:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20"
                                : "text-white bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 shadow-sm shadow-amber-500/20 hover:shadow-amber-500/30"
                            )}
                          >
                            <GitFork className="size-3.5" weight="duotone" />
                            {swarmMode ? t("swarm.disableLabel") : t("swarm.enableLabel")}
                          </button>
                        </div>
                      )}
                    </HoverCardContent>
                  </HoverCard>
                  {/* Machine count controls — visible when swarm is active */}
                  {!isSwarmLocked && swarmMode && onSwarmCountChange && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center gap-0.5 h-9 rounded-full border border-amber-500/40 bg-amber-500/10 px-1">
                          <button
                            type="button"
                            onClick={() => onSwarmCountChange(Math.max(2, (swarmCount || 2) - 1))}
                            className="size-6 rounded-full flex items-center justify-center text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 transition-colors text-sm font-medium"
                            aria-label={t("swarm.decreaseMachines")}
                          >
                            −
                          </button>
                          <span className="text-xs font-semibold text-amber-600 dark:text-amber-400 min-w-[2ch] text-center tabular-nums">
                            {swarmCount || 2}
                          </span>
                          <button
                            type="button"
                            onClick={() => onSwarmCountChange(Math.min(maxSwarmMachines, (swarmCount || 2) + 1))}
                            className="size-6 rounded-full flex items-center justify-center text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 transition-colors text-sm font-medium"
                            aria-label={t("swarm.increaseMachines")}
                          >
                            +
                          </button>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-[240px] text-center">
                        {t("swarm.machineLimit", { max: String(maxSwarmMachines) })}
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
              )}
              {/* File upload feature - only show when VM is selected and not in swarm mode */}
              {selectedVMId && selectedVMId !== "none" && !swarmMode && (
                <ButtonVMFileUpload
                  onFileUpload={onFileUpload}
                  isUserAuthenticated={isUserAuthenticated}
                  vmName={machineName || undefined}
                />
              )}
            </div>
            <PromptInputAction
              tooltip={
                status === "streaming" ? t("buttons.stop") :
                swarmMode ? t("buttons.sendToSwarm") :
                isMachineBusy ? t("buttons.taskRunning") :
                (!selectedVMId || selectedVMId === "none") ? t("buttons.selectComputer") :
                (machineStatus === "creating") ? t("buttons.waitCreating") :
                (machineStatus === "starting" || machineStatus === "stopped") ? t("buttons.waitStarting") :
                (machineStatus === "running" && !agentReady) ? t("buttons.waitAgent") :
                (machineStatus === "stopping") ? t("buttons.vmStopping") :
                t("buttons.send")
              }
            >
              {isMachineBusy && value && !isOnlyWhitespace(value) && status !== "streaming" ? (
                <Button
                  size="sm"
                  className="h-9 rounded-full transition-all duration-300 ease-out px-2.5 sm:px-3 gap-1.5 bg-amber-600 hover:bg-amber-700 text-white border-0"
                  disabled={isStoppingMachine}
                  type="button"
                  onClick={forceStopAndSend}
                  aria-label={t("buttons.stopLabel")}
                >
                  {isStoppingMachine ? (
                    <CircleNotch className="size-4 shrink-0 animate-spin" />
                  ) : (
                    <ArrowsClockwise className="size-4 shrink-0" />
                  )}
                  <span className="text-xs font-medium hidden sm:inline whitespace-nowrap">
                    {isStoppingMachine ? t("buttons.switching") : t("buttons.overrideRun")}
                  </span>
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="size-9 rounded-full transition-all duration-300 ease-out"
                  disabled={status === "streaming" ? false : (!!(!value || isSubmitting || isOnlyWhitespace(value) || (!swarmMode && (!selectedVMId || selectedVMId === "none" || machineStatus !== "running" || !agentReady))))}
                  type="button"
                  onClick={handleSend}
                  aria-label={status === "streaming" ? t("buttons.stop") : t("buttons.sendLabel")}
                >
                  {status === "streaming" ? (
                    <StopIcon className="size-4" />
                  ) : (
                    <ArrowUpIcon className="size-4" />
                  )}
                </Button>
              )}
            </PromptInputAction>
          </PromptInputActions>
        </PromptInput>
      </div>
      </div>
    </>
  )
}
