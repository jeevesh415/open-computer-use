"use client"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { Monitor } from "@phosphor-icons/react"
import type { UserMachine } from "@/types/machines.types"

type ButtonViewScreenProps = {
  machine: UserMachine
  className?: string
}

export function ButtonViewScreen({ machine, className }: ButtonViewScreenProps) {
  const handleClick = () => {
    const websocketPort = machine.websocketPort || 6080
    const vncPw = machine.vncPassword?.substring(0, 8) || ""
    const encodedPassword = encodeURIComponent(vncPw)
    const url = `http://${machine.publicIpAddress}:${websocketPort}/vnc.html?autoconnect=1&resize=scale&password=${encodedPassword}`
    window.open(url, "_blank")
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="sm"
          variant="secondary"
          type="button"
          onClick={handleClick}
          className={cn(
            "border-border dark:bg-secondary size-9 rounded-full border bg-transparent",
            className
          )}
          aria-label="View screen"
        >
          <Monitor className="size-4" weight="duotone" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <div className="text-xs">
          <div className="font-medium">View Screen</div>
          <div className="text-muted-foreground">
            Watch {machine.displayName} live
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
