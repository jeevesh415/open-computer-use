/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Corner-case tests for terminal.ts — runtime behaviour not exercised by
 * terminal-security.test.ts. Focus areas:
 *
 *  1. Session lifecycle: connectTerminal/closeTerminal create + delete entries
 *  2. Session-aware cwd (executeTerminal uses session's cwd if provided)
 *  3. Exit-code branches: clean exit, non-zero, spawn-failure (string code), killed
 *  4. Output truncation at 5000 chars on stdout, stderr, AND combined output
 *  5. Stderr+stdout combined output formatting (newline separator)
 *  6. timeout parameter normalization (negative, zero, non-number → default 30)
 *  7. closeTerminal idempotency / unknown session_id
 *  8. readTerminal / typeTerminal / clearTerminal contract shape
 *  9. Empty / whitespace-only / undefined command → structured error
 *  10. session_id pointing to a nonexistent session falls back to homedir
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock electron (security.ts imports from it) ─────────────────────────
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return '/tmp/coasty-term-cc'
      return ''
    }),
  },
}))

// ── Mock execFile — capture invocations for inspection ──────────────────
type Call = {
  cmd: string
  args: string[]
  opts: any
  cb: (error: any, stdout: string, stderr: string) => void
}
const calls: Call[] = []

vi.mock('child_process', () => ({
  execFile: vi.fn((cmd: string, args: string[], opts: any, cb: any) => {
    const call = { cmd, args, opts, cb }
    calls.push(call)
    const child: any = {
      pid: 10000 + calls.length,
      killed: false,
      kill: vi.fn(() => { child.killed = true; return true }),
      on: vi.fn(() => child),
    }
    return child
  }),
}))

import {
  connectTerminal, executeTerminal, closeTerminal,
  readTerminal, typeTerminal, clearTerminal,
} from './terminal'

beforeEach(() => {
  calls.length = 0
})

// ════════════════════════════════════════════════════════════════════════
// 1. Session lifecycle
// ════════════════════════════════════════════════════════════════════════

describe('session lifecycle', () => {
  it('connectTerminal returns unique session_id with default cwd=homedir', async () => {
    const r = await connectTerminal({})
    expect(r.success).toBe(true)
    expect(r.session_id).toMatch(/^term_\d+$/)
    expect(r.cwd).toBeTruthy()
  })

  it('connectTerminal honours passed cwd', async () => {
    const r = await connectTerminal({ cwd: '/tmp/specific' })
    expect(r.cwd).toBe('/tmp/specific')
  })

  it('two connectTerminal calls return distinct ids', async () => {
    const a = await connectTerminal({})
    const b = await connectTerminal({})
    expect(a.session_id).not.toBe(b.session_id)
  })

  it('closeTerminal removes the session (subsequent execute falls back to homedir)', async () => {
    const conn = await connectTerminal({ cwd: '/tmp/will-be-closed' })
    const sid = conn.session_id
    await closeTerminal({ session_id: sid })

    // execute with closed session → cwd should NOT be the closed session's cwd
    executeTerminal({ command: 'echo hi', session_id: sid })
    expect(calls).toHaveLength(1)
    expect(calls[0].opts.cwd).not.toBe('/tmp/will-be-closed')
  })

  it('closeTerminal with unknown session_id is harmless', async () => {
    const r = await closeTerminal({ session_id: 'term_does_not_exist' })
    expect(r.success).toBe(true)
  })

  it('closeTerminal with no session_id is harmless (default close)', async () => {
    const r = await closeTerminal({})
    expect(r.success).toBe(true)
  })
})

// ════════════════════════════════════════════════════════════════════════
// 2. session-aware cwd
// ════════════════════════════════════════════════════════════════════════

describe('session-aware cwd', () => {
  it('executeTerminal uses session cwd when session_id provided', async () => {
    const conn = await connectTerminal({ cwd: '/tmp/session-cwd' })
    executeTerminal({ command: 'pwd', session_id: conn.session_id })
    expect(calls[0].opts.cwd).toBe('/tmp/session-cwd')
  })

  it('executeTerminal with non-existent session_id silently falls back to homedir', async () => {
    executeTerminal({ command: 'pwd', session_id: 'term_999_no' })
    expect(calls).toHaveLength(1)
    // Falls back — NOT '/tmp/session-cwd', should be homedir-ish
    expect(calls[0].opts.cwd).toBeTruthy()
  })

  it('executeTerminal with no session_id uses homedir', async () => {
    executeTerminal({ command: 'pwd' })
    expect(calls[0].opts.cwd).toBeTruthy()
  })
})

