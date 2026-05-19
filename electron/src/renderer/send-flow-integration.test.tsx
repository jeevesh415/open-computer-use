/**
 * @vitest-environment jsdom
 *
 * Real component-render integration tests for the chat send flow.
 *
 * What this file pins (web-app-style contract)
 * --------------------------------------------
 * The web app at ``app/components/chat-input/chat-input.tsx`` follows
 * a simple rule: **the user's typed text stays in the input until the
 * system has a definite answer about what happens to it**. The
 * Electron desktop app must match this contract, because users move
 * between web and desktop and any behavioural drift is a trust
 * violation.
 *
 * Concretely, after clicking Send:
 *
 *   1. If the machine is NOT busy → message lands in the chat
 *      thread, wire call fires, input is cleared. ('sent' branch)
 *
 *   2. If the machine IS busy → text STAYS in the input, the yellow
 *      "Override & Run" button appears, and NO message is added to
 *      the chat thread until the user clicks Override. ('busy' branch)
 *
 *   3. If the request is rejected (empty input, disconnected, force-
 *      stop failed) → text STAYS in the input, no state change.
 *      ('rejected' branch)
 *
 * The two regressions this file guards against
 * --------------------------------------------
 *   (A) "Message disappears on send" — the old code cleared the input
 *       synchronously BEFORE the busy pre-check resolved. Combined
 *       with the auto-dismiss useEffect, a busy-positive response
 *       wiped the user's text into the void with no UI feedback.
 *       Fixed by returning a status from handleSubmit + clearing
 *       only on 'sent'.
 *
 *   (B) "Message added to chat thread before user confirms" — an
 *       intermediate fix added the message BEFORE the busy check to
 *       avoid the disappear. That polluted the chat thread with
 *       not-yet-confirmed messages. The web app doesn't do that;
 *       neither should we. Fixed by adding the message INSIDE the
 *       'sent' branch only.
 *
 * Both regressions had us fixing the symptom in the wrong layer.
 * The right layer is the hook's return value: it carries the
 * decision authority to the caller, which knows whether to mutate
 * the input.
 *
 * Test layering
 * -------------
 *   - This file: render-level integration via @testing-library/react.
 *     Slowest (~6s) but catches issues only visible when the hook +
 *     components + chat store interact under real React/jsdom
 *     semantics.
 *
 *   - useChatSubmit-ordering.test.ts: fast pure-logic mirror of the
 *     decision tree. Runs in 300ms; pins the in-hook contract that
 *     these integration tests verify end-to-end.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import React from 'react'
import { CompactPill } from './components/CompactPill'
import { useAuthStore } from './stores/auth-store'
import { useConnectionStore } from './stores/connection-store'
import { useChatStore } from './stores/chat-store'
import { useWindowStore } from './stores/window-store'

// ── Test fixtures ─────────────────────────────────────────────────────────

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
const TEST_USER_ID = 'user-test-001'
const TEST_MACHINE_ID = 'machine-test-001'

function buildCoastyMock(): CoastyMock {
  return {
    checkMachineBusy: vi.fn(async () => ({
      success: true,
      busy: false,
      ownerChatId: null,
    })),
    stopMachine: vi.fn(async () => ({
      success: true,
      stopped: true,
      released: true,
      forced: false,
      ownerChatId: null,
    })),
    sendChatMessage: vi.fn(async () => ({ success: true })),
    abortChat: vi.fn(async () => ({ success: true })),
    onChatSSEEvent: vi.fn(() => () => {}),
    createChat: vi.fn(async () => ({
      success: true,
      chat: { id: 'chat-fresh-001', title: 'New Task', model: 'default' },
    })),
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
  coasty = buildCoastyMock()
  ;(globalThis as any).window.coasty = coasty

  useAuthStore.setState({
    user: {
      id: TEST_USER_ID,
      email: 'test@coasty.ai',
      name: 'Test',
      avatar: null,
    },
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
  delete (globalThis as any).window.coasty
  vi.clearAllMocks()
})

// ── Helpers ───────────────────────────────────────────────────────────────

function renderCompactPill() {
  return render(<CompactPill />)
}

function getInput(): HTMLInputElement {
  return screen.getByPlaceholderText(/Send a message|Another task running|Working/i) as HTMLInputElement
}

async function userMessages() {
  return useChatStore.getState().messages.filter((m) => m.role === 'user')
}

async function waitForUserMessage(content?: string) {
  await waitFor(async () => {
    const um = await userMessages()
    expect(um.length).toBeGreaterThan(0)
    if (content !== undefined) {
      expect(um[um.length - 1].content).toContain(content)
    }
  })
}

// ═════════════════════════════════════════════════════════════════════════
// 1. Happy path — machine NOT busy
// ═════════════════════════════════════════════════════════════════════════

describe('CompactPill — happy path (not busy)', () => {
  it('typing + Send adds the message to chat AND clears input', async () => {
    const user = userEvent.setup()
    renderCompactPill()

    const input = getInput()
    await user.type(input, 'do something useful')
    await user.click(screen.getByRole('button', { name: /^send$/i }))

    await waitForUserMessage('do something useful')
    expect((await userMessages())).toHaveLength(1)
    // Input cleared because handleSubmit resolved to 'sent'.
    await waitFor(() => expect(input.value).toBe(''))
  })

  it('Enter key works the same as the Send button', async () => {
    const user = userEvent.setup()
    renderCompactPill()
    await user.type(getInput(), 'enter-sent message{Enter}')
    await waitForUserMessage('enter-sent message')
    expect((await userMessages())).toHaveLength(1)
  })

  it('hits the IPC checkMachineBusy pre-flight on each send', async () => {
    const user = userEvent.setup()
    renderCompactPill()
    await user.type(getInput(), 'first send{Enter}')
    await waitFor(() =>
      expect(coasty.checkMachineBusy).toHaveBeenCalledWith(TEST_MACHINE_ID),
    )
  })

  it('hits sendChatMessage IPC after a clean pre-check', async () => {
    const user = userEvent.setup()
    renderCompactPill()
    await user.type(getInput(), 'do it{Enter}')
    await waitFor(() => expect(coasty.sendChatMessage).toHaveBeenCalled())
    const sendArgs = coasty.sendChatMessage.mock.calls[0][0]
    expect(sendArgs.machineId).toBe(TEST_MACHINE_ID)
    expect(sendArgs.userId).toBe(TEST_USER_ID)
    // The last wire message must be the user's input.
    const lastMsg = sendArgs.messages[sendArgs.messages.length - 1]
    expect(lastMsg.role).toBe('user')
    expect(lastMsg.content).toContain('do it')
  })
})

// ═════════════════════════════════════════════════════════════════════════
// 2. Busy pre-check — web-app-style behavior
// ═════════════════════════════════════════════════════════════════════════

describe('CompactPill — busy pre-check AUTO-OVERRIDE (happy path)', () => {
  // The local-desktop UX: when the user clicks Send and the machine
  // is busy, the app AUTOMATICALLY stops the prior task and sends.
  // No yellow banner. No confirmation. One click → message goes
  // through (with a small ~300 ms grace).
  //
  // Tests below pin the auto-recovery happy path. Failure-mode
  // fallbacks (stop IPC throws, success=false) are in the next
  // describe block.
  beforeEach(() => {
    coasty.checkMachineBusy = vi.fn(async () => ({
      success: true,
      busy: true,
      ownerChatId: 'chat-other-task',
    }))
    // Default: stop succeeds cleanly.
    coasty.stopMachine = vi.fn(async () => ({
      success: true,
      stopped: true,
      released: true,
      forced: false,
      ownerChatId: 'chat-other-task',
    }))
  })

  // Helper: wait until the full auto-recovery flow has reached the
  // _doSubmit step (sendChatMessage IPC fired). This is the only
  // reliable "we got past the busy block AND past the 300ms grace"
  // signal in these tests — ``isStreaming`` toggles to true ONLY
  // inside _doSubmit (after the grace), so we can't gate on its
  // post-finally false state because that final state matches the
  // initial (un-started) state too.
  async function waitForSendDispatched() {
    await waitFor(
      () => expect(coasty.sendChatMessage).toHaveBeenCalled(),
      { timeout: 2000 },
    )
  }

  it('★ busy → click Send → stopMachine fires automatically (no user click)', async () => {
    const user = userEvent.setup()
    renderCompactPill()

    await user.type(getInput(), 'auto-stop me{Enter}')

    await waitFor(() => expect(coasty.stopMachine).toHaveBeenCalledWith(TEST_MACHINE_ID))
    // Drain the rest of the auto-recovery (300ms grace + _doSubmit
    // + sendChatMessage) so the next test starts from a clean state.
    await waitForSendDispatched()
  })

  it('★ busy → message lands in the chat thread after auto-stop completes', async () => {
    const user = userEvent.setup()
    renderCompactPill()

    await user.type(getInput(), 'gets through{Enter}')
    await waitForSendDispatched()
    const um = await userMessages()
    expect(um).toHaveLength(1)
    expect(um[0].content).toContain('gets through')
  })

  it('★ busy → input is cleared on successful auto-recovery', async () => {
    const user = userEvent.setup()
    renderCompactPill()

    const input = getInput()
    await user.type(input, 'clear me{Enter}')
    await waitFor(() => expect(coasty.sendChatMessage).toHaveBeenCalled())
    await waitFor(() => expect(input.value).toBe(''))
  })

  it('★ busy → NO yellow "Override & Run" button shown (auto-recovery handles it silently)', async () => {
    const user = userEvent.setup()
    renderCompactPill()

    await user.type(getInput(), 'no banner needed{Enter}')

    // Wait for full auto-recovery to finish.
    await waitFor(() => expect(coasty.sendChatMessage).toHaveBeenCalled())
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })

    // Yellow button NEVER appeared.
    expect(screen.queryByRole('button', { name: /override and run/i })).toBeNull()
  })

  it('★ busy → sendChatMessage fires AFTER stopMachine (correct ordering)', async () => {
    const callOrder: string[] = []
    coasty.stopMachine = vi.fn(async () => {
      callOrder.push('stop')
      return { success: true, stopped: true, released: true, forced: false, ownerChatId: null }
    })
    const origSend = coasty.sendChatMessage
    coasty.sendChatMessage = vi.fn(async (...args) => {
      callOrder.push('send')
      return await origSend(...args)
    })

    const user = userEvent.setup()
    renderCompactPill()
    await user.type(getInput(), 'order check{Enter}')

    await waitFor(() => expect(callOrder).toEqual(['stop', 'send']))
  })

  it('★ stale Redis lock case (forced=true) auto-recovers transparently', async () => {
    coasty.stopMachine = vi.fn(async () => ({
      success: true,
      stopped: true,
      released: true,
      forced: true,  // backend force-deleted the stale lock
      ownerChatId: 'dead-worker-chat',
    }))

    const user = userEvent.setup()
    renderCompactPill()
    await user.type(getInput(), 'force release please{Enter}')

    await waitForUserMessage('force release please')
    // No banner, no manual click — the user just sees a clean send.
    expect(screen.queryByRole('button', { name: /override and run/i })).toBeNull()
  })

  it('★ stopMachine returning stopped=false (already not busy) still proceeds with send', async () => {
    // The pre-check IPC might have returned busy=true based on a
    // stale read. By the time the user clicks Send + stop fires,
    // the lock could already be released. stop-machine reports
    // stopped=false but it's a no-op — we should still send.
    coasty.stopMachine = vi.fn(async () => ({
      success: true,
      stopped: false,
      reason: 'Machine is not busy',
      ownerChatId: null,
    }))

    const user = userEvent.setup()
    renderCompactPill()
    await user.type(getInput(), 'stale read{Enter}')

    await waitFor(() => expect(coasty.sendChatMessage).toHaveBeenCalled())
    await waitForUserMessage('stale read')
  })

  it('★ multi-turn after auto-recovery: chat_id sticky across follow-up sends', async () => {
    const user = userEvent.setup()
    renderCompactPill()

    // Turn 1: busy → auto-recover → send.
    await user.type(getInput(), 'turn 1{Enter}')
    await waitForUserMessage('turn 1')
    const chatId1 = backend_capturedSends()[0]?.chatId
    expect(chatId1).toBeTruthy()

    // After recovery, machine is no longer busy.
    coasty.checkMachineBusy = vi.fn(async () => ({
      success: true, busy: false, ownerChatId: null,
    }))

    // Turn 2: normal send.
    await user.type(getInput(), 'turn 2{Enter}')
    await waitFor(async () => {
      const um = await userMessages()
      expect(um).toHaveLength(2)
    })
    const sends = backend_capturedSends()
    expect(sends).toHaveLength(2)
    expect(sends[1].chatId).toBe(chatId1)  // same chat
  })

  it('auto-recovery includes ~300ms grace between stop and send (lock release window)', async () => {
    let stopAt = 0
    let sendAt = 0
    coasty.stopMachine = vi.fn(async () => {
      stopAt = Date.now()
      return { success: true, stopped: true, released: true, forced: false, ownerChatId: null }
    })
    const origSend = coasty.sendChatMessage
    coasty.sendChatMessage = vi.fn(async (...args) => {
      sendAt = Date.now()
      return await origSend(...args)
    })

    const user = userEvent.setup()
    renderCompactPill()
    await user.type(getInput(), 'check grace{Enter}')

    await waitFor(() => expect(sendAt).toBeGreaterThan(0))
    const gap = sendAt - stopAt
    // 300ms target ± wide tolerance for test scheduling.
    expect(gap).toBeGreaterThanOrEqual(250)
    expect(gap).toBeLessThan(800)
  })
})

describe('CompactPill — busy pre-check FALLBACK (auto-stop failure)', () => {
  // The yellow banner now only surfaces when the auto-stop itself
  // failed — IPC threw, or backend returned success=false. The user
  // can then click Override & Run to retry the recovery manually.
  beforeEach(() => {
    coasty.checkMachineBusy = vi.fn(async () => ({
      success: true,
      busy: true,
      ownerChatId: 'chat-other-task',
    }))
  })

  it('★ stopMachine throws → yellow Override & Run banner appears as fallback', async () => {
    coasty.stopMachine = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    })

    const user = userEvent.setup()
    renderCompactPill()
    await user.type(getInput(), 'fallback path{Enter}')

    await screen.findByRole('button', { name: /override and run/i })
    // No wire call fired — stop failed, we didn't try to send.
    expect(coasty.sendChatMessage).not.toHaveBeenCalled()
  })

  it('★ stopMachine throws → input is PRESERVED so user can retry', async () => {
    coasty.stopMachine = vi.fn(async () => {
      throw new Error('network down')
    })

    const user = userEvent.setup()
    renderCompactPill()
    const input = getInput()
    await user.type(input, 'keep my text{Enter}')

    await screen.findByRole('button', { name: /override and run/i })
    // Input not cleared — the user can click Override or clear to cancel.
    expect(input.value).toBe('keep my text')
  })

  it('stopMachine returns success=false → yellow banner fallback', async () => {
    coasty.stopMachine = vi.fn(async () => ({
      success: false,
      error: 'Backend stop-machine endpoint returned 500',
    }))

    const user = userEvent.setup()
    renderCompactPill()
    await user.type(getInput(), 'success-false fallback{Enter}')

    await screen.findByRole('button', { name: /override and run/i })
    expect(coasty.sendChatMessage).not.toHaveBeenCalled()
  })

  it('★ user clicks Override & Run in the fallback → retry happens', async () => {
    // First attempt fails, banner appears. User clicks Override & Run.
    // The second stopMachine call should succeed and the send should
    // proceed.
    let stopCallCount = 0
    coasty.stopMachine = vi.fn(async () => {
      stopCallCount++
      if (stopCallCount === 1) throw new Error('first attempt fails')
      return { success: true, stopped: true, released: true, forced: false, ownerChatId: null }
    })

    const user = userEvent.setup()
    renderCompactPill()
    await user.type(getInput(), 'retry me{Enter}')

    const banner = await screen.findByRole('button', { name: /override and run/i })
    await user.click(banner)

    await waitFor(() => expect(coasty.sendChatMessage).toHaveBeenCalled(), { timeout: 2000 })
    await waitForUserMessage('retry me')
  })

  it('★ clearing the input dismisses the fallback banner', async () => {
    coasty.stopMachine = vi.fn(async () => {
      throw new Error('fail')
    })

    const user = userEvent.setup()
    renderCompactPill()
    const input = getInput()
    await user.type(input, 'cancel{Enter}')

    await screen.findByRole('button', { name: /override and run/i })
    await user.clear(input)

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /override and run/i })).toBeNull()
    })
  })

  it('placeholder attribute reflects busy state during fallback', async () => {
    coasty.stopMachine = vi.fn(async () => {
      throw new Error('fail')
    })

    const user = userEvent.setup()
    renderCompactPill()
    const input = getInput()
    await user.type(input, 'placeholder check{Enter}')
    await screen.findByRole('button', { name: /override and run/i })
    expect(input.placeholder).toMatch(/Another task running/i)
  })
})

// Helper used by the auto-recovery multi-turn test above — the
// integration-test file doesn't have a real fake-backend (the e2e
// suite does), so we read the mock's call args directly.
function backend_capturedSends(): Array<{ chatId: string; messages: any[] }> {
  const mock = (window as any).coasty.sendChatMessage
  return mock.mock.calls.map((c: any[]) => c[0])
}

// ═════════════════════════════════════════════════════════════════════════
// 3. Defensive — IPC failure modes
// ═════════════════════════════════════════════════════════════════════════

describe('CompactPill — IPC failure modes', () => {
  it('checkMachineBusy success=false → treats as not busy (fail open)', async () => {
    coasty.checkMachineBusy = vi.fn(async () => ({
      success: false,
      busy: false,
      error: 'HTTP 401',
    }))

    const user = userEvent.setup()
    renderCompactPill()
    await user.type(getInput(), 'fail-open send{Enter}')

    await waitForUserMessage('fail-open send')
    await waitFor(() => expect(coasty.sendChatMessage).toHaveBeenCalled())
  })

  it('checkMachineBusy throw → treats as not busy', async () => {
    coasty.checkMachineBusy = vi.fn(async () => {
      throw new Error('IPC torn down')
    })

    const user = userEvent.setup()
    renderCompactPill()
    await user.type(getInput(), 'thrown ipc{Enter}')

    await waitForUserMessage('thrown ipc')
    await waitFor(() => expect(coasty.sendChatMessage).toHaveBeenCalled())
  })

  it('stopMachine throw during Override & Run → busy state persists, input preserved', async () => {
    // If forceStopAndSend fails to stop the running task, the user
    // shouldn't lose their input. They should be able to retry.
    coasty.checkMachineBusy = vi.fn(async () => ({
      success: true,
      busy: true,
      ownerChatId: 'chat-other',
    }))
    coasty.stopMachine = vi.fn(async () => {
      throw new Error('stop-machine network error')
    })

    const user = userEvent.setup()
    renderCompactPill()
    const input = getInput()
    await user.type(input, 'preserved on stop fail{Enter}')

    const yellowBtn = await screen.findByRole('button', { name: /override and run/i })
    await user.click(yellowBtn)

    await waitFor(() => expect(coasty.stopMachine).toHaveBeenCalled())
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })

    // Wire call did NOT fire (stop failed).
    expect(coasty.sendChatMessage).not.toHaveBeenCalled()
    // Input preserved so the user can retry.
    expect(input.value).toBe('preserved on stop fail')
    // Busy state still visible.
    expect(screen.queryByRole('button', { name: /override and run/i })).toBeTruthy()
  })
})

// ═════════════════════════════════════════════════════════════════════════
// 4. Connection-state gating
// ═════════════════════════════════════════════════════════════════════════

describe('CompactPill — disconnected', () => {
  it('input disabled while disconnected — no send possible', async () => {
    useConnectionStore.setState({ state: 'disconnected' } as any)
    renderCompactPill()
    expect(getInput()).toBeDisabled()
    expect(screen.queryByRole('button', { name: /^send$/i })).toBeNull()
  })

  it('reconnect → sends work normally', async () => {
    useConnectionStore.setState({ state: 'disconnected' } as any)
    const { rerender } = renderCompactPill()
    useConnectionStore.setState({ state: 'connected' } as any)
    rerender(<CompactPill />)

    const user = userEvent.setup()
    await user.type(getInput(), 'after reconnect{Enter}')
    await waitForUserMessage('after reconnect')
  })

  it('does not check busy when not connected (canSend gate)', async () => {
    useConnectionStore.setState({ state: 'disconnected' } as any)
    renderCompactPill()
    // No way to trigger a send when disabled; assert the IPC was
    // never called by the component lifecycle.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })
    expect(coasty.checkMachineBusy).not.toHaveBeenCalled()
  })
})

// ═════════════════════════════════════════════════════════════════════════
// 5. Post-error MACHINE_BUSY path (rare but pinned for completeness)
// ═════════════════════════════════════════════════════════════════════════

describe('CompactPill — post-error MACHINE_BUSY recovery', () => {
  // The post-error path arises when the pre-check said "not busy" but
  // the backend rejected the actual send with MACHINE_BUSY (race
  // condition). In this path, addUserMessage already ran inside
  // _doSubmit, the input was cleared on the 'sent' branch, and then
  // the onMachineBusy SSE event fires. The yellow button must STILL
  // appear and clicking it must NOT add the message twice.

  it('does not orphan the chat-thread message after a post-error busy event', async () => {
    // Pre-check says not busy.
    coasty.checkMachineBusy = vi.fn(async () => ({
      success: true,
      busy: false,
      ownerChatId: null,
    }))

    // Simulate the backend SSE returning MACHINE_BUSY mid-stream.
    // The chat:send-message IPC mock fires sse-event callbacks via
    // window.coasty.onChatSSEEvent — we drive that synthetically.
    const sseListeners: Array<(event: any) => void> = []
    coasty.onChatSSEEvent = vi.fn((listener) => {
      sseListeners.push(listener)
      return () => {
        const i = sseListeners.indexOf(listener)
        if (i >= 0) sseListeners.splice(i, 1)
      }
    })
    coasty.sendChatMessage = vi.fn(async (params) => {
      // Fire the MACHINE_BUSY + finish events WHILE the IPC promise
      // is still awaiting — this models real SSE streaming where
      // events arrive during the open stream, BEFORE the stream
      // closes. Resolving without firing would leave lib/api.ts
      // to clean up its listener first, and the events would
      // dispatch to nothing.
      await new Promise((r) => setTimeout(r, 5))
      for (const l of sseListeners) {
        l({
          requestId: params.requestId,
          type: '3',
          data: JSON.stringify({
            code: 'MACHINE_BUSY',
            message: 'Machine is busy',
            machineId: TEST_MACHINE_ID,
            ownerChatId: 'chat-other',
          }),
        })
        l({
          requestId: params.requestId,
          type: 'd',
          data: JSON.stringify({ finishReason: 'error' }),
        })
      }
      return { success: true }
    })

    const user = userEvent.setup()
    renderCompactPill()

    await user.type(getInput(), 'race condition send{Enter}')

    // First: the message IS added to the chat thread (pre-check said
    // not busy → handleSubmit's 'sent' branch ran addUserMessage).
    await waitForUserMessage('race condition send')

    // Then the SSE MACHINE_BUSY event fires → isMachineBusy=true.
    // Yellow button must appear because pendingInput.alreadyInChat=true
    // (stashed by _doSubmit at the top of its function).
    await screen.findByRole('button', { name: /override and run/i })

    // Critically: the message is STILL in the chat thread (not
    // discarded by the busy-state transition).
    expect((await userMessages())).toHaveLength(1)
  })

  it('Override & Run after post-error busy does NOT double-add the message', async () => {
    // ``alreadyInChat: true`` in pendingInput → forceStopAndSend
    // passes isRetry=true to _doSubmit → _doSubmit skips its own
    // addUserMessage. Net total adds = 1.
    coasty.checkMachineBusy = vi.fn(async () => ({
      success: true,
      busy: false,
      ownerChatId: null,
    }))

    const sseListeners: Array<(event: any) => void> = []
    coasty.onChatSSEEvent = vi.fn((listener) => {
      sseListeners.push(listener)
      return () => {
        const i = sseListeners.indexOf(listener)
        if (i >= 0) sseListeners.splice(i, 1)
      }
    })
    let callCount = 0
    coasty.sendChatMessage = vi.fn(async (params) => {
      callCount++
      if (callCount === 1) {
        // First call: fire MACHINE_BUSY while still awaiting.
        await new Promise((r) => setTimeout(r, 5))
        for (const l of sseListeners) {
          l({
            requestId: params.requestId,
            type: '3',
            data: JSON.stringify({
              code: 'MACHINE_BUSY',
              message: 'Busy',
              machineId: TEST_MACHINE_ID,
              ownerChatId: 'chat-other',
            }),
          })
          l({
            requestId: params.requestId,
            type: 'd',
            data: JSON.stringify({ finishReason: 'error' }),
          })
        }
      }
      // Second call: succeed silently.
      return { success: true }
    })

    const user = userEvent.setup()
    renderCompactPill()
    await user.type(getInput(), 'one shot{Enter}')

    await waitForUserMessage('one shot')
    const yellowBtn = await screen.findByRole('button', { name: /override and run/i })
    await user.click(yellowBtn)

    await waitFor(() => expect(callCount).toBeGreaterThanOrEqual(2))

    // ★ The message appears EXACTLY ONCE in the chat thread, even
    // though we went through send → MACHINE_BUSY → Override → send.
    expect((await userMessages())).toHaveLength(1)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// 6. Web parity — anti-regression invariants
// ═════════════════════════════════════════════════════════════════════════

describe('CompactPill — invariants', () => {
  it('typed text is preserved on the FALLBACK busy path (when auto-stop fails)', async () => {
    // Auto-override mode: in the HAPPY busy path the user's text is
    // cleared after the auto-stop+send completes (just like a normal
    // non-busy send). The text is only preserved if the auto-stop
    // ITSELF fails — that's the rare fallback path where the user
    // needs to manually retry via the yellow banner.
    //
    // This test pins the invariant for the fallback case: typed
    // text is not destroyed when the system couldn't complete the
    // user's action and is asking them to retry.
    coasty.checkMachineBusy = vi.fn(async () => ({
      success: true,
      busy: true,
      ownerChatId: 'chat-other',
    }))
    coasty.stopMachine = vi.fn(async () => {
      throw new Error('auto-stop failed')
    })

    const user = userEvent.setup()
    renderCompactPill()
    const input = getInput()

    await user.type(input, 'sacred text{Enter}')
    await screen.findByRole('button', { name: /override and run/i })
    expect(input.value).toBe('sacred text')

    // Text persists across multiple async cycles.
    await act(async () => { await new Promise((r) => setTimeout(r, 200)) })
    expect(input.value).toBe('sacred text')
  })

  it('two consecutive sends with no busy: both messages added in order', async () => {
    const user = userEvent.setup()
    renderCompactPill()

    await user.type(getInput(), 'first{Enter}')
    await waitForUserMessage('first')

    await user.type(getInput(), 'second{Enter}')
    await waitFor(async () => {
      const um = await userMessages()
      expect(um).toHaveLength(2)
    })
    const um = await userMessages()
    expect(um[0].content).toContain('first')
    expect(um[1].content).toContain('second')
  })
})
