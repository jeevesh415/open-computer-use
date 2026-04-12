"use client"

import { useState, useEffect, useCallback } from "react"
import { motion, AnimatePresence } from "motion/react"
import { ShieldCheck, ShieldWarning, X, Check, CaretDown } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface PendingApproval {
  id: string
  command: string
  parameters: any
  created_at: number
}

interface RemoteApprovalProps {
  machineId: string | null
  isElectronMachine?: boolean
}

// Commands that are likely safe (informational about the context)
const LOW_RISK_COMMANDS = new Set([
  "screenshot", "browser_state", "browser_info", "file_read",
  "file_exists", "directory_list", "terminal_read", "list_windows",
  "browser_get_dom", "browser_get_clickables", "browser_list_tabs",
])

function getRiskLevel(command: string): "low" | "medium" | "high" {
  if (LOW_RISK_COMMANDS.has(command)) return "low"
  if (command.startsWith("browser_")) return "medium"
  if (["click", "double_click", "type", "key_press", "key_combo", "drag", "scroll"].includes(command)) return "high"
  if (command.startsWith("file_write") || command.startsWith("file_delete") || command.startsWith("terminal_execute")) return "high"
  return "medium"
}

function getRiskColor(risk: "low" | "medium" | "high") {
  switch (risk) {
    case "low": return "border-green-500/30 bg-green-500/5"
    case "medium": return "border-amber-500/30 bg-amber-500/5"
    case "high": return "border-red-500/30 bg-red-500/5"
  }
}

function formatCommand(command: string): string {
  return command.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase())
}

function formatParams(params: any): string | null {
  if (!params || typeof params !== "object") return null
  const parts: string[] = []
  if (params.text) parts.push(`Text: "${params.text.slice(0, 50)}${params.text.length > 50 ? '...' : ''}"`)
  if (params.url) parts.push(`URL: ${params.url.slice(0, 60)}`)
  if (params.path) parts.push(`Path: ${params.path}`)
  if (params.command) parts.push(`Cmd: ${params.command.slice(0, 60)}`)
  if (params.x !== undefined && params.y !== undefined) parts.push(`Position: (${params.x}, ${params.y})`)
  if (params.selector) parts.push(`Selector: ${params.selector.slice(0, 40)}`)
  if (params.key) parts.push(`Key: ${params.key}`)
  if (params.keys) parts.push(`Keys: ${params.keys}`)
  return parts.length > 0 ? parts.join(" | ") : null
}

export function RemoteApproval({ machineId, isElectronMachine }: RemoteApprovalProps) {
  const [approvals, setApprovals] = useState<PendingApproval[]>([])
  const [responding, setResponding] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(true)
  const [authFailed, setAuthFailed] = useState(false)

  // Only poll for Electron machines — cloud VMs don't use this approval flow
  useEffect(() => {
    if (!machineId || !isElectronMachine || authFailed) {
      setApprovals([])
      return
    }

    let active = true

    const fetchApprovals = async () => {
      if (!active) return
      try {
        const res = await fetch(`/api/electron/machines/${machineId}/approvals`)
        if (!active) return
        if (res.ok) {
          const data = await res.json()
          setApprovals(data.approvals || [])
        } else if (res.status === 401 || res.status === 403) {
          // Stop polling on auth failure to avoid log spam
          setAuthFailed(true)
          setApprovals([])
        }
      } catch {
        // Ignore network errors
      }
    }

    fetchApprovals()
    const interval = setInterval(fetchApprovals, 3000)
    return () => { active = false; clearInterval(interval) }
  }, [machineId, isElectronMachine, authFailed])

  // Reset auth failure when machine changes
  useEffect(() => {
    setAuthFailed(false)
  }, [machineId])

  const respond = useCallback(async (approvalId: string, approved: boolean, reason?: string) => {
    if (!machineId || responding) return
    setResponding(approvalId)
    try {
      await fetch(`/api/electron/machines/${machineId}/approvals/${approvalId}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved, reason }),
      })
      // Remove from local state immediately
      setApprovals(prev => prev.filter(a => a.id !== approvalId))
    } catch (error) {
      console.error("Failed to respond to approval:", error)
    } finally {
      setResponding(null)
    }
  }, [machineId, responding])

  if (approvals.length === 0) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 10 }}
        className="w-full"
      >
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 overflow-hidden">
          {/* Header */}
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-amber-700 dark:text-amber-400 hover:bg-amber-500/10 transition-colors"
          >
            <ShieldWarning className="h-4 w-4 shrink-0" weight="duotone" />
            <span className="flex-1 text-left">
              {approvals.length} action{approvals.length !== 1 ? 's' : ''} awaiting approval
            </span>
            <CaretDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} />
          </button>

          {/* Approval items */}
          {expanded && (
            <div className="border-t border-amber-500/20 divide-y divide-amber-500/10">
              {approvals.map((approval) => {
                const risk = getRiskLevel(approval.command)
                const paramInfo = formatParams(approval.parameters)
                const isResponding = responding === approval.id

                return (
                  <div
                    key={approval.id}
                    className={cn("px-3 py-2.5 space-y-2", getRiskColor(risk))}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-0.5 min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          {risk === "high" ? (
                            <ShieldWarning className="h-3.5 w-3.5 text-red-500 shrink-0" weight="fill" />
                          ) : (
                            <ShieldCheck className="h-3.5 w-3.5 text-amber-500 shrink-0" weight="fill" />
                          )}
                          <span className="text-sm font-medium">
                            {formatCommand(approval.command)}
                          </span>
                        </div>
                        {paramInfo && (
                          <p className="text-[11px] text-muted-foreground truncate ml-5">
                            {paramInfo}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs text-red-600 hover:text-red-700 hover:bg-red-500/10"
                          onClick={() => respond(approval.id, false, "Denied from remote")}
                          disabled={isResponding}
                        >
                          <X className="h-3.5 w-3.5 mr-1" />
                          Deny
                        </Button>
                        <Button
                          size="sm"
                          className="h-7 px-2 text-xs bg-green-600 hover:bg-green-700 text-white"
                          onClick={() => respond(approval.id, true)}
                          disabled={isResponding}
                        >
                          <Check className="h-3.5 w-3.5 mr-1" />
                          Allow
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
