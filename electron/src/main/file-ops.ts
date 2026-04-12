import * as fs from 'fs/promises'
import * as path from 'path'
import { validateFilePath } from './security'

export async function readFile(params: { path: string; encoding?: string }): Promise<any> {
  try {
    const check = validateFilePath(params.path, 'read')
    if (!check.allowed) return { success: false, error: check.reason }

    const content = await fs.readFile(params.path, { encoding: (params.encoding || 'utf-8') as BufferEncoding })
    return {
      success: true,
      content: String(content).slice(0, 10000),
      path: params.path,
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

export async function editFile(params: {
  path: string
  old_text: string
  new_text: string
}): Promise<any> {
  try {
    const check = validateFilePath(params.path, 'write')
    if (!check.allowed) return { success: false, error: check.reason }

    const content = await fs.readFile(params.path, 'utf-8')
    if (!content.includes(params.old_text)) {
      return { success: false, error: 'Old text not found in file' }
    }
    const newContent = content.replace(params.old_text, params.new_text)
    await fs.writeFile(params.path, newContent, 'utf-8')
    return { success: true, path: params.path, message: 'File edited' }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function appendFile(params: { path: string; content: string }): Promise<any> {
  try {
    const check = validateFilePath(params.path, 'write')
    if (!check.allowed) return { success: false, error: check.reason }

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

export async function fileExists(params: { path: string }): Promise<any> {
  try {
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
