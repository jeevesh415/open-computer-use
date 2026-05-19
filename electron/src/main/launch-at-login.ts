import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

/**
 * Persistent launch-at-login preference.
 *
 * Why this exists: previously the app called
 *   `app.setLoginItemSettings({ openAtLogin: true })`
 * unconditionally on every packaged-build startup. That had three problems:
 *
 *  1. The user couldn't ever opt OUT — even after disabling startup via Task
 *     Manager, the next launch re-registered the entry.
 *  2. Default-on persistence is a fingerprint Windows AV products and EDR
 *     behavioural monitors flag (Trojan.Persistence, Kaspersky's
 *     "Ransomware-like behaviour", Defender's startup-folder heuristic).
 *  3. macOS / Linux behaviour wasn't consistent — opt-in is the platform
 *     convention there too.
 *
 * The new contract is opt-in:
 *   - Fresh install         → preference = false (no auto-launch)
 *   - Existing user with    → seed preference from current OS state on first
 *     auto-launch already     read (so we don't yank it from under them on
 *     enabled by old code     upgrade), then respect the user's choice
 *                             going forward.
 *
 * Stored as JSON at `<userData>/launch-at-login.json`.
 */

const CONFIG_FILE = 'launch-at-login.json'

interface LaunchPreference {
  enabled: boolean
  /** Schema version for future migrations. */
  version: 1
}

class LaunchAtLogin {
  private configPath: string
  private cached: LaunchPreference | null = null

  constructor() {
    this.configPath = path.join(app.getPath('userData'), CONFIG_FILE)
  }

  /**
   * Read the persisted preference, seeding from current OS state on first
   * read. Returns false on any I/O / JSON / Electron API error — failing
   * closed (no auto-launch) is the safer default for an AV-sensitive app.
   */
  getEnabled(): boolean {
    if (this.cached) return this.cached.enabled

    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, 'utf-8')
        const parsed = JSON.parse(raw)
        if (typeof parsed?.enabled === 'boolean') {
          this.cached = { enabled: parsed.enabled, version: 1 }
          return this.cached.enabled
        }
      }
    } catch {
      // fall through to seeding
    }

    // First read — seed from the current OS state so existing users who had
    // the previous "always-on" behaviour don't lose it on upgrade. Wrapped
    // in try/catch because Electron's getLoginItemSettings can throw on
    // some Linux WMs / locked-down Windows environments.
    let seed = false
    try {
      seed = !!app.getLoginItemSettings().openAtLogin
    } catch {
      seed = false
    }

    this.cached = { enabled: seed, version: 1 }
    this.persist()
    return seed
  }

  /**
   * Persist the user's choice and apply it to the OS immediately. Errors
   * from setLoginItemSettings are swallowed — the persisted preference is
   * the source of truth and `applyOnStartup` will retry on next launch.
   */
  setEnabled(enabled: boolean): void {
    this.cached = { enabled: !!enabled, version: 1 }
    this.persist()
    this.applyToOS(this.cached.enabled)
  }

  /**
   * Apply the persisted preference to the OS. Called once at app startup
   * from the main process. If the user enabled auto-launch via Task Manager
   * but our preference says false, this turns it off (matching user intent).
   */
  applyOnStartup(): void {
    if (!app.isPackaged) return  // never register dev builds for auto-launch
    const enabled = this.getEnabled()
    this.applyToOS(enabled)
  }

  private applyToOS(enabled: boolean): void {
    try {
      app.setLoginItemSettings({ openAtLogin: enabled })
    } catch {
      // OS-level failures are non-fatal; the preference is still persisted
      // and we'll retry on next launch.
    }
  }

  private persist(): void {
    if (!this.cached) return
    try {
      fs.mkdirSync(path.dirname(this.configPath), { recursive: true })
      fs.writeFileSync(
        this.configPath,
        JSON.stringify(this.cached, null, 2),
        'utf-8',
      )
    } catch {
      // disk full / permission denied — preference will revert next launch
    }
  }
}

export const launchAtLogin = new LaunchAtLogin()
