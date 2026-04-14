"use client"

import { cn } from "@/lib/utils"
import type { SourceUIPart } from "@ai-sdk/ui-utils"
import { ArrowUpRight, Globe } from "@phosphor-icons/react"
import Image from "next/image"
import { useState } from "react"
import { addUTM, getFavicon } from "./utils"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"

type SourcesListProps = {
  sources: SourceUIPart["source"][]
  className?: string
}

export function SourcesList({ sources, className }: SourcesListProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [failedFavicons, setFailedFavicons] = useState<Set<string>>(new Set())

  const handleFaviconError = (url: string) => {
    setFailedFavicons((prev) => new Set(prev).add(url))
  }

  const getDomain = (url: string) => {
    try {
      return new URL(url).hostname.replace("www.", "")
    } catch {
      return url
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <div className={cn("px-5 py-1.5", className)}>
        <DialogTrigger asChild>
          <button
            type="button"
            className="group flex w-full items-center gap-2.5 rounded-lg px-3 py-2 transition-colors duration-150 ease-out hover:bg-foreground/[0.04]"
          >
            <div className="flex -space-x-1.5 flex-shrink-0">
              {sources.slice(0, 4).map((source, index) => {
                const faviconUrl = getFavicon(source.url)
                const showFallback = !faviconUrl || failedFavicons.has(source.url)
                return (
                  <div
                    key={`favicon-${source.id || source.url}-${index}`}
                    className="relative h-4 w-4 rounded-full border border-background flex-shrink-0 overflow-hidden bg-muted"
                  >
                    {showFallback ? (
                      <div className="h-full w-full bg-muted" />
                    ) : (
                      <Image
                        src={faviconUrl}
                        alt=""
                        width={16}
                        height={16}
                        className="h-full w-full object-cover"
                        onError={() => handleFaviconError(source.url)}
                      />
                    )}
                  </div>
                )
              })}
            </div>
            <span className="text-[13px] text-muted-foreground/70 group-hover:text-foreground transition-colors duration-150">
              {sources.length} source{sources.length !== 1 ? "s" : ""}
            </span>
          </button>
        </DialogTrigger>
      </div>

      <DialogContent
        className="max-h-[80vh] w-full max-w-md overflow-hidden p-0 gap-0"
        hasCloseButton={false}
      >
        <DialogHeader className="px-5 pt-5 pb-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-[15px] font-medium text-foreground">
              Sources
            </DialogTitle>
            <span className="text-xs tabular-nums text-muted-foreground/60">
              {sources.length}
            </span>
          </div>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(80vh-4rem)]">
          <div className="px-5 pb-5 pt-3">
            {sources.map((source, idx) => {
              const faviconUrl = getFavicon(source.url)
              const showFallback = !faviconUrl || failedFavicons.has(source.url)
              const domain = getDomain(source.url)

              return (
                <a
                  key={source.id || `${source.url}-${idx}`}
                  href={addUTM(source.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    "group flex items-center gap-3 py-2.5 transition-colors duration-150 ease-out hover:bg-foreground/[0.03] -mx-2 px-2 rounded-md",
                    idx !== sources.length - 1 && "border-b border-border/30 dark:border-white/[0.05]"
                  )}
                >
                  <div className="relative h-7 w-7 flex-shrink-0 overflow-hidden rounded-md bg-muted">
                    {showFallback ? (
                      <div className="flex h-full w-full items-center justify-center text-[10px] font-medium text-muted-foreground/50">
                        {domain.charAt(0).toUpperCase()}
                      </div>
                    ) : (
                      <Image
                        src={faviconUrl}
                        alt=""
                        width={28}
                        height={28}
                        className="h-full w-full object-cover"
                        onError={() => handleFaviconError(source.url)}
                      />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-foreground/90 truncate leading-tight">
                      {source.title}
                    </p>
                    <p className="text-[11px] text-muted-foreground/50 truncate mt-0.5">
                      {domain}
                    </p>
                  </div>

                  <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/30 opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex-shrink-0" />
                </a>
              )
            })}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
