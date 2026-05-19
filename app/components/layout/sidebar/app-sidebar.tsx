"use client"

import { useBreakpoint } from "@/app/hooks/use-breakpoint"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useUser } from "@/lib/user-store/provider"
import { useRouter } from "next/navigation"
import { useState, useEffect, useCallback, useRef } from "react"
import { IconPin, IconPinFilled } from "@tabler/icons-react"
import { DialogCollaborativeAuth } from "../../collaborative/dialog-collaborative-auth"
import { CoastyIcon } from "@/components/icons/coasty"
import { cn } from "@/lib/utils"
import { ReferralPopup } from "../../referral/referral-popup"
import { SidebarNavSection } from "./sidebar-nav-section"
import { SidebarFooterSection } from "./sidebar-footer-section"

const SIDEBAR_PINNED_KEY = "coasty:sidebar:pinned"

// Import static CSS instead of inline <style jsx global>
import "./sidebar-animations.css"

// ─── Easter egg: Konami-lite sequence detector ─────────────────────
function useSecretSequence(sequence: string, onActivate: () => void) {
  const bufferRef = useRef("")
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.key) return
      bufferRef.current += e.key.toLowerCase()
      if (bufferRef.current.length > sequence.length) {
        bufferRef.current = bufferRef.current.slice(-sequence.length)
      }
      if (bufferRef.current === sequence) {
        onActivate()
        bufferRef.current = ""
      }
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        bufferRef.current = ""
      }, 2000)
    }
    window.addEventListener("keydown", handler)
    return () => {
      window.removeEventListener("keydown", handler)
      clearTimeout(timerRef.current)
    }
  }, [sequence, onActivate])
}

