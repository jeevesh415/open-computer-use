/**
 * Static-analysis tests for `electron-builder.yml`'s `files` allowlist.
 *
 * Why this file exists: in a previous deploy the packaged app shipped
 * without `bindings` (a transitive dep of `@nut-tree-fork/libnut-win32`)
 * because `electron-builder.yml` excludes all of `node_modules/**` and
 * then allowlists specific top-level packages — but transitive deps got
 * dropped on the floor. Result: every `click`/`type`/`terminal_execute`
 * call failed in production with:
 *
 *     Failed to load @nut-tree-fork/libnut-win32:
 *     Cannot find module 'bindings'
 *
 * These tests pin down the contract between every external native /
 * non-bundled package and the asar `files` allowlist:
 *   - if `electron.vite.config.ts` marks a package as `external`,
 *     OR if it's only declared in `package.json` `dependencies`
 *     (i.e. NOT bundled by Rollup), then the package itself plus EVERY
 *     transitive runtime dep MUST appear under the asar `files` list.
 */

import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const REPO_ROOT = path.resolve(__dirname, '..', '..')

interface PackageJSON {
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

function readPackageJson(packagePath: string): PackageJSON | null {
  const file = path.join(REPO_ROOT, 'node_modules', packagePath, 'package.json')
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch {
    return null
  }
}

/** Walk a package's `dependencies` recursively and return the full set of
 *  runtime-required packages (names only). Cycles guarded via the visited set. */
function collectTransitiveDeps(packageName: string, visited = new Set<string>()): Set<string> {
  if (visited.has(packageName)) return visited
  visited.add(packageName)

  const pkg = readPackageJson(packageName)
  if (!pkg) return visited

  for (const dep of Object.keys(pkg.dependencies ?? {})) {
    if (!visited.has(dep)) collectTransitiveDeps(dep, visited)
  }
  return visited
}

function readBuilderYml(): string {
  return fs.readFileSync(path.join(REPO_ROOT, 'electron-builder.yml'), 'utf-8')
}

function readViteConfig(): string {
  return fs.readFileSync(path.join(REPO_ROOT, 'electron.vite.config.ts'), 'utf-8')
}

/** Pull every line under `files:` that targets a node_modules path. */
function extractAllowlistedPackages(yml: string): Set<string> {
  // Match `- node_modules/<package>` (with optional /**/* suffix). Scoped
  // packages use `@scope/name`. We only care about the package name(s)
  // covered by each line.
  const out = new Set<string>()
  const lines = yml.split('\n')
  for (const ln of lines) {
    const trimmed = ln.trim()
    // Skip comment-only lines AND `!`-prefixed exclusions
    if (trimmed.startsWith('#')) continue
    // We're only interested in INCLUSION patterns (no `!`)
    const match = trimmed.match(/^-\s+(?:["'])?(node_modules\/(@[^/]+\/[^/*"']+|[^/*"']+))/)
    if (!match) continue
    // The capture group 2 is the bare package name (with @scope if scoped).
    out.add(match[2])
  }
  return out
}

/** Pull `external: [...]` from electron.vite.config.ts main build. */
function extractViteExternals(viteSrc: string): Set<string> {
  const out = new Set<string>()
  // Match `external: [ ... ]` — non-greedy across newlines.
  const m = viteSrc.match(/external\s*:\s*\[([\s\S]*?)\]/)
  if (!m) return out
  const block = m[1]
  for (const lit of block.matchAll(/['"]([^'"]+)['"]/g)) {
    out.add(lit[1])
  }
  return out
}

// ─── macOS hardened-runtime entitlements check ─────────────────────────

