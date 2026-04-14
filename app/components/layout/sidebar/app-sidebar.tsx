"use client"

import { useBreakpoint } from "@/app/hooks/use-breakpoint"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar"
import { useUser } from "@/lib/user-store/provider"
import { useRouter } from "next/navigation"
import { useState, useEffect, useCallback, useRef } from "react"
import { DialogCollaborativeAuth } from "../../collaborative/dialog-collaborative-auth"
import { CoastyIcon } from "@/components/icons/coasty"
import { cn } from "@/lib/utils"
import { ReferralPopup } from "../../referral/referral-popup"
import { SidebarNavSection } from "./sidebar-nav-section"
import { SidebarFooterSection } from "./sidebar-footer-section"

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
  const { setOpenMobile, open, isMobile: isMobileSidebar } = useSidebar()
  const expanded = isMobileSidebar || open
  const { user } = useUser()

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
        collapsible="icon"
        style={{
          "--sidebar-width": "13.5rem",
        } as React.CSSProperties}
      >
        {/* ─── Header ───────────────────────────────────────
            Same padding & layout in both modes so the logo never
            shifts horizontally. Logo center anchored at sidebar-x=24
            (parent px-2 + button px-1 + logo-half 12), matching the
            nav icon column below. Wordmark uses gap-1.5 so its left
            edge lands at x=42 — same as nav item labels. */}
        <SidebarHeader className="p-0">
          <div className="flex items-center min-h-[44px] px-2 pt-2 pb-1">
            <button
              onClick={() => {
                setLogoClicks(c => c + 1)
                handleNavigation(() => router.push("/"))
              }}
              className={cn(
                "flex w-full items-center gap-1.5 px-1 py-1.5 rounded-lg transition-colors duration-150",
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
