/**
 * @vitest-environment jsdom
 *
 * Anti-regression for the ``ensureChat`` timeout fallback in
 * ``useChatSubmit._doSubmit``.
 *
 * Why this matters
 * ----------------
 * Pre-fix, line 183 of useChatSubmit was a bare ``await ensureChat(...)``.
 * If the chat-store's createChat IPC hung — backend slow, Supabase
 * down, IPC deadlock — Send would block forever with no error surface
 * and the user would see a frozen overlay. The pre-existing falsy-id
 * fallback further down only triggers if ensureChat RETURNS something
 * falsy; it does nothing for a hang.
 *
 * The fix wraps the call in withTimeout(5000) + a try/catch that
 * routes any throw (TimeoutError or otherwise) into the existing
 * ``activeChatId = undefined → local_<ts>`` fallback path. The user's
 * Send proceeds with a local chat id, and the backend's idempotent
 * chat upsert handles persistence on the eventual successful turn.
 *
 * What this test pins
 * -------------------
 *   - When ensureChat NEVER resolves, the wire call to sendChatMessage
 *     STILL fires within a beat of the 5s deadline (not after a
 *     30-second IPC-default timeout, not never).
 *   - The fired wire payload carries a ``local_<ts>_<rand>`` chat id,
 *     proving the renderer routed through the local-fallback branch.
 *   - The user's message lands in the chat thread regardless.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import React from 'react'
import { CompactPill } from '../components/CompactPill'
import { useAuthStore } from '../stores/auth-store'
import { useConnectionStore } from '../stores/connection-store'
import { useChatStore } from '../stores/chat-store'
import { useWindowStore } from '../stores/window-store'

interface CoastyMock {
  checkMachineBusy: ReturnType<typeof vi.fn>
  stopMachine: ReturnType<typeof vi.fn>
  sendChatMessage: ReturnType<typeof vi.fn>
  abortChat: ReturnType<typeof vi.fn>
  onChatSSEEvent: ReturnType<typeof vi.fn>
  createChat: ReturnType<typeof vi.fn>
  listChats: ReturnType<typeof vi.fn>
  getChatMessages: ReturnType<typeof vi.fn>
  updateChat: ReturnType<typeof vi.fn>
  deleteChat: ReturnType<typeof vi.fn>
  setMode: ReturnType<typeof vi.fn>
  setWindowMode: ReturnType<typeof vi.fn>
  setOpacity: ReturnType<typeof vi.fn>
  getCredits: ReturnType<typeof vi.fn>
  isOssMode: ReturnType<typeof vi.fn>
}

let coasty: CoastyMock
const TEST_USER_ID = 'user-test-ensurechat'
const TEST_MACHINE_ID = 'machine-test-ensurechat'

function buildCoastyMock(): CoastyMock {
  return {
    checkMachineBusy: vi.fn(async () => ({ success: true, busy: false, ownerChatId: null })),
    stopMachine: vi.fn(async () => ({
      success: true, stopped: true, released: true, forced: false, ownerChatId: null,
    })),
    sendChatMessage: vi.fn(async () => ({ success: true })),
    abortChat: vi.fn(async () => ({ success: true })),
    onChatSSEEvent: vi.fn(() => () => {}),
    // ★ The pivotal stub: createChat NEVER resolves. This is the
    // pathological case the timeout exists to defend against — backend
    // unreachable, supabase outage, IPC deadlock, main process wedged.
    createChat: vi.fn(() => new Promise(() => {})),
    listChats: vi.fn(async () => ({ success: true, chats: [] })),
    getChatMessages: vi.fn(async () => ({ success: true, messages: [] })),
    updateChat: vi.fn(async () => ({ success: true })),
    deleteChat: vi.fn(async () => ({ success: true })),
    setMode: vi.fn(async () => ({ success: true })),
    setWindowMode: vi.fn(async () => undefined),
    setOpacity: vi.fn(async () => undefined),
    getCredits: vi.fn(async () => ({ success: true, credits: 1000 })),
    isOssMode: vi.fn(async () => false),
  }
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  coasty = buildCoastyMock()
  ;(globalThis as any).window.coasty = coasty

  useAuthStore.setState({
    user: { id: TEST_USER_ID, email: 't@coasty.ai', name: 'T', avatar: null },
    machineId: TEST_MACHINE_ID,
    loading: false,
  } as any)
  useConnectionStore.setState({ state: 'connected' } as any)
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
  })
  useWindowStore.setState({ mode: 'compact' } as any)

  // Suppress the intentional console.warn the fallback path emits —
  // it's tested below via spy, we just don't want it polluting output.
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  delete (globalThis as any).window.coasty
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

function renderCompactPill() {
  return render(<CompactPill />)
}

function getInput(): HTMLInputElement {
  return screen.getByPlaceholderText(/Send a message|Another task running|Working/i) as HTMLInputElement
}

describe('useChatSubmit — ensureChat timeout fallback', () => {
  it('★ ensureChat hangs → Send still proceeds with a local_* fallback chat id', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderCompactPill()

    await user.type(getInput(), 'hang test{Enter}')

    // Advance past the 5s ensureChat deadline. Without the fix this
    // would hang forever — the wire call would never fire. With the
    // fix, withTimeout rejects with TimeoutError, the catch routes to
    // the local-fallback branch, and sendChatMessage dispatches.
    await vi.advanceTimersByTimeAsync(5100)

    await waitFor(
      () => expect(coasty.sendChatMessage).toHaveBeenCalled(),
      { timeout: 2000 },
    )

    const wirePayload = coasty.sendChatMessage.mock.calls[0][0] as any
    // Local fallback shape: ``local_<digits>_<rand>``. The leading
    // ``local_`` prefix is the signal to the backend that this is a
    // renderer-side fallback id and not a Supabase UUID.
    expect(wirePayload.chatId).toMatch(/^local_\d+_[a-z0-9]+$/)
  })

  it('★ ensureChat hangs → user message still appears in the chat thread', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderCompactPill()

    await user.type(getInput(), 'visible even on hang{Enter}')

    await vi.advanceTimersByTimeAsync(5100)

    await waitFor(() => {
      const um = useChatStore.getState().messages.filter((m) => m.role === 'user')
      expect(um).toHaveLength(1)
      expect(um[0].content).toContain('visible even on hang')
    })
  })

  it('★ ensureChat hangs → console.warn fired with the timeout diagnostic', async () => {
    const warnSpy = vi.spyOn(console, 'warn')
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderCompactPill()

    await user.type(getInput(), 'log a warning{Enter}')
    await vi.advanceTimersByTimeAsync(5100)
    await waitFor(() => expect(coasty.sendChatMessage).toHaveBeenCalled())

    // The fix emits a "[useChatSubmit] ensureChat threw or timed out"
    // warning so operators can tell from logs that the local-fallback
    // path was taken (vs. a clean Supabase round-trip).
    const calls = warnSpy.mock.calls.flat().map((a) => String(a))
    expect(calls.some((c) => /ensureChat threw or timed out/i.test(c))).toBe(true)
  })

  it('happy path control: ensureChat resolving quickly uses the real chat id (no fallback)', async () => {
    // Sanity check: when createChat DOES resolve, the timeout path is
    // inert and the wire call carries the real Supabase chat id.
    coasty.createChat = vi.fn(async () => ({
      success: true,
      chat: { id: 'chat-real-uuid-abc', title: 'New Task', model: 'default' },
    }))

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderCompactPill()
    await user.type(getInput(), 'normal send{Enter}')

    await waitFor(
      () => expect(coasty.sendChatMessage).toHaveBeenCalled(),
      { timeout: 2000 },
    )

    const wirePayload = coasty.sendChatMessage.mock.calls[0][0] as any
    expect(wirePayload.chatId).toBe('chat-real-uuid-abc')
    expect(wirePayload.chatId).not.toMatch(/^local_/)
  })
})
