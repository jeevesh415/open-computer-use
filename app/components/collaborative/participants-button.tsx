"use client"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import { Users, Crown, Shield, User, Copy } from "lucide-react"
import { useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "@/components/ui/toast"

interface Participant {
  id: string
  user_id: string
  role: "owner" | "moderator" | "participant"
  joined_at: string
  last_active_at: string
  users: {
    display_name: string | null
    profile_image: string | null
    email: string
  }
}

interface ParticipantsButtonProps {
  participants: Participant[]
  currentUserId: string
  roomTitle: string
  inviteCode: string
  className?: string
}

export function ParticipantsButton({
  participants,
  currentUserId,
  roomTitle,
  inviteCode,
  className,
}: ParticipantsButtonProps) {
  const t = useTranslations("collaborative")
  const [isOpen, setIsOpen] = useState(false)

  const isOnline = (lastActiveAt: string) => {
    const lastActive = new Date(lastActiveAt)
    const now = new Date()
    const diffMinutes = (now.getTime() - lastActive.getTime()) / (1000 * 60)
    return diffMinutes < 5
  }

  const getRoleIcon = (role: string) => {
    switch (role) {
      case "owner":
        return <Crown className="h-3 w-3 text-amber-600" />
      case "moderator":
        return <Shield className="h-3 w-3 text-blue-600" />
      default:
        return <User className="h-3 w-3 text-gray-500" />
    }
  }

  const getRoleColor = (role: string) => {
    switch (role) {
      case "owner":
        return "bg-amber-50 text-amber-700 border-amber-200"
      case "moderator":
        return "bg-blue-50 text-blue-700 border-blue-200"
      default:
        return "bg-gray-50 text-gray-700 border-gray-200"
    }
  }

  const copyInviteCode = async () => {
    try {
      await navigator.clipboard.writeText(inviteCode)
      toast({
        title: t("participants.codeCopied"),
        status: "success",
      })
    } catch (err) {
      toast({
        title: t("participants.codeFailed"),
        status: "error",
      })
    }
  }

  const copyInviteLink = async () => {
    try {
      const inviteLink = `${window.location.origin}/join/${inviteCode}`
      await navigator.clipboard.writeText(inviteLink)
      toast({
        title: t("participants.linkCopied"),
        status: "success",
      })
    } catch (err) {
      toast({
        title: t("participants.linkFailed"),
        status: "error",
      })
    }
  }

  // Sort participants: owner first, then moderators, then participants
  const sortedParticipants = [...participants].sort((a, b) => {
    const roleOrder = { owner: 0, moderator: 1, participant: 2 }
    const aOrder = roleOrder[a.role] || 2
    const bOrder = roleOrder[b.role] || 2
    if (aOrder !== bOrder) return aOrder - bOrder
    return new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime()
  })

  // Get first 3 participants for the button display
  const displayParticipants = sortedParticipants.slice(0, 3)
  const remainingCount = Math.max(0, participants.length - 3)

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "text-foreground hover:text-foreground hover:bg-muted/80 bg-background border border-border/50 rounded-3xl px-3 py-2 h-9 transition-all duration-200 shadow-sm hover:shadow-md font-medium gap-2",
            className
          )}
        >
          <div className="flex items-center -space-x-1">
            {displayParticipants.map((participant, index) => (
              <div
                key={participant.id}
                className={cn(
                  "relative",
                  index > 0 && "ml-0.5" // Slight overlap
                )}
              >
                <Avatar className="h-5 w-5 border-2 border-background">
                  <AvatarImage src={participant.users.profile_image || undefined} />
                  <AvatarFallback className="text-xs">
                    {participant.users.display_name?.[0] || participant.users.email[0]}
                  </AvatarFallback>
                </Avatar>
                {/* Online indicator */}
                {isOnline(participant.last_active_at) && (
                  <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 bg-green-500 rounded-full border border-background" />
                )}
              </div>
            ))}
            {remainingCount > 0 && (
              <div className="flex items-center justify-center w-5 h-5 bg-muted rounded-full border-2 border-background ml-0.5">
                <span className="text-xs font-medium text-muted-foreground">
                  +{remainingCount}
                </span>
              </div>
            )}
          </div>
          <span className="text-sm font-medium">{participants.length}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-4" align="end">
        <div className="space-y-4">
          {/* Header */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <h4 className="font-medium">{t("participants.title")}</h4>
            </div>
            <p className="text-sm text-muted-foreground">{roomTitle}</p>
          </div>

          {/* Invite actions */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={copyInviteCode}
              className="flex-1 h-8"
            >
              <Copy className="h-3 w-3 mr-1" />
              {t("participants.copyCode")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={copyInviteLink}
              className="flex-1 h-8"
            >
              <Copy className="h-3 w-3 mr-1" />
              {t("participants.copyLink")}
            </Button>
          </div>

          <Separator />

          {/* Participants list */}
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {sortedParticipants.map((participant) => {
              const online = isOnline(participant.last_active_at)
              const isCurrentUser = participant.user_id === currentUserId
              
              return (
                <div
                  key={participant.id}
                  className={cn(
                    "flex items-center gap-3 p-2 rounded-lg transition-colors",
                    isCurrentUser && "bg-muted/50"
                  )}
                >
                  <div className="relative">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={participant.users.profile_image || undefined} />
                      <AvatarFallback className="text-sm">
                        {participant.users.display_name?.[0] || participant.users.email[0]}
                      </AvatarFallback>
                    </Avatar>
                    {/* Online indicator */}
                    <div 
                      className={cn(
                        "absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-background",
                        online ? "bg-green-500" : "bg-gray-300"
                      )}
                    />
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">
                        {participant.users.display_name || participant.users.email}
                        {isCurrentUser && ` ${t("participants.you")}`}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge 
                        variant="outline"
                        className={cn("text-xs px-1.5 py-0.5 h-5", getRoleColor(participant.role))}
                      >
                        {getRoleIcon(participant.role)}
                        <span className="ml-1 capitalize">{participant.role}</span>
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {online ? t("participants.online") : t("participants.offline")}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
} 