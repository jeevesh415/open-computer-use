/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Corner-case tests for file-ops.ts — runtime behaviour gaps not covered
 * by file-ops-security.test.ts.
 *
 * Focus: contract-edges (empty content, exact-size boundaries), POSIX error
 * mapping (EISDIR, ENOTDIR, ENOENT), idempotency, replacements count, Unicode
 * filenames, append-vs-write semantics, and exists() symlink semantics.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import * as os from 'os'
import * as path from 'path'
import * as fsp from 'fs/promises'

// Mock electron BEFORE importing file-ops (validateFilePath needs userData)
const FAKE_USER_DATA = path.join(
  os.tmpdir(),
  `coasty-file-ops-cornercases-${process.pid}-${Date.now()}`,
)

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => (name === 'userData' ? FAKE_USER_DATA : '')),
  },
}))

import {
  readFile, writeFile, editFile, appendFile, deleteFile, fileExists,
  listDirectory, deleteDirectory,
} from './file-ops'

let SANDBOX: string

beforeAll(async () => {
  SANDBOX = await fsp.mkdtemp(path.join(os.tmpdir(), 'coasty-fileops-cc-'))
  await fsp.mkdir(FAKE_USER_DATA, { recursive: true })
})

afterAll(async () => {
  await fsp.rm(SANDBOX, { recursive: true, force: true }).catch(() => {})
  await fsp.rm(FAKE_USER_DATA, { recursive: true, force: true }).catch(() => {})
})

// ════════════════════════════════════════════════════════════════════════
// 1. readFile boundaries
// ════════════════════════════════════════════════════════════════════════

describe('readFile boundaries', () => {
  it('exactly 10000 chars → not truncated, full content returned', async () => {
    const p = path.join(SANDBOX, 'exact-10k.txt')
    const content = 'X'.repeat(10_000)
    await fsp.writeFile(p, content, 'utf-8')
    const r = await readFile({ path: p })
    expect(r.success).toBe(true)
    expect(r.truncated).toBe(false)
    expect(r.content.length).toBe(10_000)
    expect(r.size).toBe(10_000)
  })

  it('exactly 10001 chars → truncated, size reflects original', async () => {
    const p = path.join(SANDBOX, 'over-10k.txt')
    await fsp.writeFile(p, 'Y'.repeat(10_001), 'utf-8')
    const r = await readFile({ path: p })
    expect(r.success).toBe(true)
    expect(r.truncated).toBe(true)
    expect(r.content.length).toBe(10_000)
    expect(r.size).toBe(10_001)
  })

  it('empty file → success with empty content, truncated=false', async () => {
    const p = path.join(SANDBOX, 'empty.txt')
    await fsp.writeFile(p, '', 'utf-8')
    const r = await readFile({ path: p })
    expect(r.success).toBe(true)
    expect(r.content).toBe('')
    expect(r.truncated).toBe(false)
    expect(r.size).toBe(0)
  })

  it('non-existent file → error envelope', async () => {
    const r = await readFile({ path: path.join(SANDBOX, 'no-such-file.txt') })
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/ENOENT|no such file/i)
  })

  it('reading a directory (EISDIR) → error envelope, not crash', async () => {
    const dir = path.join(SANDBOX, 'a-dir')
    await fsp.mkdir(dir, { recursive: true })
    const r = await readFile({ path: dir })
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/EISDIR|illegal operation/i)
  })

  it('Unicode filename and Unicode content round-trip', async () => {
    const p = path.join(SANDBOX, 'café-🚀.txt')
    const content = 'héllo 世界 🌍'
    await fsp.writeFile(p, content, 'utf-8')
    const r = await readFile({ path: p })
    expect(r.success).toBe(true)
    expect(r.content).toBe(content)
  })
})

// ════════════════════════════════════════════════════════════════════════
// 2. writeFile semantics
// ════════════════════════════════════════════════════════════════════════

