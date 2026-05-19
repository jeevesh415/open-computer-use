import { create } from 'zustand'

export interface ToolInvocation {
  toolCallId: string
  toolName: string
  args: Record<string, any>
  state: 'pending' | 'result'
  result?: any
  frontendScreenshot?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolInvocations?: ToolInvocation[]
  createdAt: string
}

/**
 * Normalize a message's `content` field to a string. The backend's
 * ``db_service.get_chat_messages`` will JSON-parse stringified arrays
 * back into native arrays (for OpenAI-style multi-part content). The
 * Electron renderer always wants a flat string — so collapse those
 * shapes back into a readable form here rather than letting them flow
 * to MessageItem where ``<Markdown>{message.content}</Markdown>`` would
 * silently render an empty bubble.
 */
export function normalizeMessageContent(raw: unknown): string {
  if (raw == null) return ''
  if (typeof raw === 'string') return raw
  if (Array.isArray(raw)) {
    const parts: string[] = []
    for (const part of raw) {
      if (typeof part === 'string') { parts.push(part); continue }
      if (part && typeof part === 'object') {
        // OpenAI-style: { type: 'text', text: '...' }
        if (typeof (part as any).text === 'string') { parts.push((part as any).text); continue }
        // Anthropic-style: { type: 'text', source: { text: '...' } }
        const t = (part as any)?.source?.text
        if (typeof t === 'string') { parts.push(t); continue }
      }
    }
    if (parts.length > 0) return parts.join('\n')
    try { return JSON.stringify(raw) } catch { return '' }
  }
  if (typeof raw === 'object') {
    try { return JSON.stringify(raw) } catch { return '' }
  }
  return String(raw)
}

export interface ChatSummary {
  id: string
  title: string | null
  created_at: string | null
  updated_at: string | null
  model: string | null
  last_message_preview?: string
}

interface AwaitingHumanState {
  reason: string
  machineId: string
  since: number
}

interface ChatState {
  messages: ChatMessage[]
  isStreaming: boolean
  chatId: string
  chatTitle: string | null
  /** Whether chatId points to a real Supabase chat */
  isSynced: boolean
  /** AbortController for the current streaming request */
  abortController: AbortController | null
  /** Set when agent is paused waiting for human intervention */
  awaitingHuman: AwaitingHumanState | null

  // Chat list
  chatList: ChatSummary[]
  chatListLoading: boolean

  /** True while loadChat is fetching messages for the active chat.
   *  Surfaced to MessageList so the user sees a spinner instead of an
   *  empty thread between click and IPC resolution. */
  isLoadingMessages: boolean
  /** When the most recent loadChat call failed, this carries the error
   *  text so the UI can surface a banner ("Not authenticated", "backend
   *  502: ...", "IPC timed out") rather than leaving the user staring
   *  at an empty thread with no signal that anything happened. */
  loadError: string | null
  /** Token used by loadChat to ignore stale IPC resolutions when the
   *  user clicked a different chat mid-flight. Internal only — UI does
   *  not need to read this. */
  _activeLoadToken: number

  addUserMessage: (content: string) => void
  setStreaming: (streaming: boolean) => void
  setAwaitingHuman: (state: AwaitingHumanState | null) => void
  setAbortController: (controller: AbortController | null) => void
  /** Abort the current stream and stop */
  stopStreaming: () => void
  appendAssistantContent: (content: string) => void
  addToolCall: (invocation: ToolInvocation) => void
  updateToolResult: (toolCallId: string, result: any, screenshot?: string) => void
  finishAssistantMessage: (content: string, toolInvocations?: ToolInvocation[]) => void
  clearMessages: () => void

