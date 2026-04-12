import { useBreakpoint } from "@/app/hooks/use-breakpoint"
import useClickOutside from "@/app/hooks/use-click-outside"
import { useChats } from "@/lib/chat-store/chats/provider"
import { Chat } from "@/lib/chat-store/types"
import { cn } from "@/lib/utils"
import {
  Check,
  X,
  Desktop,
  Laptop,
  Code,
  Database,
  Globe,
  FileText,
  Image,
  ChartBar,
  Bug,
  Gear,
  Rocket,
  PaintBrush,
  GameController,
  MusicNote,
  Camera,
  Heart,
  Lightning,
  Cloud,
  Lock,
  MagnifyingGlass,
  Cpu,
  Package,
} from "@phosphor-icons/react"
import { AgentIconFilled } from "@/components/icons/agent"
import Link from "next/link"
import { memo, useCallback, useMemo, useRef, useState } from "react"
import { SidebarItemMenu } from "./sidebar-item-menu"
import { useSidebar } from "@/components/ui/sidebar"

type SidebarItemProps = {
  chat: Chat
  currentChatId: string
  isCollaborative?: boolean
}

// Function to get icon based on chat title
export function getChatIcon(title: string) {
  const lowerTitle = title.toLowerCase()
  
  // Code related
  if (lowerTitle.includes('code') || lowerTitle.includes('function') || lowerTitle.includes('script') || 
      lowerTitle.includes('program') || lowerTitle.includes('develop')) {
    return <Code size={16} weight="fill" />
  }
  
  // Database
  if (lowerTitle.includes('database') || lowerTitle.includes('sql') || lowerTitle.includes('query') || 
      lowerTitle.includes('table') || lowerTitle.includes('data')) {
    return <Database size={16} weight="fill" />
  }
  
  // Web/API
  if (lowerTitle.includes('api') || lowerTitle.includes('web') || lowerTitle.includes('http') || 
      lowerTitle.includes('url') || lowerTitle.includes('website')) {
    return <Globe size={16} weight="fill" />
  }
  
  // Files/Documents
  if (lowerTitle.includes('file') || lowerTitle.includes('document') || lowerTitle.includes('text') || 
      lowerTitle.includes('write') || lowerTitle.includes('read')) {
    return <FileText size={16} weight="fill" />
  }
  
  // Images/Design
  if (lowerTitle.includes('image') || lowerTitle.includes('photo') || lowerTitle.includes('picture') || 
      lowerTitle.includes('design') || lowerTitle.includes('ui') || lowerTitle.includes('ux')) {
    return <Image size={16} weight="fill" />
  }
  
  // Charts/Analytics
  if (lowerTitle.includes('chart') || lowerTitle.includes('graph') || lowerTitle.includes('analytic') || 
      lowerTitle.includes('report') || lowerTitle.includes('dashboard')) {
    return <ChartBar size={16} weight="fill" />
  }
  
  // Bug/Debug
  if (lowerTitle.includes('bug') || lowerTitle.includes('fix') || lowerTitle.includes('error') || 
      lowerTitle.includes('debug') || lowerTitle.includes('issue')) {
    return <Bug size={16} weight="fill" />
  }
  
  // Settings/Config
  if (lowerTitle.includes('setting') || lowerTitle.includes('config') || lowerTitle.includes('setup') || 
      lowerTitle.includes('install')) {
    return <Gear size={16} weight="fill" />
  }
  
  // Launch/Deploy
  if (lowerTitle.includes('deploy') || lowerTitle.includes('launch') || lowerTitle.includes('release') || 
      lowerTitle.includes('build')) {
    return <Rocket size={16} weight="fill" />
  }
  
  // Style/CSS
  if (lowerTitle.includes('style') || lowerTitle.includes('css') || lowerTitle.includes('theme') || 
      lowerTitle.includes('color')) {
    return <PaintBrush size={16} weight="fill" />
  }
  
  // Game
  if (lowerTitle.includes('game') || lowerTitle.includes('play')) {
    return <GameController size={16} weight="fill" />
  }
  
  // Music/Audio
  if (lowerTitle.includes('music') || lowerTitle.includes('audio') || lowerTitle.includes('sound')) {
    return <MusicNote size={16} weight="fill" />
  }
  
  // Security
  if (lowerTitle.includes('security') || lowerTitle.includes('auth') || lowerTitle.includes('password') || 
      lowerTitle.includes('encrypt')) {
    return <Lock size={16} weight="fill" />
  }
  
  // Search
  if (lowerTitle.includes('search') || lowerTitle.includes('find') || lowerTitle.includes('filter')) {
    return <MagnifyingGlass size={16} weight="fill" />
  }
  
  // AI/Machine Learning
  if (lowerTitle.includes('ai') || lowerTitle.includes('ml') || lowerTitle.includes('model') || 
      lowerTitle.includes('train')) {
    return <Cpu size={16} weight="fill" />
  }
  
  // Package/Library
  if (lowerTitle.includes('package') || lowerTitle.includes('library') || lowerTitle.includes('npm') || 
      lowerTitle.includes('install')) {
    return <Package size={16} weight="fill" />
  }
  
  // Cloud
  if (lowerTitle.includes('cloud') || lowerTitle.includes('aws') || lowerTitle.includes('azure') || 
      lowerTitle.includes('gcp')) {
    return <Cloud size={16} weight="fill" />
  }
  
  // Performance
  if (lowerTitle.includes('performance') || lowerTitle.includes('optimize') || lowerTitle.includes('speed') || 
      lowerTitle.includes('fast')) {
    return <Lightning size={16} weight="fill" />
  }
  
  // Default
  return <Desktop size={16} weight="fill" />
}

