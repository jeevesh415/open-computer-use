/**
 * mobile-compat.test.ts — guard rail against the four mobile/iOS bugs
 * we shipped fixes for in commits e2e3431 + 7353e5b.
 *
 * Strategy
 * --------
 * Static analysis of every .tsx file under app/ and components/. We don't
 * spin up a browser — these are deterministic regex checks that run in
 * milliseconds and will fire CI alarms the moment someone re-introduces
 * one of the patterns. The patterns are:
 *
 *   1. INVALID-HTML link/button nesting
 *      `<a><button>...</button></a>` is invalid HTML5 (interactive content
 *      cannot nest inside <a>). Browsers parse it as `<a></a><button>` —
 *      the button is no longer inside the link, so taps on mobile do not
 *      navigate. Catches both Next.js `<Link>` and raw `<a>` wrappers,
 *      and both `<button>` and `<motion.button>` children. Reverse
 *      direction (button-wrapping-anchor) is also invalid and checked.
 *
 *   2. FRAMER-MOTION whileHover on a touch-clickable element
 *      `whileHover` is a JS pointer-event listener. iOS Safari fires
 *      pointerover on touchstart, so the first tap activates the hover
 *      animation; the second tap fires the click. Classic "have to
 *      double-click" symptom. CSS `:hover` does NOT have this problem
 *      because Tailwind v4 auto-gates it with @media (hover: hover).
 *      Rule: `whileHover` is forbidden on `motion.button`, `motion.a`,
 *      and any `motion.*` element that carries an `onClick` handler.
 *
 *   3. ISMOBILE-RACE motion props
 *      `initial={isMobile ? false : { opacity: 0 }}` is broken because
 *      `isMobile` starts as `useState(false)` and only flips after the
 *      first useEffect runs. Framer-motion captures `initial` ONCE at
 *      mount, so by the time `isMobile` becomes true, the element has
 *      already been mounted at opacity 0. If the same conditional sets
 *      `whileInView={isMobile ? undefined : ...}`, the post-mount value
 *      removes the viewport observer — the element stays at opacity 0
 *      forever. Pattern is forbidden anywhere in app/components/landing/
 *      sections.
 *
 *   4. CRITICAL-CSS regression
 *      The global `touch-action: manipulation` rule in app/globals.css
 *      eliminates the iOS 300ms double-tap-to-zoom delay on links and
 *      buttons. If someone removes it, taps feel sluggish on mobile.
 *      Asserted by reading the file and checking for the exact rule.
 *
 * What this file does NOT cover
 * -----------------------------
 *   - Runtime behaviour (Playwright). The patterns above are static and
 *     deterministic; a browser test would only add flakiness for them.
 *     For full visual / behavioural coverage, see the post_deploy smoke
 *     suite (which can run real headless mobile-viewport tests).
 *   - Hover effects on non-interactive decorative cards (those are fine).
 *   - whileHover on react-three-fiber / drei components (3d scene, not
 *     touch-clickable).
 */
import fs from "fs"
import path from "path"
import { describe, it, expect } from "vitest"

// ---------------------------------------------------------------------------
// Helpers — file discovery + line lookup
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, "../..")

const SCAN_ROOTS = [
  path.join(REPO_ROOT, "app"),
  path.join(REPO_ROOT, "components"),
]

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  "out",
  "dist",
  "coverage",
  "OSWorld",
  ".turbo",
])

function walkTsx(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walkTsx(full, acc)
    } else if (entry.isFile() && entry.name.endsWith(".tsx")) {
      acc.push(full)
    }
  }
  return acc
}

const ALL_TSX_FILES: { filePath: string; relPath: string; source: string }[] =
  SCAN_ROOTS.flatMap((root) => walkTsx(root)).map((filePath) => ({
    filePath,
    relPath: path.relative(REPO_ROOT, filePath).replace(/\\/g, "/"),
    source: fs.readFileSync(filePath, "utf8"),
  }))

/** Convert a string-character offset into a 1-indexed line number. */
function offsetToLine(source: string, offset: number): number {
  let line = 1
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source.charCodeAt(i) === 10 /* \n */) line++
  }
  return line
}

