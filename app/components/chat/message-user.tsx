"use client"

import {
  MorphingDialog,
  MorphingDialogClose,
  MorphingDialogContainer,
  MorphingDialogContent,
  MorphingDialogImage,
  MorphingDialogTrigger,
} from "@/components/motion-primitives/morphing-dialog"
import {
  MessageAction,
  MessageActions,
  Message as MessageContainer,
  MessageContent,
} from "@/components/prompt-kit/message"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import { Message as MessageType } from "@ai-sdk/react"
import { Check, Copy, Trash } from "@phosphor-icons/react"
import Image from "next/image"
import { useRef, useState } from "react"
import { useMessages } from "@/lib/chat-store/messages/provider"
import { useProjectNavigator } from "@/lib/project-navigator-store/provider"
import { useChats } from "@/lib/chat-store/chats/provider"
import { useChatSession } from "@/lib/chat-store/session/provider"
import { FileAttachmentDisplay } from "./file-attachment-display"
import { useMessageParser } from "./message-parser"

const getTextFromDataUrl = (dataUrl: string) => {
  const base64 = dataUrl.split(",")[1]
  return base64
}

export type MessageUserProps = {
  hasScrollAnchor?: boolean
  attachments?: MessageType["experimental_attachments"]
  children: string
  copied: boolean
  copyToClipboard: () => void
  onEdit: (id: string, newText: string) => void
  onReload: () => void
  onDelete: (id: string) => void
  id: string
  className?: string
  user_id?: string
  users?: {
    display_name: string | null
    profile_image: string | null
    email: string
  }
}

