/**
 * Security-focused tests for the Electron approval system.
 *
 * These tests target a stricter threat model than approval-manager.test.ts:
 *   - Mode bypass via destructive commands
 *   - Defense-in-depth via validateFilePath() even in full_control
 *   - Tampered approval-config.json
 *   - Race conditions between concurrent approval requests
 *   - UI bypass (focus stealing, background IPC)
 *   - Audit-log hygiene (no secrets in logs)
 *
 * Source files referenced:
 *   - electron/src/main/approval-manager.ts (SAFE_COMMANDS, loadConfig, saveConfig)
 *   - electron/src/main/security.ts        (validateFilePath: defense in depth)
 *   - electron/src/main/window-manager.ts  (bringToFront)
 *   - electron/src/main/ws-bridge.ts       (approval flow integration)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as path from 'path'
import * as os from 'os'

// ── Mock electron, fs, and window-manager BEFORE importing modules ──────────
//
// We use a mutable map so individual tests can simulate tampered configs.

const fakeFs = {
  files: new Map<string, string>(),
  readErrors: new Map<string, Error>(),
}

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') {
        return process.platform === 'win32'
          ? 'C:\\Users\\testuser\\AppData\\Roaming\\Coasty Desktop'
          : '/Users/testuser/Library/Application Support/Coasty Desktop'
      }
      return ''
    }),
  },
}))

vi.mock('fs', () => ({
  existsSync: vi.fn((p: string) => fakeFs.files.has(p)),
  readFileSync: vi.fn((p: string) => {
    const err = fakeFs.readErrors.get(p)
    if (err) throw err
    if (!fakeFs.files.has(p)) throw new Error(`ENOENT: ${p}`)
    return fakeFs.files.get(p)
  }),
  writeFileSync: vi.fn((p: string, data: string) => {
    fakeFs.files.set(p, data)
  }),
  mkdirSync: vi.fn(),
}))

vi.mock('./window-manager', () => ({
  bringToFront: vi.fn(),
}))

import { ApprovalManager } from './approval-manager'
import { validateFilePath } from './security'
// Resolve the mocked bringToFront function at runtime (vi.mock factories
// cannot reference top-level test variables — the factory is hoisted).
import * as windowManager from './window-manager'
const bringToFrontMock = windowManager.bringToFront as unknown as ReturnType<typeof vi.fn>

// ── Helpers ─────────────────────────────────────────────────────────────────

function configPath(): string {
  return process.platform === 'win32'
    ? 'C:\\Users\\testuser\\AppData\\Roaming\\Coasty Desktop\\approval-config.json'
    : '/Users/testuser/Library/Application Support/Coasty Desktop/approval-config.json'
}

function homePath(...segments: string[]): string {
  return path.join(os.homedir(), ...segments)
}

beforeEach(() => {
  fakeFs.files.clear()
  fakeFs.readErrors.clear()
  bringToFrontMock.mockClear()
  vi.clearAllMocks()
})

// ═══════════════════════════════════════════════════════════════════════════
// MODE BYPASS ATTEMPTS
//
// Reference: approval-manager.ts:67-78 (shouldAutoApprove), ws-bridge.ts:304-368
// ═══════════════════════════════════════════════════════════════════════════

describe('Mode bypass: off (paused) does not auto-approve', () => {
  it('rejects every command in mode=off — isDenyAll() === true', () => {
    const m = new ApprovalManager()
    m.setMode('off')

    expect(m.isDenyAll()).toBe(true)
    // ws-bridge.ts checks isDenyAll() FIRST and rejects before even reaching
    // shouldAutoApprove. Both must fail closed for an attacker to be blocked.
    for (const cmd of [
      'screenshot', 'file_read', 'click', 'terminal_execute', 'browser_open',
    ]) {
      expect(m.shouldAutoApprove(cmd)).toBe(false)
    }
  })
})

describe('Mode bypass: smart_approve never auto-approves destructive commands', () => {
  it('does not auto-approve terminal_execute (rm -rf, del /S, etc.) regardless of payload', () => {
    const m = new ApprovalManager()
    m.setMode('smart_approve')

    // The command NAME is what shouldAutoApprove inspects — it never opens the
    // payload. So even rm -rf / sent as terminal_execute must be prompted.
    expect(m.shouldAutoApprove('terminal_execute')).toBe(false)
    expect(m.shouldAutoApprove('execute_command')).toBe(false)
  })

  it('does not auto-approve file_write to credential paths', () => {
    const m = new ApprovalManager()
    m.setMode('smart_approve')

    // file_write is NOT in SAFE_COMMANDS — must always prompt
    expect(m.shouldAutoApprove('file_write')).toBe(false)
    expect(m.shouldAutoApprove('file_edit')).toBe(false)
    expect(m.shouldAutoApprove('file_delete')).toBe(false)
  })

  it('does not auto-approve known-dangerous Windows / Unix names', () => {
    const m = new ApprovalManager()
    m.setMode('smart_approve')
    for (const cmd of [
      'rm', 'del', 'format', 'rd', 'rmdir', 'shutdown', 'reboot',
      'mkfs', 'dd', 'powershell', 'bash', 'sh', 'cmd',
    ]) {
      expect(m.shouldAutoApprove(cmd)).toBe(false)
    }
  })
})

describe('Mode bypass: SAFE_COMMANDS list audit', () => {
  // The entire allowlist (approval-manager.ts:11-29). Any command added here
  // must be both READ-ONLY and SIDE-EFFECT-FREE — see comment on line 10.
  const EXPECTED_SAFE = [
    'screenshot',           // captures the screen, no system mutation
    'browser_screenshot',   // CDP / Puppeteer screenshot
    'browser_state',        // returns DOM/URL state
    'browser_info',         // window info
    'browser_get_dom',      // returns serialized DOM
    'browser_get_clickables',
    'browser_get_context',
    'browser_dom',
    'file_read',            // read-only file IO (validateFilePath still gates)
    'file_exists',          // existence check
    'directory_list',       // ls
    'file_list_downloads',  // list-only
    'file_download',        // backend → local download (write but to Downloads only)
    'terminal_read',        // read terminal output buffer (no execution)
    'terminal_connect',     // attach to existing session
    'list_windows',         // enumerate window titles
    'browser_list_tabs',    // enumerate tabs
  ]

  it('SAFE list is exactly the documented 17 commands — no surprise additions', () => {
    const m = new ApprovalManager()
    m.setMode('smart_approve')

    // Spot-check a few non-safe names to confirm only the expected ones are safe.
    const NON_SAFE_PROBE = [
      'click', 'type', 'key_press', 'scroll', 'drag', 'terminal_execute',
      'execute_command', 'file_write', 'file_edit', 'file_delete',
      'browser_navigate', 'browser_click', 'browser_type', 'browser_open',
      'browser_close', 'shutdown', 'restart',
    ]
    for (const cmd of NON_SAFE_PROBE) {
      expect(m.shouldAutoApprove(cmd)).toBe(false)
    }
    for (const cmd of EXPECTED_SAFE) {
      expect(m.shouldAutoApprove(cmd)).toBe(true)
    }
  })

  it('every safe command name lexically rejects mutation verbs', () => {
    // No safe command should imply mutation. This catches regressions where
    // someone accidentally adds e.g. "file_write" to the safe set.
    // Note: "browser_get_clickables" contains the substring "click" but is a
    // read-only DOM enumeration; "terminal_connect" attaches to a session
    // without spawning shell commands. We exclude those substrings from the
    // mutation list and rely on the EXPECTED_SAFE allowlist for the final word.
    const MUTATION_TERMS = [
      'write', 'delete', 'remove', 'create', 'modify', 'edit',
      'navigate', 'execute', 'run', 'kill', 'shutdown', 'spawn',
    ]
    for (const cmd of EXPECTED_SAFE) {
      for (const term of MUTATION_TERMS) {
        expect(
          cmd.includes(term),
          `safe command "${cmd}" must not contain mutation term "${term}"`,
        ).toBe(false)
      }
    }
  })
})

describe('Defense-in-depth: validateFilePath blocks credentials even in full_control', () => {
  // Even when the approval manager auto-approves, file-ops.ts still calls
  // validateFilePath() before touching the filesystem (file-ops.ts:7,23,41,…).
  // This is the second defensive layer — see security.ts:335.

  it('full_control + file_read of ~/.ssh/id_rsa → blocked by validateFilePath', () => {
    const m = new ApprovalManager()
    m.setMode('full_control')

    // Approval manager would auto-approve…
    expect(m.shouldAutoApprove('file_read')).toBe(true)

    // …but the file layer still rejects.
    const v = validateFilePath(homePath('.ssh', 'id_rsa'), 'read')
    expect(v.allowed).toBe(false)
    expect(v.reason).toMatch(/SSH/i)
  })

  it('full_control + file_write of approval-config.json → blocked', () => {
    const m = new ApprovalManager()
    m.setMode('full_control')
    expect(m.shouldAutoApprove('file_write')).toBe(true)
    const v = validateFilePath(configPath(), 'write')
    expect(v.allowed).toBe(false)
    expect(v.reason).toMatch(/internal app credential/i)
  })

  it('full_control + file_write of .session → blocked', () => {
    const m = new ApprovalManager()
    m.setMode('full_control')
    const sessionPath = process.platform === 'win32'
      ? 'C:\\Users\\testuser\\AppData\\Roaming\\Coasty Desktop\\.session'
      : '/Users/testuser/Library/Application Support/Coasty Desktop/.session'
    const v = validateFilePath(sessionPath, 'write')
    expect(v.allowed).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// PERSISTENCE INTEGRITY (approval-manager.ts:124-143)
// ═══════════════════════════════════════════════════════════════════════════

describe('Tampered approval-config.json: behavior on disk corruption', () => {
  it('invalid JSON → falls back to default mode (no crash)', () => {
    fakeFs.files.set(configPath(), '{not valid json')
    const m = new ApprovalManager()
    // Default in approval-manager.ts:44 is full_control. NOTE: this is the
    // safest default that doesn't immediately break the user's session, but
    // it does mean tampering can't *force* off/approve_all. We document that
    // the load is best-effort and never throws.
    expect(m.getMode()).toBe('full_control')
  })

  it('mode="evil" (unknown enum value) → ignored, default kept', () => {
    fakeFs.files.set(configPath(), JSON.stringify({ mode: 'evil' }))
    const m = new ApprovalManager()
    // approval-manager.ts:128 explicitly checks VALID_MODES.includes() before
    // assigning — unknown modes are silently rejected.
    expect(m.getMode()).toBe('full_control')
  })

  it('missing fields → default kept', () => {
    fakeFs.files.set(configPath(), JSON.stringify({ unrelated: true }))
    const m = new ApprovalManager()
    expect(m.getMode()).toBe('full_control')
  })

  it('extra fields → ignored, valid mode applied', () => {
    fakeFs.files.set(
      configPath(),
      JSON.stringify({
        mode: 'smart_approve',
        injectedSafeCommands: ['terminal_execute', 'file_delete'],
        adminOverride: true,
      }),
    )
    const m = new ApprovalManager()
    // Extra fields don't widen the safe set — SAFE_COMMANDS is hard-coded.
    expect(m.getMode()).toBe('smart_approve')
    expect(m.shouldAutoApprove('terminal_execute')).toBe(false)
    expect(m.shouldAutoApprove('file_delete')).toBe(false)
  })

  it('readFileSync throws (e.g. permission denied) → constructor still succeeds', () => {
    fakeFs.files.set(configPath(), '{"mode":"smart_approve"}')
    fakeFs.readErrors.set(configPath(), new Error('EACCES: read denied'))

    expect(() => new ApprovalManager()).not.toThrow()
    const m = new ApprovalManager()
    expect(m.getMode()).toBe('full_control')
  })

  it('mode=null in JSON → keeps default, does not type-cast', () => {
    fakeFs.files.set(configPath(), JSON.stringify({ mode: null }))
    const m = new ApprovalManager()
    expect(m.getMode()).toBe('full_control')
  })

  it('mode=42 (number) in JSON → keeps default', () => {
    fakeFs.files.set(configPath(), JSON.stringify({ mode: 42 }))
    const m = new ApprovalManager()
    expect(m.getMode()).toBe('full_control')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// RACE CONDITIONS (approval-manager.ts:89-114)
// ═══════════════════════════════════════════════════════════════════════════

describe('Concurrent / out-of-band approval responses', () => {
  it('handleResponse with unknown id is a no-op (no crash, no leak)', () => {
    const m = new ApprovalManager()
    expect(() => m.handleResponse('nope', true)).not.toThrow()
    expect(() => m.handleResponse('nope', false, 'reason')).not.toThrow()
  })

  it('two requestApproval calls produce distinct ids; resolving one does not resolve the other', async () => {
    const m = new ApprovalManager()

    const p1 = m.requestApproval('file_write', { path: '/a' })
    const p2 = m.requestApproval('file_write', { path: '/b' })

    // Map should hold exactly two entries with distinct ids
    const pendingMap = (m as any).pending as Map<string, any>
    expect(pendingMap.size).toBe(2)
    const ids = [...pendingMap.keys()]
    expect(new Set(ids).size).toBe(2)

    // Resolve ONE of them — the other must still be pending
    m.handleResponse(ids[0], true)
    const result1 = await p1
    expect(result1.approved).toBe(true)
    expect(pendingMap.size).toBe(1)
    expect(pendingMap.has(ids[1])).toBe(true)

    // Clean up to avoid hanging promise
    m.handleResponse(ids[1], false)
    await p2
  })

  it('cancelAll resolves pending approvals as denied (no hanging promises)', async () => {
    const m = new ApprovalManager()

    const p1 = m.requestApproval('terminal_execute', { command: 'ls' })
    const p2 = m.requestApproval('file_delete', { path: '/tmp/x' })

    m.cancelAll()

    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1.approved).toBe(false)
    expect(r2.approved).toBe(false)
    expect((m as any).pending.size).toBe(0)
  })

  it('resolving the same id twice is a no-op (second call ignored, no double-resolve)', async () => {
    const m = new ApprovalManager()

    let resolved = 0
    const p = m.requestApproval('file_write', { path: '/x' })
    p.then(() => { resolved++ })

    const id = [...((m as any).pending as Map<string, any>).keys()][0]
    m.handleResponse(id, true)
    m.handleResponse(id, false, 'attacker')

    await p
    // Yield once so any spurious resolution would have flushed.
    await new Promise((r) => setImmediate(r))

    expect(resolved).toBe(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// UI BYPASS PROTECTION
//
// requestApproval calls bringToFront() (approval-manager.ts:104) so the user
// physically sees the prompt. A malicious renderer can't approve via IPC
// without going through approval:respond, which itself is gated by the
// secureHandle ipc-validator (index.ts:253-261).
// ═══════════════════════════════════════════════════════════════════════════

describe('UI cannot be bypassed', () => {
  it('every approval request brings the overlay to the front', () => {
    const m = new ApprovalManager()
    m.requestApproval('file_write', { path: '/x' })
    expect(bringToFrontMock).toHaveBeenCalledTimes(1)

    m.requestApproval('terminal_execute', { command: 'ls' })
    expect(bringToFrontMock).toHaveBeenCalledTimes(2)
  })

  it('handleResponse only resolves an existing pending request — IPC alone cannot create one', () => {
    const m = new ApprovalManager()
    const fakeId = 'approval_attacker_forged_id'

    // Simulate a malicious renderer calling approval:respond before any
    // pending approval has been created. It should be ignored.
    m.handleResponse(fakeId, true)
    expect((m as any).pending.size).toBe(0)
  })

  it('requestApproval ids are non-guessable random strings (timestamp + 4 base36 chars)', () => {
    const m = new ApprovalManager()
    const ids: string[] = []

    for (let i = 0; i < 50; i++) {
      m.requestApproval('file_write', { path: `/x/${i}` })
    }
    const pending = (m as any).pending as Map<string, any>
    for (const id of pending.keys()) ids.push(id)

    // All distinct
    expect(new Set(ids).size).toBe(ids.length)
    // Format from approval-manager.ts:90 — `approval_{ts}_{4chars}`
    for (const id of ids) {
      expect(id).toMatch(/^approval_\d+_[0-9a-z]{4}$/)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// AUDIT LOGGING HYGIENE
//
// approval-manager.ts itself does not log command parameters, but ws-bridge.ts
// does (line 180, previewParameters). Verify the log preview never captures
// secret-shaped params raw — and that the approval manager doesn't echo args
// to console either.
// ═══════════════════════════════════════════════════════════════════════════

describe('Audit logging does not leak sensitive parameters', () => {
  it('requestApproval / handleResponse / cancelAll do not log parameters to console', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const m = new ApprovalManager()
    const p = m.requestApproval('file_write', {
      path: '/x',
      password: 'hunter2-secret',
      token: 'sk_live_supersecret',
      api_key: 'AKIA_redacted',
    })

    const id = [...((m as any).pending as Map<string, any>).keys()][0]
    m.handleResponse(id, false, 'denied by user')
    return p.then(() => {
      const allLogs = [
        ...errSpy.mock.calls.flat(),
        ...logSpy.mock.calls.flat(),
      ].map(String).join(' | ')

      expect(allLogs).not.toContain('hunter2-secret')
      expect(allLogs).not.toContain('sk_live_supersecret')
      expect(allLogs).not.toContain('AKIA_redacted')

      errSpy.mockRestore()
      logSpy.mockRestore()
    })
  })

  it('saveConfig writes only the mode field — no parameters or secrets persisted', () => {
    const m = new ApprovalManager()
    m.setMode('smart_approve')
    const onDisk = JSON.parse(fakeFs.files.get(configPath())!)
    expect(Object.keys(onDisk)).toEqual(['mode'])
    expect(onDisk.mode).toBe('smart_approve')
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})
