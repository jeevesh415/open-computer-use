"use client"

import { useState, useEffect, useMemo } from "react"
import type { UserMachine } from "@/types/machines.types"

export interface MachineStats {
  running: number
  stopped: number
  creating: number
  total: number
}

/**
 * Isolated hook for machine polling. Keeps machine state separate
 * so 15s polling doesn't re-render the entire sidebar — only the
 * component that calls this hook re-renders.
 */
export function useSidebarMachines(user: { id: string } | null | undefined) {
  const [machines, setMachines] = useState<UserMachine[]>([])

  useEffect(() => {
    if (!user) return

    let cancelled = false

    const fetchMachines = async () => {
      try {
        const res = await fetch("/api/machines")
        if (res.ok && !cancelled) {
          const data = await res.json()
          setMachines(data.machines || [])
        }
      } catch {
        /* silent */
      }
    }

    fetchMachines()
    const interval = setInterval(fetchMachines, 15_000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [user])

  const stats = useMemo<MachineStats>(() => {
    const running = machines.filter(
      (m) => m.status === "running" || (m as any).electronConnected
    ).length
    const stopped = machines.filter((m) => m.status === "stopped").length
    const creating = machines.filter((m) =>
      ["creating", "starting"].includes(m.status)
    ).length
    const total = machines.length
    return { running, stopped, creating, total }
  }, [machines])

  return { machines, stats }
}
