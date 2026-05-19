/**
 * Heavy tests for `useChatStore.loadChat` — the function invoked when the
 * user clicks a chat in the history sidebar.
 *
 * Why this exists: the previous implementation had three production bugs
 * that conspired to make "click history → nothing happens":
 *
 *   1. SILENT FAILURE — when the IPC returned `{success: false}` it logged
 *      to console and did NOTHING visible to the user. The chat thread
 *      stayed on whatever was already there (or empty), so the click felt
 *      like a no-op.
 *
 *   2. RACE — rapid A→B→A clicks could resolve out of order; the slow IPC
 *      would overwrite the fast IPC's state and the user ended up looking
 *      at the wrong chat.
 *
 *   3. CONTENT TYPE DRIFT — the backend's `db_service.get_chat_messages`
 *      json.loads()es content when it parses as a list. The renderer typed
 *      content as `string`, so `<Markdown>{[object Object]}</Markdown>`
 *      rendered nothing.
 *
 * Each section below corresponds to one of those classes of bugs, with
 * additional defensive cases around the IPC contract.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { useChatStore, normalizeMessageContent } from './chat-store'

// ─── Mock window.coasty IPC surface ────────────────────────────────────
//
// loadChat hits `window.coasty.getChatMessages(chatId)` — a thin IPC bridge
// that talks to the main process. In a Node test environment `window` is
// not available, so we stub a minimal surface. Each test rebinds
// `getChatMessages` to a vi.fn() so we can control timing + return shape.
// `withTimeout` is also a real implementation in the store; we keep it
// alive by leaving the wrapper untouched and just mocking the resolved
// IPC call.

interface MockIPC {
  getChatMessages: ReturnType<typeof vi.fn>
}

function installMockIPC(impl: MockIPC['getChatMessages']) {
  ;(globalThis as any).window = {
    coasty: { getChatMessages: impl },
  }
}

function resetStore() {
  // Re-initialise to a clean default. Zustand's `create` already gave us
  // setState — using it instead of re-imports keeps test isolation cheap.
  useChatStore.setState({
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
  })
}

beforeEach(() => {
  resetStore()
})

describe('loadChat — happy path', () => {
  it('loads messages and sets state from a typical backend response', async () => {
    installMockIPC(
      vi.fn().mockResolvedValue({
        success: true,
        messages: [
          { id: 'msg-1', role: 'user', content: 'hello', created_at: '2026-01-01T00:00:00Z' },
          { id: 'msg-2', role: 'assistant', content: 'hi back', created_at: '2026-01-01T00:00:01Z' },
        ],
      }),
    )

    await useChatStore.getState().loadChat('chat-A')

    const s = useChatStore.getState()
    expect(s.chatId).toBe('chat-A')
    expect(s.messages.length).toBe(2)
    expect(s.messages[0].id).toBe('msg-1')
    expect(s.messages[0].role).toBe('user')
    expect(s.messages[0].content).toBe('hello')
    expect(s.messages[1].role).toBe('assistant')
    expect(s.messages[1].content).toBe('hi back')
    expect(s.isLoadingMessages).toBe(false)
    expect(s.loadError).toBeNull()
    expect(s.isSynced).toBe(true)
  })

  it('flips isLoadingMessages true → false across the IPC', async () => {
    let resolve!: (v: any) => void
    installMockIPC(
      vi.fn().mockImplementation(
        () => new Promise((r) => { resolve = r }),
      ),
    )

    const p = useChatStore.getState().loadChat('chat-B')
    // After the synchronous setState at the top of loadChat, the load
    // state should be visible to UI subscribers.
    expect(useChatStore.getState().isLoadingMessages).toBe(true)
    expect(useChatStore.getState().chatId).toBe('chat-B')
    expect(useChatStore.getState().messages).toEqual([])

    resolve({ success: true, messages: [] })
    await p
    expect(useChatStore.getState().isLoadingMessages).toBe(false)
  })

  it('uses chatList title when present', async () => {
    useChatStore.setState({
      chatList: [
        { id: 'chat-C', title: 'My research session', created_at: null, updated_at: null, model: null },
      ],
    })
    installMockIPC(vi.fn().mockResolvedValue({ success: true, messages: [] }))

    await useChatStore.getState().loadChat('chat-C')

    expect(useChatStore.getState().chatTitle).toBe('My research session')
  })

  it('handles empty messages array without error', async () => {
    installMockIPC(vi.fn().mockResolvedValue({ success: true, messages: [] }))
    await useChatStore.getState().loadChat('chat-empty')
    const s = useChatStore.getState()
    expect(s.messages).toEqual([])
    expect(s.loadError).toBeNull()
  })

  it('extracts tool-invocations from parts field', async () => {
    installMockIPC(
      vi.fn().mockResolvedValue({
        success: true,
        messages: [
          {
            id: 'msg-1',
            role: 'assistant',
            content: 'taking a screenshot',
            created_at: '2026-01-01T00:00:00Z',
            parts: [
              {
                type: 'tool-invocation',
                toolInvocation: {
                  toolCallId: 'tc-1',
                  toolName: 'screenshot',
                  args: {},
                  state: 'result',
                  result: { ok: true },
                },
              },
              { type: 'text', text: 'inline text — ignored' },
            ],
          },
        ],
      }),
    )

    await useChatStore.getState().loadChat('chat-tools')

    const msg = useChatStore.getState().messages[0]
    expect(msg.toolInvocations).toBeDefined()
    expect(msg.toolInvocations!.length).toBe(1)
    expect(msg.toolInvocations![0].toolName).toBe('screenshot')
    expect(msg.toolInvocations![0].toolCallId).toBe('tc-1')
  })

  it('omits toolInvocations when no tool parts present', async () => {
    installMockIPC(
      vi.fn().mockResolvedValue({
        success: true,
        messages: [
          { id: 'msg-1', role: 'user', content: 'hi', parts: null },
        ],
      }),
    )
    await useChatStore.getState().loadChat('chat-D')
    expect(useChatStore.getState().messages[0].toolInvocations).toBeUndefined()
  })
})

describe('loadChat — failure surfacing (the original bug)', () => {
  it('sets loadError when IPC returns success:false', async () => {
    installMockIPC(
      vi.fn().mockResolvedValue({ success: false, error: 'Not authenticated' }),
    )

    await useChatStore.getState().loadChat('chat-auth-dead')

    const s = useChatStore.getState()
    expect(s.loadError).toContain('Not authenticated')
    expect(s.isLoadingMessages).toBe(false)
    expect(s.messages).toEqual([])
  })

  it('sets loadError when IPC throws', async () => {
    installMockIPC(vi.fn().mockRejectedValue(new Error('network down')))

    await useChatStore.getState().loadChat('chat-network-fail')

    const s = useChatStore.getState()
    expect(s.loadError).toContain('network down')
    expect(s.isLoadingMessages).toBe(false)
  })

  it('sets loadError when IPC returns malformed shape (no success field)', async () => {
    installMockIPC(vi.fn().mockResolvedValue({} as any))

    await useChatStore.getState().loadChat('chat-bad-shape')

    expect(useChatStore.getState().loadError).not.toBeNull()
    expect(useChatStore.getState().isLoadingMessages).toBe(false)
  })

  it('sets loadError when IPC returns null', async () => {
    installMockIPC(vi.fn().mockResolvedValue(null as any))

    await useChatStore.getState().loadChat('chat-null')

    expect(useChatStore.getState().loadError).not.toBeNull()
  })

  it('clearLoadError dismisses the banner', async () => {
    useChatStore.setState({ loadError: 'something broke' })
    useChatStore.getState().clearLoadError()
    expect(useChatStore.getState().loadError).toBeNull()
  })

  it('successful load clears any previous loadError', async () => {
    useChatStore.setState({ loadError: 'stale error from earlier' })
    installMockIPC(vi.fn().mockResolvedValue({ success: true, messages: [] }))

    await useChatStore.getState().loadChat('chat-recovered')

    expect(useChatStore.getState().loadError).toBeNull()
  })
})

describe('loadChat — race protection', () => {
  it('drops a stale result when a newer load has started', async () => {
    // Slow IPC for A, fast for B. We start A first, then B before A
    // resolves. The faster B should win; the slower A result must be
    // ignored when it eventually lands.
    let resolveA!: (v: any) => void
    let resolveB!: (v: any) => void
    const calls: Array<(v: any) => void> = []
    installMockIPC(
      vi.fn().mockImplementation((_id: string) => {
        return new Promise((r) => {
          calls.push(r)
        })
      }),
    )

    const pA = useChatStore.getState().loadChat('chat-A')
    // Capture A's resolver
    resolveA = calls[0]

    const pB = useChatStore.getState().loadChat('chat-B')
    resolveB = calls[1]

    // Resolve B first (fast network)
    resolveB({
      success: true,
      messages: [{ id: 'b-1', role: 'user', content: 'from B' }],
    })
    await pB
    expect(useChatStore.getState().chatId).toBe('chat-B')
    expect(useChatStore.getState().messages[0].content).toBe('from B')

    // Now A resolves late — it must be DROPPED
    resolveA({
      success: true,
      messages: [{ id: 'a-1', role: 'user', content: 'from A (stale)' }],
    })
    await pA

    const s = useChatStore.getState()
    expect(s.chatId).toBe('chat-B')
    expect(s.messages[0].content).toBe('from B')
    expect(s.messages.length).toBe(1)
  })

  it('drops a stale error when a newer load has started', async () => {
    let rejectA!: (e: any) => void
    let resolveB!: (v: any) => void
    const calls: Array<{ res: (v: any) => void; rej: (e: any) => void }> = []
    installMockIPC(
      vi.fn().mockImplementation(() => new Promise((res, rej) => {
        calls.push({ res, rej })
      })),
    )

    const pA = useChatStore.getState().loadChat('chat-A')
    rejectA = calls[0].rej

    const pB = useChatStore.getState().loadChat('chat-B')
    resolveB = calls[1].res

    resolveB({ success: true, messages: [] })
    await pB
    expect(useChatStore.getState().loadError).toBeNull()

    rejectA(new Error('stale failure'))
    await pA.catch(() => {})

    // The stale error must not poison the new successful chat
    expect(useChatStore.getState().loadError).toBeNull()
    expect(useChatStore.getState().chatId).toBe('chat-B')
  })

  it('A→B→A → A wins (newest click owns the store)', async () => {
    const calls: Array<(v: any) => void> = []
    installMockIPC(
      vi.fn().mockImplementation(() => new Promise((r) => { calls.push(r) })),
    )

    const pA1 = useChatStore.getState().loadChat('chat-A')
    const pB = useChatStore.getState().loadChat('chat-B')
    const pA2 = useChatStore.getState().loadChat('chat-A')

    // Resolve in reverse order
    calls[2]({ success: true, messages: [{ id: 'a2', role: 'user', content: 'A second click' }] })
    await pA2
    expect(useChatStore.getState().chatId).toBe('chat-A')
    expect(useChatStore.getState().messages[0].content).toBe('A second click')

    calls[1]({ success: true, messages: [{ id: 'b', role: 'user', content: 'B (stale)' }] })
    await pB
    calls[0]({ success: true, messages: [{ id: 'a1', role: 'user', content: 'A first click (stale)' }] })
    await pA1

    expect(useChatStore.getState().messages[0].content).toBe('A second click')
  })
})

describe('normalizeMessageContent — content-shape resilience', () => {
  it('passes through plain strings', () => {
    expect(normalizeMessageContent('hello world')).toBe('hello world')
  })

  it('returns empty string for null/undefined', () => {
    expect(normalizeMessageContent(null)).toBe('')
    expect(normalizeMessageContent(undefined)).toBe('')
  })

  it('handles OpenAI-style content arrays (the backend JSON-decode case)', () => {
    const content = [
      { type: 'text', text: 'part one' },
      { type: 'text', text: 'part two' },
    ]
    expect(normalizeMessageContent(content)).toBe('part one\npart two')
  })

  it('handles Anthropic-style content arrays with nested source.text', () => {
    const content = [
      { type: 'text', source: { text: 'wrapped' } },
    ]
    expect(normalizeMessageContent(content)).toBe('wrapped')
  })

  it('handles mixed arrays — strings and objects', () => {
    const content = [
      'raw string',
      { type: 'text', text: 'object part' },
    ]
    expect(normalizeMessageContent(content)).toBe('raw string\nobject part')
  })

  it('falls back to JSON.stringify for unrecognised array shapes', () => {
    const content = [{ weird: 'shape' }]
    const out = normalizeMessageContent(content)
    expect(typeof out).toBe('string')
    expect(out.length).toBeGreaterThan(0)
  })

  it('falls back to JSON.stringify for plain objects', () => {
    expect(normalizeMessageContent({ x: 1 })).toBe('{"x":1}')
  })

  it('coerces numbers / booleans to string', () => {
    expect(normalizeMessageContent(42)).toBe('42')
    expect(normalizeMessageContent(true)).toBe('true')
  })

  it('survives empty array', () => {
    expect(normalizeMessageContent([])).toBe('[]')
  })

  it('integrates with loadChat — array content from backend becomes a string in store', async () => {
    installMockIPC(
      vi.fn().mockResolvedValue({
        success: true,
        messages: [
          {
            id: 'm1',
            role: 'assistant',
            content: [{ type: 'text', text: 'first' }, { type: 'text', text: 'second' }],
          },
        ],
      }),
    )

    await useChatStore.getState().loadChat('chat-shape')

    const msg = useChatStore.getState().messages[0]
    expect(typeof msg.content).toBe('string')
    expect(msg.content).toContain('first')
    expect(msg.content).toContain('second')
  })
})

describe('loadChat — defensive parsing', () => {
  it('synthesises an id when the backend row is missing one', async () => {
    installMockIPC(
      vi.fn().mockResolvedValue({
        success: true,
        messages: [{ role: 'user', content: 'no id here' }],
      }),
    )

    await useChatStore.getState().loadChat('chat-noid')

    const m = useChatStore.getState().messages[0]
    expect(m.id).toBeTruthy()
    expect(typeof m.id).toBe('string')
  })

  it('coerces unknown roles to "user"', async () => {
    installMockIPC(
      vi.fn().mockResolvedValue({
        success: true,
        messages: [{ id: 'm', role: 'system', content: 'sys msg' }],
      }),
    )

    await useChatStore.getState().loadChat('chat-role')

    expect(useChatStore.getState().messages[0].role).toBe('user')
  })

  it('falls back to "user" when role is missing', async () => {
    installMockIPC(
      vi.fn().mockResolvedValue({
        success: true,
        messages: [{ id: 'm', content: 'no role' }],
      }),
    )

    await useChatStore.getState().loadChat('chat-norole')

    expect(useChatStore.getState().messages[0].role).toBe('user')
  })

  it('synthesises createdAt when missing', async () => {
    installMockIPC(
      vi.fn().mockResolvedValue({
        success: true,
        messages: [{ id: 'm', role: 'user', content: 'x' }],
      }),
    )

    await useChatStore.getState().loadChat('chat-notime')

    const m = useChatStore.getState().messages[0]
    expect(m.createdAt).toBeTruthy()
    // Must parse as a valid date
    expect(Number.isFinite(new Date(m.createdAt).getTime())).toBe(true)
  })

  it('tolerates messages array containing nulls', async () => {
    installMockIPC(
      vi.fn().mockResolvedValue({
        success: true,
        messages: [null, { id: 'm1', role: 'user', content: 'real' }, null],
      }),
    )

    await useChatStore.getState().loadChat('chat-null-rows')

    // All 3 rows produce a ChatMessage; nulls become empty placeholders
    // rather than crashing the transform.
    expect(useChatStore.getState().messages.length).toBe(3)
    expect(useChatStore.getState().messages[1].content).toBe('real')
  })

  it('handles non-array messages field gracefully', async () => {
    installMockIPC(
      vi.fn().mockResolvedValue({ success: true, messages: 'not an array' as any }),
    )

    await useChatStore.getState().loadChat('chat-bad-msgs')

    expect(useChatStore.getState().messages).toEqual([])
    expect(useChatStore.getState().loadError).toBeNull()
  })

  it('handles missing messages field on success', async () => {
    installMockIPC(vi.fn().mockResolvedValue({ success: true } as any))

    await useChatStore.getState().loadChat('chat-no-msgs')

    expect(useChatStore.getState().messages).toEqual([])
    expect(useChatStore.getState().loadError).toBeNull()
  })

  it('drops malformed tool-invocation parts', async () => {
    installMockIPC(
      vi.fn().mockResolvedValue({
        success: true,
        messages: [
          {
            id: 'm',
            role: 'assistant',
            content: 'mixed',
            parts: [
              { type: 'tool-invocation' /* no toolInvocation field */ },
              { type: 'tool-invocation', toolInvocation: { toolCallId: 't1', toolName: 'ok', args: {}, state: 'result' } },
              null,
            ],
          },
        ],
      }),
    )

    await useChatStore.getState().loadChat('chat-bad-parts')

    const m = useChatStore.getState().messages[0]
    expect(m.toolInvocations!.length).toBe(1)
    expect(m.toolInvocations![0].toolName).toBe('ok')
  })
})