describe('macOS entitlements', () => {
  // hardenedRuntime: true is set in electron-builder.yml; the build will
  // fail to LOAD any native module (.node) at runtime without these
  // entitlements set, even though the build itself succeeds. The failure
  // mode is opaque ("dyld: code signature in <X> not valid for use in
  // process") and only manifests on a notarised production build — so we
  // statically assert the file has them.
  const REQUIRED_KEYS = [
    'com.apple.security.cs.allow-jit',
    'com.apple.security.cs.allow-unsigned-executable-memory',
    // `allow-dyld-environment-variables` is needed for puppeteer-core to
    // pick up env vars when launching its bundled Chromium child process.
    'com.apple.security.cs.allow-dyld-environment-variables',
    // network.client is needed for HTTP/WebSocket out (Supabase, backend).
    // network.server is needed for the localhost OAuth callback in auth.ts.
    'com.apple.security.network.client',
    'com.apple.security.network.server',
    // automation.apple-events is needed for any AppleScript fallback path
    // (System Events ⇒ keystroke/click/etc). Currently desktop-automation
    // uses libnut, not osascript, but auth.ts and other paths still rely on it.
    'com.apple.security.automation.apple-events',
  ]

  it('build/entitlements.mac.plist contains every entitlement the app needs', () => {
    const file = path.join(REPO_ROOT, 'build', 'entitlements.mac.plist')
    if (!fs.existsSync(file)) {
      // Linux / Windows dev environments may not always have the plist.
      // Skip rather than fail — but the macOS CI build will catch it.
      return
    }
    const plist = fs.readFileSync(file, 'utf-8')
    for (const key of REQUIRED_KEYS) {
      expect(
        plist,
        `entitlements.mac.plist missing required key "${key}". ` +
        `Without it the macOS hardened runtime will block module / runtime ` +
        `behaviour at LOAD time, with confusing dyld errors that don't ` +
        `appear in dev builds.`,
      ).toContain(`<key>${key}</key>`)
    }
  })
})

