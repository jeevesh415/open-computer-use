"use client"

import { useState, useEffect } from "react"
import { usePathname } from "next/navigation"
import { Header } from "@/app/components/layout/header"
import { AppSidebar } from "@/app/components/layout/sidebar/app-sidebar"
import { AppTopBar } from "@/app/components/layout/topbar/app-topbar"

import { useUserPreferences } from "@/lib/user-preference-store/provider"
import { MessagesProvider } from "@/lib/chat-store/messages/provider"
import { ProjectNavigator } from "@/app/components/project/project-navigator"
import { ProjectNavigatorProvider, useProjectNavigator } from "@/lib/project-navigator-store/provider"
import { useChatSession } from "@/lib/chat-store/session/provider"
import { useChats } from "@/lib/chat-store/chats/provider"
import { cn } from "@/lib/utils"
import { ChatStreamingProvider } from "@/lib/chat-streaming-store/provider"
import dynamic from "next/dynamic"
import { AccountDialog } from "@/app/components/layout/account-dialog"
import { ChatBackgroundLayer } from "@/app/components/chat/chat-background"
import { useIntroStore } from "@/lib/intro-store"


function LayoutContent({ children }: { children: React.ReactNode }) {
  const { preferences, isLoading } = useUserPreferences()
  const { isOpen: isNavigatorOpen, toggleNavigator, width: navigatorWidth } = useProjectNavigator()
  const { chatId } = useChatSession()
  const { getChatById } = useChats()
  const pathname = usePathname()
  const hasSidebar = preferences.layout === "sidebar"

  // The decorative background belongs to chat surfaces only — the home
  // composer ("/") and individual chats ("/c/:id"). On resource pages
  // (schedules, machines, secrets, history, etc.) it competes with
  // dense content and reads as visual noise.
  const isChatSurface = pathname === "/" || pathname?.startsWith("/c/") || false
  const [isMobile, setIsMobile] = useState(false)
  const [mounted, setMounted] = useState(false)

  // Horizontal nav mode — only on desktop. On mobile we always fall
  // back to the vertical sidebar (which has a proper drawer).
  const isHorizontal =
    mounted && hasSidebar && !isMobile && preferences.sidebarStyle === "horizontal"
  
  // Check if current chat is a project (collaborative)
  const currentChat = chatId ? getChatById(chatId) : null
  const isProject = currentChat?.collaborative === true
  
  // Enable ProjectNavigator for all chats when there's an active chat
  const showProjectNavigator = !!chatId

  // Check if mobile
  useEffect(() => {
    setMounted(true)
    const checkMobile = () => {
      const mobile = window.innerWidth < 640
      setIsMobile(mobile)
    }
    checkMobile()
    window.addEventListener('resize', checkMobile)

    return () => {
      window.removeEventListener('resize', checkMobile)
    }
  }, [])

  // Hide the top header/topbar on the homepage until the cinematic intro
  // finishes — otherwise it flashes for a frame before the intro overlay
  // mounts. On any non-homepage route, the header is always visible.
  const introPhase = useIntroStore((s) => s.phase)
  const isHomepage = pathname === "/"
  const headerHidden = isHomepage && introPhase !== "done"

  // During hydration, always render the default layout to avoid mismatch
  // The layout will update after preferences are loaded
  return (
    <div className={cn("relative flex h-dvh w-full overflow-hidden", !isHorizontal && "bg-sidebar")}>
      {mounted && hasSidebar && !isHorizontal && <AppSidebar />}
      <div
        className={cn(
          "flex-1 flex transition-all duration-300",
          mounted && hasSidebar && !isHorizontal && "md:py-2 md:pr-2 md:pl-2"
        )}
      >
        <main className={cn(
          "@container relative h-full w-full",
          !isHorizontal && "bg-background",
          mounted && hasSidebar && !isHorizontal && "md:rounded-2xl md:overflow-hidden md:shadow-sm"
        )}>
          {mounted && isChatSurface && <ChatBackgroundLayer background={preferences.chatBackground} />}
          <div
            className={cn(
              "transition-opacity ease-out",
              headerHidden
                ? "opacity-0 pointer-events-none duration-0"
                : "opacity-100 duration-700"
            )}
            aria-hidden={headerHidden}
          >
            {isHorizontal ? (
              <AppTopBar />
            ) : (
              <Header hasSidebar={hasSidebar} />
            )}
          </div>
          <div
            className={cn(
              "relative h-full overflow-hidden scrollbar-invisible",
              // In horizontal mode, bg-background lives HERE (not on main)
              // so the area above this div — where the pill floats — is
              // transparent and shows through to ChatBackgroundLayer or body.
              isHorizontal && "bg-background",
              // Pill height: pt-2 (8) + py-1.5 (6) + h-7 (28) + py-1.5 (6) = 48px.
              // Plus ~4px breathing = 52px top padding.
              isHorizontal
                ? "pt-[52px]"
                : "pt-[var(--spacing-app-header,56px)]"
            )}
            style={{
              marginRight: showProjectNavigator && isNavigatorOpen && !isMobile ? `${navigatorWidth}%` : 0,
              transition: 'margin-right 0.25s ease'
            }}
          >
            {children}
          </div>

          {/* Project Navigator - inside the canvas */}
          {showProjectNavigator && (
            <ProjectNavigator isOpen={isNavigatorOpen} onToggle={toggleNavigator} disableAutoOpen={true} />
          )}
        </main>
      </div>
      <AccountDialog />
    </div>
  )
}

import { SidebarProvider } from "@/components/ui/sidebar"

export function LayoutApp({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider defaultOpen={false}>
      <MessagesProvider>
        <ChatStreamingProvider>
          <ProjectNavigatorProvider>
            <LayoutContent>{children}</LayoutContent>
          </ProjectNavigatorProvider>
        </ChatStreamingProvider>
      </MessagesProvider>
    </SidebarProvider>
  )
}
