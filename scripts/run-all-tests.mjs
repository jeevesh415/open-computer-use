#!/usr/bin/env node
// =============================================================================
// Coasty — Pre-Deployment Test Suite (Cross-Platform Node.js)
//
// Runs the FULL local test surface across frontend (vitest), backend (pytest),
// and electron (vitest). Explicitly EXCLUDES tests/post_deploy/** which is the
// live-environment smoke suite that must run only after deployment.
//
// Works on Windows, macOS, and Linux without bash or PowerShell dependency.
//
// Usage:
//   node scripts/run-all-tests.mjs            # EVERYTHING: frontend + backend
//                                             #   + electron (vitest) + electron
//                                             #   e2e (Playwright) + typecheck
//   node scripts/run-all-tests.mjs --no-e2e   # all unit surfaces, skip e2e
//                                             #   (fast iteration path)
//   node scripts/run-all-tests.mjs --parallel # all unit surfaces in parallel;
//                                             #   e2e still runs sequentially
//   node scripts/run-all-tests.mjs frontend   # only frontend (vitest)
//   node scripts/run-all-tests.mjs backend    # only backend (pytest)
//   node scripts/run-all-tests.mjs electron   # only electron (vitest)
//   node scripts/run-all-tests.mjs e2e        # only electron real-runtime Playwright
//   node scripts/run-all-tests.mjs smoke      # only packaged-app smoke test
//   node scripts/run-all-tests.mjs typecheck  # only TypeScript type check
//   node scripts/run-all-tests.mjs discover   # list all test files (no run)
//
// Flags (any combination):
//   --parallel    run unit surfaces in parallel
//   --with-e2e    append e2e to a single-surface filter (e.g. ``electron --with-e2e``)
//   --no-e2e      skip e2e when filter=all (fast path)
//
// Env vars:
//   SKIP_E2E_BUILD=1   reuse existing ``electron/out/`` instead of rebuilding
//
// Excluded by design:
//   - tests/post_deploy/**   (live-environment smoke; run only against a
//                             deployed instance via tests/post_deploy/run.sh)
//   - electron smoke test    (needs ``npm run package`` first — too slow
//                             to auto-trigger; invoke ``test:smoke`` explicitly)
// =============================================================================

import { execSync, spawn } from "child_process"
import { existsSync, readdirSync, statSync } from "fs"
import { resolve, join, relative } from "path"
import { fileURLToPath } from "url"

const __dirname = fileURLToPath(new URL(".", import.meta.url))
const ROOT = resolve(__dirname, "..")
const isWin = process.platform === "win32"

const argv = process.argv.slice(2)
const parallel = argv.includes("--parallel")
// ``--with-e2e`` is kept as an explicit opt-in for callers that pin to it.
// Under the new defaults it's redundant for filter=all (e2e is already in
// the matrix) but it remains the right knob if you want e2e appended onto
// a single-surface run like ``electron --with-e2e``.
const withE2E = argv.includes("--with-e2e")
// ``--no-e2e`` is the fast-iteration escape hatch. Skips the ~30s electron
// build + ~3min Playwright matrix and runs only the unit suites.
const skipE2E = argv.includes("--no-e2e")
const filter = argv.find((a) => !a.startsWith("--")) || "all"

const results = []
let failed = false

// ── Color helpers ────────────────────────────────────────────────────────────

const CYAN = "\x1b[36m"
const GREEN = "\x1b[32m"
const RED = "\x1b[31m"
const YELLOW = "\x1b[33m"
const GRAY = "\x1b[90m"
const BOLD = "\x1b[1m"
const RESET = "\x1b[0m"

function banner(text) {
  console.log()
  console.log(`${CYAN}${BOLD}${"═".repeat(64)}${RESET}`)
  console.log(`${CYAN}${BOLD}  ${text}${RESET}`)
  console.log(`${CYAN}${BOLD}${"═".repeat(64)}${RESET}`)
  console.log()
}

// ── Synchronous suite runner (sequential mode) ───────────────────────────────

