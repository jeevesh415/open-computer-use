import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
} from "@/components/prompt-kit/message"
import { useUserPreferences } from "@/lib/user-preference-store/provider"
import { cn } from "@/lib/utils"
import type { Message as MessageAISDK } from "@ai-sdk/react"
import { useMemo } from "react"
import { useTranslations } from "next-intl"
import { ArrowClockwise, Check, Copy } from "@phosphor-icons/react"
import { getSources } from "./get-sources"
import { Reasoning } from "./reasoning"
import { SearchImages } from "./search-images"
import { SourcesList } from "./sources-list"
import { MessageFeedbackButton } from "./message-feedback-button"
import { useProjectNavigator } from "@/lib/project-navigator-store/provider"
import { useChats } from "@/lib/chat-store/chats/provider"
import { useChatSession } from "@/lib/chat-store/session/provider"
import { TaskPlanFormatter } from "./task-plan-formatter"
import { MessageStatusIndicator } from "./message-status-indicator"
import { CuaSectionRenderer, hasCuaSections, extractScreenshots } from "./cua-section-renderer"
import { MessageStopBanner, detectStopReason, stripStopTags } from "./message-stop-banner"

type MessageAssistantProps = {
  children: string
  messageId?: string
  isLast?: boolean
  hasScrollAnchor?: boolean
  copied?: boolean
  copyToClipboard?: () => void
  onReload?: () => void
  parts?: MessageAISDK["parts"]
  status?: "streaming" | "ready" | "submitted" | "error"
  className?: string
  isChunked?: boolean | null
  isCompressed?: boolean | null
  truncated?: boolean | null
  contentSize?: number
}

export function MessageAssistant({
  children,
  messageId,
  isLast,
  hasScrollAnchor,
  copied,
  copyToClipboard,
  onReload,
  parts,
  status,
  className,
  isChunked,
  isCompressed,
  truncated,
  contentSize,
}: MessageAssistantProps) {
  const { preferences } = useUserPreferences()
  const t = useTranslations("chatMessages")
  const sources = getSources(parts)
  const { isOpen: isNavigatorOpen, width: navigatorWidth } = useProjectNavigator()
  const { chatId } = useChatSession()
  const { getChatById } = useChats()
  
  const currentChat = chatId ? getChatById(chatId) : null
  const isProject = currentChat?.collaborative === true

  const reasoningParts = parts?.find((part) => part.type === "reasoning")
  const isLastStreaming = status === "streaming" && isLast

  // Detect stop/cancellation tags and strip them from display content
  const stopReason = children ? detectStopReason(children) : null
  const displayContent = stopReason ? stripStopTags(children) : children
  const contentNullOrEmpty = displayContent === null || displayContent === ""

  // Check if content contains task plan or report markers
  const hasTaskPlan = displayContent?.includes?.('[TASK_PLAN_START]')
  const hasCoastyReport = displayContent?.includes?.('[Coasty_REPORT_START]')
  const hasTaskMarkers = hasTaskPlan || hasCoastyReport
  const hasCuaTags = displayContent ? hasCuaSections(displayContent) : false
  const cuaScreenshots = useMemo(
    () => (hasCuaTags ? extractScreenshots(parts as any) : []),
    [hasCuaTags, parts]
  )
  const searchImageResults =
    parts
      ?.filter(
        (part) =>
          part.type === "tool-invocation" &&
          part.toolInvocation?.state === "result" &&
          part.toolInvocation?.toolName === "imageSearch" &&
          part.toolInvocation?.result?.content?.[0]?.type === "images"
      )
      .flatMap((part) =>
        part.type === "tool-invocation" &&
        part.toolInvocation?.state === "result" &&
        part.toolInvocation?.toolName === "imageSearch" &&
        part.toolInvocation?.result?.content?.[0]?.type === "images"
          ? (part.toolInvocation?.result?.content?.[0]?.results ?? [])
          : []
      ) ?? []

  return (
    <Message
      className={cn(
        "group flex w-full flex-1 items-start gap-4 pb-2",
        hasScrollAnchor && "min-h-scroll-anchor",
        className
      )}
    >
      <div className={cn("flex w-full flex-col gap-2", isLast && "pb-8")}>
        {/* Message status indicators for large/chunked messages */}
        {(isChunked || isCompressed || truncated) && (
          <MessageStatusIndicator
            isChunked={isChunked}
            isCompressed={isCompressed}
            truncated={truncated}
            contentSize={contentSize}
            className="mb-1"
          />
        )}
        
        {reasoningParts && reasoningParts.reasoning && (
          <Reasoning
            reasoning={reasoningParts.reasoning}
            isStreaming={status === "streaming"}
          />
        )}

        {/* Tool invocations removed - now shown above chat input */}

        {searchImageResults.length > 0 && (
          <SearchImages results={searchImageResults} />
        )}

        {contentNullOrEmpty ? null : hasTaskMarkers ? (
          // Use TaskPlanFormatter for messages with task plans or reports
          <TaskPlanFormatter content={displayContent} isStreaming={status === "streaming"} />
        ) : hasCuaTags ? (
          // CUA agent sections with structured rendering
          <div className="bg-muted rounded-3xl px-5 py-3 max-w-none">
            <CuaSectionRenderer
              content={displayContent}
              screenshots={cuaScreenshots}
              isStreaming={status === "streaming"}
            />
          </div>
        ) : (
          // Regular markdown content
          <MessageContent
            className={cn(
              "prose dark:prose-invert relative bg-muted rounded-3xl px-5 py-2.5 max-w-none",
              "prose-h1:scroll-m-20 prose-h1:text-2xl prose-h1:font-semibold prose-h2:mt-8 prose-h2:scroll-m-20 prose-h2:text-xl prose-h2:mb-3 prose-h2:font-medium prose-h3:scroll-m-20 prose-h3:text-base prose-h3:font-medium prose-h4:scroll-m-20 prose-h5:scroll-m-20 prose-h6:scroll-m-20 prose-strong:font-medium prose-table:block prose-table:overflow-y-auto"
            )}
            markdown={true}
          >
            {displayContent}
          </MessageContent>
        )}

        {stopReason && (
          <MessageStopBanner
            config={stopReason}
            onRetry={onReload}
            className="mt-2"
          />
        )}

        {sources && sources.length > 0 && <SourcesList sources={sources} />}

        {Boolean(isLastStreaming || contentNullOrEmpty) ? null : (
          <MessageActions
            className={cn(
              "-ml-2 flex gap-0 sm:opacity-0 transition-opacity sm:group-hover:opacity-100"
            )}
          >
            <MessageAction
              tooltip={copied ? t("copied") : t("copyText")}
              side="bottom"
            >
              <button
                className="hover:bg-accent/60 text-muted-foreground hover:text-foreground flex size-7.5 items-center justify-center rounded-full bg-transparent transition"
                aria-label={t("copyText")}
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
            {isLast ? (
              <MessageAction
                tooltip={t("regenerate")}
                side="bottom"
                delayDuration={0}
              >
                <button
                  className="hover:bg-accent/60 text-muted-foreground hover:text-foreground flex size-7.5 items-center justify-center rounded-full bg-transparent transition"
                  aria-label={t("regenerate")}
                  onClick={onReload}
                  type="button"
                >
                  <ArrowClockwise className="size-4" />
                </button>
              </MessageAction>
            ) : null}
            <MessageFeedbackButton />
          </MessageActions>
        )}

      </div>
    </Message>
  )
}
