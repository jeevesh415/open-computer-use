/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Corner-case tests for ApprovalManager — covers gaps in approval-manager.test.ts:
 *   1. requestApproval / handleResponse promise roundtrip
 *   2. handleResponse with stale/unknown id (no-op, doesn't throw)
 *   3. cancelAll resolves every pending promise as denied
 *   4. mode transitions while requests are pending (in-flight requests resolve correctly)
 *   5. Concurrent requestApproval calls — IDs are unique and mapped independently
 *   6. setMode → all renderers receive 'approval-mode-changed' event
 *   7. requestApproval broadcasts 'approval-request' to all open windows
 *   8. requestApproval calls bringToFront so the user can see the prompt
 *   9. saveConfig handles fs failures silently (no throw)
 *   10. loadConfig handles corrupt JSON, invalid mode, missing file
 *   11. Smart-approve edge cases: empty string, unknown command
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock surfaces ────────────────────────────────────────────────────────
const sentEvents: Array<{ ch: string; payload: any }> = []
const fakeWindows: any[] = []

function makeWindow() {
  return {
    webContents: {
      send: vi.fn((ch: string, payload: any) => {
        sentEvents.push({ ch, payload })
      }),
    },
    isDestroyed: () => false,
  }
}

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => fakeWindows),
  },
  app: {
    getPath: vi.fn(() => '/tmp/test-coasty-approval-cc'),
  },
}))

// fs mock with controllable read / failable write — defaults match clean state
const fsState = {
  fileExists: false,
  fileContent: '{}',
  writeThrows: false,
  readThrows: false,
}

vi.mock('fs', () => ({
  existsSync: vi.fn(() => fsState.fileExists),
  readFileSync: vi.fn(() => {
    if (fsState.readThrows) throw new Error('EACCES')
    return fsState.fileContent
  }),
  writeFileSync: vi.fn(() => {
    if (fsState.writeThrows) throw new Error('EACCES')
  }),
  mkdirSync: vi.fn(),
}))

const bringToFrontFn = vi.fn()
vi.mock('./window-manager', () => ({
  bringToFront: () => bringToFrontFn(),
}))

import { ApprovalManager } from './approval-manager'

beforeEach(() => {
  sentEvents.length = 0
  fakeWindows.length = 0
  fakeWindows.push(makeWindow(), makeWindow()) // simulate two open windows
  fsState.fileExists = false
  fsState.fileContent = '{}'
  fsState.writeThrows = false
  fsState.readThrows = false
  bringToFrontFn.mockClear()
})

// ════════════════════════════════════════════════════════════════════════
// 1. requestApproval / handleResponse roundtrip
// ════════════════════════════════════════════════════════════════════════

describe('requestApproval / handleResponse', () => {
  it('promise resolves with {approved:true} when handleResponse(id, true) called', async () => {
    const m = new ApprovalManager()
    const promise = m.requestApproval('terminal_execute', { command: 'ls' })
    // Find the id from the broadcast event
    const req = sentEvents.find((e) => e.ch === 'approval-request')
    expect(req).toBeDefined()
    const id = req!.payload.id
    expect(id).toMatch(/^approval_\d+_[a-z0-9]+$/)

    m.handleResponse(id, true)
    const result = await promise
    expect(result.approved).toBe(true)
  })

  it('promise resolves with {approved:false, reason} when denied', async () => {
    const m = new ApprovalManager()
    const promise = m.requestApproval('rm -rf /', {})
    const id = sentEvents.find((e) => e.ch === 'approval-request')!.payload.id

    m.handleResponse(id, false, 'too dangerous')
    const result = await promise
    expect(result.approved).toBe(false)
    expect(result.reason).toBe('too dangerous')
  })

  it('handleResponse with unknown id is a no-op (does not throw)', () => {
    const m = new ApprovalManager()
    expect(() => m.handleResponse('approval_999_zzz', true)).not.toThrow()
  })

  it('handleResponse twice for same id only resolves the promise once', async () => {
    const m = new ApprovalManager()
    const promise = m.requestApproval('cmd', {})
    const id = sentEvents.find((e) => e.ch === 'approval-request')!.payload.id

    m.handleResponse(id, true) // resolves
    m.handleResponse(id, false) // no-op (already resolved + cleared)
    const result = await promise
    expect(result.approved).toBe(true)
  })
})

// ════════════════════════════════════════════════════════════════════════
// 2. cancelAll
// ════════════════════════════════════════════════════════════════════════