// ════════════════════════════════════════════════════════════════════════
// 3. Exit-code branches
// ════════════════════════════════════════════════════════════════════════

describe('exit-code branches', () => {
  it('clean exit (error=null) → success:true, exit_code:0, no error msg', async () => {
    const promise = executeTerminal({ command: 'echo hi' })
    calls[0].cb(null, 'hi\n', '')
    const r = await promise
    expect(r.success).toBe(true)
    expect(r.exit_code).toBe(0)
    expect(r.error).toBeUndefined()
    expect(r.stdout).toBe('hi\n')
  })

  it('non-zero numeric exit code → success:false, exit_code preserved, error includes code', async () => {
    const promise = executeTerminal({ command: 'false-or-nonzero' })
    calls[0].cb({ code: 42, message: 'cmd failed' }, '', 'oops\n')
    const r = await promise
    expect(r.success).toBe(false)
    expect(r.exit_code).toBe(42)
    expect(r.error).toMatch(/Exit code 42/)
    expect(r.error).toMatch(/oops/)
  })

  it('spawn failure (string code ENOENT) → exit_code:-1, error mentions shell', async () => {
    const promise = executeTerminal({ command: 'echo' })
    calls[0].cb({ code: 'ENOENT', message: 'shell not found' }, '', '')
    const r = await promise
    expect(r.success).toBe(false)
    expect(r.exit_code).toBe(-1)
    expect(r.error).toMatch(/ENOENT/)
    expect(r.error).toMatch(/Failed to launch/)
  })

  it('killed (timeout signal) → exit_code:-1, error mentions timeout', async () => {
    const promise = executeTerminal({ command: 'sleep 999', timeout: 1 })
    calls[0].cb({ killed: true, message: 'killed' }, '', '')
    const r = await promise
    expect(r.success).toBe(false)
    expect(r.exit_code).toBe(-1)
    expect(r.error).toMatch(/timed out/)
    expect(r.error).toMatch(/1s/) // the timeout value provided
  })

  it('error with no code/killed flag → falls through to generic error.message', async () => {
    const promise = executeTerminal({ command: 'whatever' })
    calls[0].cb({ message: 'mysterious failure' } as any, '', '')
    const r = await promise
    expect(r.success).toBe(false)
    expect(r.exit_code).toBe(-1)
    expect(r.error).toBe('mysterious failure')
  })
})

// ════════════════════════════════════════════════════════════════════════
// 4. Output truncation (5000 chars)
// ════════════════════════════════════════════════════════════════════════

describe('output truncation', () => {
  it('stdout > 5000 chars truncated, stdout AND combined output capped', async () => {
    const promise = executeTerminal({ command: 'cat huge' })
    calls[0].cb(null, 'A'.repeat(10_000), '')
    const r = await promise
    expect(r.stdout.length).toBe(5000)
    expect(r.output.length).toBe(5000)
    expect(r.stderr).toBe('')
  })

  it('stderr > 5000 chars truncated independently', async () => {
    const promise = executeTerminal({ command: 'cmd-with-stderr' })
    calls[0].cb(null, 'short stdout', 'X'.repeat(8_000))
    const r = await promise
    expect(r.stdout).toBe('short stdout')
    expect(r.stderr.length).toBe(5000)
    expect(r.success).toBe(true)
  })

  it('combined output formed from stdout + newline + stderr (when stderr non-empty)', async () => {
    const promise = executeTerminal({ command: 'mix' })
    calls[0].cb(null, 'OUT', 'ERR')
    const r = await promise
    expect(r.output).toContain('OUT')
    expect(r.output).toContain('ERR')
  })

  it('combined output omits stderr separator when stderr is empty', async () => {
    const promise = executeTerminal({ command: 'clean' })
    calls[0].cb(null, 'just stdout', '')
    const r = await promise
    expect(r.output).toBe('just stdout')
  })
})

// ════════════════════════════════════════════════════════════════════════
// 5. timeout parameter normalization
// ════════════════════════════════════════════════════════════════════════