function run(name, command, cwd) {
  console.log(`${YELLOW}▶ Running ${name}...${RESET}`)
  console.log(`${GRAY}  $ ${command}${RESET}`)
  console.log(`${GRAY}  cwd: ${relative(ROOT, cwd) || "."}${RESET}`)
  const start = Date.now()
  try {
    execSync(command, {
      cwd,
      stdio: "inherit",
      shell: true,
      env: { ...process.env, FORCE_COLOR: "1" },
    })
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    console.log(`${GREEN}✓ ${name} passed (${elapsed}s)${RESET}\n`)
    results.push({ name, passed: true, elapsed })
  } catch {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    console.log(`${RED}✗ ${name} FAILED (${elapsed}s)${RESET}\n`)
    results.push({ name, passed: false, elapsed })
    failed = true
  }
}

// ── Parallel runner — capture output and stream prefixed ─────────────────────

function runParallel(name, command, cwd, color) {
  return new Promise((resolveP) => {
    console.log(`${YELLOW}▶ Spawning ${name}...${RESET}`)
    const start = Date.now()
    const child = spawn(command, {
      cwd,
      shell: true,
      env: { ...process.env, FORCE_COLOR: "1" },
    })
    const tag = `${color}[${name}]${RESET} `
    const prefix = (data) => {
      const lines = data.toString().split("\n")
      for (const line of lines) {
        if (line.length > 0) process.stdout.write(`${tag}${line}\n`)
      }
    }
    child.stdout.on("data", prefix)
    child.stderr.on("data", prefix)
    child.on("exit", (code) => {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1)
      const passed = code === 0
      if (passed) {
        console.log(`${GREEN}✓ ${name} passed (${elapsed}s)${RESET}`)
      } else {
        console.log(`${RED}✗ ${name} FAILED (${elapsed}s, exit ${code})${RESET}`)
        failed = true
      }
      results.push({ name, passed, elapsed })
      resolveP()
    })
  })
}

// ── Test file discovery (transparency) ───────────────────────────────────────

/** Recursively walk a directory and yield matching files. */
function* walk(dir, predicate, skipDirs = new Set()) {
  let entries
  try { entries = readdirSync(dir) } catch { return }
  for (const name of entries) {
    if (skipDirs.has(name)) continue
    const full = join(dir, name)
    let st
    try { st = statSync(full) } catch { continue }
    if (st.isDirectory()) {
      yield* walk(full, predicate, skipDirs)
    } else if (predicate(full)) {
      yield full
    }
  }
}

const SKIP_DIRS = new Set([
  "node_modules", ".next", "out", "dist", "build", "coverage",
  "venv", ".venv", "__pycache__", ".git", ".pytest_cache",
])

function discoverFrontend() {
  return [...walk(
    join(ROOT, "tests"),
    (f) => /\.(test|spec)\.tsx?$/.test(f) && !f.includes("post_deploy"),
    SKIP_DIRS,
  )]
}
function discoverElectron() {
  return [...walk(
    join(ROOT, "electron", "src"),
    (f) => /\.(test|spec)\.tsx?$/.test(f),
    SKIP_DIRS,
  )]
}
function discoverBackend() {
  return [...walk(
    join(ROOT, "backend", "tests"),
    (f) => /^test_.*\.py$/.test(f.split(/[\\/]/).pop()),
    SKIP_DIRS,
  )]
}
function discoverPostDeploy() {
  return [...walk(
    join(ROOT, "tests", "post_deploy"),
    (f) => /^test_.*\.py$/.test(f.split(/[\\/]/).pop()),
    SKIP_DIRS,
  )]
}

