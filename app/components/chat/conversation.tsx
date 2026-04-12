import {
  ChatContainerContent,
  ChatContainerRoot,
} from "@/components/prompt-kit/chat-container"
import { Loader } from "@/components/prompt-kit/loader"
import { Message as MessageType } from "@ai-sdk/react"
import { useRef, useEffect, useState, useCallback, useLayoutEffect } from "react"
import { Message } from "./message"
import { motion, AnimatePresence } from "motion/react"
import { ChevronUp } from "lucide-react"
import { useMessages } from "@/lib/chat-store/messages/provider"
import { useProjectNavigator } from "@/lib/project-navigator-store/provider"
import { useChats } from "@/lib/chat-store/chats/provider"
import { useChatSession } from "@/lib/chat-store/session/provider"
import { cn } from "@/lib/utils"

/** Number of messages (not turns) to show initially — roughly 2 user+assistant turns */
const INITIAL_VISIBLE = 4
/** How many more messages to reveal per "load more" click */
const LOAD_MORE_STEP = 10

type ConversationProps = {
  messages: MessageType[]
  status?: "streaming" | "ready" | "submitted" | "error"
  onDelete: (id: string) => void
  onEdit: (id: string, newText: string) => void
  onReload: () => void
}

export function Conversation({
  messages,
  status = "ready",
  onDelete,
  onEdit,
  onReload,
}: ConversationProps) {
  const { isLoading, syncStatus } = useMessages()
  const initialMessageCount = useRef(messages.length)
  const { isOpen: isNavigatorOpen } = useProjectNavigator()
  const { chatId } = useChatSession()
  const { getChatById } = useChats()

  const currentChat = chatId ? getChatById(chatId) : null
  const isProject = currentChat?.collaborative === true

  // ── Pagination state ──────────────────────────────────────────────
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE)
  const prevChatIdRef = useRef(chatId)
  const isLoadingMoreRef = useRef(false)
  const scrollContainerRef = useRef<HTMLElement | null>(null)
  const prevScrollHeightRef = useRef(0)

  // Reset pagination when switching chats
  useEffect(() => {
    if (chatId !== prevChatIdRef.current) {
      setVisibleCount(INITIAL_VISIBLE)
      prevChatIdRef.current = chatId
    }
  }, [chatId])

  // Always show at least up to the current tail — keeps new streaming
  // messages visible without the user having to "load more"
  const effectiveVisible = Math.max(visibleCount, Math.min(INITIAL_VISIBLE, messages.length))
  const totalCount = messages.length
  const hasMore = totalCount > effectiveVisible
  const hiddenCount = Math.max(0, totalCount - effectiveVisible)
  const visibleMessages = hasMore
    ? messages.slice(totalCount - effectiveVisible)
    : messages

  // Preserve scroll position when loading older messages
  const handleLoadMore = useCallback(() => {
    const scrollEl = scrollContainerRef.current ?? document.querySelector('[role="log"]')
    if (scrollEl) {
      scrollContainerRef.current = scrollEl as HTMLElement
      prevScrollHeightRef.current = scrollEl.scrollHeight
      isLoadingMoreRef.current = true
    }
    setVisibleCount((prev) => Math.min(prev + LOAD_MORE_STEP, totalCount))
  }, [totalCount])

  // After DOM updates from "load more", restore scroll so the user's
  // viewport doesn't jump.
  useLayoutEffect(() => {
    if (!isLoadingMoreRef.current) return
    const scrollEl = scrollContainerRef.current
    if (scrollEl && prevScrollHeightRef.current > 0) {
      const diff = scrollEl.scrollHeight - prevScrollHeightRef.current
      scrollEl.scrollTop += diff
    }
    prevScrollHeightRef.current = 0
    isLoadingMoreRef.current = false
  })

  if (!messages || messages.length === 0)
    return <div className="h-full w-full"></div>

  return (
    <div className="relative flex h-full w-full flex-col items-center overflow-hidden no-scrollbar scroll-container">
      <ChatContainerRoot className="relative w-full h-full">
        <ChatContainerContent
          className="flex w-full flex-col items-center pt-4 pb-4"
        >
          <div className={cn(
            "w-full px-8 sm:px-10 md:px-12",
            !isProject || !isNavigatorOpen ? "max-w-[44rem]" : "max-w-[47rem]",
            "mx-auto"
          )}>
            {/* ── Load earlier messages ────────────────────────────── */}
            {hasMore && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="mb-3"
              >
                <button
                  onClick={handleLoadMore}
                  className={cn(
                    "group w-full flex items-center justify-center gap-2",
                    "py-2.5 rounded-xl text-xs font-medium",
                    "text-muted-foreground/70 hover:text-foreground",
                    "bg-muted/30 hover:bg-muted/60",
                    "border border-transparent hover:border-border/40",
                    "transition-all duration-200 ease-out",
                    "cursor-pointer select-none"
                  )}
                >
                  <ChevronUp className="h-3.5 w-3.5 transition-transform duration-200 group-hover:-translate-y-0.5" />
                  <span>
                    Load {Math.min(LOAD_MORE_STEP, hiddenCount)} earlier message{Math.min(LOAD_MORE_STEP, hiddenCount) !== 1 ? "s" : ""}
                  </span>
                  <span className="text-muted-foreground/40">
                    · {hiddenCount} more
                  </span>
                </button>
              </motion.div>
            )}

            <AnimatePresence initial={false} mode="popLayout">
              {visibleMessages.map((message, index) => {
                const isLast =
                  index === visibleMessages.length - 1 && status !== "submitted"
                const hasScrollAnchor =
                  isLast && messages.length > initialMessageCount.current

                return (
                  <motion.div
                    key={message.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{
                      duration: 0.2,
                      ease: "easeOut",
                    }}
                    layout
                    layoutId={message.id}
                    className="w-full"
                  >
                  <Message
                    id={message.id}
                    variant={message.role}
                    attachments={message.experimental_attachments}
                    isLast={isLast}
                    onDelete={onDelete}
                    onEdit={onEdit}
                    onReload={onReload}
                    hasScrollAnchor={hasScrollAnchor}
                    parts={message.parts}
                    status={status}
                    user_id={(message as any).user_id}
                    users={(message as any).users}
                    isChunked={(message as any).is_chunked}
                    isCompressed={(message as any).is_compressed}
                    truncated={(message as any).truncated}
                    contentSize={message.content ? message.content.length : undefined}
                  >
                    {message.content}
                  </Message>
                </motion.div>
                )
              })}
            </AnimatePresence>
            {(() => {
              if (status === "submitted" && visibleMessages.length > 0) {
                const lastUserIndex = visibleMessages.findLastIndex(m => m.role === "user")
                const hasAssistantAfterLastUser = visibleMessages.some((msg, idx) =>
                  msg.role === "assistant" && idx > lastUserIndex
                )

                const shouldShowLoader = lastUserIndex === visibleMessages.length - 1 &&
                                        !hasAssistantAfterLastUser &&
                                        (syncStatus !== 'idle')

                if (shouldShowLoader) {
                  return (
                    <div className="group min-h-scroll-anchor flex w-full flex-col items-start gap-2 pb-2">
                      <Loader />
                    </div>
                  )
                }
              }
              return null
            })()}
          </div>
        </ChatContainerContent>
      </ChatContainerRoot>
    </div>
  )
}