describe('timeout parameter normalization', () => {
  it('no timeout → default 30s', async () => {
    executeTerminal({ command: 'echo' })
    expect(calls[0].opts.timeout).toBe(30 * 1000)
  })

  it('numeric positive timeout passed through', async () => {
    executeTerminal({ command: 'echo', timeout: 5 })
    expect(calls[0].opts.timeout).toBe(5 * 1000)
  })

  it('negative timeout → falls back to default 30', async () => {
    executeTerminal({ command: 'echo', timeout: -10 })
    expect(calls[0].opts.timeout).toBe(30 * 1000)
  })

  it('zero timeout → falls back to default 30', async () => {
    executeTerminal({ command: 'echo', timeout: 0 })
    expect(calls[0].opts.timeout).toBe(30 * 1000)
  })

  it('non-number timeout → falls back to default', async () => {
    executeTerminal({ command: 'echo', timeout: 'forever' as any })
    expect(calls[0].opts.timeout).toBe(30 * 1000)
  })
})

// ════════════════════════════════════════════════════════════════════════
// 6. Empty / invalid command guards
// ════════════════════════════════════════════════════════════════════════

describe('empty/invalid command guards', () => {
  it('undefined command → structured error, NO execFile call', async () => {
    const r = await executeTerminal({ command: undefined as any })
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/command.*string/i)
    expect(calls).toHaveLength(0)
  })

  it('null command → structured error, NO execFile call', async () => {
    const r = await executeTerminal({ command: null as any })
    expect(r.success).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('empty string command → structured error, NO execFile call', async () => {
    const r = await executeTerminal({ command: '' })
    expect(r.success).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('whitespace-only command → structured error, NO execFile call', async () => {
    const r = await executeTerminal({ command: '   \t\n  ' })
    expect(r.success).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('non-string command (number) → structured error', async () => {
    const r = await executeTerminal({ command: 42 as any })
    expect(r.success).toBe(false)
    expect(calls).toHaveLength(0)
  })
})

// ════════════════════════════════════════════════════════════════════════
// 7. Helper function shapes
// ════════════════════════════════════════════════════════════════════════

describe('helper function shapes', () => {
  it('readTerminal returns success:true with empty output', async () => {
    const r = await readTerminal({})
    expect(r.success).toBe(true)
    expect(r.output).toBe('')
  })

  it('typeTerminal echoes the text (preview-only contract)', async () => {
    const r = await typeTerminal({ text: 'echo hello' })
    expect(r.success).toBe(true)
    expect(r.message).toMatch(/echo hello/)
  })

  it('typeTerminal truncates the preview to 50 chars', async () => {
    const r = await typeTerminal({ text: 'A'.repeat(200) })
    expect(r.success).toBe(true)
    // Preview is "Text \"AAA…\" ready to send..." — confirm 50-char slice
    const match = r.message.match(/"([^"]+)"/)
    expect(match).toBeTruthy()
    expect(match![1].length).toBeLessThanOrEqual(50)
  })

  it('clearTerminal returns success:true with message', async () => {
    const r = await clearTerminal({})
    expect(r.success).toBe(true)
    expect(r.message).toBeTruthy()
  })
})

// ════════════════════════════════════════════════════════════════════════
// 8. Concurrent executes do not share callbacks / state
// ════════════════════════════════════════════════════════════════════════

describe('concurrent executes', () => {
  it('two concurrent execute calls each get distinct execFile invocations', async () => {
    const p1 = executeTerminal({ command: 'echo a' })
    const p2 = executeTerminal({ command: 'echo b' })
    expect(calls).toHaveLength(2)
    // Resolve in opposite order
    calls[1].cb(null, 'b\n', '')
    calls[0].cb(null, 'a\n', '')
    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1.stdout).toBe('a\n')
    expect(r2.stdout).toBe('b\n')
  })

  it('callback fired AFTER promise already resolved (e.g. via timeout watchdog) does NOT double-resolve', async () => {
    const promise = executeTerminal({ command: 'sleep' })
    // First, simulate the watchdog firing → the promise resolves with timeout error
    // (We can't easily trigger the watchdog without faking timers; instead
    // simulate by firing two callbacks back-to-back.)
    calls[0].cb(null, 'first', '')
    // Second callback should be ignored due to `resolved` flag
    expect(() => calls[0].cb({ code: 99 }, '', 'race')).not.toThrow()
    const r = await promise
    expect(r.success).toBe(true)
    expect(r.stdout).toBe('first')
  })
})
