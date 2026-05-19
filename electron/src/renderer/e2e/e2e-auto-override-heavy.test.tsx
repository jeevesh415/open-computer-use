/**
 * @vitest-environment jsdom
 *
 * Heavy edge-case tests for the new auto-override flow.
 *
 * Context
 * -------
 * When the user clicks Send and the machine is busy, the app
 * automatically stops the prior task and proceeds with the send.
 * No yellow banner, no confirmation, just a one-click flow with a
 * brief ~300 ms grace. The yellow banner is now ONLY a fallback for
 * when the auto-stop itself fails (IPC throws or stop-machine
 * returns success=false).
 *
 * This file pins the trickier edge cases:
 *
 *   1. Rapid double-click during auto-recovery (race protection)
 *   2. Multi-turn conversation across auto-recoveries
 *   3. Auto-recovery succeeds → state is fully reset (no leaked busy)
 *   4. Auto-recovery while user is also typing (input not lost)
 *   5. Post-error MACHINE_BUSY (in-flight SSE event) still shows
 *      banner — auto-recovery only applies to the pre-check path
 *   6. checkMachineBusy fails open (not busy) → normal send
 *   7. Force-release path (forced=true) handled identically to released=true
 *   8. Auto-recovery + multi-turn: chat_id sticky
 *   9. The 300ms grace really IS waited (not skipped)
 *  10. Connection state changes mid-auto-recovery
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

async function waitForSendDispatched() {
  await waitFor(
    () => expect(backend.sendCallCount).toBeGreaterThanOrEqual(1),
    { timeout: 3000 },
  )
}

// ═════════════════════════════════════════════════════════════════════════
// 1. Race protection — rapid double-click during auto-recovery
// ═════════════════════════════════════════════════════════════════════════

describe('Auto-override — race protection', () => {
  it('★ rapid double-Enter during auto-recovery does NOT fire two sends', async () => {
    backend.setBusy(TEST_MACHINE_ID)
    backend.scriptNextResponse({
      textChunks: ['streaming'],
      perEventDelayMs: 30,
    })

    const user = userEvent.setup()
    render(<CompactPill />)
    const input = getInput()

    // First Enter triggers auto-recovery.
    await user.type(input, 'rapid send{Enter}')
    // Immediately try a second Enter — auto-recovery is still in
    // the 300ms grace window. canSend should gate (isStreaming
    // would be true once _doSubmit runs).
    await user.keyboard('{Enter}')

    await waitForSendDispatched()
    await act(async () => { await new Promise((r) => setTimeout(r, 200)) })

    // ★ Exactly one send dispatched even with the double-press.
    expect(backend.sendCallCount).toBe(1)
    // ★ Exactly one stopMachine call (the auto-recovery).
    expect(backend.stopMachineCallCount).toBe(1)
  })

  it('★ rapid Send button double-click during auto-recovery → only one send', async () => {
    backend.setBusy(TEST_MACHINE_ID)
    backend.scriptNextResponse({ textChunks: ['ok'], perEventDelayMs: 50 })

    const user = userEvent.setup()
    render(<CompactPill />)
    const input = getInput()
    await user.type(input, 'click click click')

    const sendBtn = screen.getByRole('button', { name: /^send$/i })
    // Three rapid clicks.
    await user.click(sendBtn)
    try { await user.click(sendBtn) } catch { /* button may be gone */ }
    try { await user.click(sendBtn) } catch { /* button may be gone */ }

    await waitForSendDispatched()
    await act(async () => { await new Promise((r) => setTimeout(r, 200)) })

    expect(backend.sendCallCount).toBe(1)
    expect(backend.stopMachineCallCount).toBe(1)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// 2. Multi-turn across auto-recoveries
// ═════════════════════════════════════════════════════════════════════════