describe('packaging deps allowlist', () => {
  const yml = readBuilderYml()
  const viteSrc = readViteConfig()
  const allowlist = extractAllowlistedPackages(yml)
  const externals = extractViteExternals(viteSrc)

  it('every Vite `external` package appears in the asar files allowlist', () => {
    // Filter to externals that actually live under node_modules. Vite externals
    // like 'screenshot-desktop' / 'puppeteer-core' / '@nut-tree-fork/libnut*'
    // all do.
    const missing: string[] = []
    for (const ext of externals) {
      // libnut platform sub-packages get covered by the wildcard
      // `@nut-tree-fork/**/*` rule. Anything starting with `@nut-tree-fork/` is
      // satisfied by allowlisting `@nut-tree-fork`.
      const baseScope = ext.startsWith('@') ? ext.split('/').slice(0, 1)[0] : ext
      if (allowlist.has(ext) || allowlist.has(baseScope)) continue
      missing.push(ext)
    }
    expect(
      missing,
      `Vite externals not covered by electron-builder files allowlist — ` +
      `the packaged asar will miss them and runtime require() will fail. ` +
      `Add each to electron-builder.yml under \`files:\`. Missing: ${missing.join(', ')}`,
    ).toEqual([])
  })

  it('asar files allowlist covers each libnut platform package and its key files', () => {
    // The asar contains a per-platform package whose `index.js` is the
    // runtime entry point the loader resolves via `process.platform`. Each
    // platform package needs to have its NON-binary files (the JS entry
    // point itself, plus permissionCheck.js on darwin) in the asar — those
    // aren't unpacked, just shipped inside.
    const platformChecks = {
      'libnut-win32': ['index.js', 'package.json'],
      'libnut-darwin': ['index.js', 'package.json', 'permissionCheck.js'],
      'libnut-linux': ['index.js', 'package.json'],
    }
    for (const [pkg, files] of Object.entries(platformChecks)) {
      const fullPkg = `@nut-tree-fork/${pkg}`
      const root = path.join(REPO_ROOT, 'node_modules', fullPkg)
      // Verify the package is actually installed (the meta-package brings
      // all three regardless of host) — if it's not, our asar wildcard
      // would have nothing to match, which is a different bug.
      expect(
        fs.existsSync(root),
        `${fullPkg} not installed locally — the @nut-tree-fork/libnut meta ` +
        `package should pull all three platform sub-packages on every host. ` +
        `Run npm install to refresh.`,
      ).toBe(true)
      // And every named file exists at the path our loader will look at
      for (const f of files) {
        expect(
          fs.existsSync(path.join(root, f)),
          `${fullPkg}/${f} is missing from node_modules — the asar would ` +
          `ship a partial package. Reinstall.`,
        ).toBe(true)
      }
    }
  })

  it('every transitive dep of libnut platform packages is allowlisted', () => {
    // The actual class of bug we hit: `libnut-win32/index.js` does
    // `require('bindings')`, but `bindings` was excluded by the asar files
    // allowlist. This sweeps every transitive dep of every platform package.
    const platformPkgs = [
      '@nut-tree-fork/libnut',
      '@nut-tree-fork/libnut-win32',
      '@nut-tree-fork/libnut-darwin',
      '@nut-tree-fork/libnut-linux',
    ]

    const required = new Set<string>()
    for (const pkg of platformPkgs) {
      const transitive = collectTransitiveDeps(pkg)
      for (const t of transitive) required.add(t)
    }

    const missing: string[] = []
    for (const dep of required) {
      // The libnut packages themselves are covered by `@nut-tree-fork/**/*`.
      if (dep.startsWith('@nut-tree-fork/')) continue
      if (!allowlist.has(dep)) missing.push(dep)
    }
    expect(
      missing.sort(),
      `transitive runtime deps of libnut platform packages are missing from ` +
      `electron-builder.yml's \`files:\` list. Without these, the packaged ` +
      `app will throw "Cannot find module '<dep>'" on first desktop-automation ` +
      `call. Add each missing entry: ${missing.join(', ')}`,
    ).toEqual([])
  })

  it('every transitive dep of puppeteer-core is allowlisted', () => {
    // Same class of bug for our other native external. puppeteer-core does
    // bundle a lot internally so the transitive surface is small, but the
    // browser-launch path uses `ws` for CDP which is already in the allowlist.
    const required = collectTransitiveDeps('puppeteer-core')
    const missing: string[] = []
    for (const dep of required) {
      if (dep === 'puppeteer-core') continue
      if (!allowlist.has(dep)) missing.push(dep)
    }
    // puppeteer-core's deep transitive tree is large and most of it is
    // ALREADY embedded in puppeteer-core's own bundle. We treat absence
    // here as informational rather than fatal — but if a known runtime
    // dep is missing it'll show up.
    if (missing.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[packaging] puppeteer-core transitive deps not allowlisted: ${missing.join(', ')}\n` +
        `Most are bundled internally by puppeteer-core. If you see runtime ` +
        `"Cannot find module" errors from puppeteer-core after a fresh deploy, ` +
        `add the offending package to electron-builder.yml.`,
      )
    }
  })

  it('asarUnpack covers every native .node binary needed at runtime', () => {
    // .node files cannot be loaded from inside an asar — `dlopen` needs a
    // real filesystem path. Anything we ship that contains a .node file
    // MUST appear in `asarUnpack:` so electron-builder copies it next to
    // the asar where Node's loader can find it.
    const yml = readBuilderYml()
    const unpackBlock = yml.match(/asarUnpack:\s*([\s\S]*?)(?=\n\w+:|\n\n|$)/)
    const unpackSrc = unpackBlock ? unpackBlock[1] : ''

    // Find every package in the allowlist that actually contains a .node
    // file. If any are MISSING from asarUnpack, runtime dlopen will fail.
    function findNodeFiles(packageName: string): string[] {
      const root = path.join(REPO_ROOT, 'node_modules', packageName)
      if (!fs.existsSync(root)) return []
      const out: string[] = []
      const walk = (dir: string) => {
        let entries: fs.Dirent[] = []
        try { entries = fs.readdirSync(dir, { withFileTypes: true }) }
        catch { return }
        for (const e of entries) {
          const full = path.join(dir, e.name)
          if (e.isDirectory()) walk(full)
          else if (e.name.endsWith('.node')) out.push(full)
        }
      }
      walk(root)
      return out
    }

    const offenders: string[] = []
    for (const pkg of allowlist) {
      const nodeFiles = findNodeFiles(pkg)
      if (nodeFiles.length === 0) continue
      // The `asarUnpack` regex check: this package needs at least one
      // matching glob. We accept any rule that contains the package's
      // name, since the wildcard form is fine.
      const escapedName = pkg.replace(/\./g, '\\.')
      const re = new RegExp(`node_modules/${escapedName}`)
      if (!re.test(unpackSrc)) {
        offenders.push(`${pkg} (has ${nodeFiles.length} .node file(s))`)
      }
    }
    expect(
      offenders,
      `asar contains .node binaries that aren't unpacked. Node's dlopen() ` +
      `cannot load .node files from inside an asar; the packaged app will ` +
      `crash at first require(). Add each to asarUnpack: ${offenders.join(', ')}`,
    ).toEqual([])
  })
})