/** Extract a one-line snippet around the offset for nicer error messages. */
function snippet(source: string, offset: number, len = 80): string {
  const start = Math.max(0, source.lastIndexOf("\n", offset) + 1)
  const end = source.indexOf("\n", offset)
  const lineEnd = end === -1 ? source.length : end
  return source.slice(start, lineEnd).trim().slice(0, len)
}

interface Violation {
  relPath: string
  line: number
  excerpt: string
  rule: string
}

function formatViolations(violations: Violation[]): string {
  if (violations.length === 0) return ""
  return (
    `\n${violations.length} violation(s):\n` +
    violations
      .slice(0, 25) // cap output so failures stay readable
      .map(
        (v) =>
          `  • ${v.relPath}:${v.line}\n      rule: ${v.rule}\n      code: ${v.excerpt}`,
      )
      .join("\n") +
    (violations.length > 25 ? `\n  … and ${violations.length - 25} more` : "")
  )
}

// ---------------------------------------------------------------------------
// Sanity — at least *some* files were discovered. If this fires, the test
// scaffolding is broken (paths wrong, walker buggy). Without it a regex with
// zero matches looks the same as a regex with no input.
// ---------------------------------------------------------------------------

describe("mobile-compat scaffolding", () => {
  it("discovers .tsx files under app/ and components/", () => {
    expect(ALL_TSX_FILES.length).toBeGreaterThan(50)
  })

  it("can read a known landing file (sanity check the walker)", () => {
    const found = ALL_TSX_FILES.some((f) =>
      f.relPath.endsWith("app/components/landing/landing-page.tsx"),
    )
    expect(found).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Rule 1 — INVALID HTML: link wrapping button (or vice-versa)
// ---------------------------------------------------------------------------
//
// Matches:
//   <Link …> <button …
//   <Link …> <motion.button …
//   <a …> <button …
//   <a …> <motion.button …
//   <button …> <Link …
//   <button …> <a …
//   <motion.button …> <Link …
//   <motion.button …> <a …
//
// Allows arbitrary attributes/whitespace/newlines between opening tags
// and the inner element. Multiline by virtue of the `s` flag (dotall).
// ---------------------------------------------------------------------------

const LINK_OR_ANCHOR = String.raw`<(?:Link|a)\b[^>]*>`
const BUTTON_OR_MOTION_BUTTON = String.raw`<(?:motion\.)?button\b`
const LINK_WRAPPING_BUTTON = new RegExp(
  `${LINK_OR_ANCHOR}\\s*${BUTTON_OR_MOTION_BUTTON}`,
  "gs",
)

const BUTTON_OPEN = String.raw`<(?:motion\.)?button\b[^>]*>`
const LINK_OR_ANCHOR_OPEN = String.raw`<(?:Link|a)\b`
const BUTTON_WRAPPING_LINK = new RegExp(
  `${BUTTON_OPEN}\\s*${LINK_OR_ANCHOR_OPEN}`,
  "gs",
)

describe("HTML validity: no <a>/<button> nesting", () => {
  it("no `<Link>` or `<a>` directly wraps a `<button>` / `<motion.button>`", () => {
    const violations: Violation[] = []
    for (const { source, relPath } of ALL_TSX_FILES) {
      LINK_WRAPPING_BUTTON.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = LINK_WRAPPING_BUTTON.exec(source))) {
        violations.push({
          relPath,
          line: offsetToLine(source, m.index),
          excerpt: snippet(source, m.index),
          rule: "Invalid HTML — <button> inside <a>; use <Link className='…'> or wrap with <motion.div>",
        })
      }
    }
    expect(
      violations.length,
      `Found ${violations.length} <Link>/<a> wrapping <button> — invalid HTML, breaks taps on mobile.${formatViolations(violations)}`,
    ).toBe(0)
  })

  it("no `<button>` / `<motion.button>` directly wraps a `<Link>` / `<a>`", () => {
    const violations: Violation[] = []
    for (const { source, relPath } of ALL_TSX_FILES) {
      BUTTON_WRAPPING_LINK.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = BUTTON_WRAPPING_LINK.exec(source))) {
        violations.push({
          relPath,
          line: offsetToLine(source, m.index),
          excerpt: snippet(source, m.index),
          rule: "Invalid HTML — <a>/<Link> inside <button>; pick one element",
        })
      }
    }
    expect(
      violations.length,
      `Found ${violations.length} <button> wrapping <Link>/<a> — invalid HTML.${formatViolations(violations)}`,
    ).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Rule 2 — framer-motion `whileHover` on touch-clickable elements
// ---------------------------------------------------------------------------
//
// We forbid `whileHover` on:
//   - <motion.button …>     (always interactive)
//   - <motion.a …>          (always interactive)
//   - <motion.* …> where the same element block also carries an `onClick`
//
// Decorative <motion.div> with no onClick is allowed (the existing
// collaborative-features.tsx info-card grid is the canonical case).
// ---------------------------------------------------------------------------

interface MotionElement {
  /** Position in source where `<motion.X` starts. */
  start: number
  /** The matched tag name fragment, e.g. "button", "a", "div". */
  tagName: string
  /** Position where the opening tag's `>` lives (inclusive). */
  tagEnd: number
  /** Full text of the opening tag (between `<` and `>`). */
  openText: string
}

/**
 * Find every `<motion.X …>` opening tag in a source file. Returns positional
 * metadata so subsequent rules can interrogate the props.
 *
 * We can't use a naive regex because attribute values can contain `>`
 * inside JSX expressions (`{x > 0 ? a : b}`). Walk the source and balance
 * `{}` so we know we're past JSX expressions before matching `>` as the
 * tag close.
 */
function findMotionElements(source: string): MotionElement[] {
  const out: MotionElement[] = []
  const tagRe = /<motion\.([A-Za-z][A-Za-z0-9]*)/g
  let m: RegExpExecArray | null
  while ((m = tagRe.exec(source))) {
    const tagStart = m.index
    const tagName = m[1]
    let i = tagRe.lastIndex
    let depth = 0
    let inString: '"' | "'" | "`" | null = null
    while (i < source.length) {
      const ch = source[i]
      if (inString) {
        if (ch === inString && source[i - 1] !== "\\") inString = null
      } else if (ch === '"' || ch === "'" || ch === "`") {
        inString = ch
      } else if (ch === "{") {
        depth++
      } else if (ch === "}") {
        depth--
      } else if (ch === ">" && depth === 0) {
        out.push({
          start: tagStart,
          tagName,
          tagEnd: i,
          openText: source.slice(tagStart, i + 1),
        })
        break
      }
      i++
    }
  }
  return out
}

describe("framer-motion: whileHover on touch-clickable elements", () => {
  it("never on <motion.button> or <motion.a>", () => {
    const violations: Violation[] = []
    for (const { source, relPath } of ALL_TSX_FILES) {
      for (const el of findMotionElements(source)) {
        if (el.tagName !== "button" && el.tagName !== "a") continue
        if (!/\bwhileHover\b/.test(el.openText)) continue
        violations.push({
          relPath,
          line: offsetToLine(source, el.start),
          excerpt: snippet(source, el.start),
          rule: `whileHover on <motion.${el.tagName}>; convert to CSS hover (e.g. hover:scale-[1.02]) — Tailwind v4 auto-gates :hover with @media (hover: hover) so it won't fire on iOS touch`,
        })
      }
    }
    expect(
      violations.length,
      `Found ${violations.length} whileHover on motion.button/motion.a — causes iOS double-tap.${formatViolations(violations)}`,
    ).toBe(0)
  })

  it("never on a <motion.*> that also has onClick", () => {
    const violations: Violation[] = []
    for (const { source, relPath } of ALL_TSX_FILES) {
      for (const el of findMotionElements(source)) {
        if (!/\bwhileHover\b/.test(el.openText)) continue
        if (!/\bonClick\b/.test(el.openText)) continue
        violations.push({
          relPath,
          line: offsetToLine(source, el.start),
          excerpt: snippet(source, el.start),
          rule: `whileHover + onClick on <motion.${el.tagName}>; convert hover to CSS to avoid iOS double-tap`,
        })
      }
    }
    expect(
      violations.length,
      `Found ${violations.length} whileHover on click-bound motion elements.${formatViolations(violations)}`,
    ).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Rule 3 — `isMobile ? false : { opacity: 0 … }` race in landing sections
// ---------------------------------------------------------------------------
//
// The exact pattern that broke iOS visibility:
//   initial={isMobile ? false : { opacity: 0, y: 24 }}
//
// At first render `isMobile` is the useState default `false`, so framer
// captures `initial = { opacity: 0, y: 24 }` and mounts the element at
// opacity 0. After useEffect runs it becomes true, but framer doesn't
// re-evaluate `initial`. If the same conditional sets
// `whileInView={isMobile ? undefined : …}`, the post-flip value disables
// the viewport observer entirely — the element is invisible forever.
//
// Forbidden anywhere under app/components/landing/ (sections + helpers).
// Allowed elsewhere if you really know what you're doing — but we soft-warn
// (console.warn) on out-of-landing matches so a sweep can find them.
// ---------------------------------------------------------------------------

const ISMOBILE_INITIAL_FALSE = /isMobile\s*\?\s*false\s*:\s*\{\s*opacity/g
const ISMOBILE_WHILEINVIEW_UNDEF =
  /isMobile\s*\?\s*undefined\s*:\s*\{\s*opacity/g

describe("isMobile race: framer-motion props in landing sections", () => {
  it("no `isMobile ? false : { opacity ... }` in motion `initial`", () => {
    const violations: Violation[] = []
    for (const { source, relPath } of ALL_TSX_FILES) {
      if (!relPath.includes("app/components/landing/")) continue
      ISMOBILE_INITIAL_FALSE.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = ISMOBILE_INITIAL_FALSE.exec(source))) {
        violations.push({
          relPath,
          line: offsetToLine(source, m.index),
          excerpt: snippet(source, m.index),
          rule: "isMobile-race: framer-motion captures `initial` once at mount; the post-effect flip leaves the element stuck at opacity 0 on iOS",
        })
      }
    }
    expect(
      violations.length,
      `Found ${violations.length} isMobile-race patterns in landing sections.${formatViolations(violations)}`,
    ).toBe(0)
  })

  it("no `isMobile ? undefined : { opacity ... }` in motion `whileInView`", () => {
    const violations: Violation[] = []
    for (const { source, relPath } of ALL_TSX_FILES) {
      if (!relPath.includes("app/components/landing/")) continue
      ISMOBILE_WHILEINVIEW_UNDEF.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = ISMOBILE_WHILEINVIEW_UNDEF.exec(source))) {
        violations.push({
          relPath,
          line: offsetToLine(source, m.index),
          excerpt: snippet(source, m.index),
          rule: "isMobile-race: turning whileInView off after mount disables the observer; element never fades in on iOS",
        })
      }
    }
    expect(
      violations.length,
      `Found ${violations.length} isMobile-race whileInView patterns.${formatViolations(violations)}`,
    ).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Rule 4 — global touch-action: manipulation must remain in globals.css
// ---------------------------------------------------------------------------
//
// Eliminates iOS Safari's 300ms double-tap-to-zoom delay on every link
// and button. If someone strips this rule, taps feel sluggish on mobile
// even though there's no functional regression.
// ---------------------------------------------------------------------------

describe("globals.css: critical mobile rules", () => {
  const globalsPath = path.join(REPO_ROOT, "app", "globals.css")
  const css = fs.existsSync(globalsPath)
    ? fs.readFileSync(globalsPath, "utf8")
    : ""

  it("globals.css exists", () => {
    expect(fs.existsSync(globalsPath)).toBe(true)
  })

  it("declares touch-action: manipulation on interactive elements", () => {
    // Look for a rule whose selector list includes `a` and `button` and
    // whose body contains `touch-action: manipulation`. We don't care about
    // formatting nuances — just that the rule exists.
    // Negated character classes (`[^}]*`) already cross newlines, so we
    // don't need the `s` (dotall) flag — and avoiding it keeps us compatible
    // with the project's ES2017 TypeScript target.
    const ruleRe =
      /[^}]*\ba\b[^{}]*\bbutton\b[^{]*\{[^}]*touch-action\s*:\s*manipulation\s*;[^}]*\}/
    expect(
      ruleRe.test(css),
      "globals.css must apply `touch-action: manipulation` to a, button (kills iOS 300ms tap delay).",
    ).toBe(true)
  })

  it("declares -webkit-tap-highlight-color: transparent on interactive elements", () => {
    const ruleRe =
      /[^}]*\ba\b[^{}]*\bbutton\b[^{]*\{[^}]*-webkit-tap-highlight-color\s*:\s*transparent\s*;[^}]*\}/
    expect(
      ruleRe.test(css),
      "globals.css must suppress iOS tap-highlight flash on a, button.",
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Rule 5 — hero crossfade must keep its iOS visibility safety nets
// ---------------------------------------------------------------------------
//
// The hero `#hero-crossfade` wrapper is initialised with opacity 0 in JSX
// and faded in by a rAF loop. iOS Safari throttles rAF during momentum
// scroll, so we added two guarantees:
//
//   (a) `syncCrossfade()` — recomputes opacity from window.scrollY on every
//       scroll event, independent of rAF.
//   (b) `failSafeTimer`   — 1.5 s after mount, if the user is past 50 % of
//       the hero and crossfade is still hidden, force opacity 1.
//
// If either disappears, the iOS bug reopens. Lock them in with explicit
// string-presence checks.
// ---------------------------------------------------------------------------

describe("landing-page hero: iOS visibility safety nets", () => {
  const heroPath = path.join(
    REPO_ROOT,
    "app",
    "components",
    "landing",
    "hero-video-matrix.tsx",
  )
  const src = fs.existsSync(heroPath) ? fs.readFileSync(heroPath, "utf8") : ""

  it("hero-video-matrix.tsx exists", () => {
    expect(fs.existsSync(heroPath)).toBe(true)
  })

  it("contains scroll-event-driven crossfade sync (`syncCrossfade`)", () => {
    expect(
      /function\s+syncCrossfade\b|const\s+syncCrossfade\s*=/.test(src),
      "Removing syncCrossfade re-introduces the iOS-momentum-scroll invisibility bug.",
    ).toBe(true)
  })

  it("contains the 1.5s fail-safe timer (`failSafeTimer`)", () => {
    expect(
      /failSafeTimer\b/.test(src),
      "Removing the failSafeTimer means a fully-throttled iOS rAF loop ships an invisible page.",
    ).toBe(true)
  })

  it("clears the fail-safe timer on cleanup", () => {
    expect(
      /clearTimeout\(\s*failSafeTimer/.test(src),
      "failSafeTimer is created but never cleared — leak risk on hot reload / route change.",
    ).toBe(true)
  })

  it("attaches a scroll listener on window (passive)", () => {
    // We allow either `addEventListener("scroll", …, { passive: true })` or
    // a passing `{ passive: true }` option object on a separate line.
    expect(
      /addEventListener\(\s*["']scroll["'][^)]*passive\s*:\s*true/.test(src),
      "Passive scroll listener missing — needed for the crossfade safety net to fire on iOS.",
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Rule 6 — landing wrapper must keep `isolate overflow-x-clip`
// ---------------------------------------------------------------------------
//
// Without `overflow-x-clip` on the page wrapper, a single off-by-one
// horizontal-overflow element on a sub-page can turn the whole page into a
// horizontally-pannable surface on iOS, swallowing taps as pan-x gestures.
// The blog and marketing pages we fixed last sprint all rely on this.
// ---------------------------------------------------------------------------

describe("page wrappers: horizontal-overflow guard", () => {
  const wrapperPages = [
    "app/blog/page.tsx",
    "app/blog/[id]/page.tsx",
  ]

  for (const rel of wrapperPages) {
    it(`${rel} wraps in a div with isolate + overflow-x-clip`, () => {
      const f = ALL_TSX_FILES.find((x) => x.relPath === rel)
      expect(f, `${rel} not found`).toBeTruthy()
      if (!f) return
      // Look for the wrapper div className. We accept any order of classes.
      const wrapperRe =
        /<div\s+className=["'`][^"'`]*\bmin-h-screen\b[^"'`]*["'`]/
      const wrapperMatch = wrapperRe.exec(f.source)
      expect(wrapperMatch, `${rel} has no recognisable page wrapper`).toBeTruthy()
      if (!wrapperMatch) return
      const cls = wrapperMatch[0]
      expect(cls.includes("isolate"), `${rel} wrapper missing isolate`).toBe(
        true,
      )
      expect(
        cls.includes("overflow-x-clip"),
        `${rel} wrapper missing overflow-x-clip — horizontal overflow can swallow iOS taps`,
      ).toBe(true)
    })
  }
})

// ---------------------------------------------------------------------------
// Self-check — prove the regexes catch the patterns they claim to catch.
// Without this, a regex that silently stopped working (e.g. someone "cleaned
// up" the pattern) would always report 0 violations and the suite would
// pass forever no matter how broken the codebase becomes.
// ---------------------------------------------------------------------------

describe("self-check: regexes catch known-bad patterns", () => {
  it("LINK_WRAPPING_BUTTON matches `<Link href='/x'><motion.button>`", () => {
    LINK_WRAPPING_BUTTON.lastIndex = 0
    expect(
      LINK_WRAPPING_BUTTON.test(
        `<Link href="/auth"><motion.button className="…">Try</motion.button></Link>`,
      ),
    ).toBe(true)
  })

  it("LINK_WRAPPING_BUTTON matches `<a href='…'><button>`", () => {
    LINK_WRAPPING_BUTTON.lastIndex = 0
    expect(
      LINK_WRAPPING_BUTTON.test(`<a href="https://x.com">\n  <button>x</button>\n</a>`),
    ).toBe(true)
  })

  it("LINK_WRAPPING_BUTTON does not flag `<Link><div>` (valid HTML)", () => {
    LINK_WRAPPING_BUTTON.lastIndex = 0
    expect(
      LINK_WRAPPING_BUTTON.test(`<Link href="/x"><div className="card">x</div></Link>`),
    ).toBe(false)
  })

  it("BUTTON_WRAPPING_LINK matches `<button><Link>`", () => {
    BUTTON_WRAPPING_LINK.lastIndex = 0
    expect(
      BUTTON_WRAPPING_LINK.test(`<button onClick={x}><Link href="/y">y</Link></button>`),
    ).toBe(true)
  })

  it("findMotionElements identifies `<motion.button>` and `<motion.div>`", () => {
    const src = `<motion.button whileHover={{scale:1.02}}>x</motion.button>\n<motion.div onClick={f} whileHover={{y:-1}}>y</motion.div>`
    const els = findMotionElements(src)
    expect(els.map((e) => e.tagName).sort()).toEqual(["button", "div"])
    expect(els[0].openText).toContain("whileHover")
  })

  it("findMotionElements ignores `<motion.div>` without a whileHover prop", () => {
    const src = `<motion.div initial={{opacity:0}} animate={{opacity:1}}>x</motion.div>`
    const els = findMotionElements(src)
    expect(els.length).toBe(1)
    expect(/whileHover/.test(els[0].openText)).toBe(false)
  })

  it("findMotionElements survives JSX expressions with `>` inside", () => {
    // Used to be a parser bug — `{x > 0 ? a : b}` would close the tag early.
    const src = `<motion.div className={\`\${cn(x > 0 ? "a" : "b")}\`} whileHover={{scale:1}}>z</motion.div>`
    const els = findMotionElements(src)
    expect(els.length).toBe(1)
    expect(els[0].tagName).toBe("div")
    expect(els[0].openText).toContain("whileHover")
  })

  it("ISMOBILE_INITIAL_FALSE matches the documented anti-pattern", () => {
    ISMOBILE_INITIAL_FALSE.lastIndex = 0
    expect(
      ISMOBILE_INITIAL_FALSE.test(
        `initial={isMobile ? false : { opacity: 0, y: 24 }}`,
      ),
    ).toBe(true)
  })

  it("ISMOBILE_WHILEINVIEW_UNDEF matches the documented anti-pattern", () => {
    ISMOBILE_WHILEINVIEW_UNDEF.lastIndex = 0
    expect(
      ISMOBILE_WHILEINVIEW_UNDEF.test(
        `whileInView={isMobile ? undefined : { opacity: 1, y: 0 }}`,
      ),
    ).toBe(true)
  })

  it("ISMOBILE_INITIAL_FALSE does not flag the safe `{ opacity: 1 }` variant", () => {
    ISMOBILE_INITIAL_FALSE.lastIndex = 0
    // Some sections legitimately use `isMobile ? { opacity: 1 } : { opacity: 0 }`
    // — that one is FINE because both branches set a defined initial state.
    expect(
      ISMOBILE_INITIAL_FALSE.test(
        `initial={isMobile ? { opacity: 1, y: 0 } : { opacity: 0, y: 24 }}`,
      ),
    ).toBe(false)
  })
})
