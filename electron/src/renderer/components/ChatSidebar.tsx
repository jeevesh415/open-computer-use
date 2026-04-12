import React from 'react'
import { useChatStore, ChatSummary } from '../stores/chat-store'

function stripFileTags(text: string): string {
  return text
    .replace(/<file\s[^>]*>[^<]*<\/file>\n?/g, '')
    .replace(/<directory\s[^>]*>[^<]*<\/directory>\n?/g, '')
    .trim()
}

interface ChatSidebarProps {
  isOpen: boolean
  onClose: () => void
}

export function ChatSidebar({ isOpen, onClose }: ChatSidebarProps) {
  const { chatList, chatListLoading, chatId, loadChatList, loadChat, removeChat, clearMessages } = useChatStore()

  // Refresh list when sidebar opens
  React.useEffect(() => {
    if (isOpen) {
      loadChatList()
    }
  }, [isOpen])

  const handleSelectChat = (id: string) => {
    if (id === chatId) return
    loadChat(id)
    onClose()
  }

  const handleNewChat = () => {
    clearMessages()
    onClose()
  }

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    removeChat(id)
  }

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={onClose}
      />

      {/* Sidebar panel */}
      <div className="fixed left-0 top-0 bottom-0 w-72 bg-neutral-900 border-r border-neutral-800 z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
          <span className="text-sm font-semibold text-neutral-200">Chat History</span>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-200 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* New Chat button */}
        <div className="px-3 py-2">
          <button
            onClick={handleNewChat}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-neutral-300 hover:bg-neutral-800 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New Chat
          </button>
        </div>

        {/* Chat list */}
        <div className="flex-1 overflow-y-auto px-3 pb-3">
          {chatListLoading && chatList.length === 0 && (
            <div className="text-xs text-neutral-500 text-center py-8">Loading...</div>
          )}

          {!chatListLoading && chatList.length === 0 && (
            <div className="text-xs text-neutral-500 text-center py-8">No chats yet</div>
          )}

          {chatList.map((chat) => (
            <ChatItem
              key={chat.id}
              chat={chat}
              isActive={chat.id === chatId}
              onSelect={() => handleSelectChat(chat.id)}
              onDelete={(e) => handleDelete(e, chat.id)}
            />
          ))}
        </div>
      </div>
    </>
  )
}

function ChatItem({
  chat,
  isActive,
  onSelect,
  onDelete,
}: {
  chat: ChatSummary
  isActive: boolean
  onSelect: () => void
  onDelete: (e: React.MouseEvent) => void
}) {
  const timeAgo = formatTimeAgo(chat.updated_at || chat.created_at)

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left px-3 py-2.5 rounded-lg mb-0.5 group transition-colors ${
        isActive
          ? 'bg-neutral-800 text-neutral-100'
          : 'text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">
            {chat.title || 'Untitled'}
          </div>
          {chat.last_message_preview && (
            <div className="text-xs text-neutral-500 truncate mt-0.5">
              {stripFileTags(chat.last_message_preview)}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          <span className="text-[10px] text-neutral-600">{timeAgo}</span>
          <button
            onClick={onDelete}
            className="opacity-0 group-hover:opacity-100 text-neutral-500 hover:text-red-400 transition-all p-0.5"
            title="Delete chat"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-2 14H7L5 6" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
            </svg>
          </button>
        </div>
      </div>
    </button>
  )
}

function formatTimeAgo(dateStr: string | null): string {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHrs = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'now'
  if (diffMins < 60) return `${diffMins}m`
  if (diffHrs < 24) return `${diffHrs}h`
  if (diffDays < 7) return `${diffDays}d`
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
