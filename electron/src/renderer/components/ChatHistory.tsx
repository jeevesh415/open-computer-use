import React from 'react'
import { useChatStore, type ChatSummary } from '../stores/chat-store'

/** Strip <file> and <directory> tags from a preview string */
function stripFileTags(text: string): string {
  return text
    .replace(/<file\s[^>]*>[^<]*<\/file>\n?/g, '')
    .replace(/<directory\s[^>]*>[^<]*<\/directory>\n?/g, '')
    .trim()
}

interface Props {
  onSelectChat: (chatId: string) => void
  onBack: () => void
}

function groupChats(chats: ChatSummary[]) {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const weekAgo = todayStart - 7 * 24 * 60 * 60 * 1000
  const monthAgo = todayStart - 30 * 24 * 60 * 60 * 1000

  const groups: { label: string; chats: ChatSummary[] }[] = [
    { label: 'Today', chats: [] },
    { label: 'Last 7 days', chats: [] },
    { label: 'Last 30 days', chats: [] },
    { label: 'Older', chats: [] },
  ]

  for (const chat of chats) {
    const ts = new Date(chat.updated_at || chat.created_at || 0).getTime()
    if (ts >= todayStart) groups[0].chats.push(chat)
    else if (ts >= weekAgo) groups[1].chats.push(chat)
    else if (ts >= monthAgo) groups[2].chats.push(chat)
    else groups[3].chats.push(chat)
  }

  return groups.filter((g) => g.chats.length > 0)
}

function ChatItem({ chat, isActive, onSelect, onDelete }: {
  chat: ChatSummary
  isActive: boolean
  onSelect: () => void
  onDelete: () => void
}) {
  const [confirmDelete, setConfirmDelete] = React.useState(false)

  return (
    <button
      onClick={onSelect}
      className={`group w-full flex items-start gap-2.5 px-3 py-2 rounded-lg text-left transition-colors ${
        isActive
          ? 'bg-neutral-800/80 ring-1 ring-neutral-700/50'
          : 'hover:bg-neutral-800/50'
      }`}
    >
      {/* Chat icon */}
      <svg
        width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
        className="text-neutral-600 mt-0.5 flex-shrink-0"
      >
        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
      </svg>

      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-medium text-neutral-300 truncate leading-tight">
          {chat.title || 'Untitled'}
        </div>
        {chat.last_message_preview && (
          <div className="text-[10px] text-neutral-600 truncate mt-0.5 leading-tight">
            {stripFileTags(chat.last_message_preview)}
          </div>
        )}
      </div>

      {/* Delete button */}
      {confirmDelete ? (
        <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete() }}
            className="text-[9px] px-1.5 py-0.5 rounded bg-red-600/20 text-red-400 hover:bg-red-600/30 transition-colors"
          >
            Delete
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setConfirmDelete(false) }}
            className="text-[9px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400 hover:bg-neutral-700 transition-colors"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={(e) => { e.stopPropagation(); setConfirmDelete(true) }}
          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-neutral-700/50 text-neutral-600 hover:text-red-400 transition-all flex-shrink-0"
          title="Delete chat"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
          </svg>
        </button>
      )}
    </button>
  )
}

export function ChatHistory({ onSelectChat, onBack }: Props) {
  const { chatList, chatListLoading, chatId, loadChatList, removeChat } = useChatStore()

  React.useEffect(() => {
    loadChatList()
  }, [])

  const groups = groupChats(chatList)

  return (
    <div className="flex flex-col flex-1 min-h-0 animate-chat-reveal">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-neutral-800/50">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 px-2 py-1 -ml-1 rounded-lg hover:bg-neutral-800/60 text-neutral-400 hover:text-neutral-200 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          <span className="text-[11px] font-medium">Back</span>
        </button>
        <div className="flex-1" />
        <span className="text-[11px] font-medium text-neutral-500">Chat History</span>
        <button
          onClick={() => loadChatList()}
          className="p-1 rounded-lg hover:bg-neutral-800/60 text-neutral-500 hover:text-neutral-300 transition-colors ml-1"
          title="Refresh"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
          </svg>
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-3">
        {chatListLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="flex items-center gap-2 text-neutral-500 text-xs">
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Loading...
            </div>
          </div>
        ) : groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-700 mb-2">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
            </svg>
            <span className="text-[11px] text-neutral-600">No chats yet</span>
            <span className="text-[10px] text-neutral-700 mt-0.5">Start a new task to begin</span>
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.label}>
              <div className="px-2 pb-1">
                <span className="text-[9px] font-medium text-neutral-600 uppercase tracking-widest">
                  {group.label}
                </span>
              </div>
              <div className="space-y-0.5">
                {group.chats.map((chat) => (
                  <ChatItem
                    key={chat.id}
                    chat={chat}
                    isActive={chat.id === chatId}
                    onSelect={() => onSelectChat(chat.id)}
                    onDelete={() => removeChat(chat.id)}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
