import { executeTerminal, connectTerminal, readTerminal, closeTerminal, typeTerminal, clearTerminal } from './terminal'
import { captureScreenshot } from './screenshot'
import {
  readFile, writeFile, editFile, appendFile, deleteFile, fileExists,
  listDirectory, deleteDirectory,
} from './file-ops'
import {
  openBrowser, navigateBrowser, clickBrowser, typeBrowser,
  getBrowserDom, getBrowserClickables, getBrowserState,
  getBrowserInfo, scrollBrowser, closeBrowser,
  executeBrowser, waitBrowser, screenshotBrowser,
  listBrowserTabs, openBrowserTab, closeBrowserTab, switchBrowserTab,
} from './browser-automation'
import {
  desktopClick, desktopClickWithModifiers, desktopDoubleClick, desktopType,
  desktopKeyPress, desktopKeyCombo, desktopScroll, desktopDrag,
} from './desktop-automation'
import { hideForDesktopAction, showAfterDesktopAction } from './window-manager'
import { getActiveDisplay } from './display-manager'
import { execFile } from 'child_process'
import { BrowserWindow } from 'electron'

type CommandHandler = (params: any) => Promise<any>

/** Run a shell command and parse its output into a result object. */
function runShellForResult(opts: {
  cmd: string
  args: string[]
  parse: (stdout: string) => any
  env?: Record<string, string>
}): Promise<any> {
  return new Promise((resolve) => {
    execFile(opts.cmd, opts.args, {
      timeout: 8000,
      env: opts.env ? { ...process.env, ...opts.env } : undefined,
    }, (error, stdout) => {
      if (error) {
        resolve({ success: false, error: error.message })
        return
      }
      try {
        resolve(opts.parse(stdout))
      } catch {
        resolve({ success: true, output: stdout.trim() })
      }
    })
  })
}

export class LocalExecutor {
  private handlers: Map<string, CommandHandler> = new Map()

  constructor() {
    this.registerHandlers()
  }

  async executeCommand(command: string, parameters: any = {}): Promise<any> {
    const handler = this.handlers.get(command)
    if (!handler) {
      console.warn(`[LocalExecutor] Unknown command: ${command}`)
      return { success: false, error: `Unknown command: ${command}` }
    }

    try {
      // Normalize parameters before passing to handler
      const normalized = this.normalizeParams(command, parameters)
      return await handler(normalized)
    } catch (error: any) {
      return {
        success: false,
        error: error.message || String(error),
      }
    }
  }

  /**
   * Normalize parameter names from backend format to handler format.
   * Backend sends: filepath, dirpath, find, replace
   * Handlers expect: path, old_text, new_text
   */
  private normalizeParams(command: string, params: any): any {
    const p = { ...params }

    // File operations: filepath → path
    if (p.filepath !== undefined && p.path === undefined) {
      p.path = p.filepath
    }
    // Directory operations: dirpath → path
    if (p.dirpath !== undefined && p.path === undefined) {
      p.path = p.dirpath
    }
    // File edit: find/replace → old_text/new_text
    if (p.find !== undefined && p.old_text === undefined) {
      p.old_text = p.find
    }
    if (p.replace !== undefined && p.new_text === undefined) {
      p.new_text = p.replace
    }
    // Tab management: tab_index → index
    if (p.tab_index !== undefined && p.index === undefined) {
      p.index = p.tab_index
    }

    // Multi-display coordinate offset: the backend sends coordinates relative
    // to the captured display, but desktop automation APIs use global screen
    // coordinates that span all monitors. Offset by the active display's origin
    // so clicks/drags/scrolls land on the correct screen.
    //
    // Defence-in-depth: ALWAYS coerce coordinate fields to Number, even when
    // offset is (0, 0). This prevents non-numeric strings (e.g. shell injection
    // payloads) from reaching desktop-automation functions. The automation layer
    // also validates with validateInt(), but early coercion here ensures NaN
    // propagates rather than a raw string.
    const COORD_COMMANDS = new Set(['click', 'click_with_modifiers', 'double_click', 'scroll', 'drag'])
    if (COORD_COMMANDS.has(command)) {
      // Unconditional type coercion — turns injection strings into NaN
      for (const field of ['x', 'y', 'x1', 'y1', 'x2', 'y2'] as const) {
        if (p[field] !== undefined) p[field] = Number(p[field])
      }
      if (p.clicks !== undefined) p.clicks = Number(p.clicks)

      // Apply display offset for multi-monitor setups
      const { x: ox, y: oy } = getActiveDisplay().bounds
      if (ox !== 0 || oy !== 0) {
        if (p.x !== undefined) p.x += ox
        if (p.y !== undefined) p.y += oy
        if (p.x1 !== undefined) p.x1 += ox
        if (p.y1 !== undefined) p.y1 += oy
        if (p.x2 !== undefined) p.x2 += ox
        if (p.y2 !== undefined) p.y2 += oy
      }
    }

    return p
  }