describe('writeFile semantics', () => {
  it('empty content → creates 0-byte file', async () => {
    const p = path.join(SANDBOX, 'subdir', 'empty-write.txt')
    const r = await writeFile({ path: p, content: '' })
    expect(r.success).toBe(true)
    const stat = await fsp.stat(p)
    expect(stat.size).toBe(0)
  })

  it('auto-creates deeply nested parent dirs', async () => {
    const p = path.join(SANDBOX, 'deep', 'a', 'b', 'c', 'leaf.txt')
    const r = await writeFile({ path: p, content: 'hi' })
    expect(r.success).toBe(true)
    expect((await fsp.readFile(p, 'utf-8'))).toBe('hi')
  })

  it('overwrite existing file replaces content (not appends)', async () => {
    const p = path.join(SANDBOX, 'overwrite.txt')
    await fsp.writeFile(p, 'old content here', 'utf-8')
    const r = await writeFile({ path: p, content: 'new' })
    expect(r.success).toBe(true)
    expect((await fsp.readFile(p, 'utf-8'))).toBe('new')
  })

  it('parent path is a regular file (not directory) → error envelope', async () => {
    const blocker = path.join(SANDBOX, 'blocker.txt')
    await fsp.writeFile(blocker, 'i am a file', 'utf-8')
    const r = await writeFile({ path: path.join(blocker, 'child.txt'), content: 'x' })
    expect(r.success).toBe(false)
    // Win: ENOENT/ENOTDIR; POSIX: ENOTDIR or similar
    expect(r.error).toMatch(/ENOTDIR|ENOENT|EEXIST|already exists|file/i)
  })
})

// ════════════════════════════════════════════════════════════════════════
// 3. editFile semantics
// ════════════════════════════════════════════════════════════════════════

describe('editFile semantics', () => {
  it('all=true with multiple matches → reports correct replacement count', async () => {
    const p = path.join(SANDBOX, 'edit-all.txt')
    await fsp.writeFile(p, 'foo bar foo baz foo', 'utf-8')
    const r = await editFile({ path: p, old_text: 'foo', new_text: 'qux', all: true })
    expect(r.success).toBe(true)
    expect(r.replacements).toBe(3)
    expect((await fsp.readFile(p, 'utf-8'))).toBe('qux bar qux baz qux')
  })

  it('all=false replaces only first occurrence; replacements=1', async () => {
    const p = path.join(SANDBOX, 'edit-first.txt')
    await fsp.writeFile(p, 'foo foo foo', 'utf-8')
    const r = await editFile({ path: p, old_text: 'foo', new_text: 'X' })
    expect(r.success).toBe(true)
    expect(r.replacements).toBe(1)
    expect((await fsp.readFile(p, 'utf-8'))).toBe('X foo foo')
  })

  it('old_text not found → success=false with deterministic error', async () => {
    const p = path.join(SANDBOX, 'edit-nofound.txt')
    await fsp.writeFile(p, 'hello world', 'utf-8')
    const r = await editFile({ path: p, old_text: 'absent-string', new_text: 'X' })
    expect(r.success).toBe(false)
    expect(r.error).toBe('Old text not found in file')
  })

  it('all=true with old_text===new_text is idempotent (file content unchanged)', async () => {
    const p = path.join(SANDBOX, 'edit-noop.txt')
    await fsp.writeFile(p, 'foo foo foo', 'utf-8')
    const r = await editFile({ path: p, old_text: 'foo', new_text: 'foo', all: true })
    expect(r.success).toBe(true)
    expect(r.replacements).toBe(3)
    expect((await fsp.readFile(p, 'utf-8'))).toBe('foo foo foo')
  })

  it('regex-special chars in old_text are treated literally (not as patterns)', async () => {
    const p = path.join(SANDBOX, 'edit-regex.txt')
    // String#replace treats first arg as literal string (not regex) when given a string
    await fsp.writeFile(p, 'price: $9.99 (sale)', 'utf-8')
    const r = await editFile({ path: p, old_text: '$9.99', new_text: '$0.00' })
    expect(r.success).toBe(true)
    expect((await fsp.readFile(p, 'utf-8'))).toBe('price: $0.00 (sale)')
  })

  it('edit on non-existent file → error envelope', async () => {
    const p = path.join(SANDBOX, 'no-such-file-edit.txt')
    const r = await editFile({ path: p, old_text: 'x', new_text: 'y' })
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/ENOENT|no such file/i)
  })

  it('multi-line old_text spans newlines correctly', async () => {
    const p = path.join(SANDBOX, 'edit-multiline.txt')
    await fsp.writeFile(p, 'line1\nline2\nline3', 'utf-8')
    const r = await editFile({ path: p, old_text: 'line1\nline2', new_text: 'X' })
    expect(r.success).toBe(true)
    expect((await fsp.readFile(p, 'utf-8'))).toBe('X\nline3')
  })
})

