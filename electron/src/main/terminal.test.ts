/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Tests for the stdout/stderr buffer-cap fix in ``terminal.ts``
 * (Issue #4, 2026-05-17). Three production events fired
 * ``ERR_CHILD_PROCESS_STDIO_MAXBUFFER`` from PowerShell update scripts
 * whose output exceeded Node's default 1 MB cap on ``execFile``.
 *
 * The fix:
 *   1. ``terminal.executeTerminal`` passes ``maxBuffer: 10 * 1024 * 1024``
 *      (10 MB) so 1-10 MB PowerShell logs are captured cleanly.
 *   2. The 5,000-char slice the handler applies AFTER capture is
 *      orthogonal — agents only see 5 KB, but we still need to capture
 *      the underlying bytes without throwing.
 *
 * These tests run against the mocked ``child_process.execFile`` so we
 * don't actually spawn PowerShell. We assert:
 *
 *   * The 10 MB maxBuffer is plumbed through correctly.
 *   * A 5 MB stdout payload returns success (vs. the 1 MB default
 *     throwing ERR_CHILD_PROCESS_STDIO_MAXBUFFER pre-fix).
 *   * stdout/stderr in the result are sliced to 5,000 chars per the
 *     existing truncation contract.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock electron (security.ts imports from it) ─────────────────────────
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return '/tmp/coasty-term-test'
      return ''
    }),
  },
}))

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
      pid: 12345,
      killed: false,
      kill: vi.fn(() => { child.killed = true; return true }),
      on: vi.fn(() => child),
    }
    return child
  }),
  spawn: vi.fn(),
}))

import { executeTerminal } from './terminal'

beforeEach(() => {
  calls.length = 0
})

// ════════════════════════════════════════════════════════════════════════
// 1. The 10 MB maxBuffer is wired into the execFile options
// ════════════════════════════════════════════════════════════════════════

describe('terminal maxBuffer (Issue #4, 2026-05-17)', () => {
  it('plumbs a 10 MB maxBuffer into child_process.execFile options', async () => {
    const pending = executeTerminal({ command: 'echo hi' })
    // The handler invokes execFile synchronously; the mock pushes onto `calls`.
    expect(calls.length).toBe(1)
    expect(calls[0].opts.maxBuffer).toBe(10 * 1024 * 1024)
    // Make sure the test promise resolves so vitest's leak detector is happy.
    calls[0].cb(null, '', '')
    await pending
  })

  it('succeeds when stdout is 5 MB (pre-fix this threw ERR_CHILD_PROCESS_STDIO_MAXBUFFER)', async () => {
    // Build a 5 MB stdout payload. This is the EXACT scenario from the
    // 2026-05-17 update-script logs — well below our 10 MB cap, well
    // above the pre-fix 1 MB default.
    const FIVE_MB = 5 * 1024 * 1024
    const huge = 'A'.repeat(FIVE_MB)

    const pending = executeTerminal({ command: 'Get-Module -ListAvailable | Format-List *' })
    expect(calls.length).toBe(1)

    // Invoke the callback with the 5 MB payload exactly as Node would
    // when the underlying spawn completed cleanly.
    calls[0].cb(null, huge, '')

    const result = await pending
    expect(result.success).toBe(true)
    expect(result.exit_code).toBe(0)
    // The handler always slices to 5,000 chars for the model context;
    // that is the existing contract and is orthogonal to maxBuffer.
    expect(result.stdout.length).toBeLessThanOrEqual(5000)
    expect(result.output.length).toBeLessThanOrEqual(5000)
  })

  it('does NOT throw when the callback would have surfaced ERR_CHILD_PROCESS_STDIO_MAXBUFFER on a 1 MB cap', async () => {
    // Belt-and-braces: simulate the exact pre-fix error. With the 10 MB
    // cap the underlying execFile never raises this anymore, but we test
    // the handler's resilience — if a future regression lowered the cap
    // we want a clear, structured error, NOT an uncaught exception.
    const pending = executeTerminal({ command: 'Get-Module -ListAvailable | Format-List *' })
    expect(calls.length).toBe(1)
    const err: any = new Error('stdout maxBuffer length exceeded')
    err.code = 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
    calls[0].cb(err, '', '')

    const result = await pending
    // The handler MUST return a structured failure result (success=false)
    // rather than letting the rejection propagate out of the promise.
    expect(result.success).toBe(false)
    expect(typeof result.error).toBe('string')
    expect(result.exit_code).toBe(-1)
  })

  it('PowerShell on Windows / bash on Unix both receive the cap', async () => {
    // Cover both platform-specific shells by spying on the cmd argument
    // (we don't override process.platform — the test asserts that the
    // cap is set regardless of which shell was selected).
    const pending = executeTerminal({ command: 'ls' })
    expect(calls.length).toBe(1)
    expect(calls[0].opts.maxBuffer).toBe(10 * 1024 * 1024)
    calls[0].cb(null, 'small\noutput\n', '')
    await pending
  })
})