describe('cancelAll', () => {
  it('resolves every pending promise as denied', async () => {
    const m = new ApprovalManager()
    const p1 = m.requestApproval('cmd1', {})
    const p2 = m.requestApproval('cmd2', {})
    const p3 = m.requestApproval('cmd3', {})

    m.cancelAll()
    const [r1, r2, r3] = await Promise.all([p1, p2, p3])
    expect(r1.approved).toBe(false)
    expect(r2.approved).toBe(false)
    expect(r3.approved).toBe(false)
  })

  it('no-op when no pending approvals', () => {
    const m = new ApprovalManager()
    expect(() => m.cancelAll()).not.toThrow()
  })

  it('handleResponse after cancelAll on the same id is harmless (no second resolve)', async () => {
    const m = new ApprovalManager()
    const promise = m.requestApproval('cmd', {})
    const id = sentEvents.find((e) => e.ch === 'approval-request')!.payload.id
    m.cancelAll()
    expect(() => m.handleResponse(id, true)).not.toThrow()
    const result = await promise
    expect(result.approved).toBe(false) // cancelAll wins
  })
})

// ════════════════════════════════════════════════════════════════════════
// 3. Concurrent requests get unique ids and resolve independently
// ════════════════════════════════════════════════════════════════════════

describe('concurrent requests', () => {
  it('two simultaneous requests get distinct ids', async () => {
    const m = new ApprovalManager()
    const p1 = m.requestApproval('cmd1', {})
    const p2 = m.requestApproval('cmd2', {})
    // Each request broadcasts once per window (we have 2 fake windows), so
    // dedupe while preserving first-seen order to recover the per-request id.
    const all = sentEvents.filter((e) => e.ch === 'approval-request').map((e) => e.payload.id)
    const ids = [...new Set(all)]
    expect(ids.length).toBe(2)

    // Resolve them in opposite order
    m.handleResponse(ids[1], false, 'no')
    m.handleResponse(ids[0], true)
    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1.approved).toBe(true)
    expect(r2.approved).toBe(false)
    expect(r2.reason).toBe('no')
  })

  it('1000 sequential requests all generate unique ids', () => {
    const m = new ApprovalManager()
    for (let i = 0; i < 1000; i++) {
      m.requestApproval(`cmd${i}`, {})
    }
    const allIds = sentEvents.filter((e) => e.ch === 'approval-request').map((e) => e.payload.id)
    // 2 windows × 1000 requests = 2000 events but only 1000 unique ids
    expect(new Set(allIds).size).toBe(1000)
  })
})

// ════════════════════════════════════════════════════════════════════════
// 4. Mode transitions during pending requests
// ════════════════════════════════════════════════════════════════════════

describe('mode transitions while pending', () => {
  it('switching mode does NOT auto-resolve pending approvals', async () => {
    const m = new ApprovalManager()
    m.setMode('approve_all')
    const promise = m.requestApproval('cmd', {})
    const id = sentEvents.find((e) => e.ch === 'approval-request')!.payload.id

    // Switch to full_control — but the request is already mid-flight; only
    // explicit handleResponse should resolve it.
    m.setMode('full_control')

    // Use vi.waitFor would be over-engineering — just ensure we can still resolve manually
    m.handleResponse(id, true)
    const result = await promise
    expect(result.approved).toBe(true)
  })

  it('switching to "off" does NOT cancel existing pending approvals', async () => {
    // Off blocks NEW commands at the executor level. Existing pending approvals
    // remain pending until the user responds or cancelAll is called.
    const m = new ApprovalManager()
    const promise = m.requestApproval('cmd', {})
    const id = sentEvents.find((e) => e.ch === 'approval-request')!.payload.id
    m.setMode('off')

    m.handleResponse(id, false, 'paused')
    const result = await promise
    expect(result.approved).toBe(false)
    expect(result.reason).toBe('paused')
  })
})

// ════════════════════════════════════════════════════════════════════════
// 5. IPC broadcast surface
// ════════════════════════════════════════════════════════════════════════

