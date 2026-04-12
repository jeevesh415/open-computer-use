import React from 'react'
import type { ChatMessage } from '../stores/chat-store'
import { useChatStore } from '../stores/chat-store'
import { useAuthStore } from '../stores/auth-store'
import { MessageItem } from './MessageItem'
import { hasCuaSections } from './CuaSectionRenderer'
import { AwaitingHumanBanner } from './AwaitingHumanBanner'

interface Props {
  messages: ChatMessage[]
  isStreaming: boolean
}

export function MessageList({ messages, isStreaming }: Props) {
  const bottomRef = React.useRef<HTMLDivElement>(null)
  const user = useAuthStore((s) => s.user)
  const awaitingHuman = useChatStore((s) => s.awaitingHuman)
  const setAwaitingHuman = useChatStore((s) => s.setAwaitingHuman)
  const clearAwaitingHuman = React.useCallback(() => setAwaitingHuman(null), [setAwaitingHuman])

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isStreaming])

  if (messages.length === 0) {
    const displayName = user?.name?.split(' ')[0]
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center mb-2">
          <h1
            className="text-3xl font-bold tracking-tight leading-relaxed pb-1 flex items-center justify-center gap-1.5 flex-wrap"
            style={{ fontFamily: "'Caveat', cursive" }}
          >
            <span className="inline-block -rotate-1 text-neutral-100/90">Hello</span>
            {displayName && (
              <span className="inline-block -rotate-1 text-neutral-100/90">, {displayName}</span>
            )}
            <span className="inline-block -rotate-1 text-neutral-100/90">!</span>
          </h1>
          <p className="text-neutral-500 text-sm mt-1">
            I'll handle the computer work. What's the task?
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
      {messages.map((msg, i) => (
        <MessageItem
          key={msg.id}
          message={msg}
          isStreaming={isStreaming}
          isLast={i === messages.length - 1}
        />
      ))}

      {/* Store-level awaiting human banner — only shown when the 'h' SSE
          event fires but the message content does NOT already contain an
          inline <cua-section type="awaiting-human"> tag (which the
          CuaSectionRenderer handles). Without this guard, the banner
          renders twice. */}
      {awaitingHuman && isStreaming && (() => {
        const last = messages[messages.length - 1]
        const alreadyInline = last?.role === 'assistant' && last.content &&
          hasCuaSections(last.content) && last.content.includes('awaiting-human')
        if (alreadyInline) return null
        return (
          <div className="px-2">
            <AwaitingHumanBanner
              reason={awaitingHuman.reason}
              machineId={awaitingHuman.machineId}
              since={awaitingHuman.since}
              isActive
              onResume={clearAwaitingHuman}
            />
          </div>
        )
      })()}

      {isStreaming && !awaitingHuman && (
        <div className="flex items-center gap-2 text-neutral-500 text-sm pl-4">
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Processing...
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  )
}