// ─── Main sidebar (slim orchestrator) ─────────────────────────────
export function AppSidebar() {
  const isMobile = useBreakpoint(768)
  const { setOpenMobile, open, isMobile: isMobileSidebar, setOpen } = useSidebar()
  const expanded = isMobileSidebar || open
  const { user } = useUser()

  // ─── Pin state ────────────────────────────────────────────────
  // When pinned, we swap the sidebar's `collapsible` prop from
  // "icon" (hover-to-expand, mouse-leave collapses) to "none" (no
  // hover behavior at all). The Sidebar's mouse handlers only fire
  // when collapsible === "icon", so flipping the prop is enough to
  // freeze the sidebar in its current open state — no need to fork
  // the underlying ui/sidebar component.
  const [pinned, setPinned] = useState<boolean>(() => {
    if (typeof window === "undefined") return false
    return window.localStorage.getItem(SIDEBAR_PINNED_KEY) === "true"
  })

  // On first paint after a pinned restore, ensure the sidebar is
  // actually open (the cookie-based default may say otherwise).
  useEffect(() => {
    if (pinned) setOpen(true)
    // We only want this on mount + when pin state changes.
  }, [pinned, setOpen])

  const togglePinned = useCallback(() => {
    setPinned((prev) => {
      const next = !prev
      if (typeof window !== "undefined") {
        window.localStorage.setItem(SIDEBAR_PINNED_KEY, String(next))
      }
      if (next) setOpen(true)
      return next
    })
  }, [setOpen])

  const [isCollaborativeAuthDialogOpen, setIsCollaborativeAuthDialogOpen] = useState(false)
  const [isReferralPopupOpen, setIsReferralPopupOpen] = useState(false)

  const router = useRouter()

  // ─── Easter egg states ───────────────────────────────────────
  const [logoClicks, setLogoClicks] = useState(0)
  const [partyMode, setPartyMode] = useState(false)

  useEffect(() => {
    if (logoClicks >= 7) {
      setPartyMode(true)
      const t = setTimeout(() => {
        setPartyMode(false)
        setLogoClicks(0)
      }, 3000)
      return () => clearTimeout(t)
    }
  }, [logoClicks])

  const [rainbowMode, setRainbowMode] = useState(false)
  useSecretSequence("coast", useCallback(() => {
    setRainbowMode(true)
    setTimeout(() => setRainbowMode(false), 4000)
  }, []))

  const handleNavigation = useCallback((navigationFn: () => void) => {
    navigationFn()
    if (isMobile) {
      setOpenMobile(false)
    }
  }, [isMobile, setOpenMobile])

  const closeMobileIfNeeded = useCallback(() => {
    if (isMobile) setOpenMobile(false)
  }, [isMobile, setOpenMobile])

  return (
    <>
      <Sidebar
        side="left"
        variant="sidebar"
        // `none` while pinned freezes the hover-to-expand behavior —
        // mouseLeave no longer collapses the rail. Flipping back to
        // `icon` restores the default hover-driven behavior.
        collapsible={pinned ? "none" : "icon"}
        style={{
          "--sidebar-width": "13.5rem",
        } as React.CSSProperties}
      >
        {/* ─── Header ───────────────────────────────────────
            Same padding & layout in both modes so the logo never
            shifts horizontally. Logo center anchored at sidebar-x=24
            (parent px-2 + button px-1 + logo-half 12), matching the
            nav icon column below. Wordmark uses gap-1.5 so its left
            edge lands at x=42 — same as nav item labels.

            The pin button only renders when expanded — it would have
            no room in the 48px collapsed rail. Logo button takes
            `flex-1 min-w-0` so it shrinks gracefully when the pin
            button shows, instead of pushing it offscreen. */}
        <SidebarHeader className="p-0">
          <div className="flex items-center min-h-[44px] px-2 pt-2 pb-1 gap-0.5">
            <button
              onClick={() => {
                setLogoClicks(c => c + 1)
                handleNavigation(() => router.push("/"))
              }}
              className={cn(
                "flex flex-1 min-w-0 items-center gap-1.5 px-1 py-1.5 rounded-lg transition-colors duration-150",
                "hover:bg-foreground/[0.04] dark:hover:bg-white/[0.04]",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
              )}
              title="Coasty"
            >
              <div className={cn(
                "flex h-6 w-6 items-center justify-center shrink-0 transition-transform duration-500",
                partyMode && "animate-spin"
              )}>
                <CoastyIcon className="h-6 w-6 text-sidebar-primary" />
              </div>
              {expanded && (
                <span className="text-[13.5px] font-semibold text-foreground/90 tracking-[-0.015em] leading-tight truncate">
                  Coasty
                </span>
              )}
            </button>

            {/* ── Pin toggle ──
                Desktop-only — on mobile the sidebar is a sheet
                drawer with no hover-to-expand, so pinning has no
                meaning. Filled-pin tilted 45° in pinned state reads
                as "stuck"; outline-pin upright reads as "loose /
                will close on mouse-out". Color shifts from a quiet
                foreground/30 to a deliberate foreground/75 with a
                subtle bg when active. */}
            {expanded && !isMobile && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={togglePinned}
                    aria-label={pinned ? "Unpin sidebar" : "Keep sidebar open"}
                    aria-pressed={pinned}
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors duration-150",
                      "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50",
                      pinned
                        ? "text-foreground/75 bg-foreground/[0.05] hover:bg-foreground/[0.08] dark:bg-white/[0.05] dark:hover:bg-white/[0.08]"
                        : "text-foreground/30 hover:text-foreground/70 hover:bg-foreground/[0.04] dark:hover:bg-white/[0.04]"
                    )}
                  >
                    {pinned ? (
                      <IconPinFilled
                        size={13}
                        stroke={1.5}
                        className="rotate-45 transition-transform duration-200"
                      />
                    ) : (
                      <IconPin
                        size={13}
                        stroke={1.75}
                        className="transition-transform duration-200"
                      />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  <span className="font-medium text-[12px]">
                    {pinned ? "Unpin sidebar" : "Keep sidebar open"}
                  </span>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </SidebarHeader>

        {/* ─── Content ──────────────────────────────────────
            Padding is intentionally constant across expand/collapse so
            every icon stays anchored at sidebar-x=24px and never shifts
            during the width transition. */}
        <SidebarContent
          className={cn(
            "pt-2 px-2 overflow-y-auto overflow-x-hidden",
            rainbowMode && "rainbow-wave"
          )}
        >
          <SidebarNavSection
            user={user}
            expanded={expanded}
            isMobile={isMobile}
            closeMobileIfNeeded={closeMobileIfNeeded}
            handleNavigation={handleNavigation}
          />
        </SidebarContent>

        {/* ─── Footer ─────────────────────────────────────── */}
        <SidebarFooter className="relative pt-0 border-t border-sidebar-border/15">
          <SidebarFooterSection
            user={user}
            expanded={expanded}
            isMobile={isMobile}
            closeMobileIfNeeded={closeMobileIfNeeded}
          />
        </SidebarFooter>

        {/* Dialogs */}
        <DialogCollaborativeAuth
          open={isCollaborativeAuthDialogOpen}
          setOpen={setIsCollaborativeAuthDialogOpen}
        />
        <ReferralPopup
          open={isReferralPopupOpen}
          onOpenChange={setIsReferralPopupOpen}
        />
      </Sidebar>
    </>
  )
}
