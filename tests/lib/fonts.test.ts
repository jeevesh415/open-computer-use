import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import {
  EXPORT_SANS_STACK,
  EXPORT_MONO_STACK,
  SYSTEM_SANS_STACK,
  SVG_SYSTEM_STACK,
  SVG_MONO_STACK,
  TERMINAL_MONO_STACK,
  FAVICON_SERIF_STACK,
} from "@/lib/fonts"

const ROOT = process.cwd()
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf-8")

const ALL_STACKS: Array<[name: string, value: string]> = [
  ["EXPORT_SANS_STACK", EXPORT_SANS_STACK],
  ["EXPORT_MONO_STACK", EXPORT_MONO_STACK],
  ["SYSTEM_SANS_STACK", SYSTEM_SANS_STACK],
  ["SVG_SYSTEM_STACK", SVG_SYSTEM_STACK],
  ["SVG_MONO_STACK", SVG_MONO_STACK],
  ["TERMINAL_MONO_STACK", TERMINAL_MONO_STACK],
  ["FAVICON_SERIF_STACK", FAVICON_SERIF_STACK],
]

const MULTI_TOKEN_STACKS: Array<[name: string, value: string]> = ALL_STACKS.filter(
  ([name]) => name !== "SVG_MONO_STACK"
)

// ---------------------------------------------------------------------------
// 1. Constants — shape, content, and CSS validity
// ---------------------------------------------------------------------------

describe("lib/fonts — exported constants", () => {
  it.each(ALL_STACKS)("%s is a non-empty trimmed string", (_name, stack) => {
    expect(typeof stack).toBe("string")
    expect(stack.length).toBeGreaterThan(0)
    expect(stack.trim()).toBe(stack)
  })

  it.each(MULTI_TOKEN_STACKS)(
    "%s ends with a CSS generic family (sans-serif | monospace | serif)",
    (_name, stack) => {
      expect(stack).toMatch(/(sans-serif|monospace|serif)$/)
    }
  )

  it.each(MULTI_TOKEN_STACKS)("%s is a comma-separated list", (_name, stack) => {
    expect(stack.split(",").length).toBeGreaterThanOrEqual(2)
  })

  it("EXPORT_SANS_STACK is the Apple SF Pro export stack", () => {
    expect(EXPORT_SANS_STACK).toContain("-apple-system")
    expect(EXPORT_SANS_STACK).toContain("BlinkMacSystemFont")
    expect(EXPORT_SANS_STACK).toMatch(/"SF Pro Text"/)
    expect(EXPORT_SANS_STACK).toMatch(/"SF Pro Display"/)
    expect(EXPORT_SANS_STACK).toMatch(/"Helvetica Neue"/)
    expect(EXPORT_SANS_STACK).toMatch(/sans-serif$/)
  })

  it("EXPORT_MONO_STACK is the SF Mono export stack", () => {
    expect(EXPORT_MONO_STACK).toMatch(/"SF Mono"/)
    expect(EXPORT_MONO_STACK).toMatch(/"Fira Code"/)
    expect(EXPORT_MONO_STACK).toMatch(/"Consolas"/)
    expect(EXPORT_MONO_STACK).toMatch(/monospace$/)
  })

  it("SYSTEM_SANS_STACK includes Segoe UI for Windows compatibility", () => {
    expect(SYSTEM_SANS_STACK).toContain("Segoe UI")
    expect(SYSTEM_SANS_STACK).toContain("-apple-system")
    expect(SYSTEM_SANS_STACK).toContain("system-ui")
    expect(SYSTEM_SANS_STACK).toMatch(/sans-serif$/)
  })

  it("SVG_SYSTEM_STACK leads with system-ui and falls back to Apple", () => {
    expect(SVG_SYSTEM_STACK.startsWith("system-ui")).toBe(true)
    expect(SVG_SYSTEM_STACK).toContain("-apple-system")
    expect(SVG_SYSTEM_STACK).toMatch(/sans-serif$/)
  })

  it("SVG_MONO_STACK is exactly the monospace generic", () => {
    expect(SVG_MONO_STACK).toBe("monospace")
  })

  it("TERMINAL_MONO_STACK leads with JetBrains Mono and falls through to platform mono", () => {
    expect(TERMINAL_MONO_STACK.startsWith('"JetBrains Mono"')).toBe(true)
    expect(TERMINAL_MONO_STACK).toContain("Menlo")
    expect(TERMINAL_MONO_STACK).toContain("Monaco")
    expect(TERMINAL_MONO_STACK).toMatch(/"Courier New"/)
    expect(TERMINAL_MONO_STACK).toMatch(/monospace$/)
  })

  it("FAVICON_SERIF_STACK leads with Instrument Serif and ends with the serif generic", () => {
    expect(FAVICON_SERIF_STACK.startsWith('"Instrument Serif"')).toBe(true)
    expect(FAVICON_SERIF_STACK).toMatch(/"Times New Roman"/)
    expect(FAVICON_SERIF_STACK).toContain("Georgia")
    expect(FAVICON_SERIF_STACK).toMatch(/serif$/)
    // Must NOT end with sans-serif — it's a serif stack
    expect(FAVICON_SERIF_STACK).not.toMatch(/sans-serif$/)
  })

  it("multi-word font names are double-quoted (CSS spec friendly)", () => {
    // Each stack with a multi-word name should have it inside double quotes
    // so that older CSS parsers and the canvas 2D context parse it correctly.
    const multiWordChecks: Array<[stack: string, name: string]> = [
      [EXPORT_SANS_STACK, "SF Pro Text"],
      [EXPORT_SANS_STACK, "SF Pro Display"],
      [EXPORT_SANS_STACK, "Helvetica Neue"],
      [EXPORT_MONO_STACK, "SF Mono"],
      [EXPORT_MONO_STACK, "Fira Code"],
      [TERMINAL_MONO_STACK, "JetBrains Mono"],
      [TERMINAL_MONO_STACK, "Courier New"],
      [FAVICON_SERIF_STACK, "Instrument Serif"],
      [FAVICON_SERIF_STACK, "Times New Roman"],
    ]
    for (const [stack, name] of multiWordChecks) {
      expect(stack).toContain(`"${name}"`)
    }
  })

  it("no stack contains stray duplicated commas or empty tokens", () => {
    for (const [, stack] of MULTI_TOKEN_STACKS) {
      expect(stack).not.toMatch(/,\s*,/)
      expect(stack).not.toMatch(/^,/)
      expect(stack).not.toMatch(/,$/)
    }
  })
})

