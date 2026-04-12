"use client"

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "@/components/ui/toast"
import { useUser } from "@/lib/user-store/provider"
import { useChats } from "@/lib/chat-store/chats/provider"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { useTranslations } from "next-intl"
import { motion } from "framer-motion"
import { Users, UserPlus, ArrowRight, Loader2 } from "lucide-react"

interface JoinRoomDialogContentProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onRoomJoined?: () => void
}

export function JoinRoomDialogContent({ open, onOpenChange, onRoomJoined }: JoinRoomDialogContentProps) {
  const t = useTranslations("collaborative")
  const [inviteCode, setInviteCode] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const { user } = useUser()
  const { refresh } = useChats()
  const router = useRouter()
  const isLoggedIn = !!user

  const handleJoinRoom = async () => {
    if (!isLoggedIn) return

    if (!inviteCode.trim()) {
      toast({
        title: t("joinRoom.enterCode"),
        status: "error",
      })
      return
    }

    try {
      setIsLoading(true)
      
      const response = await fetch("/api/collaborative-rooms/join", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inviteCode: inviteCode.trim(),
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to join room")
      }

      const { chatId } = await response.json()
      
      // Refresh the chats list to include the joined room
      await refresh()
      
      // Reset form
      setInviteCode("")
      
      // Close dialog
      onOpenChange(false)
      
      // Navigate to the room
      router.push(`/c/${chatId}`)
      
      // Call the callback if provided
      if (onRoomJoined) {
        onRoomJoined()
      }
      
      toast({
        title: t("joinRoom.joinSuccess"),
        status: "success",
      })
    } catch (error) {
      toast({
        title: t("joinRoom.joinFailed"),
        description: error instanceof Error ? error.message : t("joinRoom.invalidCode"),
        status: "error",
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-center pb-4">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.1, type: "spring", stiffness: 200 }}
            className="mx-auto mb-4 w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center"
          >
            <Users className="h-6 w-6 text-primary" />
          </motion.div>
          <DialogTitle className="text-xl">{t("joinRoom.title")}</DialogTitle>
          <DialogDescription>
            {t("joinRoom.description")}
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="invite-code" className="text-sm font-medium">
              {t("joinRoom.inviteCode")}
            </Label>
            <Input
              id="invite-code"
              placeholder={t("joinRoom.placeholder")}
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !isLoading) {
                  handleJoinRoom()
                }
              }}
              className="uppercase text-center text-lg font-mono"
              maxLength={10}
            />
            <p className="text-xs text-muted-foreground text-center">
              {t("joinRoom.hint")}
            </p>
          </div>
        </div>
        
        <DialogFooter className="gap-2 sm:gap-0">
          <Button 
            variant="outline" 
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            {t("joinRoom.cancel")}
          </Button>
          <Button
            onClick={handleJoinRoom}
            disabled={isLoading || !inviteCode.trim()}
            className="min-w-[120px]"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t("joinRoom.joining")}
              </>
            ) : (
              <>
                <UserPlus className="mr-2 h-4 w-4" />
                {t("joinRoom.joinButton")}
                <ArrowRight className="ml-2 h-4 w-4" />
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}