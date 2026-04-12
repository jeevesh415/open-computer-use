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
        {/* ─── Header ─────────────────────────────────────── */}
        <SidebarHeader className="p-0 border-b border-sidebar-border/10">
          <div className={cn(
            "flex items-center min-h-[48px]",
            expanded ? "px-3 py-2" : "justify-center py-2"
          )}>
            <button
              onClick={() => {
                setLogoClicks(c => c + 1)
                handleNavigation(() => router.push("/"))
              }}
              className={cn(
                "flex items-center rounded-lg transition-all duration-200 ease-out",
                "hover:bg-sidebar-accent/30",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50",
                expanded ? "gap-2 flex-1 min-w-0 p-1.5" : "p-2 justify-center"
              )}
              title="Coasty"
            >
              <div className={cn(
                "flex h-7 w-7 items-center justify-center shrink-0 transition-transform duration-500",
                partyMode && "animate-spin"
              )}>
                <CoastyIcon className="h-6 w-6 text-sidebar-primary" />
              </div>
              {expanded && (
                <span className="text-[13px] font-semibold text-foreground tracking-[-0.01em] leading-normal truncate">
                  Coasty
                </span>
              )}
            </button>
          </div>
        </SidebarHeader>

        {/* ─── Content ────────────────────────────────────── */}
        <SidebarContent
          className={cn(
            "pt-2 overflow-y-auto overflow-x-hidden",
            expanded ? "px-2" : "px-1.5",
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
