import * as fs from 'fs/promises'
import * as path from 'path'
import { validateFilePath } from './security'

// reports truncated/size so callers can detect partial reads (10KB cap)
export async function readFile(params: { path: string; encoding?: string }): Promise<any> {
  try {
    const check = validateFilePath(params.path, 'read')
    if (!check.allowed) return { success: false, error: check.reason }

    const raw = String(
      await fs.readFile(params.path, { encoding: (params.encoding || 'utf-8') as BufferEncoding }),
    )
    const truncated = raw.length > 10000
    return {
      success: true,
      content: raw.slice(0, 10000),
      path: params.path,
      truncated,
      size: raw.length,
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function writeFile(params: { path: string; content: string }): Promise<any> {
  try {
    const check = validateFilePath(params.path, 'write')
    if (!check.allowed) return { success: false, error: check.reason }

    // Ensure parent directory exists
    await fs.mkdir(path.dirname(params.path), { recursive: true })
    await fs.writeFile(params.path, params.content, 'utf-8')
    return { success: true, path: params.path, message: 'File written' }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

// supports global replace via `all`; reports replacements count
export async function editFile(params: {
  path: string
  old_text: string
  new_text: string
  all?: boolean
}): Promise<any> {
  try {
    const check = validateFilePath(params.path, 'write')
    if (!check.allowed) return { success: false, error: check.reason }

    const content = await fs.readFile(params.path, 'utf-8')
    if (!content.includes(params.old_text)) {
      return { success: false, error: 'Old text not found in file' }
    }

    let newContent: string
    let replacements: number
    if (params.all) {
      // String#replaceAll: literal-string replace, no regex semantics — Electron 40 (Node ≥18) supports this.
      newContent = content.replaceAll(params.old_text, params.new_text)
      replacements = content.split(params.old_text).length - 1
    } else {
      newContent = content.replace(params.old_text, params.new_text)
      replacements = 1
    }

    await fs.writeFile(params.path, newContent, 'utf-8')
    return { success: true, path: params.path, message: 'File edited', replacements }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

// auto-creates parent dirs to mirror writeFile semantics
export async function appendFile(params: { path: string; content: string }): Promise<any> {
  try {
    const check = validateFilePath(params.path, 'write')
    if (!check.allowed) return { success: false, error: check.reason }

    await fs.mkdir(path.dirname(params.path), { recursive: true })
    await fs.appendFile(params.path, params.content, 'utf-8')
    return { success: true, path: params.path, message: 'Content appended' }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function deleteFile(params: { path: string }): Promise<any> {
  try {
    const check = validateFilePath(params.path, 'delete')
    if (!check.allowed) return { success: false, error: check.reason }

    await fs.unlink(params.path)
    return { success: true, path: params.path, message: 'File deleted' }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

// validates path against credential allowlist before probing existence
export async function fileExists(params: { path: string }): Promise<any> {
  try {
    const check = validateFilePath(params.path, 'read')
    if (!check.allowed) return { success: false, error: check.reason, exists: false }

    await fs.access(params.path)
    const stat = await fs.stat(params.path)
    return {
      success: true,
      exists: true,
      is_file: stat.isFile(),
      is_directory: stat.isDirectory(),
      size: stat.size,
    }
  } catch {
    return { success: true, exists: false }
  }
}

export async function listDirectory(params: { path: string }): Promise<any> {
  try {
    const check = validateFilePath(params.path, 'read')
    if (!check.allowed) return { success: false, error: check.reason }

    const entries = await fs.readdir(params.path, { withFileTypes: true })
    const items = entries.map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? 'directory' : 'file',
      path: path.join(params.path, entry.name),
    }))
    return { success: true, items, path: params.path, count: items.length }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function deleteDirectory(params: { path: string }): Promise<any> {
  try {
    const check = validateFilePath(params.path, 'delete')
    if (!check.allowed) return { success: false, error: check.reason }

    await fs.rm(params.path, { recursive: true, force: true })
    return { success: true, path: params.path, message: 'Directory deleted' }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}
