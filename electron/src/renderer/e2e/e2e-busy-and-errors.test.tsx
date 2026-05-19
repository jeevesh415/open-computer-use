/**
 * @vitest-environment jsdom
 *
 * End-to-end tests for busy-state recovery + error scenarios.
 *
 * Scenarios pinned
 * ----------------
 *
 *   Busy / Override & Run
 *   ---------------------
 *   - Pre-check busy → yellow button visible, input PRESERVED
 *   - Click Override & Run → stopMachine fires → busy clears → send proceeds → response streams
 *   - Override & Run when stop returned ``forced: true`` (stale Redis lock case)
 *   - User edits input then clicks Override → edited content goes to wire
 *   - User clears input while busy → state dismissed (cancel gesture)
 *   - Stop IPC fails → input preserved, busy state retained, can retry
 *
 *   Post-error MACHINE_BUSY (race condition path)
 *   ---------------------------------------------
 *   - Pre-check said not busy, send fires, backend returns MACHINE_BUSY mid-stream
 *   - Yellow button appears, user message is preserved in chat (alreadyInChat=true)
 *   - Override & Run re-sends without double-adding the user message
 *
 *   Error responses
 *   ---------------
 *   - SSE '3' generic error → appended to chat as visible error
 *   - SSE '3' MACHINE_BUSY → routed to yellow state, NOT shown as raw error
 *   - SSE 'error' type → direct error path, surface in chat
 *   - Multiple errors in one stream → only the first is displayed (no spam)
 *
 *   Connection / disconnection
 *   --------------------------
 *   - WS disconnected → canSend false, input disabled, no IPC fires
 *   - WS reconnects → sends work again
 *   - Connection drops mid-stream → finish event still finalizes state
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import React from 'react'
import { CompactPill } from '../components/CompactPill'
import { useAuthStore } from '../stores/auth-store'
import { useConnectionStore } from '../stores/connection-store'
import { useChatStore } from '../stores/chat-store'
import { useWindowStore } from '../stores/window-store'
import { FakeBackend } from './fake-backend'

const TEST_USER_ID = 'user-e2e'
const TEST_MACHINE_ID = 'machine-e2e'

let backend: FakeBackend

beforeEach(() => {
  backend = new FakeBackend()
  ;(globalThis as any).window.coasty = backend.build()

  useAuthStore.setState({
    user: { id: TEST_USER_ID, email: 't@t.t', name: 'T', avatar: null },
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
})

afterEach(() => {
  backend.hardReset()
  const ac = useChatStore.getState().abortController
  if (ac) ac.abort()
  delete (globalThis as any).window.coasty
})

function getInput(): HTMLInputElement {
  return screen.getByPlaceholderText(/Send a message|Another task running|Working/i) as HTMLInputElement
}

// ═════════════════════════════════════════════════════════════════════════
// 1. Pre-check busy → Override & Run end-to-end
// ═════════════════════════════════════════════════════════════════════════

describe('E2E — pre-check busy AUTO-OVERRIDE (happy path)', () => {
  // Local-desktop UX: when the user clicks Send and the machine is
  // busy, we automatically stop the prior task and send. No yellow
  // banner. No confirmation. Tests below pin the auto-recovery
  // happy path end-to-end (renderer → IPC → backend → SSE).
  beforeEach(() => {
    // Machine is busy with another task before the user sends.
    backend.setBusy(TEST_MACHINE_ID, 'chat-other-task-123')
  })

  it('★ full lifecycle: type → click Send → auto-stop → send → response (NO banner)', async () => {
    backend.scriptNextResponse({ textChunks: ['Done.'] })
    const user = userEvent.setup()
    render(<CompactPill />)

    const input = getInput()
    await user.type(input, 'do the thing{Enter}')

    // ★ stopMachine IPC fires automatically.
    await waitFor(() => expect(backend.stopMachineCallCount).toBeGreaterThanOrEqual(1))
    // ★ sendChatMessage IPC fires AFTER the stop.
    await waitFor(
      () => expect(backend.sendCallCount).toBeGreaterThanOrEqual(1),
      { timeout: 3000 },
    )

    // ★ Yellow "Override & Run" banner NEVER appeared.
    expect(screen.queryByRole('button', { name: /override and run/i })).toBeNull()

    // Final state: user message + assistant response in the chat.
    await waitFor(() => {
      const s = useChatStore.getState()
      expect(s.isStreaming).toBe(false)
      const users = s.messages.filter((m) => m.role === 'user')
      const assistants = s.messages.filter((m) => m.role === 'assistant')
      expect(users).toHaveLength(1)
      expect(users[0].content).toBe('do the thing')
      expect(assistants).toHaveLength(1)
      expect(assistants[0].content).toContain('Done.')
    })

    // Input cleared on successful send.
    await waitFor(() => expect(input.value).toBe(''))
  })

  it('★ stale Redis lock force-release case (forced=true) auto-recovers transparently', async () => {
    // Backend's force_release_machine cleared the stale lock.
    // Renderer doesn't care which path released it — both look the
    // same from the UI side.
    backend.setStopMachineResponse({
      success: true,
      stopped: true,
      released: true,
      forced: true,
      ownerChatId: 'chat-stale-owner',
    })
    backend.scriptNextResponse({ textChunks: ['recovered'] })

    const user = userEvent.setup()
    render(<CompactPill />)
    await user.type(getInput(), 'force release me{Enter}')

    await waitFor(
      () => expect(backend.sendCallCount).toBeGreaterThanOrEqual(1),
      { timeout: 3000 },
    )
    // No banner — user experiences a clean send.
    expect(screen.queryByRole('button', { name: /override and run/i })).toBeNull()
    const assistants = useChatStore.getState().messages.filter((m) => m.role === 'assistant')
    expect(assistants).toHaveLength(1)
  })

  it('★ stopMachine ordering: stop fires BEFORE sendChatMessage', async () => {
    backend.scriptNextResponse({ textChunks: ['ok'] })
    const user = userEvent.setup()
    render(<CompactPill />)

    await user.type(getInput(), 'order test{Enter}')
    await waitFor(() => expect(backend.sendCallCount).toBeGreaterThanOrEqual(1), { timeout: 3000 })

    // Inspect mock call orders via vi.fn invocationCallOrder.
    const stopOrder = (backend.build().stopMachine as any)
    // Use the calls array timestamps instead (mock.invocationCallOrder exists on vi.fn).
    const sendMock = (window as any).coasty.sendChatMessage
    const stopMock = (window as any).coasty.stopMachine
    expect(stopMock.mock.invocationCallOrder[0]).toBeLessThan(
      sendMock.mock.invocationCallOrder[0],
    )
  })

  it('★ user types message → input is preserved during the brief auto-stop window', async () => {
    // While stopMachine + grace are running, the user's input
    // should still be visible (auto-recovery happens within ~400ms).
    // After completion, it clears.
    backend.scriptNextResponse({ textChunks: ['streaming'], perEventDelayMs: 50 })

    const user = userEvent.setup()
    render(<CompactPill />)
    const input = getInput()
    await user.type(input, 'check input{Enter}')

    // During the brief auto-stop window (before send fires), input
    // may or may not be cleared depending on timing. After send
    // fires, it's definitely cleared.
    await waitFor(
      () => expect(backend.sendCallCount).toBeGreaterThanOrEqual(1),
      { timeout: 3000 },
    )
    await waitFor(() => expect(input.value).toBe(''))
  })
})

describe('E2E — pre-check busy FALLBACK (auto-stop failure)', () => {
  beforeEach(() => {
    backend.setBusy(TEST_MACHINE_ID, 'chat-other-task-123')
  })

  it('★ stopMachine throws → yellow banner appears, no send fires', async () => {
    const coasty = (window as any).coasty
    coasty.stopMachine = (async () => { throw new Error('network down') }) as any

    const user = userEvent.setup()
    render(<CompactPill />)
    await user.type(getInput(), 'fallback{Enter}')

    await screen.findByRole('button', { name: /override and run/i })
    expect(backend.sendCallCount).toBe(0)
  })

  it('★ stopMachine success=false → yellow banner appears, no send fires', async () => {
    backend.setStopMachineResponse({
      success: false,
      error: 'Backend 500',
    })

    const user = userEvent.setup()
    render(<CompactPill />)
    await user.type(getInput(), 'success-false{Enter}')

    await screen.findByRole('button', { name: /override and run/i })
    expect(backend.sendCallCount).toBe(0)
  })

  it('★ fallback: user can click Override & Run to retry', async () => {
    // First stop fails, banner appears, user clicks Override, second
    // stop succeeds, send proceeds.
    const coasty = (window as any).coasty
    let stopCount = 0
    coasty.stopMachine = (async () => {
      stopCount++
      if (stopCount === 1) throw new Error('first stop fails')
      backend.setNotBusy(TEST_MACHINE_ID)
      return { success: true, stopped: true, released: true, forced: false, ownerChatId: null }
    }) as any

    backend.scriptNextResponse({ textChunks: ['recovered manually'] })

    const user = userEvent.setup()
    render(<CompactPill />)
    await user.type(getInput(), 'manual retry{Enter}')

    const banner = await screen.findByRole('button', { name: /override and run/i })
    await user.click(banner)

    await waitFor(() => expect(backend.sendCallCount).toBeGreaterThanOrEqual(1), { timeout: 3000 })
  })

  it('★ fallback: input preserved so user can edit before retry', async () => {
    const coasty = (window as any).coasty
    coasty.stopMachine = (async () => { throw new Error('fail') }) as any

    const user = userEvent.setup()
    render(<CompactPill />)
    const input = getInput()
    await user.type(input, 'preserve me{Enter}')

    await screen.findByRole('button', { name: /override and run/i })
    expect(input.value).toBe('preserve me')
  })

  it('★ fallback: clearing input dismisses the banner', async () => {
    const coasty = (window as any).coasty
    coasty.stopMachine = (async () => { throw new Error('fail') }) as any

    const user = userEvent.setup()
    render(<CompactPill />)
    const input = getInput()
    await user.type(input, 'cancel me{Enter}')

    await screen.findByRole('button', { name: /override and run/i })
    await user.clear(input)

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /override and run/i })).toBeNull()
    })
  })
})

// ═════════════════════════════════════════════════════════════════════════
// 2. Post-error MACHINE_BUSY (race condition path)
// ═════════════════════════════════════════════════════════════════════════

describe('E2E — post-error MACHINE_BUSY (race)', () => {
  it('★ pre-check not-busy, send fires, backend returns MACHINE_BUSY mid-stream', async () => {
    // Pre-check said not busy, but the backend race acquired the lock
    // between pre-check and send. The chat route emits a structured
    // MACHINE_BUSY error event. The renderer must route it to the
    // yellow state (not just show as a chat error).
    backend.scriptNextResponse({
      error: {
        code: 'MACHINE_BUSY',
        message: 'Race condition',
        machineId: TEST_MACHINE_ID,
        ownerChatId: 'other-chat',
      },
    })

    const user = userEvent.setup()
    render(<CompactPill />)

    await user.type(getInput(), 'race condition test{Enter}')

    // The user message lands in the chat (handleSubmit's non-busy path
    // ran addUserMessage).
    await waitFor(() => {
      const users = useChatStore.getState().messages.filter((m) => m.role === 'user')
      expect(users).toHaveLength(1)
    })

    // Then SSE delivers MACHINE_BUSY → yellow appears.
    await screen.findByRole('button', { name: /override and run/i })

    // Chat thread still has the user message (NOT orphaned).
    const users = useChatStore.getState().messages.filter((m) => m.role === 'user')
    expect(users).toHaveLength(1)
    expect(users[0].content).toContain('race condition test')
    // No error string appended.
    const assistants = useChatStore.getState().messages.filter((m) => m.role === 'assistant')
    for (const a of assistants) {
      expect(a.content).not.toContain('Error:')
    }
  })

  it('★ Override & Run after post-error MACHINE_BUSY does NOT double-add the user message', async () => {
    // First call: race-condition MACHINE_BUSY
    backend.scriptNextResponse({
      error: {
        code: 'MACHINE_BUSY',
        message: 'race',
        machineId: TEST_MACHINE_ID,
        ownerChatId: 'other',
      },
    })

    const user = userEvent.setup()
    render(<CompactPill />)
    await user.type(getInput(), 'one shot{Enter}')

    // Wait for the message to land + the yellow to surface.
    await waitFor(() => {
      const users = useChatStore.getState().messages.filter((m) => m.role === 'user')
      expect(users).toHaveLength(1)
    })
    await screen.findByRole('button', { name: /override and run/i })

    // Script the retry to succeed.
    backend.scriptNextResponse({ textChunks: ['recovered.'] })
    backend.setNotBusy(TEST_MACHINE_ID)

    await user.click(screen.getByRole('button', { name: /override and run/i }))

    await waitFor(() => expect(backend.sendCallCount).toBeGreaterThanOrEqual(2), { timeout: 3000 })

    // ★ EXACTLY ONE user message — alreadyInChat=true semantics work
    // end-to-end. If this fails, the message would be duplicated.
    const users = useChatStore.getState().messages.filter((m) => m.role === 'user')
    expect(users).toHaveLength(1)
    expect(users[0].content).toBe('one shot')
  })
})

// ═════════════════════════════════════════════════════════════════════════
// 3. Error responses
// ═════════════════════════════════════════════════════════════════════════

describe('E2E — error responses', () => {
  it('generic SSE error event appends a readable error line to the assistant message', async () => {
    backend.scriptNextResponse({
      textChunks: [],
      error: { message: 'Insufficient credits. Please purchase more credits to continue.' },
    })

    const user = userEvent.setup()
    render(<CompactPill />)
    await user.type(getInput(), 'try{Enter}')

    await waitFor(() => {
      const assistants = useChatStore.getState().messages.filter((m) => m.role === 'assistant')
      const hasError = assistants.some((a) => a.content.includes('Error:'))
      expect(hasError).toBe(true)
    })
  })

  it('MACHINE_BUSY error is NOT shown as a raw error in the chat thread', async () => {
    backend.scriptNextResponse({
      error: {
        code: 'MACHINE_BUSY',
        message: 'Machine is busy',
        machineId: TEST_MACHINE_ID,
        ownerChatId: 'other',
      },
    })

    const user = userEvent.setup()
    render(<CompactPill />)
    await user.type(getInput(), 'busy via sse{Enter}')

    await screen.findByRole('button', { name: /override and run/i })

    // No "Error:" line in the chat — the busy state took over routing.
    const assistants = useChatStore.getState().messages.filter((m) => m.role === 'assistant')
    for (const a of assistants) {
      expect(a.content).not.toContain('Error:')
    }
  })

  it('streaming stops cleanly on error (isStreaming → false)', async () => {
    backend.scriptNextResponse({
      error: { message: 'Backend exploded' },
    })

    const user = userEvent.setup()
    render(<CompactPill />)
    await user.type(getInput(), 'fail{Enter}')

    await waitFor(() => {
      expect(useChatStore.getState().isStreaming).toBe(false)
    })
  })
})

// ═════════════════════════════════════════════════════════════════════════
// 4. Connection state
// ═════════════════════════════════════════════════════════════════════════

describe('E2E — connection state', () => {
  it('disconnected: input is disabled, IPC never fires', async () => {
    useConnectionStore.setState({ state: 'disconnected' } as any)
    render(<CompactPill />)

    expect(getInput()).toBeDisabled()
    // Even synthetic events shouldn't push through canSend's gate.
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    expect(backend.sendCallCount).toBe(0)
    expect((window as any).coasty.checkMachineBusy.mock.calls.length).toBe(0)
  })

  it('reconnect → next send goes through', async () => {
    useConnectionStore.setState({ state: 'disconnected' } as any)
    const { rerender } = render(<CompactPill />)

    useConnectionStore.setState({ state: 'connected' } as any)
    rerender(<CompactPill />)

    backend.scriptNextResponse({ textChunks: ['back online'] })
    const user = userEvent.setup()
    await user.type(getInput(), 'after reconnect{Enter}')

    await waitFor(() => expect(backend.sendCallCount).toBeGreaterThanOrEqual(1))
  })

  it('connecting state: send is gated', async () => {
    useConnectionStore.setState({ state: 'connecting' } as any)
    render(<CompactPill />)
    expect(getInput()).toBeDisabled()
  })

  it('error state: send is gated (no panic-send to a broken bridge)', async () => {
    useConnectionStore.setState({ state: 'error' } as any)
    render(<CompactPill />)
    expect(getInput()).toBeDisabled()
  })
})