export function MessageUser({
  hasScrollAnchor,
  attachments,
  children,
  copied,
  copyToClipboard,
  onEdit,
  onReload,
  onDelete,
  id,
  className,
  user_id,
  users,
}: MessageUserProps) {
  const [editInput, setEditInput] = useState(children)
  const [isEditing, setIsEditing] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const { isOpen: isNavigatorOpen, width: navigatorWidth, selectedVMId } = useProjectNavigator()
  const { chatId } = useChatSession()
  const { getChatById } = useChats()
  
  const currentChat = chatId ? getChatById(chatId) : null
  const isProject = currentChat?.collaborative === true
  
  // Parse message content to extract file attachments
  const { content: parsedContent, fileAttachments } = useMessageParser(children)
  
  // If there are files but no text, show a default message
  const displayContent = parsedContent || (fileAttachments.length > 0 ? "Files uploaded" : children)

  const handleEditCancel = () => {
    setIsEditing(false)
    setEditInput(children)
  }

  const handleSave = () => {
    if (onEdit) {
      onEdit(id, editInput)
    }
    onReload()
    setIsEditing(false)
  }

  const handleDelete = () => {
    onDelete(id)
  }

  // Get user profile picture and name from collaborative room data or message user data
  const getUserInfo = () => {
    // Always return null since no longer collaborative
    return null
  }

  const userInfo = getUserInfo() as any

  return (
    <MessageContainer
      className={cn(
        "group flex w-full flex-col items-end gap-0.5 pb-2 transition-all duration-200 ease-out",
        hasScrollAnchor && "min-h-scroll-anchor",
        className
      )}
    >
      {/* Display file attachments parsed from message */}
      {fileAttachments && fileAttachments.length > 0 && (
        <>
          {console.log('MessageUser - Rendering FileAttachmentDisplay with:', fileAttachments)}
          <FileAttachmentDisplay
            attachments={fileAttachments.map(f => ({
              name: f.name,
              vmPath: f.vmPath,
              size: f.size // Pass the size from parsed attachment
            }))}
            machineId={selectedVMId}
            className="w-full max-w-[85%] sm:max-w-[75%] md:max-w-[70%]"
          />
        </>
      )}
      
      {attachments?.map((attachment, index) => (
        <div
          className="flex flex-row gap-2"
          key={`${attachment.name}-${index}`}
        >
          {attachment.contentType?.startsWith("image") ? (
            <MorphingDialog
              transition={{
                type: "spring" as const,
                stiffness: 280,
                damping: 18,
                mass: 0.3,
              }}
            >
              <MorphingDialogTrigger className="z-10">
                <Image
                  className="mb-1 w-40 rounded-md"
                  key={attachment.name}
                  src={attachment.url}
                  alt={attachment.name || "Attachment"}
                  width={160}
                  height={120}
                />
              </MorphingDialogTrigger>
              <MorphingDialogContainer>
                <MorphingDialogContent className="relative rounded-lg">
                  <MorphingDialogImage
                    src={attachment.url}
                    alt={attachment.name || ""}
                    className="max-h-[90vh] max-w-[90vw] object-contain"
                  />
                </MorphingDialogContent>
                <MorphingDialogClose className="text-primary" />
              </MorphingDialogContainer>
            </MorphingDialog>
          ) : attachment.contentType?.startsWith("text") ? (
            <div className="text-primary mb-3 h-24 w-40 overflow-hidden rounded-md border p-2 text-xs">
              {getTextFromDataUrl(attachment.url)}
            </div>
          ) : null}
        </div>
      ))}
      {isEditing ? (
        <div
          className="bg-accent relative flex min-w-[180px] flex-col gap-2 rounded-3xl px-5 py-2.5"
          style={{
            width: contentRef.current?.offsetWidth,
          }}
        >
          <textarea
            className="w-full resize-none bg-transparent outline-none"
            value={editInput}
            onChange={(e) => setEditInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                handleSave()
              }
              if (e.key === "Escape") {
                handleEditCancel()
              }
            }}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={handleEditCancel}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave}>
              Save
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-end w-full">
          <MessageContent
            className={cn(
              "bg-accent relative rounded-3xl px-5 py-2.5 transition-all duration-200 ease-out",
              "max-w-[85%] sm:max-w-[75%] md:max-w-[70%]"
            )}
            markdown={true}
            enableMath={false}
            ref={contentRef}
            components={{
              code: ({ children }) => <>{children}</>,
              pre: ({ children }) => <>{children}</>,
              h1: ({ children }) => <p>{children}</p>,
              h2: ({ children }) => <p>{children}</p>,
              h3: ({ children }) => <p>{children}</p>,
              h4: ({ children }) => <p>{children}</p>,
              h5: ({ children }) => <p>{children}</p>,
              h6: ({ children }) => <p>{children}</p>,
              p: ({ children }) => <p>{children}</p>,
              li: ({ children }) => <p>- {children}</p>,
              ul: ({ children }) => <>{children}</>,
              ol: ({ children }) => <>{children}</>,
            }}
          >
            {displayContent}
          </MessageContent>
          
          {/* Avatar removed - no longer collaborative */}
          {false && (
            <div className="flex flex-col items-center gap-1 ml-3 w-16 flex-shrink-0 transition-all duration-200 ease-out">
              <Avatar className="h-8 w-8 border-2 border-background shadow-sm transition-transform duration-200 ease-out hover:scale-105">
                <AvatarImage src={userInfo?.profileImage || undefined} />
                <AvatarFallback className="text-xs font-medium">
                  {userInfo?.displayName?.[0] || userInfo?.email?.[0]?.toUpperCase() || 'U'}
                </AvatarFallback>
              </Avatar>
              <span className="text-xs text-muted-foreground text-center w-full truncate leading-tight">
                {userInfo?.displayName || userInfo?.email?.split('@')[0] || 'User'}
              </span>
            </div>
          )}
        </div>
      )}
      <MessageActions className="flex gap-0 sm:opacity-0 transition-opacity duration-0 sm:group-hover:opacity-100">
        <MessageAction tooltip={copied ? "Copied!" : "Copy text"} side="bottom">
          <button
            className="hover:bg-accent/60 text-muted-foreground hover:text-foreground flex size-7.5 items-center justify-center rounded-full bg-transparent transition"
            aria-label="Copy text"
            onClick={copyToClipboard}
            type="button"
          >
            {copied ? (
              <Check className="size-4" />
            ) : (
              <Copy className="size-4" />
            )}
          </button>
        </MessageAction>
        {/* @todo: add when ready */}
        {/* <MessageAction
          tooltip={isEditing ? "Save" : "Edit"}
          side="bottom"
          delayDuration={0}
        >
          <button
            className="flex h-8 w-8 items-center justify-center rounded-full bg-transparent transition"
            aria-label="Edit"
            onClick={() => setIsEditing(!isEditing)}
            type="button"
          >
            <PencilSimple className="size-4" />
          </button>
        </MessageAction> */}
        {/* Delete functionality temporarily disabled */}
        {/* <MessageAction tooltip="Delete" side="bottom">
          <button
            className="hover:bg-accent/60 text-muted-foreground hover:text-foreground flex size-7.5 items-center justify-center rounded-full bg-transparent transition"
            aria-label="Delete"
            onClick={handleDelete}
            type="button"
          >
            <Trash className="size-4" />
          </button>
        </MessageAction> */}
      </MessageActions>
    </MessageContainer>
  )
}