// ════════════════════════════════════════════════════════════════════════
// 4. appendFile semantics
// ════════════════════════════════════════════════════════════════════════

describe('appendFile semantics', () => {
  it('two sequential appends concatenate (do not overwrite)', async () => {
    const p = path.join(SANDBOX, 'append-seq.txt')
    await appendFile({ path: p, content: 'A' })
    await appendFile({ path: p, content: 'B' })
    await appendFile({ path: p, content: 'C' })
    expect((await fsp.readFile(p, 'utf-8'))).toBe('ABC')
  })

  it('append empty string is a no-op (file size unchanged)', async () => {
    const p = path.join(SANDBOX, 'append-empty.txt')
    await fsp.writeFile(p, 'original', 'utf-8')
    const r = await appendFile({ path: p, content: '' })
    expect(r.success).toBe(true)
    expect((await fsp.readFile(p, 'utf-8'))).toBe('original')
  })

  it('append to non-existent file creates it', async () => {
    const p = path.join(SANDBOX, 'subdir-append', 'new.txt')
    const r = await appendFile({ path: p, content: 'first' })
    expect(r.success).toBe(true)
    expect((await fsp.readFile(p, 'utf-8'))).toBe('first')
  })
})

// ════════════════════════════════════════════════════════════════════════
// 5. deleteFile EISDIR + ENOENT
// ════════════════════════════════════════════════════════════════════════

describe('deleteFile error mapping', () => {
  it('non-existent path → error envelope (not silent)', async () => {
    const r = await deleteFile({ path: path.join(SANDBOX, 'never-existed.txt') })
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/ENOENT|no such file/i)
  })

  it('path is a directory → EISDIR-style error (deleteFile is for files only)', async () => {
    const dir = path.join(SANDBOX, 'delete-me-dir')
    await fsp.mkdir(dir, { recursive: true })
    const r = await deleteFile({ path: dir })
    expect(r.success).toBe(false)
    // POSIX: EISDIR / EPERM; Windows: EPERM/EISDIR
    expect(r.error).toMatch(/EISDIR|EPERM|operation not permitted|illegal/i)
  })

  it('successful delete is idempotent in the sense that second call errors cleanly', async () => {
    const p = path.join(SANDBOX, 'delete-once.txt')
    await fsp.writeFile(p, 'tmp', 'utf-8')
    const r1 = await deleteFile({ path: p })
    expect(r1.success).toBe(true)
    const r2 = await deleteFile({ path: p })
    expect(r2.success).toBe(false)
  })
})

// ════════════════════════════════════════════════════════════════════════
// 6. fileExists shape
// ════════════════════════════════════════════════════════════════════════

describe('fileExists shape', () => {
  it('existing file → exists:true, is_file:true, is_directory:false, size set', async () => {
    const p = path.join(SANDBOX, 'exists-file.txt')
    await fsp.writeFile(p, 'hello', 'utf-8')
    const r = await fileExists({ path: p })
    expect(r.success).toBe(true)
    expect(r.exists).toBe(true)
    expect(r.is_file).toBe(true)
    expect(r.is_directory).toBe(false)
    expect(r.size).toBe(5)
  })

  it('existing directory → exists:true, is_directory:true, is_file:false', async () => {
    const dir = path.join(SANDBOX, 'exists-dir')
    await fsp.mkdir(dir, { recursive: true })
    const r = await fileExists({ path: dir })
    expect(r.success).toBe(true)
    expect(r.exists).toBe(true)
    expect(r.is_file).toBe(false)
    expect(r.is_directory).toBe(true)
  })

  it('non-existent path → exists:false (NOT an error)', async () => {
    const r = await fileExists({ path: path.join(SANDBOX, 'nonexistent.xyz') })
    expect(r.success).toBe(true)
    expect(r.exists).toBe(false)
    // Must NOT include is_file / is_directory keys for missing files
    expect(r.is_file).toBeUndefined()
  })
})