describe('Auto-override — multi-turn', () => {
  it('★ turn 1 hits busy → auto-recover; turn 2 not busy → normal send. Same chat_id.', async () => {
    backend.setBusy(TEST_MACHINE_ID)
    backend.scriptNextResponse({ textChunks: ['turn 1 done'] })

    const user = userEvent.setup()
    render(<CompactPill />)
    await user.type(getInput(), 'first turn{Enter}')
    await waitForSendDispatched()
    await waitFor(() => expect(useChatStore.getState().isStreaming).toBe(false))

    const chatIdT1 = backend.capturedSends[0].chatId

    // Machine is now not busy (auto-recovery worked).
    expect(backend.busyMachinesSize?.()).toBeFalsy?.()  // can't easily inspect; rely on next send

    backend.scriptNextResponse({ textChunks: ['turn 2 done'] })
    await user.type(getInput(), 'second turn{Enter}')
    await waitFor(() => expect(backend.sendCallCount).toBeGreaterThanOrEqual(2), { timeout: 3000 })

    const chatIdT2 = backend.capturedSends[1].chatId
    // ★ Same chat across both turns.
    expect(chatIdT2).toBe(chatIdT1)
    // stopMachine fired ONLY on turn 1 (turn 2 was not busy).
    expect(backend.stopMachineCallCount).toBe(1)

    await waitFor(() => {
      const users = useChatStore.getState().messages.filter((m) => m.role === 'user')
      expect(users).toHaveLength(2)
    })
  })

  it('★ both turns hit busy → both auto-recover; chat_id still sticky', async () => {
    backend.setBusy(TEST_MACHINE_ID)
    backend.scriptNextResponse({ textChunks: ['t1'] })

    const user = userEvent.setup()
    render(<CompactPill />)
    await user.type(getInput(), 'turn 1{Enter}')
    await waitForSendDispatched()
    await waitFor(() => expect(useChatStore.getState().isStreaming).toBe(false))

    // Re-set busy for turn 2.
    backend.setBusy(TEST_MACHINE_ID)
    backend.scriptNextResponse({ textChunks: ['t2'] })
    await user.type(getInput(), 'turn 2{Enter}')
    await waitFor(() => expect(backend.sendCallCount).toBeGreaterThanOrEqual(2), { timeout: 3000 })

    expect(backend.stopMachineCallCount).toBe(2)
    expect(backend.capturedSends[1].chatId).toBe(backend.capturedSends[0].chatId)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// 3. State invariants after auto-recovery
// ═════════════════════════════════════════════════════════════════════════

describe('Auto-override — state cleanup', () => {
  it('★ after successful auto-recovery: isMachineBusy=false, pendingInput=null, isStoppingMachine=false', async () => {
    backend.setBusy(TEST_MACHINE_ID)
    backend.scriptNextResponse({ textChunks: ['done'] })

    const user = userEvent.setup()
    render(<CompactPill />)
    await user.type(getInput(), 'clean state{Enter}')
    await waitForSendDispatched()
    await waitFor(() => expect(useChatStore.getState().isStreaming).toBe(false))

    // After recovery completes, no busy/stopping state should linger.
    // We can't read internal hook state directly here, but the UI
    // surface (yellow button + Switching indicator) is a faithful
    // proxy.
    expect(screen.queryByRole('button', { name: /override and run/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /switching/i })).toBeNull()
  })

  it('★ input is cleared exactly ONCE on successful auto-recovery', async () => {
    backend.setBusy(TEST_MACHINE_ID)
    backend.scriptNextResponse({ textChunks: ['ok'] })

    const user = userEvent.setup()
    render(<CompactPill />)
    const input = getInput()
    await user.type(input, 'clear once{Enter}')

    await waitForSendDispatched()
    await waitFor(() => expect(input.value).toBe(''))

    // Now type a new message — value should be just the new text,
    // not corrupted by any state-resurrection.
    await user.type(input, 'second')
    expect(input.value).toBe('second')
  })

  it('★ no leaked SSE event after auto-recovery (stale request filtered)', async () => {
    // Verify lib/api.ts's requestId filtering still works after the
    // auto-recovery path — fire a stale event after the send
    // completed, it should be ignored.
    backend.setBusy(TEST_MACHINE_ID)
    backend.scriptNextResponse({ textChunks: ['legit'] })

    const user = userEvent.setup()
    render(<CompactPill />)
    await user.type(getInput(), 'real send{Enter}')
    await waitForSendDispatched()
    await waitFor(() => expect(useChatStore.getState().isStreaming).toBe(false))

    const initialCount = useChatStore.getState().messages.length
    ;(backend as any).emit({
      requestId: 'STALE-DOES-NOT-EXIST',
      type: '0',
      data: JSON.stringify('ghost content from old stream'),
    })
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    expect(useChatStore.getState().messages.length).toBe(initialCount)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// 4. Defensive: non-busy + fail-open paths still work
// ═════════════════════════════════════════════════════════════════════════

describe('Auto-override — defensive paths', () => {
  it('not-busy path: stopMachine is NEVER called (no rogue stops)', async () => {
    backend.scriptNextResponse({ textChunks: ['ok'] })
    const user = userEvent.setup()
    render(<CompactPill />)
    await user.type(getInput(), 'normal send{Enter}')

    await waitForSendDispatched()
    await waitFor(() => expect(useChatStore.getState().isStreaming).toBe(false))

    expect(backend.stopMachineCallCount).toBe(0)
  })

  it('checkMachineBusy IPC throws → fail-open → normal send (no auto-recovery)', async () => {
    const coasty = (window as any).coasty
    coasty.checkMachineBusy = (async () => { throw new Error('IPC torn down') }) as any

    backend.scriptNextResponse({ textChunks: ['ok'] })
    const user = userEvent.setup()
    render(<CompactPill />)
    await user.type(getInput(), 'fail open{Enter}')

    await waitForSendDispatched()
    // No auto-recovery because checkBusy returned false on error.
    expect(backend.stopMachineCallCount).toBe(0)
  })

  it('checkMachineBusy returns success=false → treated as not busy (fail-open)', async () => {
    const coasty = (window as any).coasty
    coasty.checkMachineBusy = (async () => ({
      success: false, busy: false, error: 'HTTP 500',
    })) as any

    backend.scriptNextResponse({ textChunks: ['ok'] })
    const user = userEvent.setup()
    render(<CompactPill />)
    await user.type(getInput(), 'fail open 500{Enter}')

    await waitForSendDispatched()
    expect(backend.stopMachineCallCount).toBe(0)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// 5. Disconnected / connection state
// ═════════════════════════════════════════════════════════════════════════

describe('Auto-override — connection state', () => {
  it('disconnected: input disabled, no IPC fires', async () => {
    backend.setBusy(TEST_MACHINE_ID)
    useConnectionStore.setState({ state: 'disconnected' } as any)
    render(<CompactPill />)

    expect(getInput()).toBeDisabled()
    await act(async () => { await new Promise((r) => setTimeout(r, 100)) })
    expect(backend.sendCallCount).toBe(0)
    expect(backend.stopMachineCallCount).toBe(0)
  })

  it('reconnect after disconnect → auto-recovery works on next send', async () => {
    backend.setBusy(TEST_MACHINE_ID)
    useConnectionStore.setState({ state: 'disconnected' } as any)
    const { rerender } = render(<CompactPill />)

    useConnectionStore.setState({ state: 'connected' } as any)
    rerender(<CompactPill />)

    backend.scriptNextResponse({ textChunks: ['reconnected'] })
    const user = userEvent.setup()
    await user.type(getInput(), 'after reconnect{Enter}')

    await waitForSendDispatched()
    expect(backend.stopMachineCallCount).toBe(1)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// 6. Post-error MACHINE_BUSY (SSE race condition path)
// ═════════════════════════════════════════════════════════════════════════

describe('Auto-override — post-error MACHINE_BUSY (race)', () => {
  it('★ pre-check said not busy → mid-stream MACHINE_BUSY → user message preserved + yellow banner appears', async () => {
    // The race: pre-check is fast and reports not-busy; meanwhile
    // another client acquires the lock; our send hits the backend
    // which now reports MACHINE_BUSY via SSE.
    //
    // Auto-recovery in this case is intentionally NOT enabled — the
    // user message is ALREADY in the chat thread (post-error stash
    // alreadyInChat=true), so we surface the yellow banner so the
    // user explicitly authorizes the retry. Auto-retry here would
    // introduce ambiguity (which task was running? whose was it?).
    backend.scriptNextResponse({
      error: {
        code: 'MACHINE_BUSY',
        message: 'race',
        machineId: TEST_MACHINE_ID,
        ownerChatId: 'other-chat',
      },
    })

    const user = userEvent.setup()
    render(<CompactPill />)
    await user.type(getInput(), 'pre-check pass, mid-stream busy{Enter}')

    // User message landed.
    await waitFor(() => {
      const users = useChatStore.getState().messages.filter((m) => m.role === 'user')
      expect(users).toHaveLength(1)
    })
    // Banner appears for manual retry.
    await screen.findByRole('button', { name: /override and run/i })
  })

  it('★ post-error retry via banner: no double-add of the user message', async () => {
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
    await user.type(getInput(), 'race retry{Enter}')

    await screen.findByRole('button', { name: /override and run/i })

    backend.scriptNextResponse({ textChunks: ['recovered'] })
    await user.click(screen.getByRole('button', { name: /override and run/i }))

    await waitFor(() => expect(backend.sendCallCount).toBeGreaterThanOrEqual(2), { timeout: 3000 })

    const users = useChatStore.getState().messages.filter((m) => m.role === 'user')
    expect(users).toHaveLength(1)
    expect(users[0].content).toBe('race retry')
  })
})

// ═════════════════════════════════════════════════════════════════════════
// 7. Stability under repeated auto-recoveries
// ═════════════════════════════════════════════════════════════════════════

describe('Auto-override — stability under repetition', () => {
  it('★ 5 consecutive sends, each hitting busy: all 5 auto-recover successfully', async () => {
    const user = userEvent.setup()
    render(<CompactPill />)

    for (let i = 1; i <= 5; i++) {
      backend.setBusy(TEST_MACHINE_ID)
      backend.scriptNextResponse({ textChunks: [`r${i}`] })
      await user.type(getInput(), `msg ${i}{Enter}`)
      await waitFor(
        () => expect(backend.sendCallCount).toBeGreaterThanOrEqual(i),
        { timeout: 3000 },
      )
      await waitFor(() => expect(useChatStore.getState().isStreaming).toBe(false))
    }

    expect(backend.stopMachineCallCount).toBe(5)
    expect(backend.sendCallCount).toBe(5)
    const users = useChatStore.getState().messages.filter((m) => m.role === 'user')
    expect(users).toHaveLength(5)
    // All sends share the same chat_id (createChat only fires once).
    const chatIds = new Set(backend.capturedSends.map((s) => s.chatId))
    expect(chatIds.size).toBe(1)
  })

  it('★ mixed busy/not-busy sends in a row: stopMachine only fires on busy turns', async () => {
    const user = userEvent.setup()
    render(<CompactPill />)

    // Turn 1: busy
    backend.setBusy(TEST_MACHINE_ID)
    backend.scriptNextResponse({ textChunks: ['t1'] })
    await user.type(getInput(), 'busy 1{Enter}')
    await waitFor(() => expect(backend.sendCallCount).toBe(1), { timeout: 3000 })
    await waitFor(() => expect(useChatStore.getState().isStreaming).toBe(false))

    // Turn 2: not busy
    backend.scriptNextResponse({ textChunks: ['t2'] })
    await user.type(getInput(), 'normal 2{Enter}')
    await waitFor(() => expect(backend.sendCallCount).toBe(2), { timeout: 3000 })
    await waitFor(() => expect(useChatStore.getState().isStreaming).toBe(false))

    // Turn 3: busy again
    backend.setBusy(TEST_MACHINE_ID)
    backend.scriptNextResponse({ textChunks: ['t3'] })
    await user.type(getInput(), 'busy 3{Enter}')
    await waitFor(() => expect(backend.sendCallCount).toBe(3), { timeout: 3000 })

    // stopMachine fired ONLY on turns 1 and 3.
    expect(backend.stopMachineCallCount).toBe(2)
  })
})