  /**
   * Wrap a handler so the overlay becomes invisible and click-through before
   * the action, then fades back in after. Uses opacity + setIgnoreMouseEvents
   * instead of win.hide()/show() for a seamless, glitch-free experience.
   */
  private withOverlayHidden(handler: CommandHandler): CommandHandler {
    return async (params) => {
      await hideForDesktopAction()
      try {
        const result = await handler(params)

        // If a desktop action was denied due to missing macOS permissions,
        // notify the renderer so it can show an in-app prompt to the user.
        if (result?.permissionDenied) {
          const win = BrowserWindow.getAllWindows()[0]
          if (win && !win.isDestroyed()) {
            win.webContents.send('permission:denied', {
              type: result.permissionType,
              message: result.error,
            })
          }
        }

        return result
      } finally {
        showAfterDesktopAction()
      }
    }
  }

  private registerHandlers(): void {
    // ========================
    // DESKTOP / SCREENSHOT
    // ========================
    this.handlers.set('screenshot', () => captureScreenshot())

    // Desktop mouse — hide overlay so clicks don't hit it
    this.handlers.set('click', this.withOverlayHidden((p) => desktopClick(p)))
    this.handlers.set('click_with_modifiers', this.withOverlayHidden((p) => desktopClickWithModifiers(p)))
    this.handlers.set('double_click', this.withOverlayHidden((p) => desktopDoubleClick(p)))

    // Desktop keyboard — hide overlay so it can't steal focus
    this.handlers.set('type', this.withOverlayHidden((p) => desktopType(p)))
    this.handlers.set('key_press', this.withOverlayHidden((p) => desktopKeyPress(p)))
    this.handlers.set('key_combo', this.withOverlayHidden((p) => desktopKeyCombo(p)))

    // Desktop scroll and drag — hide overlay so it can't intercept
    this.handlers.set('scroll', this.withOverlayHidden((p) => desktopScroll(p)))
    this.handlers.set('drag', this.withOverlayHidden((p) => desktopDrag(p)))

    // Stubs for VM-only features
    this.handlers.set('detect_elements', async () => ({
      success: false,
      error: 'Element detection is not available on local machines. Use screenshot + AI analysis instead.',
    }))
    this.handlers.set('ocr', async () => ({
      success: false,
      error: 'OCR is not available on local machines. Use screenshot + AI analysis instead.',
    }))

    // ========================
    // TERMINAL
    // ========================
    this.handlers.set('terminal_connect', (p) => connectTerminal(p))
    this.handlers.set('terminal_execute', (p) => executeTerminal(p))
    this.handlers.set('terminal_read', (p) => readTerminal(p))
    this.handlers.set('terminal_type', (p) => typeTerminal(p))
    this.handlers.set('terminal_clear', (p) => clearTerminal(p))
    this.handlers.set('terminal_close', (p) => closeTerminal(p))
    // Deprecated alias
    this.handlers.set('execute_command', (p) => executeTerminal(p))

    // ========================
    // FILE OPERATIONS
    // ========================
    this.handlers.set('file_read', (p) => readFile(p))
    this.handlers.set('file_write', (p) => writeFile(p))
    this.handlers.set('file_edit', (p) => editFile(p))
    this.handlers.set('file_append', (p) => appendFile(p))
    this.handlers.set('file_delete', (p) => deleteFile(p))
    this.handlers.set('file_exists', (p) => fileExists(p))
    this.handlers.set('directory_list', (p) => listDirectory(p))
    this.handlers.set('directory_delete', (p) => deleteDirectory(p))
    // file_upload → same as file_write for local machine
    this.handlers.set('file_upload', (p) => writeFile(p))
    // file_download → same as file_read for local machine
    this.handlers.set('file_download', (p) => readFile(p))
    // file_list_downloads → same as directory_list for local machine
    this.handlers.set('file_list_downloads', (p) => listDirectory(p))

    // ========================
    // BROWSER AUTOMATION
    // ========================
    this.handlers.set('browser_open', (p) => openBrowser(p))
    this.handlers.set('browser_connect', (p) => openBrowser(p)) // alias: connect = open for local
    this.handlers.set('browser_navigate', (p) => navigateBrowser(p))
    this.handlers.set('browser_click', (p) => clickBrowser(p))
    this.handlers.set('browser_type', (p) => typeBrowser(p))
    this.handlers.set('browser_get_dom', (p) => getBrowserDom(p))
    this.handlers.set('browser_dom', (p) => getBrowserDom(p)) // alias used by backend tool name
    this.handlers.set('browser_get_clickables', (p) => getBrowserClickables(p))
    this.handlers.set('browser_state', (p) => getBrowserState(p))
    this.handlers.set('browser_info', (p) => getBrowserInfo(p))
    this.handlers.set('browser_get_context', (p) => getBrowserState(p)) // context = state for local
    this.handlers.set('browser_scroll', (p) => scrollBrowser(p))
    this.handlers.set('browser_close', (p) => closeBrowser(p))

    // Browser JS execution
    this.handlers.set('browser_execute', (p) => executeBrowser(p))

    // Browser screenshot (prefer page screenshot, fall back to desktop)
    this.handlers.set('browser_screenshot', async () => {
      const result = await screenshotBrowser()
      if (result) return result
      return captureScreenshot() // Fallback to desktop screenshot
    })

    // Browser wait (proper element/text polling with timeout)
    this.handlers.set('browser_wait', (p) => waitBrowser(p))

    // Browser tab management
    this.handlers.set('browser_list_tabs', () => listBrowserTabs())
    this.handlers.set('browser_open_tab', (p) => openBrowserTab(p))
    this.handlers.set('browser_close_tab', (p) => closeBrowserTab(p))
    this.handlers.set('browser_switch_tab', (p) => switchBrowserTab(p))

    // ========================
    // WINDOW MANAGEMENT
    // ========================
    this.handlers.set('list_windows', async () => {
      return runShellForResult(
        process.platform === 'win32'
          ? {
            cmd: 'powershell.exe',
            args: ['-NoProfile', '-Command',
              'Get-Process | Where-Object { $_.MainWindowTitle -ne "" } | Select-Object Id, MainWindowTitle | ConvertTo-Json'],
            parse: (stdout: string) => {
              const windows = JSON.parse(stdout || '[]')
              const list = (Array.isArray(windows) ? windows : [windows]).map((w: any) => ({
                id: String(w.Id),
                title: w.MainWindowTitle,
              }))
              return { success: true, windows: list, count: list.length }
            },
          }
          : process.platform === 'linux'
            ? {
              cmd: '/bin/bash',
              args: ['-c', 'wmctrl -l 2>/dev/null || xdotool search --name "" getwindowname %@ 2>/dev/null'],
              parse: (stdout: string) => {
                const lines = stdout.trim().split('\n').filter(Boolean)
                const windows = lines.map((line, i) => ({
                  id: String(i),
                  title: line.split(/\s+/).slice(3).join(' ') || line,
                }))
                return { success: true, windows, count: windows.length }
              },
            }
            : {
              cmd: '/usr/bin/osascript',
              args: ['-e', 'tell application "System Events" to get name of every window of every process whose visible is true'],
              parse: (stdout: string) => {
                const titles = stdout.split(',').map(s => s.trim()).filter(Boolean)
                const windows = titles.map((title, i) => ({ id: String(i), title }))
                return { success: true, windows, count: windows.length }
              },
            },
      )
    })

    this.handlers.set('switch_to_window', this.withOverlayHidden(async (p) => {
      const title = p.window || p.title || ''
      if (!title) return { success: false, error: 'No window title specified' }
      // Pass title via environment variable to avoid shell injection.
      // Env vars are out-of-band — they never go through shell parsing.
      const env = { _COASTY_WIN_TITLE: title }
      return runShellForResult(
        process.platform === 'win32'
          ? {
            cmd: 'powershell.exe',
            args: ['-NoProfile', '-Command',
              `$t = $env:_COASTY_WIN_TITLE; ` +
              `$w = Get-Process | Where-Object { $_.MainWindowTitle -like "*$t*" } | Select-Object -First 1; ` +
              `if ($w) { [void][System.Reflection.Assembly]::LoadWithPartialName("Microsoft.VisualBasic"); ` +
              `[Microsoft.VisualBasic.Interaction]::AppActivate($w.Id); "Switched" } else { "Not found" }`],
            parse: (stdout: string) => ({
              success: stdout.trim().includes('Switched'),
              message: stdout.trim().includes('Switched') ? `Switched to "${title}"` : `Window "${title}" not found`,
            }),
            env,
          }
          : process.platform === 'linux'
            ? {
              cmd: '/bin/bash',
              args: ['-c', 'wmctrl -a "$_COASTY_WIN_TITLE" 2>/dev/null && echo OK || xdotool search --name "$_COASTY_WIN_TITLE" windowactivate 2>/dev/null && echo OK'],
              parse: (stdout: string) => ({
                success: stdout.includes('OK'),
                message: stdout.includes('OK') ? `Switched to "${title}"` : `Window "${title}" not found`,
              }),
              env,
            }
            : {
              cmd: '/usr/bin/osascript',
              args: ['-e', 'tell application "System Events" to set frontmost of (first process whose name contains (system attribute "_COASTY_WIN_TITLE")) to true'],
              parse: () => ({ success: true, message: `Switched to "${title}"` }),
              env,
            },
      )
    }))

    this.handlers.set('arrange_windows', async (p) => {
      return { success: true, message: `Window arrangement: ${p.arrangement || 'tile'} (not yet implemented)` }
    })
    this.handlers.set('move_window', async (p) => {
      return { success: true, message: `Window move to (${p.x}, ${p.y}) (not yet implemented)` }
    })

    // Window operations: close, minimize, maximize, restore
    const windowOp = async (op: string) => {
      if (process.platform === 'win32') {
        const psMap: Record<string, string> = {
          close: 'Stop-Process -Id (Get-Process | Where-Object { $_.MainWindowHandle -eq [System.Diagnostics.Process]::GetCurrentProcess().MainWindowHandle }).Id',
          minimize: 'Add-Type -Name Win -Namespace Native -MemberDefinition \'[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);\'; $h = (Get-Process | Sort-Object -Property StartTime -Descending | Where-Object { $_.MainWindowTitle -ne "" } | Select-Object -First 1).MainWindowHandle; [Native.Win]::ShowWindow($h, 6)',
          maximize: 'Add-Type -Name Win -Namespace Native -MemberDefinition \'[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);\'; $h = (Get-Process | Sort-Object -Property StartTime -Descending | Where-Object { $_.MainWindowTitle -ne "" } | Select-Object -First 1).MainWindowHandle; [Native.Win]::ShowWindow($h, 3)',
          restore: 'Add-Type -Name Win -Namespace Native -MemberDefinition \'[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);\'; $h = (Get-Process | Sort-Object -Property StartTime -Descending | Where-Object { $_.MainWindowTitle -ne "" } | Select-Object -First 1).MainWindowHandle; [Native.Win]::ShowWindow($h, 9)',
        }
        if (psMap[op]) {
          return runShellForResult({
            cmd: 'powershell.exe',
            args: ['-NoProfile', '-Command', psMap[op]],
            parse: () => ({ success: true, message: `Window ${op} executed` }),
          })
        }
      }
      return { success: true, message: `Window ${op} (limited support on this platform)` }
    }

    this.handlers.set('close_window', () => windowOp('close'))
    this.handlers.set('minimize_window', () => windowOp('minimize'))
    this.handlers.set('maximize_window', () => windowOp('maximize'))
    this.handlers.set('restore_window', () => windowOp('restore'))
  }
}
