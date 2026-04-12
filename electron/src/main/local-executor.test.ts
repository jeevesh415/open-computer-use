import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock all external dependencies
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  app: { getPath: vi.fn(() => '/tmp/test') },
}))
vi.mock('./terminal', () => ({
  executeTerminal: vi.fn(async () => ({ success: true, output: 'ok' })),
  connectTerminal: vi.fn(async () => ({ success: true })),
  readTerminal: vi.fn(async () => ({ success: true, output: '' })),
  closeTerminal: vi.fn(async () => ({ success: true })),
  typeTerminal: vi.fn(async () => ({ success: true })),
  clearTerminal: vi.fn(async () => ({ success: true })),
}))
vi.mock('./screenshot', () => ({
  captureScreenshot: vi.fn(async () => ({ success: true, image: 'base64...' })),
}))
vi.mock('./file-ops', () => ({
  readFile: vi.fn(async (p: any) => ({ success: true, content: 'file-content' })),
  writeFile: vi.fn(async () => ({ success: true })),
  editFile: vi.fn(async () => ({ success: true })),
  appendFile: vi.fn(async () => ({ success: true })),
  deleteFile: vi.fn(async () => ({ success: true })),
  fileExists: vi.fn(async () => ({ success: true, exists: true })),
  listDirectory: vi.fn(async () => ({ success: true, entries: [] })),
  deleteDirectory: vi.fn(async () => ({ success: true })),
}))
vi.mock('./browser-automation', () => ({
  openBrowser: vi.fn(async () => ({ success: true })),
  navigateBrowser: vi.fn(async () => ({ success: true })),
  clickBrowser: vi.fn(async () => ({ success: true })),
  typeBrowser: vi.fn(async () => ({ success: true })),
  getBrowserDom: vi.fn(async () => ({ success: true, dom: '<html></html>' })),
  getBrowserClickables: vi.fn(async () => ({ success: true, elements: [] })),
  getBrowserState: vi.fn(async () => ({ success: true, url: 'about:blank' })),
  getBrowserInfo: vi.fn(async () => ({ success: true })),
  scrollBrowser: vi.fn(async () => ({ success: true })),
  closeBrowser: vi.fn(async () => ({ success: true })),
  executeBrowser: vi.fn(async () => ({ success: true })),
  waitBrowser: vi.fn(async () => ({ success: true })),
  screenshotBrowser: vi.fn(async () => ({ success: true })),
  listBrowserTabs: vi.fn(async () => ({ success: true, tabs: [] })),
  openBrowserTab: vi.fn(async () => ({ success: true })),
  closeBrowserTab: vi.fn(async () => ({ success: true })),
  switchBrowserTab: vi.fn(async () => ({ success: true })),
}))
vi.mock('./desktop-automation', () => ({
  desktopClick: vi.fn(async () => ({ success: true })),
  desktopClickWithModifiers: vi.fn(async () => ({ success: true })),
  desktopDoubleClick: vi.fn(async () => ({ success: true })),
  desktopType: vi.fn(async () => ({ success: true })),
  desktopKeyPress: vi.fn(async () => ({ success: true })),
  desktopKeyCombo: vi.fn(async () => ({ success: true })),
  desktopScroll: vi.fn(async () => ({ success: true })),
  desktopDrag: vi.fn(async () => ({ success: true })),
}))
vi.mock('./window-manager', () => ({
  hideForDesktopAction: vi.fn(async () => {}),
  showAfterDesktopAction: vi.fn(() => {}),
}))
vi.mock('./display-manager', () => ({
  getActiveDisplay: vi.fn(() => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 } })),
}))
vi.mock('child_process', () => ({
  execFile: vi.fn(),
}))

import { LocalExecutor } from './local-executor'

