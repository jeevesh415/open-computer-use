"use client"

import { useState, useEffect } from "react"
import { Header } from "@/app/components/layout/header"
import { AppSidebar } from "@/app/components/layout/sidebar/app-sidebar"

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


function LayoutContent({ children }: { children: React.ReactNode }) {
  const { preferences, isLoading } = useUserPreferences()
  const { isOpen: isNavigatorOpen, toggleNavigator, width: navigatorWidth } = useProjectNavigator()
  const { chatId } = useChatSession()
  const { getChatById } = useChats()
  const hasSidebar = preferences.layout === "sidebar"
  const [isMobile, setIsMobile] = useState(false)
  const [mounted, setMounted] = useState(false)
  
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

  // During hydration, always render the default layout to avoid mismatch
  // The layout will update after preferences are loaded
  return (
    <div className="relative flex h-dvh w-full overflow-hidden bg-sidebar">
      {mounted && hasSidebar && <AppSidebar />}
      <div
        className={cn(
          "flex-1 flex transition-all duration-300",
          mounted && hasSidebar && "md:py-2 md:pr-2 md:pl-2"
        )}
      >
        <main className={cn(
          "@container relative h-full w-full bg-background",
          mounted && hasSidebar && "md:rounded-2xl md:overflow-hidden md:shadow-sm"
        )}>
          {mounted && <ChatBackgroundLayer background={preferences.chatBackground} />}
          <Header
            hasSidebar={hasSidebar}
          />
          <div
            className="relative pt-[var(--spacing-app-header,56px)] h-full overflow-hidden scrollbar-invisible"
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
