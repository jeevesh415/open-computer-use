import React from 'react'
import { useWindowStore } from '../stores/window-store'
import { useConnectionStore } from '../stores/connection-store'
import { useAuthStore } from '../stores/auth-store'
import { useChatSubmit, FileRef } from '../hooks/useChatSubmit'
import { MessageList } from './MessageList'

function statusDot(state: string): string {
  switch (state) {
    case 'connected': return 'bg-emerald-400'
    case 'connecting': return 'bg-yellow-400 animate-pulse'
    case 'error': return 'bg-red-400'
    default: return 'bg-neutral-500'
  }
}

/** Friendly short path: show last 2 segments only */
function shortPath(fullPath: string): string {
  const sep = fullPath.includes('\\') ? '\\' : '/'
  const parts = fullPath.split(sep)
  if (parts.length <= 2) return fullPath
  return '...' + sep + parts.slice(-2).join(sep)
}

/** File extension → icon color */
function extColor(ext: string): string {
  const e = ext.toLowerCase()
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(e)) return 'text-pink-400'
  if (['pdf'].includes(e)) return 'text-red-400'
  if (['doc', 'docx', 'txt', 'md', 'rtf'].includes(e)) return 'text-blue-400'
  if (['xls', 'xlsx', 'csv'].includes(e)) return 'text-green-400'
  if (['js', 'ts', 'tsx', 'jsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h'].includes(e)) return 'text-amber-400'
  if (['json', 'yaml', 'yml', 'toml', 'xml'].includes(e)) return 'text-cyan-400'
  if (['zip', 'tar', 'gz', '7z', 'rar'].includes(e)) return 'text-purple-400'
  return 'text-neutral-400'
}

