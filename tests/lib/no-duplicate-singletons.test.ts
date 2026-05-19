/**
 * Anti-regression: scan the frontend source tree for the
 * singleton-vs-instance bug class.
 *
 * # Background
 *
 * `backend/app/api/routes/file_operations.py` previously did:
 *
 *     from app.services.vm_control import VMControlService
 *     vm_control_service = VMControlService()   // ← own isolated instance
 *
 * even though `app/services/vm_control.py` exported a canonical
 * singleton.  Result: in the split deployment, file requests landing on a
 * non-owner replica went through the duplicate instance with empty
 * `connections` / `session_data` dicts, had to re-establish a fresh
 * outbound WebSocket each time, and routinely blew through the 60 s
 * frontend `/api/files` `maxDuration` — surfacing as a generic "Internal
 * server error" while chat to the same machine worked fine.
 *
 * The frontend has the same risk surface: factory functions like
 * `getMachineCleanupService()` / `getAwsEc2Service()` /
 * `getAzureContainerService()` / `dockerService` are designed as
 * singletons.  If a future PR does `new MachineCleanupService()` directly
 * inside an API route, that route gets its own isolated instance and the
 * cross-replica state diverges the same way file_operations did.
 *
 * # What this test enforces
 *
 * For every class that has a singleton accessor exported from `lib/`
 * (`getXxxService()` factory or top-level `xxxService` const), no other
 * file in `app/` or `lib/` (excluding `__tests__/`) may construct that
 * class with `new ClassName(`.  Either call the factory or import the
 * exported singleton.
 */

import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"

const REPO_ROOT = resolve(__dirname, "..", "..")
const SCAN_ROOTS = ["app", "lib"].map((d) => join(REPO_ROOT, d))

// Files allowed to construct the singletons themselves: the canonical
// definition module (auto-detected — matches the file that exports both
// the class and the factory/singleton).  Test files / mocks are also
// allowed since fixtures legitimately need isolated instances.
const TEST_FILE_PATTERNS = [
  /[\\/]__tests__[\\/]/,
  /\.test\.tsx?$/,
  /\.spec\.tsx?$/,
  /[\\/]tests[\\/]/,
  /[\\/]node_modules[\\/]/,
  /[\\/]\.next[\\/]/,
  /[\\/]\.turbo[\\/]/,
  /[\\/]dist[\\/]/,
  /[\\/]build[\\/]/,
]

// Singletons that are intentionally factory-protected: the class export
// exists but every consumer must call the factory.  Auto-detection key is
// the export pattern in the canonical module.
type SingletonSpec = {
  className: string
  // Path (relative to repo root) where the class+factory live — the only
  // file allowed to do `new ClassName(`.
  canonicalFile: string
  // Human-readable replacement instruction.
  replacement: string
}

const SINGLETONS: SingletonSpec[] = [
  {
    className: "MachineCleanupService",
    canonicalFile: "lib/services/machine-cleanup.ts",
    replacement:
      'import { getMachineCleanupService } from "@/lib/services/machine-cleanup"; const svc = getMachineCleanupService()',
  },
  {
    className: "AwsEc2Service",
    canonicalFile: "lib/aws/ec2-service.ts",
    replacement:
      'import { getAwsEc2Service } from "@/lib/aws/ec2-service"; const svc = getAwsEc2Service()',
  },
  {
    className: "AzureContainerService",
    canonicalFile: "lib/azure/container-instances.ts",
    replacement:
      'import { getAzureContainerService } from "@/lib/azure/container-instances"; const svc = getAzureContainerService()',
  },
  {
    className: "DockerService",
    canonicalFile: "lib/docker/docker-service.ts",
    replacement: 'import { dockerService } from "@/lib/docker/docker-service"',
  },
]

function isTestFile(path: string): boolean {
  return TEST_FILE_PATTERNS.some((pat) => pat.test(path))
}

function* walk(dir: string): Generator<string> {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(dir, entry)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      // Skip .next, node_modules etc. early to keep the scan fast.
      if (
        entry === "node_modules" ||
        entry === ".next" ||
        entry === ".turbo" ||
        entry === "dist" ||
        entry === "build" ||
        entry === ".git"
      )
        continue
      yield* walk(full)
    } else if (st.isFile() && /\.tsx?$/.test(entry)) {
      yield full
    }
  }
}

function findConstructions(content: string, className: string): number[] {
  // Match `new ClassName(` or `new ClassName ()` — class names are word-bounded.
  const re = new RegExp(`\\bnew\\s+${className}\\s*\\(`, "g")
  const lines: number[] = []
  let match: RegExpExecArray | null
  while ((match = re.exec(content)) !== null) {
    const before = content.slice(0, match.index)
    lines.push((before.match(/\n/g)?.length ?? 0) + 1)
  }
  return lines
}

describe("no duplicate singleton instantiations (anti-regression for deployed file-ops bug)", () => {
  it("every documented singleton has its canonical definition file present", () => {
    for (const spec of SINGLETONS) {
      const path = join(REPO_ROOT, spec.canonicalFile)
      const src = readFileSync(path, "utf8")
      expect(src, `${spec.canonicalFile} should declare class ${spec.className}`).toMatch(
        new RegExp(`(export\\s+)?class\\s+${spec.className}\\b`),
      )
      expect(src, `${spec.canonicalFile} should construct ${spec.className} itself`).toMatch(
        new RegExp(`\\bnew\\s+${spec.className}\\s*\\(`),
      )
    }
  })

  it("no file outside the canonical definition (or tests) constructs a singleton class", () => {
    const violations: { file: string; line: number; spec: SingletonSpec }[] = []

    for (const root of SCAN_ROOTS) {
      for (const file of walk(root)) {
        const rel = relative(REPO_ROOT, file).replace(/\\/g, "/")
        if (isTestFile(rel)) continue

        let content: string
        try {
          content = readFileSync(file, "utf8")
        } catch {
          continue
        }

        for (const spec of SINGLETONS) {
          // Skip the canonical home — it must construct the class once
          // (inside its factory or at module load).
          if (rel === spec.canonicalFile) continue

          for (const line of findConstructions(content, spec.className)) {
            violations.push({ file: rel, line, spec })
          }
        }
      }
    }

    if (violations.length > 0) {
      const lines = [
        "Found duplicate-singleton instantiations.  Each of these creates",
        "an isolated instance whose state (connections, sessions, locks,",
        "caches) diverges from the canonical singleton — the exact bug",
        "that broke deployed cloud-VM file operations (see commit history",
        "of backend/app/api/routes/file_operations.py for the incident).",
        "",
        "Fix each by using the canonical accessor:",
        "",
      ]
      for (const v of violations) {
        lines.push(`  ${v.file}:${v.line}  →  ${v.spec.replacement}`)
      }
      lines.push("")
      lines.push(
        "If a duplicate is genuinely required (e.g. an isolated test fixture),",
        "move the file under a __tests__/ directory or rename it *.test.ts so",
        "the scan exempts it.",
      )
      throw new Error(lines.join("\n"))
    }
  })
})