// ---------------------------------------------------------------------------
// 2. Consumer regression — every refactored file must import from @/lib/fonts
//    AND must NOT contain the old hard-coded font literals.
// ---------------------------------------------------------------------------

type Consumer = {
  file: string
  constants: string[]
  removedLiterals: string[]
}

const CONSUMERS: Consumer[] = [
  {
    file: "app/components/machines/ssh-terminal.tsx",
    constants: ["TERMINAL_MONO_STACK"],
    removedLiterals: [
      '"JetBrains Mono", Menlo, Monaco, "Courier New", monospace',
    ],
  },
  {
    file: "app/components/swarms/swarms-content.tsx",
    constants: ["EXPORT_SANS_STACK", "EXPORT_MONO_STACK"],
    removedLiterals: [
      '"SF Pro Text", "SF Pro Display"',
      '"SF Mono", "Fira Code", "Consolas", monospace',
    ],
  },
  {
    file: "app/components/chat/swarm-panel.tsx",
    constants: ["EXPORT_SANS_STACK", "EXPORT_MONO_STACK"],
    removedLiterals: [
      '"SF Pro Text", "SF Pro Display"',
      '"SF Mono", "Fira Code", "Consolas", monospace',
    ],
  },
  // chat-input.tsx no longer ships an inline swarm SVG (the swarm UI moved
  // into the VM selector popover), so it no longer needs SVG_SYSTEM_STACK.
  {
    file: "app/components/layout/settings/billing/billing-section.tsx",
    constants: ["SVG_SYSTEM_STACK"],
    removedLiterals: ['fontFamily="system-ui, -apple-system, sans-serif"'],
  },
  {
    file: "app/api/machines/[id]/screenshot/route.ts",
    constants: ["SVG_MONO_STACK"],
    removedLiterals: ['font-family="monospace"'],
  },
  {
    file: "app/opengraph-image.tsx",
    constants: ["SVG_SYSTEM_STACK"],
    removedLiterals: ['"system-ui, -apple-system, sans-serif"'],
  },
  {
    file: "app/global-error.tsx",
    constants: ["SVG_SYSTEM_STACK"],
    removedLiterals: ['"system-ui, -apple-system, sans-serif"'],
  },
  {
    file: "app/auth/desktop-callback/route.ts",
    constants: ["SYSTEM_SANS_STACK"],
    removedLiterals: [
      "-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif",
    ],
  },
  {
    file: "components/animated-favicon.tsx",
    constants: ["FAVICON_SERIF_STACK"],
    removedLiterals: [
      '"Instrument Serif", "Times New Roman", Georgia, serif',
    ],
  },
]

