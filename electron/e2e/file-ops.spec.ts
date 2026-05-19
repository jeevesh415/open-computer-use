/**
 * Real-filesystem ops via the main process.
 *
 * The file-ops module is invoked by the local-executor when the agent
 * issues read/write/edit/delete commands. Vitest mocks ``fs`` — this spec
 * runs the real syscalls so we catch:
 *   - path-handling regressions on Windows (backslash vs forward-slash)
 *   - encoding bugs (UTF-8 BOM, CRLF roundtripping)
 *   - permission errors that mocked fs would silently pass
 *
 * The test reaches into the main process via ``app.evaluate`` to invoke
 * file-ops directly. The renderer doesn't have a file-IO surface (by
 * design), so we don't go via ``window.coasty``.
 */
import { test, expect } from '@playwright/test'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { launchApp, closeApp, waitForMainWindow, LaunchedApp } from './fixtures/launch'

let launched: LaunchedApp | null = null
let scratchDir = ''

test.beforeEach(async () => {
  scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coasty-fileops-'))
  launched = await launchApp()
  await waitForMainWindow(launched)
})

test.afterEach(async () => {
  await closeApp(launched)
  launched = null
  try { fs.rmSync(scratchDir, { recursive: true, force: true }) } catch { /* ignore */ }
})

/** Run the named file-ops handler inside the main process via the test-
 *  mode global. ``local-executor.ts`` attaches the file-ops module to
 *  ``globalThis.__coastyTestExports__`` whenever ``COASTY_TEST_MODE=1`` —
 *  see the ``isTestMode()`` guard in that file. The global is the
 *  workaround for the fact that electron-vite bundles main into a single
 *  ``index.js``, so ``import('./file-ops.js')`` doesn't resolve at runtime. */
async function callFileOp(
  handler: 'writeFile' | 'readFile' | 'editFile' | 'deleteFile' | 'listDirectory' | 'appendFile',
  params: Record<string, unknown>,
): Promise<unknown> {
  return launched!.app.evaluate(async (_electron, payload) => {
    const exports = (globalThis as any).__coastyTestExports__
    if (!exports?.fileOps) {
      throw new Error(
        '__coastyTestExports__.fileOps is missing — was COASTY_TEST_MODE=1 set at launch?',
      )
    }
    const fn = exports.fileOps[payload.handler]
    if (typeof fn !== 'function') {
      throw new Error(`fileOps.${payload.handler} is not a function`)
    }
    return fn(payload.params)
  }, { handler, params })
}

test('writeFile creates a file with the exact content', async () => {
  const filePath = path.join(scratchDir, 'hello.txt')
  await callFileOp('writeFile', { path: filePath, content: 'hello world\n' })

  expect(fs.existsSync(filePath)).toBe(true)
  expect(fs.readFileSync(filePath, 'utf8')).toBe('hello world\n')
})

test('readFile returns content written by writeFile', async () => {
  const filePath = path.join(scratchDir, 'roundtrip.txt')
  fs.writeFileSync(filePath, 'fixture content\n')

  const result = (await callFileOp('readFile', { path: filePath })) as { content?: string }
  // The handler returns { success, content } per file-ops.ts.
  expect(result.content).toBe('fixture content\n')
})

test('writeFile + readFile roundtrip UTF-8 content unchanged', async () => {
  const filePath = path.join(scratchDir, 'unicode.txt')
  const content = 'héllo • 世界 • 😀\n'
  await callFileOp('writeFile', { path: filePath, content })

  const result = (await callFileOp('readFile', { path: filePath })) as { content?: string }
  expect(result.content).toBe(content)
})

test('editFile replaces find-text with replace-text', async () => {
  const filePath = path.join(scratchDir, 'edit.txt')
  fs.writeFileSync(filePath, 'foo bar baz\n')

  await callFileOp('editFile', {
    path: filePath,
    old_text: 'bar',
    new_text: 'QUX',
  })

  expect(fs.readFileSync(filePath, 'utf8')).toBe('foo QUX baz\n')
})

test('appendFile adds to the end without truncating', async () => {
  const filePath = path.join(scratchDir, 'log.txt')
  fs.writeFileSync(filePath, 'line1\n')

  await callFileOp('appendFile', { path: filePath, content: 'line2\n' })

  expect(fs.readFileSync(filePath, 'utf8')).toBe('line1\nline2\n')
})

test('deleteFile removes the file', async () => {
  const filePath = path.join(scratchDir, 'doomed.txt')
  fs.writeFileSync(filePath, 'bye\n')

  await callFileOp('deleteFile', { path: filePath })

  expect(fs.existsSync(filePath)).toBe(false)
})

test('listDirectory enumerates entries', async () => {
  fs.writeFileSync(path.join(scratchDir, 'a.txt'), 'a')
  fs.writeFileSync(path.join(scratchDir, 'b.txt'), 'b')
  fs.mkdirSync(path.join(scratchDir, 'sub'))

  // file-ops.ts returns ``{ success, items: [...], path, count }`` —
  // ``items`` not ``entries``. Each item carries ``name``, ``type``,
  // and ``path``.
  const result = (await callFileOp('listDirectory', { path: scratchDir })) as {
    items?: Array<{ name: string; type: 'file' | 'directory' }>
  }
  const names = (result.items ?? []).map((e) => e.name).sort()
  expect(names).toContain('a.txt')
  expect(names).toContain('b.txt')
  expect(names).toContain('sub')
})

test('readFile of a missing path returns an error result (does not throw)', async () => {
  const missing = path.join(scratchDir, 'does-not-exist.txt')
  const result = (await callFileOp('readFile', { path: missing })) as {
    success?: boolean
    error?: string
  }
  // The handler must return a structured error, not throw — otherwise the
  // IPC bridge surfaces an Electron-internal ``Error`` shape the renderer
  // can't parse.
  expect(result.success).toBe(false)
  expect(typeof result.error).toBe('string')
})