function summarizeDiscovery() {
  const fe = discoverFrontend()
  const el = discoverElectron()
  const be = discoverBackend()
  const pd = discoverPostDeploy()

  console.log(`${GRAY}  Frontend test files:    ${fe.length.toString().padStart(3)}${RESET}`)
  console.log(`${GRAY}  Electron test files:    ${el.length.toString().padStart(3)}${RESET}`)
  console.log(`${GRAY}  Backend test files:     ${be.length.toString().padStart(3)}${RESET}`)
  console.log(`${GRAY}  Post-deploy (excluded): ${pd.length.toString().padStart(3)}${RESET}`)
  console.log()

  // Drift detection: surface anything suspicious
  const checks = [
    { label: "post-deploy .test.ts contamination",
      files: [...walk(join(ROOT, "tests", "post_deploy"), (f) => /\.test\.tsx?$/.test(f))] },
    { label: ".tsx test files (currently unused — verify intent)",
      files: [...walk(ROOT, (f) => f.endsWith(".test.tsx"), SKIP_DIRS)] },
  ]
  for (const c of checks) {
    if (c.files.length > 0) {
      console.log(`${YELLOW}  ⚠ ${c.label}: ${c.files.length} file(s)${RESET}`)
      for (const f of c.files) console.log(`${YELLOW}     ${relative(ROOT, f)}${RESET}`)
    }
  }
  return { fe, el, be, pd }
}

// ── Python venv plumbing ─────────────────────────────────────────────────────

function pythonCmd() {
  if (isWin) return "python"
  try {
    execSync("python3 --version", { stdio: "ignore" })
    return "python3"
  } catch {
    return "python"
  }
}
function withVenv() {
  const venvBin = isWin
    ? join(ROOT, "backend", "venv", "Scripts")
    : join(ROOT, "backend", "venv", "bin")
  if (existsSync(venvBin)) {
    const sep = isWin ? ";" : ":"
    process.env.PATH = venvBin + sep + process.env.PATH
    return true
  }
  return false
}

// ── Main ─────────────────────────────────────────────────────────────────────

banner("TEST DISCOVERY")
const inventory = summarizeDiscovery()

if (filter === "discover") {
  console.log(`${BOLD}Frontend (vitest @ root):${RESET}`)
  for (const f of inventory.fe) console.log(`  ${relative(ROOT, f)}`)
  console.log(`\n${BOLD}Electron (vitest @ electron/):${RESET}`)
  for (const f of inventory.el) console.log(`  ${relative(ROOT, f)}`)
  console.log(`\n${BOLD}Backend (pytest @ backend/):${RESET}`)
  for (const f of inventory.be) console.log(`  ${relative(ROOT, f)}`)
  console.log(`\n${BOLD}Post-deploy (NOT run by test:all):${RESET}`)
  for (const f of inventory.pd) console.log(`  ${relative(ROOT, f)}`)
  process.exit(0)
}

const wantFrontend = filter === "all" || filter === "frontend"
const wantBackend = filter === "all" || filter === "backend"
const wantElectron = filter === "all" || filter === "electron"
const wantTypecheck = filter === "all" || filter === "typecheck"
// ``e2e`` runs the Playwright real-Electron specs in electron/e2e/. The
// suite needs a built ``electron/out/main/index.js`` first — handled below
// by ensureElectronBuild().
//
// Defaults:
//   filter=all           → e2e included (unless ``--no-e2e``)
//   filter=e2e           → only e2e
//   filter=<other>       → e2e off unless ``--with-e2e`` is also passed
//
// We include e2e by default in ``test:all`` because "all" should mean all —
// otherwise users have to learn that there's a hidden release-gating suite
// they're missing.
const wantE2E =
  filter === "e2e" ||
  (filter === "all" && !skipE2E) ||
  (filter !== "all" && withE2E)
// ``smoke`` boots the packaged unpacked binary under electron/dist/. Unlike
// e2e, this is NOT auto-built — the user must have already run
// ``npm run package`` because building installers takes minutes.
const wantSmoke = filter === "smoke"