describe("consumer regression — refactored files import from @/lib/fonts", () => {
  it.each(CONSUMERS.flatMap((c) => c.constants.map((k) => ({ file: c.file, constant: k }))))(
    "$file imports { $constant } from @/lib/fonts",
    ({ file, constant }) => {
      const src = read(file)
      // Match: import { ... CONST ... } from "@/lib/fonts"
      // Be tolerant to multi-line imports and other named imports on the line.
      const importRegex = new RegExp(
        `import\\s*\\{[^}]*\\b${constant}\\b[^}]*\\}\\s*from\\s*["']@/lib/fonts["']`,
        "s"
      )
      expect(src).toMatch(importRegex)
    }
  )
})

describe("consumer regression — old hard-coded font literals are removed", () => {
  it.each(
    CONSUMERS.flatMap((c) =>
      c.removedLiterals.map((literal) => ({ file: c.file, literal }))
    )
  )("$file no longer contains literal: $literal", ({ file, literal }) => {
    const src = read(file)
    expect(src).not.toContain(literal)
  })
})

describe("consumer regression — imported constant is actually used", () => {
  // Catches the bug where someone imports the constant but accidentally
  // pastes the hard-coded value next to it. Each constant should appear
  // at least twice: once in the import line, once or more in usage.
  it.each(
    CONSUMERS.flatMap((c) =>
      c.constants.map((k) => ({ file: c.file, constant: k }))
    )
  )(
    "$file references $constant at least twice (import + usage)",
    ({ file, constant }) => {
      const src = read(file)
      const matches = src.match(new RegExp(`\\b${constant}\\b`, "g")) ?? []
      expect(matches.length).toBeGreaterThanOrEqual(2)
    }
  )
})

// ---------------------------------------------------------------------------
// 3. Central pipeline — Geist + Tailwind aliasing must NOT have been touched
// ---------------------------------------------------------------------------

describe("central typography pipeline is intact", () => {
  it("app/layout.tsx still imports Geist via next/font/google", () => {
    const src = read("app/layout.tsx")
    expect(src).toContain('from "next/font/google"')
    expect(src).toMatch(/Geist\s*,\s*Geist_Mono/)
    expect(src).toContain('variable: "--font-geist-sans"')
    expect(src).toContain('variable: "--font-geist-mono"')
  })

  it("app/globals.css still aliases Tailwind's font tokens to the Geist variables", () => {
    const src = read("app/globals.css")
    expect(src).toContain("--font-sans: var(--font-geist-sans)")
    expect(src).toContain("--font-mono: var(--font-geist-mono)")
  })
})

// ---------------------------------------------------------------------------
// 4. Cross-consumer consistency — files that share an export aesthetic
//    must share the same constants
// ---------------------------------------------------------------------------

describe("cross-consumer consistency", () => {
  it("swarm-panel and swarms-content both use EXPORT_SANS_STACK + EXPORT_MONO_STACK for PDFs", () => {
    const a = read("app/components/swarms/swarms-content.tsx")
    const b = read("app/components/chat/swarm-panel.tsx")
    for (const src of [a, b]) {
      expect(src).toContain("EXPORT_SANS_STACK")
      expect(src).toContain("EXPORT_MONO_STACK")
    }
  })

  it("opengraph-image and global-error both use SVG_SYSTEM_STACK for OS-stack rendering", () => {
    const a = read("app/opengraph-image.tsx")
    const b = read("app/global-error.tsx")
    for (const src of [a, b]) {
      expect(src).toContain("SVG_SYSTEM_STACK")
    }
  })
})
