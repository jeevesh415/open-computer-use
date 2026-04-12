import React, { useMemo, useCallback } from 'react'
import type { ChatMessage } from '../stores/chat-store'
import { useChatStore } from '../stores/chat-store'
import { ToolInvocationDisplay } from './ToolInvocationDisplay'
import { hasCuaSections, CuaSectionRenderer } from './CuaSectionRenderer'
import { Markdown } from './Markdown'

function toDataUri(raw: string): string | null {
  const clean = raw.trim()
  if (!clean) return null
  if (clean.startsWith('data:image/')) return clean
  if (clean.startsWith('/9j/')) return `data:image/jpeg;base64,${clean}`
  if (clean.startsWith('iVBOR')) return `data:image/png;base64,${clean}`
  return `data:image/jpeg;base64,${clean}`
}

interface ParsedFile { name: string; path: string; ext: string; isDirectory: boolean }

/** Extract <file> and <directory> tags from user message, return clean text + file list */
function parseFileRefs(content: string): { text: string; files: ParsedFile[] } {
  const files: ParsedFile[] = []

  const FILE_RE = /<file\s+path="([^"]*)"[^>]*>([^<]*)<\/file>/g
  let match: RegExpExecArray | null
  while ((match = FILE_RE.exec(content)) !== null) {
    const filePath = match[1]
    const name = match[2] || filePath.split(/[/\\]/).pop() || 'file'
    const dot = name.lastIndexOf('.')
    files.push({ name, path: filePath, ext: dot > 0 ? name.slice(dot + 1) : '', isDirectory: false })
  }

  const DIR_RE = /<directory\s+path="([^"]*)"[^>]*>([^<]*)<\/directory>/g
  while ((match = DIR_RE.exec(content)) !== null) {
    const dirPath = match[1]
    const name = match[2] || dirPath.split(/[/\\]/).pop() || 'folder'
    files.push({ name, path: dirPath, ext: '', isDirectory: true })
  }

  const text = content
    .replace(/<file\s[^>]*>[^<]*<\/file>\n?/g, '')
    .replace(/<directory\s[^>]*>[^<]*<\/directory>\n?/g, '')
    .trim()
  return { text, files }
}

function fileExtColor(ext: string): string {
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

interface Props {
  message: ChatMessage
  isStreaming?: boolean
  isLast?: boolean
}

export function MessageItem({ message, isStreaming, isLast }: Props) {
  const isUser = message.role === 'user'
  const isCua = !isUser && message.content && hasCuaSections(message.content)
  const setAwaitingHuman = useChatStore((s) => s.setAwaitingHuman)
  const clearAwaitingHuman = useCallback(() => setAwaitingHuman(null), [setAwaitingHuman])

  const screenshots = useMemo(() => {
    if (!isCua || !message.toolInvocations) return []
    const result: string[] = []
    for (const inv of message.toolInvocations) {
      if (inv.frontendScreenshot) {
        const uri = toDataUri(inv.frontendScreenshot)
        if (uri) { result.push(uri); continue }
      }
      if (inv.state === 'result' && inv.result && typeof inv.result === 'object' && 'frontendScreenshot' in inv.result) {
        const uri = toDataUri(inv.result.frontendScreenshot)
        if (uri) { result.push(uri); continue }
      }
    }
    return result
  }, [isCua, message.toolInvocations])

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] space-y-3 ${
          isUser
            ? 'bg-neutral-800 rounded-3xl px-5 py-2.5'
            : 'bg-transparent'
        }`}
      >
        {/* Message content */}
        {message.content && (
          isUser ? (
            <UserContent content={message.content} />
          ) : isCua ? (
            <CuaSectionRenderer
              content={message.content}
              screenshots={screenshots}
              isStreaming={isStreaming && isLast}
              onResumeHuman={clearAwaitingHuman}
            />
          ) : (
            <div className="markdown-prose text-sm leading-relaxed text-neutral-300">
              <Markdown>{message.content}</Markdown>
            </div>
          )
        )}

        {/* Tool invocations */}
        {!isUser && message.toolInvocations && message.toolInvocations.length > 0 && (
          <ToolInvocationDisplay invocations={message.toolInvocations} />
        )}
      </div>
    </div>
  )
}

/** Renders user message text + file attachment chips (if any <file> tags are present). */
function UserContent({ content }: { content: string }) {
  const { text, files } = useMemo(() => parseFileRefs(content), [content])

  return (
    <div className="space-y-2">
      {text && (
        <div className="text-sm leading-relaxed whitespace-pre-wrap text-neutral-200">
          {text}
        </div>
      )}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {files.map((f, i) => (
            <span
              key={i}
              title={f.path}
              className="inline-flex items-center gap-1 bg-neutral-700/50 border border-neutral-600/30 rounded-md px-1.5 py-0.5 text-[10px]"
            >
              {f.isDirectory ? (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 text-blue-400">
                  <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                </svg>
              ) : (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`flex-shrink-0 ${fileExtColor(f.ext)}`}>
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                </svg>
              )}
              <span className="text-neutral-300 truncate max-w-[140px]">{f.name}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