  /** Create a new chat in Supabase and set chatId. Call before first message. */
  ensureChat: (firstMessageContent?: string) => Promise<string>
  /** Load chat list from backend */
  loadChatList: () => Promise<void>
  /** Switch to an existing chat and load its messages */
  loadChat: (chatId: string) => Promise<void>
  /** Clear the loadError banner (UI dismiss handler) */
  clearLoadError: () => void
  /** Delete a chat */
  removeChat: (chatId: string) => Promise<void>
  /** Update chat title */
  renameChat: (chatId: string, title: string) => Promise<void>
}

function generateId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

/** Default timeout (ms) for IPC calls to the main process. */
const IPC_TIMEOUT_MS = 30_000

/**
 * Wrap an IPC promise with a timeout so a hung main process handler
 * cannot block the renderer indefinitely.
 */
function withTimeout<T>(promise: Promise<T>, ms: number = IPC_TIMEOUT_MS, label = 'IPC call'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    promise.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isStreaming: false,
  chatId: '',
  chatTitle: null,
  isSynced: false,
  abortController: null,
  awaitingHuman: null,
  chatList: [],
  chatListLoading: false,
  isLoadingMessages: false,
  loadError: null,
  _activeLoadToken: 0,

  addUserMessage: (content) => {
    set((state) => ({
      messages: [
        ...state.messages,
        {
          id: generateId(),
          role: 'user',
          content,
          createdAt: new Date().toISOString(),
        },
      ],
    }))
  },

  setStreaming: (streaming) => set({ isStreaming: streaming }),

  setAwaitingHuman: (state) => set({ awaitingHuman: state }),

  setAbortController: (controller) => set({ abortController: controller }),

  stopStreaming: () => {
    const { abortController } = get()
    if (abortController) {
      abortController.abort()
    }
    set({ isStreaming: false, abortController: null })
  },

  appendAssistantContent: (content) => {
    set((state) => {
      const messages = [...state.messages]
      const last = messages[messages.length - 1]

      if (last?.role === 'assistant' && !last.id.startsWith('final_')) {
        messages[messages.length - 1] = { ...last, content: last.content + content }
      } else {
        messages.push({
          id: `streaming_${Date.now()}`,
          role: 'assistant',
          content,
          toolInvocations: [],
          createdAt: new Date().toISOString(),
        })
      }

      return { messages }
    })
  },

  addToolCall: (invocation) => {
    set((state) => {
      const messages = [...state.messages]
      const last = messages[messages.length - 1]

      if (last?.role === 'assistant' && !last.id.startsWith('final_')) {
        const tools = [...(last.toolInvocations || []), invocation]
        messages[messages.length - 1] = { ...last, toolInvocations: tools }
      } else {
        // ── Tool-only assistant turn ────────────────────────────────────
        // The assistant streamed NO text before this tool call (e.g. a
        // pure ``cua_screenshot`` turn). Without creating an assistant
        // message here, the tool invocation would be silently dropped
        // because the last message is still ``user`` and the
        // ``last?.role === 'assistant'`` guard above filters it out.
        //
        // The CUA executor regularly produces tool-only turns —
        // think of an agent that decides "I need to see the screen
        // first" and emits ``cua_screenshot`` with no preamble. The
        // user must see the tool activity in the chat thread to
        // understand what's happening.
        messages.push({
          id: `streaming_${Date.now()}`,
          role: 'assistant',
          content: '',
          toolInvocations: [invocation],
          createdAt: new Date().toISOString(),
        })
      }

      return { messages }
    })
  },

  updateToolResult: (toolCallId, result, screenshot) => {
    set((state) => {
      const messages = [...state.messages]
      const last = messages[messages.length - 1]

      if (last?.role === 'assistant' && last.toolInvocations) {
        const tools = last.toolInvocations.map((t) =>
          t.toolCallId === toolCallId
            ? { ...t, state: 'result' as const, result, frontendScreenshot: screenshot }
            : t,
        )
        messages[messages.length - 1] = { ...last, toolInvocations: tools }
      }

      return { messages }
    })
  },

  finishAssistantMessage: (content, toolInvocations) => {
    set((state) => {
      const messages = [...state.messages]
      const last = messages[messages.length - 1]

      if (last?.role === 'assistant') {
        messages[messages.length - 1] = {
          ...last,
          id: `final_${Date.now()}`,
          content: content || last.content,
          toolInvocations: toolInvocations || last.toolInvocations,
        }
      } else if (content || (toolInvocations && toolInvocations.length > 0)) {
        // ── Finish-only assistant turn ─────────────────────────────────
        // The backend ended the turn without any prior text / tool-call
        // events but the finish payload DOES carry content or final tool
        // invocations. Without this branch, that content is lost and the
        // chat thread is missing the assistant's reply entirely.
        //
        // Real example: a backend race where the SSE stream closes
        // before the 'a' tool-result events flushed, but the 'd' event
        // includes the tool invocations in its payload.
        messages.push({
          id: `final_${Date.now()}`,
          role: 'assistant',
          content: content || '',
          toolInvocations: toolInvocations || undefined,
          createdAt: new Date().toISOString(),
        })
      }

      return { messages, isStreaming: false, awaitingHuman: null }
    })
  },

  clearMessages: () => {
    const { abortController } = get()
    if (abortController) abortController.abort()
    set({ messages: [], chatId: '', chatTitle: null, isSynced: false, isStreaming: false, abortController: null })
  },

  ensureChat: async (firstMessageContent?: string) => {
    const state = get()
    // Already have a synced chat
    if (state.isSynced && state.chatId) {
      return state.chatId
    }

    try {
      // Strip <file> and <directory> tags so the title is clean text
      const clean = firstMessageContent
        ? firstMessageContent
            .replace(/<file\s[^>]*>[^<]*<\/file>\n?/g, '')
            .replace(/<directory\s[^>]*>[^<]*<\/directory>\n?/g, '')
            .trim()
        : ''
      const title = clean
        ? clean.slice(0, 60) + (clean.length > 60 ? '...' : '')
        : 'New Task'

      const result = await withTimeout(window.coasty.createChat({ title }), IPC_TIMEOUT_MS, 'createChat')
      if (result.success && result.chat) {
        const newChatId = result.chat.id
        set({ chatId: newChatId, chatTitle: result.chat.title, isSynced: true })
        return newChatId
      }
    } catch (err) {
      console.error('Failed to create chat in Supabase:', err)
    }

    // Fallback to local-only ID if backend is unavailable
    const fallbackId = `local_${Date.now()}`
    set({ chatId: fallbackId, isSynced: false })
    return fallbackId
  },

  loadChatList: async () => {
    set({ chatListLoading: true })
    try {
      const result = await withTimeout(window.coasty.listChats(), IPC_TIMEOUT_MS, 'listChats')
      if (result.success && result.chats) {
        set({ chatList: result.chats, chatListLoading: false })
      } else {
        set({ chatListLoading: false })
      }
    } catch (err) {
      console.error('Failed to load chat list:', err)
      set({ chatListLoading: false })
    }
  },

  loadChat: async (chatId: string) => {
    // ── Abort any active stream before switching chats ────────────────
    // The previous chat may still be streaming. Tear it down BEFORE we
    // swap chatId so the in-flight SSE callbacks don't paint into the
    // new chat thread.
    const { abortController } = get()
    if (abortController) abortController.abort()

    // ── Race protection ───────────────────────────────────────────────
    // Each loadChat call gets a monotonically increasing token. The
    // store records the latest token in `_activeLoadToken`. When the
    // IPC promise resolves, we check that OUR token still matches; if
    // not (the user clicked another chat in the meantime), we drop the
    // stale result on the floor. Without this guard, rapid clicks like
    // A→B→A can land in the WRONG chat because the slower IPC wins the
    // setState race.
    const myToken = get()._activeLoadToken + 1

    // Snap to the new chat immediately so the UI feels responsive:
    //   - chatId moves to the target
    //   - messages cleared (last chat's thread vanishes)
    //   - title pulled from chatList if available
    //   - isLoadingMessages=true → MessageList renders spinner
    //   - loadError cleared so any prior banner disappears
    const chatInfo = get().chatList.find((c) => c.id === chatId)
    set({
      chatId,
      messages: [],
      isStreaming: false,
      abortController: null,
      isSynced: true,
      chatTitle: chatInfo?.title || null,
      isLoadingMessages: true,
      loadError: null,
      awaitingHuman: null,
      _activeLoadToken: myToken,
    })

    const stillCurrent = () => get()._activeLoadToken === myToken

    try {
      const result = await withTimeout(
        window.coasty.getChatMessages(chatId),
        IPC_TIMEOUT_MS,
        'getChatMessages',
      )

      if (!stillCurrent()) {
        // User clicked a different chat while we were waiting — drop
        // this result silently. The newer loadChat owns the store.
        return
      }

      if (!result || result.success !== true) {
        const errText = (result && (result.error as string)) || 'Unknown error'
        console.warn('[chat-store] loadChat IPC returned failure:', { chatId, errText, result })
        set({
          isLoadingMessages: false,
          loadError: `Couldn't load chat: ${errText}`,
        })
        return
      }

      const rawMessages = Array.isArray(result.messages) ? result.messages : []

      // Transform DB messages to ChatMessage format. Tolerant to a
      // variety of backend shapes — see normalizeMessageContent for
      // why content may not be a plain string.
      const messages: ChatMessage[] = rawMessages.map((msg: any) => {
        const role = msg?.role === 'assistant' ? 'assistant' : 'user'
        const partsArr = Array.isArray(msg?.parts) ? msg.parts : []
        const toolInvocations = partsArr
          .filter((p: any) => p && p.type === 'tool-invocation' && p.toolInvocation)
          .map((p: any) => p.toolInvocation)
        return {
          id: String(msg?.id ?? `msg_${Math.random().toString(36).slice(2, 10)}`),
          role,
          content: normalizeMessageContent(msg?.content),
          createdAt: msg?.created_at || new Date().toISOString(),
          toolInvocations: toolInvocations.length > 0 ? toolInvocations : undefined,
        }
      })

      if (!stillCurrent()) return

      set({
        messages,
        isLoadingMessages: false,
        loadError: null,
      })
    } catch (err: any) {
      if (!stillCurrent()) return
      const msg = err?.message || String(err)
      console.error('[chat-store] loadChat failed:', msg, err)
      set({
        isLoadingMessages: false,
        loadError: `Couldn't load chat: ${msg}`,
      })
    }
  },

  clearLoadError: () => set({ loadError: null }),

  removeChat: async (chatId: string) => {
    try {
      const result = await withTimeout(window.coasty.deleteChat(chatId), IPC_TIMEOUT_MS, 'deleteChat')
      if (result.success) {
        const state = get()
        // If we deleted the current chat, abort any active stream and clear
        if (state.chatId === chatId && state.abortController) {
          state.abortController.abort()
        }
        set({
          chatList: state.chatList.filter((c) => c.id !== chatId),
          ...(state.chatId === chatId
            ? { messages: [], chatId: '', chatTitle: null, isSynced: false, isStreaming: false, abortController: null }
            : {}),
        })
      }
    } catch (err) {
      console.error('Failed to delete chat:', err)
    }
  },

  renameChat: async (chatId: string, title: string) => {
    try {
      const result = await withTimeout(window.coasty.updateChat({ chatId, title }), IPC_TIMEOUT_MS, 'updateChat')
      if (result.success) {
        const state = get()
        set({
          chatList: state.chatList.map((c) =>
            c.id === chatId ? { ...c, title } : c
          ),
          ...(state.chatId === chatId ? { chatTitle: title } : {}),
        })
      }
    } catch (err) {
      console.error('Failed to rename chat:', err)
    }
  },
}))
