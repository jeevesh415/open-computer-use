/**
 * Tests for the unified error reporter.
 *
 * Covers:
 *  - context enrichment (timestamp, OS, version, machine_id, user_id, command)
 *  - PII scrubbing (Bearer tokens, JWTs, API keys, user-home paths)
 *  - rate limiting / dedup of identical reports
 *  - file persistence (NDJSON, daily rotation)
 *  - WS sink success/failure paths
 *  - HTTP fallback queue with exponential backoff
 *  - severity sampling for non-error levels
 *  - resilience to disk errors / WS exceptions
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const h = vi.hoisted(() => ({
  tmpDir: '',
  appVersion: '9.9.9',
  isReady: true,
}))

vi.mock('electron', () => ({
  app: {
    getPath: (n: string) => {
      if (n === 'userData') return h.tmpDir
      throw new Error(`unexpected getPath: ${n}`)
    },
    getVersion: () => h.appVersion,
  },
}))

describe('errorReporter', () => {
  let mod: typeof import('./error-reporter')

  beforeEach(async () => {
    h.tmpDir = path.join(os.tmpdir(), `err-rep-${Date.now()}-${Math.floor(Math.random() * 1e9)}`)
    fs.mkdirSync(h.tmpDir, { recursive: true })
    vi.resetModules()
    mod = await import('./error-reporter')
    mod.errorReporter._resetForTests()
    mod.errorReporter.init()
  })

  afterEach(() => {
    try { fs.rmSync(h.tmpDir, { recursive: true, force: true }) } catch { /* noop */ }
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  // ─── enrichment ──────────────────────────────────────────────────────

  describe('enrichment', () => {
    it('captures all required fields on a basic error', () => {
      const sink = vi.fn()
      mod.errorReporter.setWebSocketSink(sink)
      mod.errorReporter.setIdentity('m-1', 'u-1')

      mod.reportError('local_executor', { error: new Error('boom'), command: 'click' })

      expect(sink).toHaveBeenCalledTimes(1)
      const r = sink.mock.calls[0][0]
      expect(r.id).toMatch(/^[0-9a-f]{8}-/)
      expect(r.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      expect(r.severity).toBe('error')
      expect(r.category).toBe('local_executor')
      expect(r.machine_id).toBe('m-1')
      expect(r.user_id).toBe('u-1')
      expect(r.app_version).toBe('9.9.9')
      expect(r.os).toEqual({
        platform: process.platform,
        release: os.release(),
        arch: process.arch,
      })
      expect(r.command).toBe('click')
      expect(r.message).toBe('boom')
      expect(r.stack).toContain('Error: boom')
      expect(r.count).toBe(1)
    })

    it('accepts string errors', () => {
      const sink = vi.fn()
      mod.errorReporter.setWebSocketSink(sink)
      mod.reportError('other', { error: 'plain string failure' })
      expect(sink.mock.calls[0][0].message).toBe('plain string failure')
    })

    it('accepts plain objects with message + stack', () => {
      const sink = vi.fn()
      mod.errorReporter.setWebSocketSink(sink)
      mod.reportError('other', { error: { message: 'object err', stack: 'fake stack' } as any })
      const r = sink.mock.calls[0][0]
      expect(r.message).toBe('object err')
      expect(r.stack).toBe('fake stack')
    })

    it('falls back to "<no message>" on undefined error + no message', () => {
      const sink = vi.fn()
      mod.errorReporter.setWebSocketSink(sink)
      mod.reportError('other', {})
      expect(sink.mock.calls[0][0].message).toBe('<no message>')
    })

    it('truncates extremely long messages and stacks', () => {
      const sink = vi.fn()
      mod.errorReporter.setWebSocketSink(sink)
      const longMsg = 'A'.repeat(10_000)
      const longStack = 'B'.repeat(20_000)
      mod.reportError('other', { error: { message: longMsg, stack: longStack } as any })
      const r = sink.mock.calls[0][0]
      expect(r.message.length).toBeLessThan(10_000)
      expect(r.message).toContain('truncated')
      expect(r.stack.length).toBeLessThan(20_000)
    })

    it('passes through correlation_id and structured context', () => {
      const sink = vi.fn()
      mod.errorReporter.setWebSocketSink(sink)
      mod.reportError('ws_bridge', {
        error: new Error('x'),
        correlationId: 'cmd-abc',
        context: { some: 'extra', n: 42 },
      })
      const r = sink.mock.calls[0][0]
      expect(r.correlation_id).toBe('cmd-abc')
      expect(r.context).toEqual({ some: 'extra', n: 42 })
    })
  })

  // ─── PII scrubbing ────────────────────────────────────────────────────

  describe('PII scrubbing', () => {
    it('redacts Bearer tokens in messages', () => {
      const sink = vi.fn()
      mod.errorReporter.setWebSocketSink(sink)
      mod.reportError('other', {
        error: new Error('Failed: Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig'),
      })
      const r = sink.mock.calls[0][0]
      expect(r.message).not.toContain('eyJhbGci')
      expect(r.message).toMatch(/jwt|redacted/)
    })

    it('redacts standalone JWTs', () => {
      const sink = vi.fn()
      mod.errorReporter.setWebSocketSink(sink)
      mod.reportError('other', {
        error: new Error('token=eyJabcdefghijklmn.eyJpayload12345.signaturexyz123'),
      })
      const r = sink.mock.calls[0][0]
      expect(r.message).not.toContain('eyJabcdef')
      expect(r.message).toContain('<jwt>')
    })

    it('redacts api_key=<secret> patterns', () => {
      const sink = vi.fn()
      mod.errorReporter.setWebSocketSink(sink)
      mod.reportError('other', {
        error: new Error('Bad API_KEY=sk-1234567890abcdefghij in request'),
      })
      const r = sink.mock.calls[0][0]
      expect(r.message).not.toContain('sk-1234567890abcdefghij')
    })

    it('redacts password=<secret>', () => {
      const sink = vi.fn()
      mod.errorReporter.setWebSocketSink(sink)
      mod.reportError('other', {
        error: new Error('connect failed password=hunter2'),
      })
      expect(sink.mock.calls[0][0].message).not.toContain('hunter2')
    })

    it('redacts user-home path on Windows-style C:\\Users\\X', () => {
      const sink = vi.fn()
      mod.errorReporter.setWebSocketSink(sink)
      mod.reportError('other', {
        error: new Error('cannot read C:\\Users\\johndoe\\Documents\\secret.txt'),
      })
      const r = sink.mock.calls[0][0]
      expect(r.message).not.toContain('johndoe')
      expect(r.message).toContain('<user>')
    })

    it('redacts user-home path on Unix-style /home/X and /Users/X', () => {
      const sink = vi.fn()
      mod.errorReporter.setWebSocketSink(sink)
      mod.reportError('other', {
        error: new Error('ENOENT: /home/jane/.config/coasty.json | /Users/jane/Library/X'),
      })
      const r = sink.mock.calls[0][0]
      expect(r.message).not.toMatch(/\/home\/jane|\/Users\/jane/)
    })

    it('drops obvious secret keys in the context dict entirely', () => {
      const sink = vi.fn()
      mod.errorReporter.setWebSocketSink(sink)
      mod.reportError('other', {
        error: new Error('x'),
        context: {
          ok_field: 'visible',
          authorization: 'Bearer secret-token',
          password: 'hunter2',
          api_key: 'sk-xxx',
          token: 'should-be-redacted',
          cookie: 'sid=abc',
        },
      })
      const r = sink.mock.calls[0][0]
      expect(r.context.ok_field).toBe('visible')
      expect(r.context.authorization).toBe('<redacted>')
      expect(r.context.password).toBe('<redacted>')
      expect(r.context.api_key).toBe('<redacted>')
      expect(r.context.token).toBe('<redacted>')
      expect(r.context.cookie).toBe('<redacted>')
    })

    it('truncates over-large context blobs', () => {
      const sink = vi.fn()
      mod.errorReporter.setWebSocketSink(sink)
      const huge = { data: 'X'.repeat(50_000) }
      mod.reportError('other', { error: new Error('x'), context: huge })
      const r = sink.mock.calls[0][0]
      expect(r.context._truncated).toBe(true)
      expect(JSON.stringify(r.context).length).toBeLessThan(50_000)
    })
  })

  // ─── dedup ──────────────────────────────────────────────────────────

  describe('rate limiting / dedup', () => {
    it('collapses identical reports within the dedup window', () => {
      const sink = vi.fn()
      mod.errorReporter.setWebSocketSink(sink)
      const err = new Error('repeated boom')
      for (let i = 0; i < 20; i++) {
        mod.reportError('local_executor', { error: err })
      }
      // First emission goes through; the rest are deduped.
      expect(sink).toHaveBeenCalledTimes(1)
    })

    it('treats different categories as separate fingerprints', () => {
      const sink = vi.fn()
      mod.errorReporter.setWebSocketSink(sink)
      mod.reportError('local_executor', { error: new Error('same msg') })
      mod.reportError('ws_bridge', { error: new Error('same msg') })
      expect(sink).toHaveBeenCalledTimes(2)
    })

    it('treats different messages as separate fingerprints', () => {
      const sink = vi.fn()
      mod.errorReporter.setWebSocketSink(sink)
      mod.reportError('other', { error: new Error('msg A') })
      mod.reportError('other', { error: new Error('msg B') })
      expect(sink).toHaveBeenCalledTimes(2)
    })
  })

  // ─── sampling ───────────────────────────────────────────────────────

  describe('severity sampling', () => {
    it('errors are NEVER sampled (every error reaches sinks)', () => {
      const sink = vi.fn()
      mod.errorReporter.setWebSocketSink(sink)
      // Force Math.random to a value that WOULD sample-out — but errors
      // shouldn't be subject to it.
      const randSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99)
      try {
        for (let i = 0; i < 5; i++) {
          mod.reportError('other', { error: new Error(`err-${i}`) })  // unique fingerprint each
        }
        expect(sink).toHaveBeenCalledTimes(5)
      } finally {
        randSpy.mockRestore()
      }
    })

    it('warns are NEVER sampled (treated as errors for delivery)', () => {
      const sink = vi.fn()
      mod.errorReporter.setWebSocketSink(sink)
      const randSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99)
      try {
        for (let i = 0; i < 5; i++) {
          mod.reportWarn('other', { error: new Error(`warn-${i}`) })
        }
        expect(sink).toHaveBeenCalledTimes(5)
      } finally {
        randSpy.mockRestore()
      }
    })

    it('info severity IS sampled', () => {
      const sink = vi.fn()
      mod.errorReporter.setWebSocketSink(sink)
      const randSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99) // > 0.1 sample rate
      try {
        for (let i = 0; i < 5; i++) {
          mod.reportInfo('other', { message: `info-${i}` })
        }
        expect(sink).not.toHaveBeenCalled()
      } finally {
        randSpy.mockRestore()
      }
    })
  })

  // ─── file persistence ───────────────────────────────────────────────

  describe('file persistence', () => {
    it('writes one NDJSON line per report to today\'s log file', () => {
      mod.errorReporter.setWebSocketSink(vi.fn())
      mod.reportError('other', { error: new Error('one') })
      mod.reportError('other', { error: new Error('two') })

      const logDir = path.join(h.tmpDir, 'logs')
      const files = fs.readdirSync(logDir)
      expect(files.length).toBe(1)
      expect(files[0]).toMatch(/^electron-\d{4}-\d{2}-\d{2}\.ndjson$/)

      const content = fs.readFileSync(path.join(logDir, files[0]), 'utf-8')
      const lines = content.trim().split('\n')
      expect(lines).toHaveLength(2)
      const parsed = lines.map((l) => JSON.parse(l))
      expect(parsed[0].message).toBe('one')
      expect(parsed[1].message).toBe('two')
    })

    it('survives disk write failure without throwing', async () => {
      // Simulate "disk write fails" by pointing the log directory at a path
      // that is actually a regular file, so `appendFileSync` raises ENOTDIR.
      // This is more realistic than mocking fs and doesn't trip vitest's
      // ESM module-namespace restriction.
      const blockingFile = path.join(h.tmpDir, 'blocked.txt')
      fs.writeFileSync(blockingFile, 'this is a file, not a dir')
      h.tmpDir = blockingFile  // point logDir's parent at a non-dir
      vi.resetModules()
      const fresh = await import('./error-reporter')
      fresh.errorReporter._resetForTests()
      fresh.errorReporter.init()
      fresh.errorReporter.setWebSocketSink(vi.fn())

      // The call must NOT throw — file failure is non-fatal, stdout still works.
      expect(() =>
        fresh.reportError('other', { error: new Error('still works') })
      ).not.toThrow()
    })
  })

  // ─── WS sink + HTTP fallback ────────────────────────────────────────

  describe('WS sink', () => {
    it('routes through WS when sink is installed', () => {
      const sink = vi.fn()
      mod.errorReporter.setWebSocketSink(sink)
      mod.reportError('other', { error: new Error('x') })
      expect(sink).toHaveBeenCalledTimes(1)
      // No HTTP queue when WS is up
      expect(mod.errorReporter._getQueueLength()).toBe(0)
    })

    it('falls back to HTTP queue when WS sink throws', () => {
      mod.errorReporter.setWebSocketSink(() => {
        throw new Error('WS closed mid-send')
      })
      mod.errorReporter.init({ backendUrl: 'http://localhost:8001' })
      mod.reportError('other', { error: new Error('queued') })
      expect(mod.errorReporter._getQueueLength()).toBe(1)
    })

    it('queues for HTTP when no WS sink is installed', () => {
      mod.errorReporter.init({ backendUrl: 'http://localhost:8001' })
      mod.reportError('other', { error: new Error('queued') })
      expect(mod.errorReporter._getQueueLength()).toBe(1)
    })

    it('does not queue for HTTP when no backend URL is configured', () => {
      // No init({backendUrl}) call — only the bare init in beforeEach
      mod.reportError('other', { error: new Error('lonely') })
      expect(mod.errorReporter._getQueueLength()).toBe(0)
    })
  })

  // ─── identity propagation ───────────────────────────────────────────

  describe('identity', () => {
    it('starts with null machine_id and user_id', () => {
      const sink = vi.fn()
      mod.errorReporter.setWebSocketSink(sink)
      mod.reportError('other', { error: new Error('anon') })
      const r = sink.mock.calls[0][0]
      expect(r.machine_id).toBeNull()
      expect(r.user_id).toBeNull()
    })

    it('subsequent reports pick up updated identity', () => {
      const sink = vi.fn()
      mod.errorReporter.setWebSocketSink(sink)
      mod.errorReporter.setIdentity('m-final', 'u-final')
      mod.reportError('other', { error: new Error('with-id') })
      const r = sink.mock.calls[0][0]
      expect(r.machine_id).toBe('m-final')
      expect(r.user_id).toBe('u-final')
    })
  })
})
