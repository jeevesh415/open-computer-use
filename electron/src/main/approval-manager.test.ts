import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Electron before importing the module
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
  app: {
    getPath: vi.fn(() => '/tmp/test-coasty'),
  },
}))

vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => '{}'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}))

vi.mock('./window-manager', () => ({
  bringToFront: vi.fn(),
}))

import { ApprovalManager } from './approval-manager'
import type { ApprovalMode } from './approval-manager'

describe('ApprovalManager', () => {
  let manager: ApprovalManager

  beforeEach(() => {
    manager = new ApprovalManager()
  })

  describe('getMode / setMode', () => {
    it('defaults to full_control', () => {
      expect(manager.getMode()).toBe('full_control')
    })

    it('accepts valid modes', () => {
      const modes: ApprovalMode[] = ['full_control', 'smart_approve', 'approve_all', 'off']
      for (const mode of modes) {
        manager.setMode(mode)
        expect(manager.getMode()).toBe(mode)
      }
    })

    it('ignores invalid mode', () => {
      manager.setMode('full_control')
      manager.setMode('invalid_mode' as any)
      expect(manager.getMode()).toBe('full_control')
    })
  })

  describe('shouldAutoApprove', () => {
    it('full_control: auto-approves everything', () => {
      manager.setMode('full_control')
      expect(manager.shouldAutoApprove('click')).toBe(true)
      expect(manager.shouldAutoApprove('terminal_execute')).toBe(true)
      expect(manager.shouldAutoApprove('file_write')).toBe(true)
    })

    it('off: auto-approves nothing', () => {
      manager.setMode('off')
      expect(manager.shouldAutoApprove('screenshot')).toBe(false)
      expect(manager.shouldAutoApprove('file_read')).toBe(false)
    })

    it('approve_all: auto-approves nothing (requires manual approval)', () => {
      manager.setMode('approve_all')
      expect(manager.shouldAutoApprove('screenshot')).toBe(false)
      expect(manager.shouldAutoApprove('click')).toBe(false)
    })

    it('smart_approve: auto-approves safe read-only commands', () => {
      manager.setMode('smart_approve')
      // Safe commands
      expect(manager.shouldAutoApprove('screenshot')).toBe(true)
      expect(manager.shouldAutoApprove('browser_state')).toBe(true)
      expect(manager.shouldAutoApprove('file_read')).toBe(true)
      expect(manager.shouldAutoApprove('file_exists')).toBe(true)
      expect(manager.shouldAutoApprove('directory_list')).toBe(true)
      expect(manager.shouldAutoApprove('browser_get_dom')).toBe(true)
      // Unsafe commands
      expect(manager.shouldAutoApprove('click')).toBe(false)
      expect(manager.shouldAutoApprove('type')).toBe(false)
      expect(manager.shouldAutoApprove('terminal_execute')).toBe(false)
      expect(manager.shouldAutoApprove('file_write')).toBe(false)
      expect(manager.shouldAutoApprove('file_delete')).toBe(false)
    })

    it('smart_approve: covers all 17 safe commands', () => {
      manager.setMode('smart_approve')
      const allSafe = [
        'screenshot', 'browser_screenshot', 'browser_state', 'browser_info',
        'browser_get_dom', 'browser_get_clickables', 'browser_get_context',
        'browser_dom', 'file_read', 'file_exists', 'directory_list',
        'file_list_downloads', 'file_download', 'terminal_read',
        'terminal_connect', 'list_windows', 'browser_list_tabs',
      ]
      for (const cmd of allSafe) {
        expect(manager.shouldAutoApprove(cmd)).toBe(true)
      }
    })

    it('smart_approve: rejects all write/destructive commands', () => {
      manager.setMode('smart_approve')
      const unsafe = [
        'click', 'double_click', 'type', 'key_press', 'key_combo',
        'scroll', 'drag', 'terminal_execute', 'file_write', 'file_edit',
        'file_delete', 'browser_navigate', 'browser_click', 'browser_type',
        'browser_open', 'browser_close',
      ]
      for (const cmd of unsafe) {
        expect(manager.shouldAutoApprove(cmd)).toBe(false)
      }
    })
  })

  describe('isDenyAll', () => {
    it('returns true only for off mode', () => {
      manager.setMode('off')
      expect(manager.isDenyAll()).toBe(true)
    })

    it('returns false for other modes', () => {
      for (const mode of ['full_control', 'smart_approve', 'approve_all'] as ApprovalMode[]) {
        manager.setMode(mode)
        expect(manager.isDenyAll()).toBe(false)
      }
    })
  })
})