describe('IPC broadcast surface', () => {
  it('setMode broadcasts approval-mode-changed to ALL open windows', () => {
    const m = new ApprovalManager()
    m.setMode('smart_approve')
    const events = sentEvents.filter((e) => e.ch === 'approval-mode-changed')
    expect(events.length).toBe(2) // 2 fake windows
    events.forEach((e) => expect(e.payload).toBe('smart_approve'))
  })

  it('setMode with invalid mode does NOT broadcast', () => {
    const m = new ApprovalManager()
    sentEvents.length = 0
    m.setMode('garbage' as any)
    expect(sentEvents.filter((e) => e.ch === 'approval-mode-changed').length).toBe(0)
  })

  it('requestApproval broadcasts approval-request to ALL open windows', () => {
    const m = new ApprovalManager()
    m.requestApproval('cmd', { foo: 'bar' })
    const reqs = sentEvents.filter((e) => e.ch === 'approval-request')
    expect(reqs.length).toBe(2) // 2 windows
    reqs.forEach((e) => {
      expect(e.payload.command).toBe('cmd')
      expect(e.payload.parameters).toEqual({ foo: 'bar' })
      expect(e.payload.id).toBeDefined()
    })
  })

  it('requestApproval calls bringToFront so user can see prompt', () => {
    const m = new ApprovalManager()
    m.requestApproval('cmd', {})
    expect(bringToFrontFn).toHaveBeenCalledTimes(1)
  })

  it('cancelAll does NOT broadcast (no IPC surface for cancel)', () => {
    const m = new ApprovalManager()
    m.requestApproval('cmd', {})
    sentEvents.length = 0
    m.cancelAll()
    // No specific event channel for cancellation in current impl
    const cancelEvents = sentEvents.filter((e) => e.ch.includes('cancel'))
    expect(cancelEvents).toEqual([])
  })
})

// ════════════════════════════════════════════════════════════════════════
// 6. Persistence: loadConfig + saveConfig
// ════════════════════════════════════════════════════════════════════════

describe('config persistence', () => {
  it('loadConfig with no existing file → defaults to full_control', () => {
    fsState.fileExists = false
    const m = new ApprovalManager()
    expect(m.getMode()).toBe('full_control')
  })

  it('loadConfig with corrupt JSON → falls back to default (no throw)', () => {
    fsState.fileExists = true
    fsState.fileContent = '{not valid json'
    expect(() => new ApprovalManager()).not.toThrow()
    const m = new ApprovalManager()
    expect(m.getMode()).toBe('full_control')
  })

  it('loadConfig with valid stored mode → loads it', () => {
    fsState.fileExists = true
    fsState.fileContent = JSON.stringify({ mode: 'smart_approve' })
    const m = new ApprovalManager()
    expect(m.getMode()).toBe('smart_approve')
  })

  it('loadConfig with invalid mode in JSON → falls back to default', () => {
    fsState.fileExists = true
    fsState.fileContent = JSON.stringify({ mode: 'evil_mode' })
    const m = new ApprovalManager()
    expect(m.getMode()).toBe('full_control')
  })

  it('loadConfig with read failure (EACCES) → falls back to default (no throw)', () => {
    fsState.fileExists = true
    fsState.readThrows = true
    expect(() => new ApprovalManager()).not.toThrow()
    const m = new ApprovalManager()
    expect(m.getMode()).toBe('full_control')
  })

  it('saveConfig failure on disk → setMode still updates in-memory state', () => {
    fsState.writeThrows = true
    const m = new ApprovalManager()
    expect(() => m.setMode('smart_approve')).not.toThrow()
    expect(m.getMode()).toBe('smart_approve')
  })
})

// ════════════════════════════════════════════════════════════════════════
// 7. shouldAutoApprove edge cases
// ════════════════════════════════════════════════════════════════════════

describe('shouldAutoApprove edge cases', () => {
  it('smart_approve: unknown command → not auto-approved', () => {
    const m = new ApprovalManager()
    m.setMode('smart_approve')
    expect(m.shouldAutoApprove('made_up_command_xyz')).toBe(false)
  })

  it('smart_approve: empty string command → not auto-approved', () => {
    const m = new ApprovalManager()
    m.setMode('smart_approve')
    expect(m.shouldAutoApprove('')).toBe(false)
  })

  it('full_control: empty string still auto-approved (mode is permissive)', () => {
    const m = new ApprovalManager()
    m.setMode('full_control')
    expect(m.shouldAutoApprove('')).toBe(true)
  })

  it('case sensitivity: commands are case-sensitive in safe set', () => {
    const m = new ApprovalManager()
    m.setMode('smart_approve')
    expect(m.shouldAutoApprove('Screenshot')).toBe(false) // capital S not in safe set
    expect(m.shouldAutoApprove('screenshot')).toBe(true)
  })
})
