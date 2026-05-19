/**
 * Tests for the launch-at-login opt-in preference module.
 *
 * Critical regressions guarded:
 *   - Fresh install MUST NOT auto-enable login launch (was the AV-flagged
 *     default before the opt-in refactor).
 *   - Existing users with auto-launch already enabled keep it on upgrade
 *     (we seed from current OS state on first read).
 *   - User's choice persists across restarts.
 *   - Disabling via setEnabled(false) actually un-registers the OS entry,
 *     not just the preference file (regression: the old code called
 *     setLoginItemSettings({ openAtLogin: true }) on every startup, which
 *     made user opt-out impossible).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

// vi.hoisted runs before module imports, so we can't reference `path`/`os`
// in here directly. Defer tmpDir creation to beforeEach instead — keep this
// hoisted block to bare state that doesn't need Node modules.
const h = vi.hoisted(() => ({
  tmpDir: '',  // populated in beforeEach
  isPackaged: true,
  osLoginEnabled: false,
  setLoginItemSettingsCalls: [] as Array<{ openAtLogin: boolean }>,
  setLoginItemSettingsThrows: false,
  getLoginItemSettingsThrows: false,
}))

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return h.tmpDir
      throw new Error(`unexpected getPath: ${name}`)
    },
    get isPackaged() { return h.isPackaged },
    getLoginItemSettings: vi.fn(() => {
      if (h.getLoginItemSettingsThrows) throw new Error('OS error')
      return { openAtLogin: h.osLoginEnabled }
    }),
    setLoginItemSettings: vi.fn((opts: { openAtLogin: boolean }) => {
      if (h.setLoginItemSettingsThrows) throw new Error('OS error')
      h.setLoginItemSettingsCalls.push(opts)
      h.osLoginEnabled = opts.openAtLogin
    }),
  },
}))

describe('launchAtLogin', () => {
  beforeEach(() => {
    h.tmpDir = path.join(
      os.tmpdir(),
      `coasty-launch-test-${Date.now()}-${Math.floor(Math.random() * 1e9)}`,
    )
    fs.mkdirSync(h.tmpDir, { recursive: true })
    h.osLoginEnabled = false
    h.setLoginItemSettingsCalls = []
    h.setLoginItemSettingsThrows = false
    h.getLoginItemSettingsThrows = false
    h.isPackaged = true
    vi.resetModules()
  })

  afterEach(() => {
    try { fs.rmSync(h.tmpDir, { recursive: true, force: true }) } catch { /* noop */ }
  })

  it('fresh install with OS state = false defaults to disabled', async () => {
    h.osLoginEnabled = false
    const { launchAtLogin } = await import('./launch-at-login')
    expect(launchAtLogin.getEnabled()).toBe(false)
  })

  it('fresh install seeds from existing OS state — keeps existing user on upgrade', async () => {
    // Simulates an existing user who had auto-launch enabled by the old
    // unconditional `setLoginItemSettings({ openAtLogin: true })`. After
    // upgrade their preference file doesn't exist, but the OS entry does.
    // We must NOT silently disable it.
    h.osLoginEnabled = true
    const { launchAtLogin } = await import('./launch-at-login')
    expect(launchAtLogin.getEnabled()).toBe(true)
  })

  it('persists the seeded value to disk on first read', async () => {
    h.osLoginEnabled = true
    const { launchAtLogin } = await import('./launch-at-login')
    launchAtLogin.getEnabled()  // triggers seed + write
    const file = path.join(h.tmpDir, 'launch-at-login.json')
    expect(fs.existsSync(file)).toBe(true)
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'))
    expect(parsed.enabled).toBe(true)
    expect(parsed.version).toBe(1)
  })

  it('subsequent reads use the persisted value, not the live OS state', async () => {
    // User enables, persists. Then OS state somehow drifts (e.g. user
    // disabled via Task Manager). Our persisted preference still says
    // enabled — applyOnStartup will re-apply on next launch.
    h.osLoginEnabled = true
    const mod1 = await import('./launch-at-login')
    expect(mod1.launchAtLogin.getEnabled()).toBe(true)

    // Simulate restart with different OS state
    h.osLoginEnabled = false
    vi.resetModules()
    const mod2 = await import('./launch-at-login')
    // Reads from disk (where we persisted true) — NOT from OS (false)
    expect(mod2.launchAtLogin.getEnabled()).toBe(true)
  })

  it('setEnabled(false) unregisters from the OS — opt-out works', async () => {
    h.osLoginEnabled = true  // existing user with auto-launch on
    const { launchAtLogin } = await import('./launch-at-login')

    launchAtLogin.setEnabled(false)

    expect(h.setLoginItemSettingsCalls).toContainEqual({ openAtLogin: false })
    expect(h.osLoginEnabled).toBe(false)
    expect(launchAtLogin.getEnabled()).toBe(false)
  })

  it('setEnabled(true) registers with the OS', async () => {
    const { launchAtLogin } = await import('./launch-at-login')
    launchAtLogin.setEnabled(true)
    expect(h.setLoginItemSettingsCalls).toContainEqual({ openAtLogin: true })
    expect(h.osLoginEnabled).toBe(true)
    expect(launchAtLogin.getEnabled()).toBe(true)
  })

  it('applyOnStartup re-applies persisted state to OS — closes drift', async () => {
    // Pre-seed disk with enabled=true
    fs.writeFileSync(
      path.join(h.tmpDir, 'launch-at-login.json'),
      JSON.stringify({ enabled: true, version: 1 }),
    )
    h.osLoginEnabled = false  // OS state drifted off

    const { launchAtLogin } = await import('./launch-at-login')
    launchAtLogin.applyOnStartup()

    expect(h.setLoginItemSettingsCalls).toContainEqual({ openAtLogin: true })
    expect(h.osLoginEnabled).toBe(true)
  })

  it('applyOnStartup is a no-op in dev builds (never registers persistence)', async () => {
    h.isPackaged = false
    fs.writeFileSync(
      path.join(h.tmpDir, 'launch-at-login.json'),
      JSON.stringify({ enabled: true, version: 1 }),
    )

    const { launchAtLogin } = await import('./launch-at-login')
    launchAtLogin.applyOnStartup()

    expect(h.setLoginItemSettingsCalls).toEqual([])
  })

  it('corrupt JSON on disk falls back to OS state, does not crash', async () => {
    fs.writeFileSync(path.join(h.tmpDir, 'launch-at-login.json'), '{ not valid json')
    h.osLoginEnabled = true

    const { launchAtLogin } = await import('./launch-at-login')
    expect(() => launchAtLogin.getEnabled()).not.toThrow()
    expect(launchAtLogin.getEnabled()).toBe(true)
  })

  it('JSON missing the enabled field falls back to OS state', async () => {
    fs.writeFileSync(path.join(h.tmpDir, 'launch-at-login.json'), JSON.stringify({}))
    h.osLoginEnabled = false

    const { launchAtLogin } = await import('./launch-at-login')
    expect(launchAtLogin.getEnabled()).toBe(false)
  })

  it('getLoginItemSettings throwing falls back to false (fail-closed)', async () => {
    h.getLoginItemSettingsThrows = true
    const { launchAtLogin } = await import('./launch-at-login')
    expect(launchAtLogin.getEnabled()).toBe(false)
  })

  it('setLoginItemSettings throwing does not crash setEnabled', async () => {
    h.setLoginItemSettingsThrows = true
    const { launchAtLogin } = await import('./launch-at-login')
    expect(() => launchAtLogin.setEnabled(true)).not.toThrow()
    // Preference persisted even though OS apply failed
    expect(launchAtLogin.getEnabled()).toBe(true)
  })

  it('truthy non-boolean inputs are coerced to boolean (defensive)', async () => {
    const { launchAtLogin } = await import('./launch-at-login')
    // @ts-expect-error — testing runtime coercion
    launchAtLogin.setEnabled(1)
    expect(launchAtLogin.getEnabled()).toBe(true)
    // @ts-expect-error
    launchAtLogin.setEnabled(0)
    expect(launchAtLogin.getEnabled()).toBe(false)
    // @ts-expect-error
    launchAtLogin.setEnabled('yes')
    expect(launchAtLogin.getEnabled()).toBe(true)
  })
})