export const SidebarItem = memo(function SidebarItem({ chat, currentChatId, isCollaborative }: SidebarItemProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(chat.title || "")
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const lastChatTitleRef = useRef(chat.title)
  const { updateTitle } = useChats()
  const isMobile = useBreakpoint(768)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const { setOpen, setOpenMobile } = useSidebar()

  if (!isEditing && lastChatTitleRef.current !== chat.title) {
    lastChatTitleRef.current = chat.title
    setEditTitle(chat.title || "")
  }

  const handleStartEditing = useCallback(() => {
    setIsEditing(true)
    setEditTitle(chat.title || "")

    requestAnimationFrame(() => {
      if (inputRef.current) {
        inputRef.current.focus()
        inputRef.current.select()
      }
    })
  }, [chat.title])

  const handleSave = useCallback(async () => {
    setIsEditing(false)
    setIsMenuOpen(false)
    await updateTitle(chat.id, editTitle)
  }, [chat.id, editTitle, updateTitle])

  const handleCancel = useCallback(() => {
    setEditTitle(chat.title || "")
    setIsEditing(false)
    setIsMenuOpen(false)
  }, [chat.title])

  const handleMenuOpenChange = useCallback((open: boolean) => {
    setIsMenuOpen(open)
  }, [])

  const handleClickOutside = useCallback(() => {
    if (isEditing) {
      handleSave()
    }
  }, [isEditing, handleSave])

  useClickOutside(containerRef, handleClickOutside)

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setEditTitle(e.target.value)
    },
    []
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault()
        handleSave()
      } else if (e.key === "Escape") {
        e.preventDefault()
        handleCancel()
      }
    },
    [handleSave, handleCancel]
  )

  const handleContainerClick = useCallback(
    (e: React.MouseEvent) => {
      if (isEditing) {
        e.stopPropagation()
      }
    },
    [isEditing]
  )

  const handleSaveClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      handleSave()
    },
    [handleSave]
  )

  const handleCancelClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      handleCancel()
    },
    [handleCancel]
  )

  const handleLinkClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (isMobile) {
      setOpenMobile(false)
    }
  }, [isMobile, setOpenMobile])

  // Memoize computed values
  const isActive = useMemo(
    () => chat.id === currentChatId,
    [chat.id, currentChatId]
  )

  const displayTitle = useMemo(
    () => chat.title || "Untitled Project",
    [chat.title]
  )

  const chatIcon = useMemo(
    () => getChatIcon(chat.title || ""),
    [chat.title]
  )

  const isDesktopChat = useMemo(() => {
    let rs = chat.room_settings as any
    if (typeof rs === "string") {
      try { rs = JSON.parse(rs) } catch { rs = {} }
    }
    return rs?.source === "electron"
  }, [chat.room_settings])

  const desktopLabel = useMemo(() => {
    if (!isDesktopChat) return null
    let rs = chat.room_settings as any
    if (typeof rs === "string") {
      try { rs = JSON.parse(rs) } catch { rs = {} }
    }
    return rs?.machine_name || "Desktop"
  }, [isDesktopChat, chat.room_settings])

  const hasSchedule = useMemo(() => {
    let rs = chat.room_settings as any
    if (typeof rs === "string") {
      try { rs = JSON.parse(rs) } catch { rs = {} }
    }
    return rs?.schedule?.enabled === true
  }, [chat.room_settings])

  const containerClassName = useMemo(
    () =>
      cn(
        "group relative w-full rounded-md transition-all",
        isActive 
          ? "bg-primary/10" 
          : "hover:bg-accent/50"
      ),
    [isActive]
  )

  const menuClassName = useMemo(
    () =>
      cn(
        "absolute top-1 right-1 flex items-center justify-center opacity-0 transition-opacity duration-200",
        "group-hover:opacity-100",
        (isMenuOpen || isActive) && "opacity-100",
        isMobile && "opacity-100"
      ),
    [isMobile, isMenuOpen, isActive]
  )

  return (
    <div
      className={containerClassName}
      onClick={handleContainerClick}
      ref={containerRef}
    >
      {isEditing ? (
        <div className="flex items-center gap-1.5 rounded-md bg-accent/80 px-2.5 py-2">
          <input
            ref={inputRef}
            value={editTitle}
            onChange={handleInputChange}
            className="flex-1 bg-transparent text-sm font-medium text-foreground placeholder:text-muted-foreground focus:outline-none"
            onKeyDown={handleKeyDown}
            placeholder="Project name..."
            autoFocus
          />
          <div className="flex items-center gap-0.5">
            <button
              onClick={handleSaveClick}
              className="flex h-5 w-5 items-center justify-center rounded bg-primary text-primary-foreground transition-colors hover:bg-primary/90"
              type="button"
            >
              <Check size={10} weight="bold" />
            </button>
            <button
              onClick={handleCancelClick}
              className="flex h-5 w-5 items-center justify-center rounded bg-muted text-muted-foreground transition-colors hover:bg-muted/80"
              type="button"
            >
              <X size={10} weight="bold" />
            </button>
          </div>
        </div>
      ) : (
        <>
          <Link
            href={`/c/${chat.id}`}
            className="block w-full"
            prefetch
            onClick={handleLinkClick}
          >
            <div className="flex items-center gap-2 px-2.5 py-2 pr-6">
              <div className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                isActive 
                  ? "bg-primary/20 text-primary" 
                  : "bg-muted text-muted-foreground"
              )}>
                {chatIcon}
              </div>
              <div className="flex-1 min-w-0 space-y-0.5">
                <div className="flex items-center gap-1.5">
                  <p className={cn(
                    "truncate text-sm font-medium leading-tight",
                    isActive ? "text-foreground" : "text-foreground/80"
                  )}>
                    {displayTitle}
                  </p>
                  {isDesktopChat && (
                    <span
                      className="inline-flex shrink-0 items-center gap-0.5 rounded bg-blue-500/15 px-1 py-0.5 text-[9px] font-medium text-blue-400"
                      title={desktopLabel || "Desktop"}
                    >
                      <Laptop size={10} weight="fill" />
                    </span>
                  )}
                  {hasSchedule && (
                    <span
                      className="inline-flex shrink-0 items-center rounded bg-emerald-500/15 px-1 py-0.5 text-[9px] font-medium text-emerald-400"
                      title="Employee Active"
                    >
                      <AgentIconFilled className="h-2.5 w-2.5" />
                    </span>
                  )}
                </div>
                {chat.last_message_preview && (
                  <p className={cn(
                    "truncate text-[11px] leading-tight",
                    isActive ? "text-muted-foreground/80" : "text-muted-foreground/60"
                  )}>
                    {chat.last_message_preview}
                  </p>
                )}
              </div>
            </div>
          </Link>

          <div className={menuClassName}>
            <SidebarItemMenu
              chat={chat}
              onStartEditing={handleStartEditing}
              onMenuOpenChange={handleMenuOpenChange}
            />
          </div>
        </>
      )}
    </div>
  )
})
