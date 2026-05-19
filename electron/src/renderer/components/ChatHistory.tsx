import React from 'react'
import { useChatStore, type ChatSummary } from '../stores/chat-store'

interface Props {
  onSelectChat: (chatId: string) => void
  onBack: () => void
}

/* ─── helpers ────────────────────────────────────────────── */

function stripFileTags(text: string): string {
  return text
    .replace(/<file\s[^>]*>[^<]*<\/file>\n?/g, '')
    .replace(/<directory\s[^>]*>[^<]*<\/directory>\n?/g, '')
    .trim()
}

/** Compact relative timestamp — Now · 4m · 2h · Yesterday · 3d · Mar 4 */
function relativeTime(ts: string | null | undefined): string {
  if (!ts) return ''
  const date = new Date(ts)
  const diff = Date.now() - date.getTime()
  if (diff < 0) return 'Now'
  const sec = Math.floor(diff / 1000)
  if (sec < 30) return 'Now'
  const min = Math.floor(sec / 60)
  if (min < 1) return `${sec}s`
  const hr = Math.floor(min / 60)
  if (hr < 1) return `${min}m`
  const day = Math.floor(hr / 24)
  if (day < 1) return `${hr}h`
  if (day === 1) return 'Yesterday'
  if (day < 7) return `${day}d`
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
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

/* ─── HistoryItem ────────────────────────────────────────── */

function HistoryItem({
  chat, isActive, onSelect, onDelete,
}: {
  chat: ChatSummary
  isActive: boolean
  onSelect: () => void
  onDelete: () => void
}) {
  const [confirming, setConfirming] = React.useState(false)
  const time = relativeTime(chat.updated_at || chat.created_at)
  const preview = chat.last_message_preview ? stripFileTags(chat.last_message_preview) : ''

  // Click anywhere outside the confirming row cancels — defer one tick so
  // the same click that opened the confirmation doesn't immediately close it.
  React.useEffect(() => {
    if (!confirming) return
    const handler = () => setConfirming(false)
    const timer = window.setTimeout(() => document.addEventListener('click', handler), 0)
    return () => { window.clearTimeout(timer); document.removeEventListener('click', handler) }
  }, [confirming])

  if (confirming) {
    return (
      <div
        onClick={(e) => e.stopPropagation()}
        className="px-3 py-2 rounded-xl flex items-center gap-2.5 animate-chat-reveal"
        style={{
          background: 'rgba(239, 68, 68, 0.06)',
          boxShadow: 'inset 0 0 0 0.5px rgba(239,68,68,0.22)',
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-400 flex-shrink-0">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
        </svg>
        <span className="flex-1 text-[11px] text-red-200/90 truncate tracking-tight">
          Delete "{chat.title || 'Untitled'}"?
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); setConfirming(false) }}
          className="press-scale text-[10.5px] px-2 py-[3px] rounded-full text-neutral-400 hover:text-neutral-100 hover:bg-white/[0.06] transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="press-scale text-[10.5px] px-2 py-[3px] rounded-full font-medium text-white bg-red-500 hover:bg-red-400 transition-colors"
          style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.2), 0 0 0 0.5px rgba(255,255,255,0.15) inset' }}
        >
          Delete
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={onSelect}
      className={`group relative w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-colors ${
        isActive ? 'bg-white/[0.05]' : 'hover:bg-white/[0.03]'
      }`}
    >
      {/* Active accent — 2px rounded bar tucked at the left edge */}
      {isActive && (
        <span
          aria-hidden="true"
          className="absolute left-1 top-1/2 -translate-y-1/2 w-[2px] h-4 rounded-full bg-white/80"
        />
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className={`text-[12px] font-medium truncate tracking-tight flex-1 ${isActive ? 'text-neutral-50' : 'text-neutral-200'}`}>
            {chat.title || 'Untitled'}
          </span>
          <span className="text-[10px] text-neutral-600 flex-shrink-0 tabular-nums group-hover:opacity-0 transition-opacity">
            {time}
          </span>
        </div>
        {preview && (
          <div className="text-[10.5px] text-neutral-500 truncate mt-0.5 leading-tight">
            {preview}
          </div>
        )}
      </div>

      {/* Hover-reveal trash — sits in the same slot as the timestamp */}
      <span
        onClick={(e) => { e.stopPropagation(); setConfirming(true) }}
        role="button"
        aria-label="Delete chat"
        title="Delete chat"
        className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 press-scale flex-shrink-0 p-1 rounded-md hover:bg-red-500/12 text-neutral-500 hover:text-red-400 transition-all cursor-pointer"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
        </svg>
      </span>
    </button>
  )
}

/* ─── ChatHistory ────────────────────────────────────────── */

export function ChatHistory({ onSelectChat, onBack }: Props) {
  const { chatList, chatListLoading, chatId, loadChatList, removeChat } = useChatStore()
  const [query, setQuery] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    loadChatList()
  }, [])

  // Auto-focus the search input on mount for keyboard-first navigation
  React.useEffect(() => {
    const t = window.setTimeout(() => inputRef.current?.focus(), 240)
    return () => window.clearTimeout(t)
  }, [])

  const filtered = React.useMemo(() => {
    if (!query.trim()) return chatList
    const q = query.toLowerCase()
    return chatList.filter((c) =>
      (c.title?.toLowerCase().includes(q) ?? false)
      || (c.last_message_preview?.toLowerCase().includes(q) ?? false),
    )
  }, [chatList, query])

  const groups = groupChats(filtered)
  const total = filtered.length

  return (
    <div className="flex flex-col flex-1 min-h-0 animate-chat-reveal">
      {/* ── Header ── */}
      <div className="flex items-center gap-2 px-3 py-2 flex-shrink-0">
        <button
          onClick={onBack}
          className="press-scale flex items-center gap-1 px-1.5 py-1 -ml-0.5 rounded-md hover:bg-white/[0.06] text-neutral-400 hover:text-neutral-100 transition-colors"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          <span className="text-[11px] font-medium tracking-tight">Back</span>
        </button>
        <div className="flex-1" />
        <span className="text-[11.5px] font-medium text-neutral-300/90 tracking-tight">History</span>
        <div className="flex-1" />
        <button
          onClick={() => loadChatList()}
          className="press-scale p-1 rounded-md hover:bg-white/[0.06] text-neutral-500 hover:text-neutral-200 transition-colors"
          title="Refresh"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={chatListLoading ? 'animate-spin' : ''}>
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
          </svg>
        </button>
      </div>

      {/* ── Search ── */}
      <div className="px-3 pt-1 pb-2 flex-shrink-0">
        <div className="relative">
          <svg
            width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-600 pointer-events-none"
          >
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search history…"
            className="titlebar-no-drag w-full pl-8 pr-8 py-1.5 rounded-full bg-white/[0.035] text-[12px] text-neutral-100 placeholder-neutral-500 outline-none transition-all focus:bg-white/[0.055] tracking-tight"
            style={{ boxShadow: 'inset 0 0 0 0.5px rgba(255,255,255,0.07)' }}
          />
          {query && (
            <button
              onClick={() => { setQuery(''); inputRef.current?.focus() }}
              className="press-scale absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-white/[0.08] text-neutral-500 hover:text-neutral-100 transition-colors"
              title="Clear"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
        {query && (
          <div className="px-1 pt-1.5 text-[10px] text-neutral-500 tracking-tight">
            {total} {total === 1 ? 'result' : 'results'}
          </div>
        )}
      </div>

      {/* ── List ── */}
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-3">
        {chatListLoading ? (
          <div className="flex items-center justify-center py-12">
            <svg className="w-4 h-4 animate-spin text-neutral-500" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        ) : groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-center">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-700">
              {query
                ? <><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></>
                : <><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></>}
            </svg>
            <span className="text-[11.5px] text-neutral-500 mt-3 tracking-tight">
              {query ? 'No matches' : 'No tasks yet'}
            </span>
            <span className="text-[10px] text-neutral-600 mt-0.5 tracking-tight">
              {query ? 'Try a different search' : 'Start a new task to begin'}
            </span>
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.label}>
              <div className="px-3 pb-1">
                <span className="text-[9px] font-semibold text-neutral-600 uppercase tracking-widest">
                  {group.label}
                </span>
              </div>
              <div className="space-y-0.5">
                {group.chats.map((chat) => (
                  <HistoryItem
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