// ════════════════════════════════════════════════════════════════════════
// 7. listDirectory shape
// ════════════════════════════════════════════════════════════════════════

describe('listDirectory shape', () => {
  it('empty directory → success:true, items:[], count:0', async () => {
    const dir = path.join(SANDBOX, 'empty-dir')
    await fsp.mkdir(dir, { recursive: true })
    const r = await listDirectory({ path: dir })
    expect(r.success).toBe(true)
    expect(r.items).toEqual([])
    expect(r.count).toBe(0)
  })

  it('file path passed instead of directory → ENOTDIR-style error', async () => {
    const p = path.join(SANDBOX, 'a-file.txt')
    await fsp.writeFile(p, 'x', 'utf-8')
    const r = await listDirectory({ path: p })
    expect(r.success).toBe(false)
    // Win: ENOTDIR; some platforms: ENOENT
    expect(r.error).toMatch(/ENOTDIR|ENOENT|not a directory/i)
  })

  it('mixed files + subdirectories tagged correctly', async () => {
    const dir = path.join(SANDBOX, 'mixed-dir')
    await fsp.mkdir(dir, { recursive: true })
    await fsp.writeFile(path.join(dir, 'file.txt'), 'x', 'utf-8')
    await fsp.mkdir(path.join(dir, 'sub'), { recursive: true })
    const r = await listDirectory({ path: dir })
    expect(r.success).toBe(true)
    expect(r.count).toBe(2)
    const file = r.items.find((i: any) => i.name === 'file.txt')
    const sub = r.items.find((i: any) => i.name === 'sub')
    expect(file.type).toBe('file')
    expect(sub.type).toBe('directory')
  })

  it('Unicode filenames preserved exactly (no mojibake)', async () => {
    const dir = path.join(SANDBOX, 'unicode-dir')
    await fsp.mkdir(dir, { recursive: true })
    await fsp.writeFile(path.join(dir, 'café.txt'), 'x', 'utf-8')
    await fsp.writeFile(path.join(dir, 'emoji-🚀.txt'), 'x', 'utf-8')
    const r = await listDirectory({ path: dir })
    expect(r.success).toBe(true)
    const names = r.items.map((i: any) => i.name).sort()
    expect(names).toContain('café.txt')
    expect(names).toContain('emoji-🚀.txt')
  })
})

// ════════════════════════════════════════════════════════════════════════
// 8. deleteDirectory semantics
// ════════════════════════════════════════════════════════════════════════

describe('deleteDirectory semantics', () => {
  it('deleting non-existent dir is success (force:true)', async () => {
    const r = await deleteDirectory({ path: path.join(SANDBOX, 'never-existed-dir') })
    expect(r.success).toBe(true)
  })

  it('removes nested tree recursively', async () => {
    const dir = path.join(SANDBOX, 'tree-root')
    await fsp.mkdir(path.join(dir, 'a', 'b', 'c'), { recursive: true })
    await fsp.writeFile(path.join(dir, 'a', 'file.txt'), 'x', 'utf-8')
    await fsp.writeFile(path.join(dir, 'a', 'b', 'c', 'deep.txt'), 'y', 'utf-8')
    const r = await deleteDirectory({ path: dir })
    expect(r.success).toBe(true)
    const stillExists = await fsp.access(dir).then(() => true).catch(() => false)
    expect(stillExists).toBe(false)
  })

  it('passing a file path (not directory) — fs.rm with force:true treats it as success', async () => {
    // This documents current behaviour: fs.rm(file, { force: true, recursive: true }) succeeds
    // and removes the file. If a stricter contract is wanted later, change here.
    const p = path.join(SANDBOX, 'lone-file-for-deldir.txt')
    await fsp.writeFile(p, 'x', 'utf-8')
    const r = await deleteDirectory({ path: p })
    expect(r.success).toBe(true)
    const stillExists = await fsp.access(p).then(() => true).catch(() => false)
    expect(stillExists).toBe(false)
  })
})