describe('loadChat — state semantics', () => {
  it('clears messages immediately on click (does not show stale previous chat)', async () => {
    // Pre-populate with chat A's messages
    useChatStore.setState({
      chatId: 'chat-A',
      messages: [
        { id: 'a1', role: 'user', content: 'A msg', createdAt: '2026-01-01T00:00:00Z' },
      ],
      chatTitle: 'Chat A',
    })

    let resolveLoad!: (v: any) => void
    installMockIPC(vi.fn().mockImplementation(() => new Promise((r) => { resolveLoad = r })))

    const p = useChatStore.getState().loadChat('chat-B')

    // BEFORE the IPC resolves, the user should not see chat-A's messages
    // — that would be a confusing "wrong chat" flash. The store snaps to
    // empty + loading immediately.
    expect(useChatStore.getState().chatId).toBe('chat-B')
    expect(useChatStore.getState().messages).toEqual([])
    expect(useChatStore.getState().isLoadingMessages).toBe(true)

    resolveLoad({ success: true, messages: [] })
    await p
  })

  it('aborts an active stream when switching chats', async () => {
    const ctrl = new AbortController()
    const abortSpy = vi.spyOn(ctrl, 'abort')

    useChatStore.setState({
      abortController: ctrl,
      isStreaming: true,
    })

    installMockIPC(vi.fn().mockResolvedValue({ success: true, messages: [] }))

    await useChatStore.getState().loadChat('chat-new')

    expect(abortSpy).toHaveBeenCalledTimes(1)
    expect(useChatStore.getState().isStreaming).toBe(false)
    expect(useChatStore.getState().abortController).toBeNull()
  })

  it('clears awaitingHuman state when loading a different chat', async () => {
    useChatStore.setState({
      awaitingHuman: { reason: 'permission needed', machineId: 'm1', since: Date.now() },
    })

    installMockIPC(vi.fn().mockResolvedValue({ success: true, messages: [] }))

    await useChatStore.getState().loadChat('chat-new')

    expect(useChatStore.getState().awaitingHuman).toBeNull()
  })

  it('increments _activeLoadToken on each call', async () => {
    installMockIPC(vi.fn().mockResolvedValue({ success: true, messages: [] }))
    const before = useChatStore.getState()._activeLoadToken
    await useChatStore.getState().loadChat('chat-1')
    expect(useChatStore.getState()._activeLoadToken).toBeGreaterThan(before)
    const mid = useChatStore.getState()._activeLoadToken
    await useChatStore.getState().loadChat('chat-2')
    expect(useChatStore.getState()._activeLoadToken).toBeGreaterThan(mid)
  })
})

