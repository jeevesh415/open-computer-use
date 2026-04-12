/**
 * Tests for the awaiting-human feature across the Electron app:
 *   - SSE event parsing (api.ts 'h' event handler)
 *   - CUA section parsing & grouping (awaiting-human section types)
 *   - Chat store state management (setAwaitingHuman, finishAssistantMessage)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ═══════════════════════════════════════════════════════════════════════
// 1. SSE 'h' event handler (api.ts)
// ═══════════════════════════════════════════════════════════════════════

describe('api.ts SSE event handler — awaiting human (h)', () => {
  // Re-implement the event dispatch logic from api.ts to test it in isolation
  function dispatchSSEEvent(
    event: { type: string; data: string },
    callbacks: {
      onText?: (text: string) => void
      onToolCall?: (data: any) => void
      onToolResult?: (data: any) => void
      onReasoning?: (text: string) => void
      onFinish?: (data: any) => void
      onError?: (error: string) => void
      onAwaitingHuman?: (data: { reason: string; machineId: string }) => void
    },
  ) {
    switch (event.type) {
      case '0': {
        const text = JSON.parse(event.data)
        callbacks.onText?.(text)
        break
      }
      case '3': {
        const errorData = JSON.parse(event.data)
        callbacks.onError?.(typeof errorData === 'string' ? errorData : errorData.error || 'Unknown error')
        break
      }
      case '9': {
        const toolData = JSON.parse(event.data)
        callbacks.onToolCall?.({
          toolCallId: toolData.toolCallId,
          toolName: toolData.toolName,
          args: toolData.args || {},
        })
        break
      }
      case 'a': {
        const resultData = JSON.parse(event.data)
        const result = resultData.result || resultData
        const screenshot = result?.frontendScreenshot || resultData?.frontendScreenshot
        callbacks.onToolResult?.({
          toolCallId: resultData.toolCallId,
          result: result?._result || result,
          frontendScreenshot: screenshot,
        })
        break
      }
      case 'g': {
        const reasoning = JSON.parse(event.data)
        callbacks.onReasoning?.(typeof reasoning === 'string' ? reasoning : reasoning.text || '')
        break
      }
      case 'd': {
        const finishData = JSON.parse(event.data)
        callbacks.onFinish?.({
          finishReason: finishData.finishReason || 'stop',
          content: finishData.content || '',
          toolInvocations: finishData.toolInvocations,
        })
        break
      }
      case 'h': {
        const awaitData = JSON.parse(event.data)
        callbacks.onAwaitingHuman?.({
          reason: awaitData.reason || 'Human intervention needed',
          machineId: awaitData.machineId || '',
        })
        break
      }
      case 'error': {
        callbacks.onError?.(event.data)
        break
      }
    }
  }

  it('dispatches onAwaitingHuman with reason and machineId', () => {
    const cb = vi.fn()
    dispatchSSEEvent(
      { type: 'h', data: JSON.stringify({ reason: 'Please log in manually', machineId: 'machine_123' }) },
      { onAwaitingHuman: cb },
    )
    expect(cb).toHaveBeenCalledOnce()
    expect(cb).toHaveBeenCalledWith({
      reason: 'Please log in manually',
      machineId: 'machine_123',
    })
  })

  it('provides default reason when missing', () => {
    const cb = vi.fn()
    dispatchSSEEvent(
      { type: 'h', data: JSON.stringify({ machineId: 'm_1' }) },
      { onAwaitingHuman: cb },
    )
    expect(cb).toHaveBeenCalledWith({
      reason: 'Human intervention needed',
      machineId: 'm_1',
    })
  })

  it('provides empty machineId when missing', () => {
    const cb = vi.fn()
    dispatchSSEEvent(
      { type: 'h', data: JSON.stringify({ reason: 'Do something' }) },
      { onAwaitingHuman: cb },
    )
    expect(cb).toHaveBeenCalledWith({
      reason: 'Do something',
      machineId: '',
    })
  })

  it('does not crash when onAwaitingHuman callback is not provided', () => {
    expect(() =>
      dispatchSSEEvent(
        { type: 'h', data: JSON.stringify({ reason: 'test', machineId: 'x' }) },
        {},
      )
    ).not.toThrow()
  })

  it('does not affect other event types', () => {
    const textCb = vi.fn()
    const humanCb = vi.fn()
    dispatchSSEEvent(
      { type: '0', data: JSON.stringify('hello world') },
      { onText: textCb, onAwaitingHuman: humanCb },
    )
    expect(textCb).toHaveBeenCalledWith('hello world')
    expect(humanCb).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// 2. CUA Section Parser — awaiting-human types
// ═══════════════════════════════════════════════════════════════════════

// Inline the parser logic (same as CuaSectionRenderer.tsx) to test in node
const TAG_REGEX = /<cua-section\s+([^>]*)>([\s\S]*?)<\/cua-section>/g
const ATTR_REGEX = /(\w[\w-]*)="([^"]*)"/g

type SectionType =
  | 'verification' | 'analysis' | 'next-action' | 'grounded-action' | 'reflection'
  | 'code-agent-summary' | 'code-agent-thought' | 'code-agent-result' | 'code-agent-done'
  | 'action-result' | 'status' | 'search-results'
  | 'awaiting-human' | 'awaiting-human-timeout' | 'awaiting-human-resumed'

interface ParsedSection {
  type: SectionType
  content: string
  attrs: Record<string, string>
}

function parseAttributes(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  let m: RegExpExecArray | null
  while ((m = ATTR_REGEX.exec(attrString)) !== null) {
    attrs[m[1]] = m[2]
  }
  return attrs
}

function parseSections(raw: string): ParsedSection[] {
  const sections: ParsedSection[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  TAG_REGEX.lastIndex = 0

  while ((match = TAG_REGEX.exec(raw)) !== null) {
    const before = raw.slice(lastIndex, match.index).trim()
    if (before) {
      sections.push({ type: 'next-action' as SectionType, content: before, attrs: { _plain: 'true' } })
    }
    const attrs = parseAttributes(match[1])
    sections.push({
      type: (attrs.type ?? 'next-action') as SectionType,
      content: match[2].trim(),
      attrs,
    })
    lastIndex = match.index + match[0].length
  }

  const trailing = raw.slice(lastIndex).trim()
  if (trailing) {
    sections.push({ type: 'next-action' as SectionType, content: trailing, attrs: { _plain: 'true' } })
  }
  return sections
}

interface StepGroup {
  kind: 'step'
  action: string
  observation: string | null
  code: string | null
  results: { content: string; status: string }[]
}

type TopLevelItem =
  | StepGroup
  | { kind: 'status'; content: string; status: string }
  | { kind: 'code-agent-thought'; content: string; step: string; budget: string }
  | { kind: 'code-agent-result'; content: string; step: string }
  | { kind: 'code-agent-done'; content: string; step: string }
  | { kind: 'code-agent-summary'; content: string }
  | { kind: 'search-results'; query: string; content: string }
  | { kind: 'awaiting-human'; reason: string; machineId: string }
  | { kind: 'awaiting-human-timeout'; content: string }
  | { kind: 'awaiting-human-resumed'; content: string }
  | { kind: 'text'; content: string }

const OBSERVATION_TYPES = new Set<SectionType>(['verification', 'analysis', 'reflection'])

function buildTopLevel(sections: ParsedSection[]): TopLevelItem[] {
  const items: TopLevelItem[] = []
  let i = 0
  let pendingStep: StepGroup | null = null

  function flushStep() {
    if (pendingStep) {
      items.push(pendingStep)
      pendingStep = null
    }
  }

  while (i < sections.length) {
    const s = sections[i]

    if (OBSERVATION_TYPES.has(s.type)) {
      const parts: string[] = []
      while (i < sections.length && OBSERVATION_TYPES.has(sections[i].type)) {
        parts.push(sections[i].content)
        i++
      }
      const merged = parts.join('\n\n')
      if (pendingStep && pendingStep.action) flushStep()
      if (!pendingStep) {
        pendingStep = { kind: 'step', action: '', observation: merged, code: null, results: [] }
      } else {
        pendingStep.observation = pendingStep.observation
          ? pendingStep.observation + '\n\n' + merged
          : merged
      }
      continue
    }

    if (s.type === 'next-action') {
      if (pendingStep && pendingStep.action) flushStep()
      if (!pendingStep) {
        pendingStep = { kind: 'step', action: '', observation: null, code: null, results: [] }
      }
      if (s.attrs._plain === 'true') {
        flushStep()
        items.push({ kind: 'text', content: s.content })
      } else {
        pendingStep.action = s.content
      }
    } else if (s.type === 'grounded-action') {
      if (pendingStep) pendingStep.code = s.content
    } else if (s.type === 'action-result') {
      if (pendingStep) pendingStep.results.push({ content: s.content, status: s.attrs.status || 'success' })
    } else if (s.type === 'status') {
      flushStep()
      items.push({ kind: 'status', content: s.content, status: s.attrs.status || 'completed' })
    } else if (s.type === 'code-agent-thought') {
      flushStep()
      items.push({ kind: 'code-agent-thought', content: s.content, step: s.attrs.step || '', budget: s.attrs.budget || '' })
    } else if (s.type === 'code-agent-result') {
      flushStep()
      items.push({ kind: 'code-agent-result', content: s.content, step: s.attrs.step || '' })
    } else if (s.type === 'code-agent-done') {
      flushStep()
      items.push({ kind: 'code-agent-done', content: s.content, step: s.attrs.step || '' })
    } else if (s.type === 'code-agent-summary') {
      flushStep()
      items.push({ kind: 'code-agent-summary', content: s.content })
    } else if (s.type === 'search-results') {
      flushStep()
      items.push({ kind: 'search-results', query: s.attrs.query || '', content: s.content })
    } else if (s.type === 'awaiting-human') {
      flushStep()
      items.push({ kind: 'awaiting-human', reason: s.attrs.reason || s.content, machineId: s.attrs.machineId || s.attrs.machineid || '' })
    } else if (s.type === 'awaiting-human-timeout') {
      flushStep()
      items.push({ kind: 'awaiting-human-timeout', content: s.content })
    } else if (s.type === 'awaiting-human-resumed') {
      flushStep()
      items.push({ kind: 'awaiting-human-resumed', content: s.content })
    }

    i++
  }

  flushStep()
  return items
}

describe('CUA Section Parser — awaiting-human', () => {
  describe('parseSections', () => {
    it('parses awaiting-human section tag', () => {
      const raw = '<cua-section type="awaiting-human" reason="Please sign in" machineId="m_1">Agent paused</cua-section>'
      const sections = parseSections(raw)
      expect(sections).toHaveLength(1)
      expect(sections[0].type).toBe('awaiting-human')
      expect(sections[0].attrs.reason).toBe('Please sign in')
      expect(sections[0].attrs.machineId).toBe('m_1')
      expect(sections[0].content).toBe('Agent paused')
    })

    it('parses awaiting-human-timeout section tag', () => {
      const raw = '<cua-section type="awaiting-human-timeout">Timed out waiting for human</cua-section>'
      const sections = parseSections(raw)
      expect(sections).toHaveLength(1)
      expect(sections[0].type).toBe('awaiting-human-timeout')
      expect(sections[0].content).toBe('Timed out waiting for human')
    })

    it('parses awaiting-human-resumed section tag', () => {
      const raw = '<cua-section type="awaiting-human-resumed">Human is done, resuming</cua-section>'
      const sections = parseSections(raw)
      expect(sections).toHaveLength(1)
      expect(sections[0].type).toBe('awaiting-human-resumed')
      expect(sections[0].content).toBe('Human is done, resuming')
    })

    it('parses machineId with lowercase "machineid" attribute', () => {
      const raw = '<cua-section type="awaiting-human" reason="Do X" machineid="m_lower">paused</cua-section>'
      const sections = parseSections(raw)
      expect(sections[0].attrs.machineid).toBe('m_lower')
    })
  })

  describe('buildTopLevel', () => {
    it('creates awaiting-human top-level item with reason from attrs', () => {
      const raw = '<cua-section type="awaiting-human" reason="Fill in the captcha" machineId="m_42"></cua-section>'
      const sections = parseSections(raw)
      const items = buildTopLevel(sections)
      expect(items).toHaveLength(1)
      expect(items[0]).toEqual({
        kind: 'awaiting-human',
        reason: 'Fill in the captcha',
        machineId: 'm_42',
      })
    })

    it('falls back to content when reason attr is missing', () => {
      const raw = '<cua-section type="awaiting-human" machineId="m_1">Please handle this step</cua-section>'
      const sections = parseSections(raw)
      const items = buildTopLevel(sections)
      expect(items).toHaveLength(1)
      expect(items[0]).toEqual({
        kind: 'awaiting-human',
        reason: 'Please handle this step',
        machineId: 'm_1',
      })
    })

    it('handles lowercase machineid attr', () => {
      const raw = '<cua-section type="awaiting-human" reason="test" machineid="lower_id"></cua-section>'
      const sections = parseSections(raw)
      const items = buildTopLevel(sections)
      expect(items[0]).toMatchObject({ kind: 'awaiting-human', machineId: 'lower_id' })
    })

    it('creates awaiting-human-timeout item', () => {
      const raw = '<cua-section type="awaiting-human-timeout">No response after 5 minutes</cua-section>'
      const sections = parseSections(raw)
      const items = buildTopLevel(sections)
      expect(items).toHaveLength(1)
      expect(items[0]).toEqual({
        kind: 'awaiting-human-timeout',
        content: 'No response after 5 minutes',
      })
    })

    it('creates awaiting-human-resumed item', () => {
      const raw = '<cua-section type="awaiting-human-resumed">User completed the task</cua-section>'
      const sections = parseSections(raw)
      const items = buildTopLevel(sections)
      expect(items).toHaveLength(1)
      expect(items[0]).toEqual({
        kind: 'awaiting-human-resumed',
        content: 'User completed the task',
      })
    })

    it('flushes pending step before awaiting-human', () => {
      const raw = [
        '<cua-section type="next-action">Clicking the login button</cua-section>',
        '<cua-section type="awaiting-human" reason="Enter credentials" machineId="m_1"></cua-section>',
      ].join('')
      const sections = parseSections(raw)
      const items = buildTopLevel(sections)
      expect(items).toHaveLength(2)
      expect(items[0]).toMatchObject({ kind: 'step', action: 'Clicking the login button' })
      expect(items[1]).toMatchObject({ kind: 'awaiting-human', reason: 'Enter credentials' })
    })

    it('flushes pending step before awaiting-human-timeout', () => {
      const raw = [
        '<cua-section type="next-action">Waiting for user</cua-section>',
        '<cua-section type="awaiting-human-timeout">Timed out</cua-section>',
      ].join('')
      const sections = parseSections(raw)
      const items = buildTopLevel(sections)
      expect(items).toHaveLength(2)
      expect(items[0]).toMatchObject({ kind: 'step' })
      expect(items[1]).toMatchObject({ kind: 'awaiting-human-timeout', content: 'Timed out' })
    })

    it('flushes pending step before awaiting-human-resumed', () => {
      const raw = [
        '<cua-section type="next-action">Pausing</cua-section>',
        '<cua-section type="awaiting-human-resumed">Back online</cua-section>',
      ].join('')
      const sections = parseSections(raw)
      const items = buildTopLevel(sections)
      expect(items).toHaveLength(2)
      expect(items[0]).toMatchObject({ kind: 'step' })
      expect(items[1]).toMatchObject({ kind: 'awaiting-human-resumed', content: 'Back online' })
    })

    it('handles full lifecycle: step → awaiting-human → resumed → step', () => {
      const raw = [
        '<cua-section type="next-action">Navigate to settings</cua-section>',
        '<cua-section type="awaiting-human" reason="Enter 2FA code" machineId="m_99"></cua-section>',
        '<cua-section type="awaiting-human-resumed">User entered 2FA</cua-section>',
        '<cua-section type="next-action">Clicking save</cua-section>',
        '<cua-section type="status" status="completed">Task done</cua-section>',
      ].join('')
      const sections = parseSections(raw)
      const items = buildTopLevel(sections)
      expect(items).toHaveLength(5)
      expect(items[0]).toMatchObject({ kind: 'step', action: 'Navigate to settings' })
      expect(items[1]).toMatchObject({ kind: 'awaiting-human', reason: 'Enter 2FA code', machineId: 'm_99' })
      expect(items[2]).toMatchObject({ kind: 'awaiting-human-resumed', content: 'User entered 2FA' })
      expect(items[3]).toMatchObject({ kind: 'step', action: 'Clicking save' })
      expect(items[4]).toMatchObject({ kind: 'status', content: 'Task done' })
    })

    it('handles awaiting-human with empty reason and machineId', () => {
      const raw = '<cua-section type="awaiting-human"></cua-section>'
      const sections = parseSections(raw)
      const items = buildTopLevel(sections)
      expect(items).toHaveLength(1)
      expect(items[0]).toEqual({
        kind: 'awaiting-human',
        reason: '',
        machineId: '',
      })
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════
// 3. Chat Store — awaiting human state management
// ═══════════════════════════════════════════════════════════════════════

describe('Chat Store — awaitingHuman state', () => {
  // Minimal re-implementation of the awaiting-human state logic to test in node
  interface AwaitingHumanState {
    reason: string
    machineId: string
    since: number
  }

  interface MinimalChatState {
    isStreaming: boolean
    awaitingHuman: AwaitingHumanState | null
  }

  function createStore(): MinimalChatState & {
    setAwaitingHuman: (state: AwaitingHumanState | null) => void
    setStreaming: (s: boolean) => void
    finishAssistantMessage: () => void
  } {
    const store: MinimalChatState = { isStreaming: false, awaitingHuman: null }
    return {
      ...store,
      get isStreaming() { return store.isStreaming },
      get awaitingHuman() { return store.awaitingHuman },
      setAwaitingHuman: (state) => { store.awaitingHuman = state },
      setStreaming: (s) => { store.isStreaming = s },
      finishAssistantMessage: () => {
        store.isStreaming = false
        store.awaitingHuman = null
      },
    }
  }

  it('starts with awaitingHuman as null', () => {
    const store = createStore()
    expect(store.awaitingHuman).toBeNull()
  })

  it('setAwaitingHuman sets the state', () => {
    const store = createStore()
    const state: AwaitingHumanState = { reason: 'Login needed', machineId: 'm_1', since: 1000 }
    store.setAwaitingHuman(state)
    expect(store.awaitingHuman).toEqual(state)
  })

  it('setAwaitingHuman(null) clears the state', () => {
    const store = createStore()
    store.setAwaitingHuman({ reason: 'x', machineId: 'y', since: 100 })
    store.setAwaitingHuman(null)
    expect(store.awaitingHuman).toBeNull()
  })

  it('finishAssistantMessage clears awaitingHuman', () => {
    const store = createStore()
    store.setStreaming(true)
    store.setAwaitingHuman({ reason: 'Waiting', machineId: 'm', since: 500 })
    store.finishAssistantMessage()
    expect(store.awaitingHuman).toBeNull()
    expect(store.isStreaming).toBe(false)
  })

  it('full flow: streaming → awaiting → resume → finish', () => {
    const store = createStore()

    // Start streaming
    store.setStreaming(true)
    expect(store.isStreaming).toBe(true)
    expect(store.awaitingHuman).toBeNull()

    // Agent pauses for human
    const since = Date.now()
    store.setAwaitingHuman({ reason: 'Enter captcha', machineId: 'm_42', since })
    expect(store.awaitingHuman).toEqual({ reason: 'Enter captcha', machineId: 'm_42', since })
    expect(store.isStreaming).toBe(true) // Still streaming while waiting

    // User clicks "Done, Continue" → clear awaitingHuman but stream continues
    store.setAwaitingHuman(null)
    expect(store.awaitingHuman).toBeNull()
    expect(store.isStreaming).toBe(true)

    // Agent finishes
    store.finishAssistantMessage()
    expect(store.isStreaming).toBe(false)
    expect(store.awaitingHuman).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// 4. SSE Parser (sse-parser.ts) — 'h' event code
// ═══════════════════════════════════════════════════════════════════════

describe('SSE Parser — h event code', () => {
  // Simulate the parser's event splitting & dispatch
  function parseEvents(raw: string): Array<{ code: string; data: string }> {
    const events: Array<{ code: string; data: string }> = []
    const parts = raw.split('\n\n')
    for (const part of parts) {
      const trimmed = part.trim()
      if (!trimmed) continue
      const colonIndex = trimmed.indexOf(':')
      if (colonIndex === -1) continue
      events.push({
        code: trimmed.slice(0, colonIndex),
        data: trimmed.slice(colonIndex + 1),
      })
    }
    return events
  }

  it('extracts h event from SSE stream', () => {
    const stream = '0:"hello"\n\nh:{"reason":"Login required","machineId":"m_5"}\n\n'
    const events = parseEvents(stream)
    expect(events).toHaveLength(2)
    expect(events[1].code).toBe('h')
    const data = JSON.parse(events[1].data)
    expect(data.reason).toBe('Login required')
    expect(data.machineId).toBe('m_5')
  })

  it('extracts h event between text and finish events', () => {
    const stream = [
      '0:"Navigating to login page"',
      '',
      'h:{"reason":"Enter your password","machineId":"m_10"}',
      '',
      '0:"Continuing after login"',
      '',
      'd:{"finishReason":"stop","content":"Done"}',
      '',
    ].join('\n')
    const events = parseEvents(stream)
    expect(events).toHaveLength(4)
    expect(events[0].code).toBe('0')
    expect(events[1].code).toBe('h')
    expect(events[2].code).toBe('0')
    expect(events[3].code).toBe('d')
  })

  it('handles multiple h events in one stream', () => {
    const stream = [
      'h:{"reason":"Step 1","machineId":"m_a"}',
      '',
      'h:{"reason":"Step 2","machineId":"m_b"}',
      '',
    ].join('\n')
    const events = parseEvents(stream)
    expect(events).toHaveLength(2)
    expect(JSON.parse(events[0].data).reason).toBe('Step 1')
    expect(JSON.parse(events[1].data).reason).toBe('Step 2')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// 5. Integration: useChatSubmit callback wiring
// ═══════════════════════════════════════════════════════════════════════

describe('useChatSubmit — onAwaitingHuman wiring', () => {
  it('setAwaitingHuman is called with correct shape from SSE callback', () => {
    const setAwaitingHuman = vi.fn()

    // Simulate what useChatSubmit.ts does in the onAwaitingHuman callback
    const onAwaitingHuman = (data: { reason: string; machineId: string }) => {
      setAwaitingHuman({
        reason: data.reason,
        machineId: data.machineId,
        since: Date.now(),
      })
    }

    onAwaitingHuman({ reason: 'Complete the form', machineId: 'electron_m_1' })
    expect(setAwaitingHuman).toHaveBeenCalledOnce()
    const arg = setAwaitingHuman.mock.calls[0][0]
    expect(arg.reason).toBe('Complete the form')
    expect(arg.machineId).toBe('electron_m_1')
    expect(typeof arg.since).toBe('number')
    expect(arg.since).toBeGreaterThan(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// 6. Edge cases
// ═══════════════════════════════════════════════════════════════════════

describe('Edge cases', () => {
  it('mixed CUA sections with awaiting-human interleaved', () => {
    const raw = [
      '<cua-section type="verification">Page loaded</cua-section>',
      '<cua-section type="next-action">Click login</cua-section>',
      '<cua-section type="grounded-action">agent.click(100, 200)</cua-section>',
      '<cua-section type="action-result" status="success">Clicked</cua-section>',
      '<cua-section type="awaiting-human" reason="Enter credentials" machineId="m_1"></cua-section>',
      '<cua-section type="awaiting-human-resumed">User logged in</cua-section>',
      '<cua-section type="next-action">Navigate to dashboard</cua-section>',
      '<cua-section type="action-result" status="success">Navigated</cua-section>',
      '<cua-section type="status" status="completed">All done</cua-section>',
    ].join('\n')
    const sections = parseSections(raw)
    const items = buildTopLevel(sections)

    // Expected: step(observation+action+code+result), awaiting-human, awaiting-human-resumed, step(action+result), status
    expect(items.length).toBeGreaterThanOrEqual(4)

    const kinds = items.map((i) => i.kind)
    expect(kinds).toContain('step')
    expect(kinds).toContain('awaiting-human')
    expect(kinds).toContain('awaiting-human-resumed')
    expect(kinds).toContain('status')

    const awaitItem = items.find((i) => i.kind === 'awaiting-human')
    expect(awaitItem).toMatchObject({ reason: 'Enter credentials', machineId: 'm_1' })
  })

  it('awaiting-human at the very start of content', () => {
    const raw = '<cua-section type="awaiting-human" reason="Manual setup required" machineId="m_0"></cua-section>'
    const items = buildTopLevel(parseSections(raw))
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'awaiting-human', reason: 'Manual setup required' })
  })

  it('awaiting-human at the very end of content after status', () => {
    const raw = [
      '<cua-section type="status" status="completed">Done</cua-section>',
      '<cua-section type="awaiting-human" reason="Final review needed" machineId="m_2"></cua-section>',
    ].join('')
    const items = buildTopLevel(parseSections(raw))
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ kind: 'status' })
    expect(items[1]).toMatchObject({ kind: 'awaiting-human' })
  })

  it('consecutive awaiting-human events produce separate items', () => {
    const raw = [
      '<cua-section type="awaiting-human" reason="Step A" machineId="m_1"></cua-section>',
      '<cua-section type="awaiting-human" reason="Step B" machineId="m_2"></cua-section>',
    ].join('')
    const items = buildTopLevel(parseSections(raw))
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ kind: 'awaiting-human', reason: 'Step A', machineId: 'm_1' })
    expect(items[1]).toMatchObject({ kind: 'awaiting-human', reason: 'Step B', machineId: 'm_2' })
  })
})