if (parallel && filter === "all") {
  banner("RUNNING ALL SUITES IN PARALLEL")

  const venvOk = withVenv()
  if (!venvOk && wantBackend) {
    console.log(`${YELLOW}  ⚠ backend/venv not found — backend tests may fail${RESET}\n`)
  }
  const py = pythonCmd()
  await Promise.all([
    runParallel("frontend",  "npx vitest run --reporter=verbose", ROOT, CYAN),
    runParallel("electron",  "npx vitest run --reporter=verbose", join(ROOT, "electron"), GREEN),
    runParallel("backend",   `${py} -m pytest tests/ -v --tb=short`, join(ROOT, "backend"), YELLOW),
  ])
  if (wantTypecheck) {
    await runParallel("typecheck", "npx tsc --noEmit", ROOT, GRAY)
  }
} else {
  if (wantFrontend) {
    banner("FRONTEND TESTS (Vitest)")
    run("Frontend Unit Tests", "npx vitest run --reporter=verbose", ROOT)
  }
  if (wantBackend) {
    banner("BACKEND TESTS (pytest)")
    const venvOk = withVenv()
    if (!venvOk) {
      console.log(`${YELLOW}  ⚠ backend/venv not found — using system Python${RESET}\n`)
    }
    const py = pythonCmd()
    run("Backend Unit & Integration Tests",
        `${py} -m pytest tests/ -v --tb=short`,
        join(ROOT, "backend"))
  }
  if (wantElectron) {
    banner("ELECTRON TESTS (Vitest)")
    run("Electron Unit Tests", "npx vitest run --reporter=verbose", join(ROOT, "electron"))
  }
  if (wantTypecheck) {
    banner("TYPE CHECKING")
    run("TypeScript Type Check", "npx tsc --noEmit", ROOT)
  }
}

// ── Electron e2e (real-runtime Playwright) ───────────────────────────────────
//
// Independent of the parallel/sequential split above — e2e is always
// sequential (Playwright workers=1 in playwright.config.ts) and must run
// AFTER the build step that produces electron/out/main/index.js.
//
// Auto-build is opt-out via SKIP_E2E_BUILD=1 (useful when you've already
// built and just want fast re-runs of the spec layer).

function ensureElectronBuild() {
  const mainEntry = join(ROOT, "electron", "out", "main", "index.js")
  if (existsSync(mainEntry) && process.env.SKIP_E2E_BUILD === "1") {
    console.log(`${GRAY}  SKIP_E2E_BUILD=1 set — using existing build at ${relative(ROOT, mainEntry)}${RESET}`)
    return
  }
  if (existsSync(mainEntry)) {
    console.log(`${GRAY}  Existing build found — rebuilding for fresh e2e state.${RESET}\n` +
                `${GRAY}  (set SKIP_E2E_BUILD=1 to skip)${RESET}`)
  }
  run("Electron Build (for e2e)", "npm run build", join(ROOT, "electron"))
}

if (wantE2E) {
  banner("ELECTRON E2E TESTS (Playwright + real Electron)")
  ensureElectronBuild()
  // Only continue if the build succeeded — otherwise Playwright fails with
  // an unhelpful "Cannot find module out/main/index.js" error from inside
  // Electron itself.
  if (!failed) {
    run(
      "Electron E2E (real-runtime)",
      "npx playwright test --config=playwright.config.ts",
      join(ROOT, "electron"),
    )
  } else {
    console.log(`${YELLOW}  Skipping e2e — build failed above.${RESET}`)
  }
}

if (wantSmoke) {
  banner("ELECTRON SMOKE TEST (packaged binary)")
  run(
    "Electron Smoke (packaged)",
    "node ./scripts/smoke-packaged.mjs",
    join(ROOT, "electron"),
  )
}

// ── Summary ──────────────────────────────────────────────────────────────────

banner("TEST RESULTS SUMMARY")
for (const r of results) {
  const icon = r.passed ? `${GREEN}✓` : `${RED}✗`
  const status = r.passed ? "passed" : "FAILED"
  console.log(`  ${icon} ${r.name.padEnd(34)} — ${status} (${r.elapsed}s)${RESET}`)
}
console.log()

if (failed) {
  console.log(`${RED}${BOLD}Some test suites failed. Fix issues before deploying.${RESET}`)
  process.exit(1)
} else {
  console.log(`${GREEN}${BOLD}All test suites passed!${RESET}`)
  console.log(`${GRAY}Note: tests/post_deploy/** is excluded by design — run it against a deployed environment with bash tests/post_deploy/run.sh${RESET}`)
  process.exit(0)
}
