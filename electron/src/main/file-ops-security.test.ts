/**
 * Security tests for file-ops.ts — covers concrete file system behaviour
 * NOT exercised by the validateFilePath unit tests in security.test.ts.
 *
 *  - Real read/write/delete against `os.tmpdir()` (sandboxed, cleaned up)
 *  - 10KB read truncation contract
 *  - Path traversal in nested deletes
 *  - Symlink-to-/etc must not be followed by listDirectory
 *  - editFile treats `old_text` as a literal string (not regex)
 *  - Append to a read-only file returns an error envelope
 *  - Race conditions between two concurrent writes don't crash or corrupt
 *  - Long path handling (>260 chars on Windows)
 *  - Reserved Windows names propagate through every CRUD entry point
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs'
import * as fsp from 'fs/promises'

// ─── Mock electron's `app.getPath('userData')` BEFORE importing file-ops ─────

const FAKE_USER_DATA = path.join(
  os.tmpdir(),
  `coasty-file-ops-test-${process.pid}-${Date.now()}`,
)

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return FAKE_USER_DATA
      return ''
    }),
  },
}))

import {
  readFile, writeFile, editFile, appendFile, deleteFile, fileExists,
  listDirectory, deleteDirectory,
} from './file-ops'

// ─── Sandbox setup ───────────────────────────────────────────────────────────

let SANDBOX: string

beforeAll(async () => {
  SANDBOX = await fsp.mkdtemp(path.join(os.tmpdir(), 'coasty-fileops-'))
  // Pre-create the fake userData dir so validateFilePath checks against it
  // for the .session sentinel test.
  await fsp.mkdir(FAKE_USER_DATA, { recursive: true })
})

afterAll(async () => {
  // Best-effort cleanup; tests should not leak into CI temp space.
  await fsp.rm(SANDBOX, { recursive: true, force: true }).catch(() => {})
  await fsp.rm(FAKE_USER_DATA, { recursive: true, force: true }).catch(() => {})
})

// ─── Read truncation contract (max 10KB) ────────────────────────────────────

describe('readFile truncation', () => {
  it('truncates large file content to 10000 chars', async () => {
    const big = path.join(SANDBOX, 'big.txt')
    await fsp.writeFile(big, 'A'.repeat(50_000), 'utf-8')
    const r = await readFile({ path: big })
    expect(r.success).toBe(true)
    expect(r.content.length).toBe(10_000)
    // FIXED (P2-02): readFile now flags truncation explicitly so callers can
    // distinguish "got the whole file" from "got the first 10 KB only".
    expect(r.truncated).toBe(true)
    expect(r.size).toBe(50_000)
  })

  it('returns content as-is when file is small', async () => {
    const small = path.join(SANDBOX, 'small.txt')
    await fsp.writeFile(small, 'hello world', 'utf-8')
    const r = await readFile({ path: small })
    expect(r.success).toBe(true)
    expect(r.content).toBe('hello world')
    // Truncation flag must be false for small files; size is the raw length.
    expect(r.truncated).toBe(false)
    expect(r.size).toBe('hello world'.length)
  })

  it('returns truncated=false for files exactly at the 10000-char boundary', async () => {
    const exact = path.join(SANDBOX, 'exact.txt')
    await fsp.writeFile(exact, 'x'.repeat(10_000), 'utf-8')
    const r = await readFile({ path: exact })
    expect(r.success).toBe(true)
    expect(r.content.length).toBe(10_000)
    expect(r.truncated).toBe(false)
    expect(r.size).toBe(10_000)
  })

  it('returns truncated=true for files one byte over the boundary', async () => {
    const over = path.join(SANDBOX, 'over.txt')
    await fsp.writeFile(over, 'x'.repeat(10_001), 'utf-8')
    const r = await readFile({ path: over })
    expect(r.success).toBe(true)
    expect(r.content.length).toBe(10_000)
    expect(r.truncated).toBe(true)
    expect(r.size).toBe(10_001)
  })

  it('returns failure for missing file rather than throwing', async () => {
    const r = await readFile({ path: path.join(SANDBOX, 'nope.txt') })
    expect(r.success).toBe(false)
    expect(r.error).toBeDefined()
  })
})

// ─── Credential-file blocking (cross-check, not duplicating exhaustive list) ─

describe('credential file blocking via file-ops entrypoints', () => {
  it('readFile rejects ~/.ssh/id_rsa via validateFilePath', async () => {
    const sshKey = path.join(os.homedir(), '.ssh', 'id_rsa')
    const r = await readFile({ path: sshKey })
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/SSH/i)
  })

  it('writeFile rejects userData/.session even from outside the app', async () => {
    const sessionFile = path.join(FAKE_USER_DATA, '.session')
    const r = await writeFile({ path: sessionFile, content: 'evil' })
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/credential/i)
  })

  it('appendFile rejects userData/.session', async () => {
    const sessionFile = path.join(FAKE_USER_DATA, '.session')
    const r = await appendFile({ path: sessionFile, content: 'tail' })
    expect(r.success).toBe(false)
  })

  it('deleteFile rejects userData/approval-config.json', async () => {
    const cfg = path.join(FAKE_USER_DATA, 'approval-config.json')
    const r = await deleteFile({ path: cfg })
    expect(r.success).toBe(false)
  })

  it('editFile rejects userData/.session', async () => {
    const sessionFile = path.join(FAKE_USER_DATA, '.session')
    const r = await editFile({ path: sessionFile, old_text: 'a', new_text: 'b' })
    expect(r.success).toBe(false)
  })
})

// ─── Path traversal ─────────────────────────────────────────────────────────

describe('path traversal in nested deletes', () => {
  it('deleteFile resolves ../ before validation, blocking traversal into system dirs', async () => {
    // build path that resolves to a system dir on the host platform
    const bad = process.platform === 'win32'
      ? path.join(SANDBOX, '..', '..', '..', '..', '..', 'Windows', 'System32', 'cmd.exe')
      : path.join(SANDBOX, '..', '..', '..', '..', '..', 'etc', 'shadow')
    const r = await deleteFile({ path: bad })
    expect(r.success).toBe(false)
  })

  it('deleteDirectory resolves ../ before validation', async () => {
    // Construct a path with embedded ../ that resolves into a system dir.
    // We use enough `..` segments to clearly walk past the sandbox parents
    // and INTO a path the validator must reject after path.resolve collapses
    // the segments.
    const bad = process.platform === 'win32'
      // Anchor at C:\ then walk into a system dir — path.resolve will
      // collapse the ../ and produce C:\Windows\System32\...
      ? path.resolve('C:\\', '..', '..', 'Windows', 'System32', 'coasty-test-target')
      : path.resolve('/', '..', '..', 'etc', 'shadow')
    const r = await deleteDirectory({ path: bad })
    expect(r.success).toBe(false)
  })
})

// ─── Symlink handling ───────────────────────────────────────────────────────

describe('symlink handling', () => {
  it('listDirectory does not transparently follow a symlink to /etc on POSIX', async () => {
    if (process.platform === 'win32') return // requires elevation on Windows

    const linkDir = path.join(SANDBOX, 'links')
    await fsp.mkdir(linkDir, { recursive: true })
    const symlinkPath = path.join(linkDir, 'etc-link')
    try {
      await fsp.symlink('/etc', symlinkPath, 'dir')
    } catch {
      // EPERM on some sandboxes — skip if we can't create symlinks
      return
    }

    const r = await listDirectory({ path: linkDir })
    expect(r.success).toBe(true)
    // The symlink itself is listed, but it's reported as 'file' by Dirent
    // unless followed. Since file-ops uses `withFileTypes: true` (no
    // `recursive`), it does not recurse — so /etc contents are NOT enumerated.
    expect(r.items.length).toBe(1)
    expect(r.items[0].name).toBe('etc-link')
    // No /etc entries leaked into the listing
    expect(r.items.find((i: any) => i.name === 'passwd')).toBeUndefined()
  })

  it('reading through a symlink to a credential file is blocked by path validation', async () => {
    if (process.platform === 'win32') return
    // Create a real credential file target so realpathSync can canonicalise it.
    // Using a fake home-relative path under the sandbox would not match the
    // CREDENTIAL_PATTERNS (which require the path to be under os.homedir()),
    // so we set up a symlink target under the user's actual ~/.ssh dir.
    const sshDir = path.join(os.homedir(), '.ssh')
    const fakeCredTarget = path.join(sshDir, `id_rsa_test_${process.pid}`)
    try {
      await fsp.mkdir(sshDir, { recursive: true })
      await fsp.writeFile(fakeCredTarget, 'fake test key', { mode: 0o600 })
    } catch {
      return // can't create test fixture in this environment
    }
    const linkPath = path.join(SANDBOX, 'symlink-to-id_rsa')
    try {
      await fsp.symlink(fakeCredTarget, linkPath)
    } catch {
      await fsp.unlink(fakeCredTarget).catch(() => {})
      return
    }
    // FIXED (P1-03): validateFilePath now canonicalises symlinks via
    // fs.realpathSync and runs the credential-pattern check against BOTH the
    // literal resolved path AND the canonical target. A symlink under
    // SANDBOX pointing into ~/.ssh/id_rsa* must be rejected by the validator,
    // not the OS permission layer.
    const r = await readFile({ path: linkPath })
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/SSH key|credential/i)

    // Cleanup
    await fsp.unlink(linkPath).catch(() => {})
    await fsp.unlink(fakeCredTarget).catch(() => {})
  })
})

// ─── writeFile creates intermediate directories ─────────────────────────────

describe('writeFile intermediate directory creation', () => {
  it('creates nested parent directories that do not exist', async () => {
    const target = path.join(SANDBOX, 'a', 'b', 'c', 'deep.txt')
    const r = await writeFile({ path: target, content: 'deep' })
    expect(r.success).toBe(true)
    const back = await fsp.readFile(target, 'utf-8')
    expect(back).toBe('deep')
  })

  it('does NOT create parents into a blocked system directory', async () => {
    const bad = process.platform === 'win32'
      ? 'C:\\Windows\\Coasty-Test\\nested\\file.txt'
      : '/etc/coasty-test/nested/file.txt'
    const r = await writeFile({ path: bad, content: 'hi' })
    expect(r.success).toBe(false)
    // Confirm we did NOT actually create C:\Windows\Coasty-Test
    if (process.platform !== 'win32') {
      expect(fs.existsSync('/etc/coasty-test')).toBe(false)
    }
  })
})

// ─── editFile literal vs regex semantics ────────────────────────────────────

describe('editFile regex-special characters', () => {
  it('treats $ as literal', async () => {
    const f = path.join(SANDBOX, 'edit-dollar.txt')
    await fsp.writeFile(f, 'price = $100', 'utf-8')
    const r = await editFile({ path: f, old_text: '$100', new_text: '$200' })
    expect(r.success).toBe(true)
    const back = await fsp.readFile(f, 'utf-8')
    expect(back).toBe('price = $200')
  })

  it('treats ( and ) as literal', async () => {
    const f = path.join(SANDBOX, 'edit-parens.txt')
    await fsp.writeFile(f, 'foo (bar) baz', 'utf-8')
    const r = await editFile({ path: f, old_text: '(bar)', new_text: '(qux)' })
    expect(r.success).toBe(true)
    const back = await fsp.readFile(f, 'utf-8')
    expect(back).toBe('foo (qux) baz')
  })

  it('treats backslash as literal', async () => {
    const f = path.join(SANDBOX, 'edit-backslash.txt')
    await fsp.writeFile(f, 'C:\\path\\to\\file', 'utf-8')
    const r = await editFile({ path: f, old_text: 'C:\\path', new_text: 'D:\\new' })
    expect(r.success).toBe(true)
    const back = await fsp.readFile(f, 'utf-8')
    expect(back).toBe('D:\\new\\to\\file')
  })

  it('returns failure when old_text not found', async () => {
    const f = path.join(SANDBOX, 'edit-missing.txt')
    await fsp.writeFile(f, 'hello', 'utf-8')
    const r = await editFile({ path: f, old_text: 'goodbye', new_text: 'hi' })
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/not found/i)
  })

  it('replaces only the FIRST occurrence by default (back-compat)', async () => {
    // FIXED (P2-03): default behaviour preserved — first-occurrence-only,
    // and the response now reports `replacements: 1`.
    const f = path.join(SANDBOX, 'edit-multi.txt')
    await fsp.writeFile(f, 'foo foo foo', 'utf-8')
    const r = await editFile({ path: f, old_text: 'foo', new_text: 'bar' })
    expect(r.success).toBe(true)
    expect(r.replacements).toBe(1)
    const back = await fsp.readFile(f, 'utf-8')
    expect(back).toBe('bar foo foo')
  })

  it('replaces ALL occurrences when all=true (P2-03 fix)', async () => {
    const f = path.join(SANDBOX, 'edit-multi-all.txt')
    await fsp.writeFile(f, 'foo foo foo', 'utf-8')
    const r = await editFile({ path: f, old_text: 'foo', new_text: 'bar', all: true })
    expect(r.success).toBe(true)
    expect(r.replacements).toBe(3)
    const back = await fsp.readFile(f, 'utf-8')
    expect(back).toBe('bar bar bar')
  })

  it('all=true reports replacements=1 when the substring appears once', async () => {
    const f = path.join(SANDBOX, 'edit-once-all.txt')
    await fsp.writeFile(f, 'lonely', 'utf-8')
    const r = await editFile({ path: f, old_text: 'lonely', new_text: 'happy', all: true })
    expect(r.success).toBe(true)
    expect(r.replacements).toBe(1)
    const back = await fsp.readFile(f, 'utf-8')
    expect(back).toBe('happy')
  })

  it('all=true with regex-special chars replaces literally', async () => {
    const f = path.join(SANDBOX, 'edit-all-special.txt')
    await fsp.writeFile(f, '$x $x $x', 'utf-8')
    const r = await editFile({ path: f, old_text: '$x', new_text: '$y', all: true })
    expect(r.success).toBe(true)
    expect(r.replacements).toBe(3)
    const back = await fsp.readFile(f, 'utf-8')
    expect(back).toBe('$y $y $y')
  })
})

// ─── appendFile error handling ──────────────────────────────────────────────

describe('appendFile error envelope', () => {
  it('returns error when target is a directory', async () => {
    const dir = path.join(SANDBOX, 'i-am-a-dir')
    await fsp.mkdir(dir, { recursive: true })
    const r = await appendFile({ path: dir, content: 'data' })
    expect(r.success).toBe(false)
    expect(r.error).toBeDefined()
  })

  it('auto-creates missing parent directories (P2-04 fix; mirrors writeFile)', async () => {
    const target = path.join(SANDBOX, 'append-auto-parent', 'nested', 'tail.txt')
    const r = await appendFile({ path: target, content: 'first' })
    expect(r.success).toBe(true)
    // The file and its parent dirs were created on demand.
    expect(fs.existsSync(path.dirname(target))).toBe(true)
    const back1 = await fsp.readFile(target, 'utf-8')
    expect(back1).toBe('first')
    // A second append should accumulate (no truncation).
    const r2 = await appendFile({ path: target, content: '+second' })
    expect(r2.success).toBe(true)
    const back2 = await fsp.readFile(target, 'utf-8')
    expect(back2).toBe('first+second')
  })

  it('does NOT bypass validateFilePath when auto-creating parents', async () => {
    // The mkdir-recursive must run AFTER the credential check, so an
    // attacker cannot use appendFile to materialise system directories.
    const bad = process.platform === 'win32'
      ? 'C:\\Windows\\Coasty-AppendTest\\nested\\file.txt'
      : '/etc/coasty-append-test/nested/file.txt'
    const r = await appendFile({ path: bad, content: 'evil' })
    expect(r.success).toBe(false)
    if (process.platform !== 'win32') {
      expect(fs.existsSync('/etc/coasty-append-test')).toBe(false)
    }
  })
})

// ─── Concurrent writes ──────────────────────────────────────────────────────

describe('concurrent writes', () => {
  it('two simultaneous writes to the same path do not corrupt the file', async () => {
    const target = path.join(SANDBOX, 'race.txt')
    const a = 'A'.repeat(2000)
    const b = 'B'.repeat(2000)
    const [ra, rb] = await Promise.all([
      writeFile({ path: target, content: a }),
      writeFile({ path: target, content: b }),
    ])
    expect(ra.success).toBe(true)
    expect(rb.success).toBe(true)
    const back = await fsp.readFile(target, 'utf-8')
    // Last-writer-wins: contents should be ENTIRELY one of the two —
    // no interleaving or partial truncation. The length must match exactly.
    expect([a, b]).toContain(back)
    expect(back.length).toBe(2000)
  })

  it('concurrent appends produce a sum of both bytes (no lost writes)', async () => {
    const target = path.join(SANDBOX, 'append-race.txt')
    await fsp.writeFile(target, '')
    const ops: Promise<any>[] = []
    for (let i = 0; i < 10; i++) {
      ops.push(appendFile({ path: target, content: `chunk${i}\n` }))
    }
    await Promise.all(ops)
    const back = await fsp.readFile(target, 'utf-8')
    // All 10 chunks should be present, in some order
    for (let i = 0; i < 10; i++) {
      expect(back).toContain(`chunk${i}`)
    }
  })
})

// ─── Long path handling ─────────────────────────────────────────────────────

describe('long path handling', () => {
  it('writeFile fails gracefully with very long filename (>260 chars on Windows)', async () => {
    const longName = 'a'.repeat(280) + '.txt'
    const target = path.join(SANDBOX, longName)
    const r = await writeFile({ path: target, content: 'x' })
    // On Windows MAX_PATH=260 unless long-path support is enabled. The
    // call should either succeed (long-path enabled) or return an error
    // envelope (not a thrown exception).
    expect(r).toHaveProperty('success')
    if (!r.success) {
      expect(r.error).toBeDefined()
      expect(typeof r.error).toBe('string')
    }
  })

  it('readFile fails gracefully with extremely deep nested path', async () => {
    let deep = SANDBOX
    for (let i = 0; i < 50; i++) deep = path.join(deep, `level${i}`)
    const target = path.join(deep, 'file.txt')
    const r = await readFile({ path: target })
    expect(r.success).toBe(false)
  })
})

// ─── Windows reserved names — extend coverage to all CRUD ops ───────────────

describe('Windows reserved device names across CRUD', () => {
  if (process.platform !== 'win32') {
    it.skip('Windows-only', () => {})
    return
  }

  const RESERVED = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'LPT1']

  it.each(RESERVED)('writeFile blocks %s', async (name) => {
    const r = await writeFile({ path: path.join(SANDBOX, name), content: 'x' })
    expect(r.success).toBe(false)
  })

  it.each(RESERVED)('appendFile blocks %s', async (name) => {
    const r = await appendFile({ path: path.join(SANDBOX, name), content: 'x' })
    expect(r.success).toBe(false)
  })

  it.each(RESERVED)('deleteFile blocks %s', async (name) => {
    const r = await deleteFile({ path: path.join(SANDBOX, name) })
    expect(r.success).toBe(false)
  })

  it.each(RESERVED)('editFile blocks %s', async (name) => {
    const r = await editFile({ path: path.join(SANDBOX, name), old_text: 'a', new_text: 'b' })
    expect(r.success).toBe(false)
  })

  it.each(RESERVED)('reserved name with extension blocked: %s.txt', async (name) => {
    const r = await writeFile({ path: path.join(SANDBOX, `${name}.txt`), content: 'x' })
    expect(r.success).toBe(false)
  })
})

// ─── fileExists edge cases ──────────────────────────────────────────────────

describe('fileExists', () => {
  it('returns exists=false for missing file (no error)', async () => {
    const r = await fileExists({ path: path.join(SANDBOX, 'nope') })
    expect(r.success).toBe(true)
    expect(r.exists).toBe(false)
  })

  it('rejects credential probes via validateFilePath (P2-05 fix)', async () => {
    // FIXED: fileExists now runs validateFilePath('read') first, so it
    // cannot leak existence of ~/.ssh/id_rsa. The response surfaces
    // success=false (not the original true,true|false), and exists=false
    // is included so callers that key off `.exists` get a safe falsy value.
    const sshKey = path.join(os.homedir(), '.ssh', 'id_rsa')
    const r = await fileExists({ path: sshKey })
    expect(r.success).toBe(false)
    expect(r.exists).toBe(false)
    expect(r.error).toMatch(/SSH key|credential/i)
  })

  it('rejects userData/.session existence probes', async () => {
    const sessionFile = path.join(FAKE_USER_DATA, '.session')
    const r = await fileExists({ path: sessionFile })
    expect(r.success).toBe(false)
    expect(r.exists).toBe(false)
  })

  it('still works for ordinary sandbox files', async () => {
    const okFile = path.join(SANDBOX, 'fe-ok.txt')
    await fsp.writeFile(okFile, 'hi', 'utf-8')
    const r = await fileExists({ path: okFile })
    expect(r.success).toBe(true)
    expect(r.exists).toBe(true)
    expect(r.is_file).toBe(true)
    expect(r.is_directory).toBe(false)
    expect(r.size).toBe(2)
  })

  it('returns success=true, exists=false for permitted-but-missing paths', async () => {
    const r = await fileExists({ path: path.join(SANDBOX, 'definitely-missing') })
    expect(r.success).toBe(true)
    expect(r.exists).toBe(false)
  })
})

// ─── deleteDirectory recursive force ────────────────────────────────────────

describe('deleteDirectory', () => {
  it('removes a populated directory recursively', async () => {
    const dir = path.join(SANDBOX, 'rm-tree')
    await fsp.mkdir(path.join(dir, 'sub'), { recursive: true })
    await fsp.writeFile(path.join(dir, 'a.txt'), 'a', 'utf-8')
    await fsp.writeFile(path.join(dir, 'sub', 'b.txt'), 'b', 'utf-8')
    const r = await deleteDirectory({ path: dir })
    expect(r.success).toBe(true)
    expect(fs.existsSync(dir)).toBe(false)
  })

  it('returns success even for non-existent directory (force: true)', async () => {
    const r = await deleteDirectory({ path: path.join(SANDBOX, 'never-existed') })
    expect(r.success).toBe(true)
  })
})