describe('LocalExecutor', () => {
  let executor: LocalExecutor

  beforeEach(() => {
    executor = new LocalExecutor()
  })

  describe('executeCommand', () => {
    it('returns error for unknown command', async () => {
      const result = await executor.executeCommand('nonexistent_command')
      expect(result.success).toBe(false)
      expect(result.error).toContain('Unknown command')
    })

    it('executes screenshot command', async () => {
      const result = await executor.executeCommand('screenshot')
      expect(result.success).toBe(true)
    })

    it('executes terminal_execute command', async () => {
      const result = await executor.executeCommand('terminal_execute', { command: 'ls' })
      expect(result.success).toBe(true)
    })

    it('executes file_read command', async () => {
      const result = await executor.executeCommand('file_read', { path: '/tmp/test.txt' })
      expect(result.success).toBe(true)
    })

    it('executes browser_state command', async () => {
      const result = await executor.executeCommand('browser_state')
      expect(result.success).toBe(true)
    })

    it('handles detect_elements as unsupported stub', async () => {
      const result = await executor.executeCommand('detect_elements')
      expect(result.success).toBe(false)
      expect(result.error).toContain('not available on local machines')
    })

    it('handles ocr as unsupported stub', async () => {
      const result = await executor.executeCommand('ocr')
      expect(result.success).toBe(false)
      expect(result.error).toContain('not available on local machines')
    })

    it('hides overlay before click and shows after', async () => {
      const { hideForDesktopAction, showAfterDesktopAction } = await import('./window-manager')
      await executor.executeCommand('click', { x: 100, y: 200 })
      expect(hideForDesktopAction).toHaveBeenCalled()
      expect(showAfterDesktopAction).toHaveBeenCalled()
    })

    it('catches handler exceptions and returns error', async () => {
      const { captureScreenshot } = await import('./screenshot')
      vi.mocked(captureScreenshot).mockRejectedValueOnce(new Error('Screen capture failed'))
      const result = await executor.executeCommand('screenshot')
      expect(result.success).toBe(false)
      expect(result.error).toBe('Screen capture failed')
    })

    it('handles undefined parameters gracefully', async () => {
      const result = await executor.executeCommand('screenshot', undefined)
      expect(result.success).toBe(true)
    })
  })

  describe('parameter normalization', () => {
    it('normalizes filepath to path', async () => {
      const { readFile } = await import('./file-ops')
      await executor.executeCommand('file_read', { filepath: '/tmp/test.txt' })
      expect(readFile).toHaveBeenCalledWith(expect.objectContaining({ path: '/tmp/test.txt' }))
    })

    it('normalizes find/replace to old_text/new_text', async () => {
      const { editFile } = await import('./file-ops')
      await executor.executeCommand('file_edit', {
        path: '/tmp/f.txt',
        find: 'old',
        replace: 'new',
      })
      expect(editFile).toHaveBeenCalledWith(
        expect.objectContaining({ old_text: 'old', new_text: 'new' })
      )
    })
  })

  describe('registered commands coverage', () => {
    const EXPECTED_COMMANDS = [
      'screenshot',
      'click', 'click_with_modifiers', 'double_click', 'type', 'key_press', 'key_combo', 'scroll', 'drag',
      'terminal_connect', 'terminal_execute', 'terminal_read', 'terminal_close',
      'terminal_type', 'terminal_clear', 'execute_command',
      'file_read', 'file_write', 'file_edit', 'file_exists',
      'file_append', 'file_delete', 'directory_delete',
      'directory_list',
      'browser_open', 'browser_navigate', 'browser_click', 'browser_type',
      'browser_state', 'browser_close',
      'browser_scroll', 'browser_execute', 'browser_screenshot',
      'browser_open_tab', 'browser_close_tab', 'browser_switch_tab',
      'detect_elements', 'ocr',
    ]

    for (const cmd of EXPECTED_COMMANDS) {
      it(`has handler for '${cmd}'`, async () => {
        const result = await executor.executeCommand(cmd, {})
        // If error exists, it should not be "Unknown command"
        if (result.error) {
          expect(result.error).not.toContain('Unknown command')
        } else {
          // No error means the handler was found and executed
          expect(result).toBeDefined()
        }
      })
    }
  })
})