describe('loadChat — backend response shape compatibility', () => {
  it('handles messages where content is null (DB NULL)', async () => {
    installMockIPC(
      vi.fn().mockResolvedValue({
        success: true,
        messages: [{ id: 'm', role: 'user', content: null }],
      }),
    )
    await useChatStore.getState().loadChat('chat-nullc')
    expect(useChatStore.getState().messages[0].content).toBe('')
  })

  it('handles messages with parts as a string (legacy JSON-not-parsed shape)', async () => {
    installMockIPC(
      vi.fn().mockResolvedValue({
        success: true,
        messages: [
          { id: 'm', role: 'assistant', content: 'x', parts: '[{"type":"tool-invocation"}]' },
        ],
      }),
    )
    await useChatStore.getState().loadChat('chat-legacy-parts')
    // String parts cannot be filtered as an array → toolInvocations
    // should simply be undefined, not crash the load.
    const m = useChatStore.getState().messages[0]
    expect(m.toolInvocations).toBeUndefined()
    expect(m.content).toBe('x')
  })

  it('handles 401 response (auth death) by surfacing the error', async () => {
    installMockIPC(
      vi.fn().mockResolvedValue({
        success: false,
        error: 'backend 401: Unauthorized',
      }),
    )

    await useChatStore.getState().loadChat('chat-401')

    expect(useChatStore.getState().loadError).toContain('401')
  })

  it('handles 502 backend down by surfacing the error', async () => {
    installMockIPC(
      vi.fn().mockResolvedValue({
        success: false,
        error: 'backend 502: Bad Gateway',
      }),
    )

    await useChatStore.getState().loadChat('chat-502')

    expect(useChatStore.getState().loadError).toContain('502')
  })

  it('handles IPC timeout (the wrapper rejection path)', async () => {
    installMockIPC(
      vi.fn().mockRejectedValue(new Error('getChatMessages timed out after 30000ms')),
    )

    await useChatStore.getState().loadChat('chat-timeout')

    expect(useChatStore.getState().loadError).toContain('timed out')
  })
})