export function ExpandedPanel() {
  const { toggleExpanded } = useWindowStore()
  const connectionState = useConnectionStore((s) => s.state)
  const { signOut } = useAuthStore()
  const {
    messages, isStreaming, chatTitle,
    canSend, handleSubmit, handleStop, clearMessages,
    isMachineBusy, isStoppingMachine, forceStopAndSend, dismissBusyState,
  } = useChatSubmit()

  const [input, setInput] = React.useState('')
  const [files, setFiles] = React.useState<FileRef[]>([])
  const inputRef = React.useRef<HTMLTextAreaElement>(null)

  // Dismiss busy state when input is cleared so subsequent typing goes
  // through the normal pre-check path. Same pattern as CompactPill.
  React.useEffect(() => {
    if (isMachineBusy && !input.trim()) {
      dismissBusyState()
    }
  }, [input, isMachineBusy, dismissBusyState])

  const onSubmit = (e?: React.FormEvent) => {
    e?.preventDefault()
    if (isMachineBusy) {
      // Yellow Override & Run path: stop the running task, then send.
      forceStopAndSend(input, files.length > 0 ? files : undefined)
      setInput('')
      setFiles([])
      return
    }
    if (!canSend(input)) return
    handleSubmit(input, files.length > 0 ? files : undefined)
    setInput('')
    setFiles([])
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSubmit()
    }
  }

  const pickFiles = async () => {
    const result = await window.coasty.selectFiles()
    if (result.success && result.files.length > 0) {
      // Deduplicate by path
      setFiles((prev) => {
        const existing = new Set(prev.map((f) => f.path))
        const newFiles = result.files.filter((f) => !existing.has(f.path))
        return [...prev, ...newFiles]
      })
    }
  }

  const removeFile = (path: string) => {
    setFiles((prev) => prev.filter((f) => f.path !== path))
  }

  // Auto-resize textarea
  React.useEffect(() => {
    const el = inputRef.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = Math.min(el.scrollHeight, 120) + 'px'
    }
  }, [input])

  return (
    <div className="glow-border animate-expand-in flex flex-col w-full h-full rounded-2xl bg-neutral-900/95 backdrop-blur-xl overflow-hidden">
      {/* Header bar */}
      <div className="titlebar-drag flex items-center justify-between px-4 py-2.5 border-b border-neutral-800/50 flex-shrink-0">
        <div className="titlebar-no-drag flex items-center gap-2.5">
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDot(connectionState)}`} />
          <span className="text-xs font-medium text-neutral-200 truncate max-w-[160px]">
            {chatTitle || 'Coasty'}
          </span>
        </div>

        <div className="titlebar-no-drag flex items-center gap-1">
          <button
            onClick={clearMessages}
            className="px-2 py-1 rounded-md text-[10px] text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800/60 transition-colors"
            title="New chat"
          >
            New
          </button>
          <button
            onClick={signOut}
            className="p-1.5 rounded-lg hover:bg-neutral-800/60 text-neutral-500 hover:text-neutral-300 transition-colors"
            title="Sign out"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
          <button
            onClick={() => toggleExpanded()}
            className="p-1.5 rounded-lg hover:bg-neutral-800/60 text-neutral-400 hover:text-neutral-200 transition-colors"
            title="Collapse"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="18 15 12 9 6 15" />
            </svg>
          </button>
        </div>
      </div>

      {/* Messages */}
      <MessageList messages={messages} isStreaming={isStreaming} />

      {/* Input area */}
      <div className="border-t border-neutral-800/50 px-3 py-2 flex-shrink-0">
        {connectionState !== 'connected' && (
          <div className="mb-1.5 text-[10px] text-yellow-500 text-center">
            Not connected — waiting for backend
          </div>
        )}

        {/* Attached files */}
        {files.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {files.map((f) => (
              <div
                key={f.path}
                className="group flex items-center gap-1.5 max-w-[200px] bg-neutral-800/70 border border-neutral-700/40 rounded-lg px-2 py-1 text-[10px]"
                title={f.path}
              >
                {/* Extension badge */}
                <span className={`font-mono font-semibold uppercase flex-shrink-0 ${extColor(f.ext)}`}>
                  {f.ext || '?'}
                </span>
                {/* File name */}
                <span className="text-neutral-300 truncate">{f.name}</span>
                {/* Remove button */}
                <button
                  onClick={() => removeFile(f.path)}
                  className="flex-shrink-0 text-neutral-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={onSubmit} className="flex items-end gap-2">
          {/* Attach file button */}
          <button
            type="button"
            onClick={pickFiles}
            disabled={connectionState !== 'connected'}
            className="p-2 rounded-xl text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800/60 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex-shrink-0"
            title="Attach files"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
            </svg>
          </button>

          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={files.length > 0 ? 'What should I do with these files?' : 'Send a message...'}
            rows={1}
            disabled={connectionState !== 'connected'}
            className="flex-1 bg-neutral-800/60 border border-neutral-700/50 rounded-xl px-3 py-2 text-xs text-neutral-200 placeholder-neutral-600 resize-none focus:outline-none focus:border-neutral-600 disabled:opacity-50"
          />

          {isStreaming ? (
            <button
              type="button"
              onClick={handleStop}
              className="px-3 py-2 bg-red-600/20 border border-red-600/30 text-red-400 rounded-xl text-xs font-medium hover:bg-red-600/30 transition-colors flex-shrink-0"
            >
              Stop
            </button>
          ) : isMachineBusy && input.trim() ? (
            // Yellow Override & Run — same colour family as the web app
            // chat-input.tsx Override button. Submitting the form (Enter
            // or click) routes through onSubmit, which routes through
            // forceStopAndSend when isMachineBusy is true.
            <button
              type="submit"
              disabled={isStoppingMachine}
              title="Stop running task and start this one"
              className="px-3 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
            >
              {isStoppingMachine ? 'Switching…' : 'Override & Run'}
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canSend(input)}
              className="px-3 py-2 bg-brand-600 text-white rounded-xl text-xs font-medium hover:bg-brand-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex-shrink-0"
            >
              Send
            </button>
          )}
        </form>
      </div>
    </div>
  )
}
