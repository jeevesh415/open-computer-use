"use client"

import {
  ChatBackground,
  useUserPreferences,
} from "@/lib/user-preference-store/provider"
import { cn } from "@/lib/utils"
import { Check } from "lucide-react"
import { ChatBackgroundLayer } from "@/app/components/chat/chat-background"

const backgrounds: {
  id: ChatBackground
  label: string
  description: string
}[] = [
  {
    id: "none",
    label: "Default",
    description: "Clean flat surface",
  },
  {
    id: "constellation",
    label: "Constellation",
    description: "Connected star field",
  },
  {
    id: "dotmatrix",
    label: "Dot Matrix",
    description: "Halftone wave pattern",
  },
  {
    id: "blueprint",
    label: "Blueprint",
    description: "Technical drafting grid",
  },
  {
    id: "isometric",
    label: "Isometric",
    description: "3D architect grid",
  },
]

function LivePreview({ id }: { id: ChatBackground }) {
  return (
    <div className="relative h-full w-full overflow-hidden rounded-t-[11px] bg-background">
      {/* Real background layer — same component used in the actual canvas */}
      <ChatBackgroundLayer background={id} />

      {/* Miniature chat mockup overlay */}
      <div className="relative z-[2] flex h-full flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-2.5 py-1.5">
          <div className="flex items-center gap-1">
            <div className="h-2 w-2 rounded-[3px] bg-foreground/[0.06]" />
            <div className="h-[3px] w-5 rounded-full bg-foreground/[0.05]" />
          </div>
          <div className="flex items-center gap-[2px]">
            <div className="h-[5px] w-[5px] rounded-full bg-foreground/[0.04]" />
            <div className="h-[5px] w-[5px] rounded-full bg-foreground/[0.04]" />
          </div>
        </div>

        {/* Messages */}
        <div className="flex flex-1 flex-col justify-center gap-[5px] px-2.5">
          <div className="self-start rounded-[5px] bg-muted/40 px-1.5 py-[2.5px] max-w-[70%]">
            <div className="flex flex-col gap-[1.5px]">
              <div className="h-[1.5px] w-12 rounded-full bg-foreground/[0.08]" />
              <div className="h-[1.5px] w-8 rounded-full bg-foreground/[0.06]" />
            </div>
          </div>
          <div className="self-end rounded-[5px] bg-accent/50 px-1.5 py-[2.5px]">
            <div className="h-[1.5px] w-8 rounded-full bg-foreground/[0.08]" />
          </div>
          <div className="self-start rounded-[5px] bg-muted/40 px-1.5 py-[2.5px] max-w-[75%]">
            <div className="flex flex-col gap-[1.5px]">
              <div className="h-[1.5px] w-14 rounded-full bg-foreground/[0.08]" />
              <div className="h-[1.5px] w-10 rounded-full bg-foreground/[0.06]" />
              <div className="h-[1.5px] w-6 rounded-full bg-foreground/[0.04]" />
            </div>
          </div>
          <div className="self-end rounded-[5px] bg-accent/50 px-1.5 py-[2.5px]">
            <div className="h-[1.5px] w-5 rounded-full bg-foreground/[0.08]" />
          </div>
        </div>

        {/* Input bar */}
        <div className="px-2 pb-1.5">
          <div className="flex items-center gap-[3px] rounded-[5px] border border-foreground/[0.04] bg-foreground/[0.02] px-1.5 py-[2.5px]">
            <div className="h-[1.5px] w-6 rounded-full bg-foreground/[0.06]" />
            <div className="flex-1" />
            <div className="h-[4px] w-[4px] rounded-full bg-foreground/[0.06]" />
          </div>
        </div>
      </div>
    </div>
  )
}

export function BackgroundSelection() {
  const { preferences, setChatBackground } = useUserPreferences()

  return (
    <div>
      <div className="flex items-center gap-2 mb-3.5">
        <h3 className="text-sm font-semibold">Canvas Background</h3>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
        {backgrounds.map((bg) => {
          const isActive = preferences.chatBackground === bg.id
          return (
            <button
              key={bg.id}
              type="button"
              onClick={() => setChatBackground(bg.id)}
              className={cn(
                "group relative flex flex-col rounded-xl border overflow-hidden transition-all duration-200",
                isActive
                  ? "border-foreground/20 ring-1 ring-foreground/[0.08] shadow-sm"
                  : "border-border/40 hover:border-border/60"
              )}
            >
              {/* Live preview using real ChatBackgroundLayer */}
              <div
                className={cn(
                  "aspect-[3/2] w-full transition-opacity duration-200",
                  isActive
                    ? "opacity-100"
                    : "opacity-60 group-hover:opacity-90"
                )}
              >
                <LivePreview id={bg.id} />
              </div>

              {/* Label */}
              <div className="flex items-center justify-between border-t border-border/20 px-2.5 py-2">
                <div className="text-left min-w-0">
                  <span
                    className={cn(
                      "text-[11px] font-medium leading-none block truncate",
                      isActive
                        ? "text-foreground"
                        : "text-muted-foreground/50 group-hover:text-muted-foreground/70"
                    )}
                  >
                    {bg.label}
                  </span>
                </div>
                {isActive && (
                  <div className="ml-1 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-foreground">
                    <Check
                      className="h-2.5 w-2.5 text-background"
                      strokeWidth={3}
                    />
                  </div>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
