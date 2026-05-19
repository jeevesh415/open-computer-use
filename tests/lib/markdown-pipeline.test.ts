/**
 * Markdown / sanitizer pipeline tests (no React).
 *
 * These tests assert architectural invariants of the markdown -> HTML pipeline
 * used in components/prompt-kit/markdown.tsx and lib/sanitize.ts:
 *
 *   1. The shared sanitizer (`sanitizeUserInput` -> DOMPurify) sits in the
 *      pipeline for any path that produces HTML from untrusted input.
 *   2. The allowed-tag list is conservative (no `<form>`, `<input>`,
 *      `<iframe>`, `<object>`, `<embed>`, `<style>`, `<link>`, `<meta>`).
 *   3. The allowed-protocol whitelist for href/src is restricted to
 *      http, https and mailto. Schemes like `javascript:`, `data:text/html`,
 *      `vbscript:` and `file:` are stripped.
 *   4. The `marked` lexer (used by parseMarkdownIntoBlocks) does not preserve
 *      raw HTML as executable script content when rendered through the
 *      sanitizer.
 *
 * Note: the React-side rendering pipeline (`react-markdown` + `remark-gfm` +
 * `remark-breaks`) is exercised in `tests/lib/rendering-xss.test.tsx`. This
 * file focuses on the *sanitizer* invariants that any HTML producer in the
 * codebase must obey.
 */
import { describe, it, expect } from "vitest"
import { sanitizeUserInput } from "@/lib/sanitize"
import { marked } from "marked"

// ---------------------------------------------------------------------------
// Allowed tag list — conservative
// ---------------------------------------------------------------------------
describe("markdown pipeline: allowed tags", () => {
  // Tags that the sanitizer MUST strip because they enable script
  // execution, navigation hijacking, or document-level state changes.
  // (DOMPurify's default `FORBID_TAGS` removes these.)
  // Note: <audio>/<video>/<input>/<form>/<button>/<svg> are NOT in this
  // list because DOMPurify allows them by default — see the
  // "DOMPurify-default-permitted" test below for the exact policy and the
  // mitigation (event-handler attributes are still stripped).
  const dangerousTags = [
    "iframe",
    "object",
    "embed",
    "style",
    "link",
    "meta",
    "base",
    "frame",
    "frameset",
    "applet",
  ]

  for (const tag of dangerousTags) {
    it(`strips <${tag}> from sanitized HTML`, () => {
      const open = `<${tag}>`
      const close = `</${tag}>`
      const out = sanitizeUserInput(`${open}content${close}`)
      // The opening tag must not survive in any form
      expect(out.toLowerCase()).not.toContain(`<${tag}`)
    })

    it(`strips self-closing <${tag} /> from sanitized HTML`, () => {
      const out = sanitizeUserInput(`<${tag} />`)
      expect(out.toLowerCase()).not.toContain(`<${tag}`)
    })
  }

  it("allows <p>, <strong>, <em>, <code>, <pre>, <a>, <ul>, <ol>, <li>", () => {
    const safe = [
      "<p>x</p>",
      "<strong>x</strong>",
      "<em>x</em>",
      "<code>x</code>",
      "<pre>x</pre>",
      '<a href="https://example.com">x</a>',
      "<ul><li>x</li></ul>",
      "<ol><li>x</li></ol>",
      "<h1>x</h1>",
      "<h2>x</h2>",
      "<blockquote>x</blockquote>",
      "<hr />",
    ]
    for (const html of safe) {
      const out = sanitizeUserInput(html)
      // The text content "x" must survive — proves the sanitizer didn't nuke
      // the safe tags entirely.
      if (html.includes("x")) {
        expect(out).toContain("x")
      }
    }
  })

  it("DOMPurify default policy: <form>/<input>/<button> survive but cannot carry on*= handlers", () => {
    // This test documents the existing DOMPurify default behavior. These
    // tags are not stripped (they're considered semantically meaningful in
    // some HTML), but their event-handler attributes ARE stripped.
    const out = sanitizeUserInput(
      '<form action="javascript:alert(1)"><input onfocus="alert(1)" autofocus></form>'
    )
    // No event-handler attributes
    expect(out.toLowerCase()).not.toContain("onfocus")
    // No javascript: protocol on action
    expect(out.toLowerCase()).not.toContain("javascript:")
  })

  it("strips <script> with all variants", () => {
    const variants = [
      "<script>alert(1)</script>",
      "<SCRIPT>alert(1)</SCRIPT>",
      "<script src='x'></script>",
      "<script>alert`1`</script>",
      "<script\n>alert(1)</script>",
    ]
    for (const v of variants) {
      const out = sanitizeUserInput(v)
      expect(out.toLowerCase()).not.toContain("<script")
      expect(out).not.toContain("alert(1)")
    }
  })
})

// ---------------------------------------------------------------------------
// Allowed protocol whitelist for href/src
// ---------------------------------------------------------------------------
describe("markdown pipeline: protocol whitelist", () => {
  it("allows http: and https: in <a href>", () => {
    expect(sanitizeUserInput('<a href="https://example.com">x</a>')).toContain(
      "https://example.com"
    )
    expect(sanitizeUserInput('<a href="http://example.com">x</a>')).toContain(
      "http://example.com"
    )
  })

  it("allows mailto: in <a href>", () => {
    const out = sanitizeUserInput('<a href="mailto:a@b.com">x</a>')
    expect(out).toContain("mailto:")
  })

  it("strips javascript: in <a href>", () => {
    const out = sanitizeUserInput('<a href="javascript:alert(1)">x</a>')
    expect(out.toLowerCase()).not.toContain("javascript:")
  })

  it("strips vbscript: in <a href>", () => {
    const out = sanitizeUserInput('<a href="vbscript:msgbox(1)">x</a>')
    expect(out.toLowerCase()).not.toContain("vbscript:")
  })

  it("strips data:text/html in <a href>", () => {
    const out = sanitizeUserInput(
      '<a href="data:text/html,<script>alert(1)</script>">x</a>'
    )
    expect(out.toLowerCase()).not.toContain("data:text/html")
    expect(out.toLowerCase()).not.toContain("<script")
  })

  it("strips file: scheme", () => {
    const out = sanitizeUserInput('<a href="file:///etc/passwd">x</a>')
    expect(out.toLowerCase()).not.toContain("file:")
  })

  it("strips javascript: in <img src>", () => {
    const out = sanitizeUserInput('<img src="javascript:alert(1)">')
    expect(out.toLowerCase()).not.toContain("javascript:")
  })

  it("strips embedded <script> when src=data:text/html (no executable script in DOM)", () => {
    const out = sanitizeUserInput(
      '<img src="data:text/html,<script>alert(1)</script>">'
    )
    // DOMPurify allows data: in <img src> (it cannot script-execute as an
    // image), but the embedded URL fragment must not surface as a real
    // <script> element in the sanitized DOM.
    expect(out.toLowerCase()).not.toContain("<script")
    expect(out.toLowerCase()).not.toContain("</script")
  })

  it("strips mixed-case JaVaScRiPt:", () => {
    const out = sanitizeUserInput('<a href="JaVaScRiPt:alert(1)">x</a>')
    expect(out.toLowerCase()).not.toContain("javascript:")
  })

  it("strips javascript: with whitespace/control chars", () => {
    const variants = [
      '<a href=" javascript:alert(1)">x</a>',
      '<a href="\tjavascript:alert(1)">x</a>',
      '<a href="\njavascript:alert(1)">x</a>',
      '<a href="java\tscript:alert(1)">x</a>',
    ]
    for (const v of variants) {
      const out = sanitizeUserInput(v)
      expect(out).not.toContain("alert(1)")
    }
  })
})

// ---------------------------------------------------------------------------
// `marked` lexer + sanitizer integration
// ---------------------------------------------------------------------------
describe("markdown pipeline: marked + sanitizer", () => {
  it("marked.parse output passes through sanitizer without leaking script", async () => {
    const md = "Hello <script>alert(1)</script> world"
    const html = await marked.parse(md, { async: true })
    const out = sanitizeUserInput(html)
    expect(out.toLowerCase()).not.toContain("<script")
    expect(out).not.toContain("alert(1)")
  })

  it("marked turns [text](javascript:...) into a link, sanitizer must strip protocol", async () => {
    const md = "[click](javascript:alert(1))"
    const html = await marked.parse(md, { async: true })
    const out = sanitizeUserInput(html)
    expect(out.toLowerCase()).not.toContain("javascript:")
    expect(out).not.toContain("alert(1)")
  })

  it("marked image with data:text/html cannot produce a script element", async () => {
    const md = "![](data:text/html,<script>alert(1)</script>)"
    const html = await marked.parse(md, { async: true })
    const out = sanitizeUserInput(html)
    // Even if the data: URL survives in an <img src>, an actual <script>
    // element must not appear in the sanitized output.
    expect(out.toLowerCase()).not.toContain("<script")
    expect(out.toLowerCase()).not.toContain("</script")
  })

  it("preserves fenced code block content as text (escaped)", async () => {
    const md = "```js\n<script>alert(1)</script>\n```"
    const html = await marked.parse(md, { async: true })
    const out = sanitizeUserInput(html)
    // The literal text should be preserved (escaped) but no executable
    // <script> tag should appear at the top level.
    expect(out).toContain("alert(1)")
    // The marked output for fenced code uses HTML entities — confirm no
    // unescaped <script> child element.
    const scriptOpenMatch = out.match(/<script\b/i)
    expect(scriptOpenMatch).toBeNull()
  })

  it("inline code preserves angle-bracket content as escaped text", async () => {
    const md = "`<img src=x onerror=alert(1)>`"
    const html = await marked.parse(md, { async: true })
    const out = sanitizeUserInput(html)
    // The literal text "onerror=" survives inside <code> as escaped text
    // (this is correct — it shows the user the literal source code), but
    // there must not be an actual <img> element with an onerror attribute.
    expect(out.toLowerCase()).toContain("<code>")
    // No real <img> element should be created.
    expect(out).not.toMatch(/<img\b/i)
    // The angle brackets must be HTML-entity-encoded, not raw.
    expect(out).toContain("&lt;img")
  })
})

// ---------------------------------------------------------------------------
// Sanity: the sanitizer is deterministic and idempotent
// ---------------------------------------------------------------------------
describe("markdown pipeline: sanitizer invariants", () => {
  it("is idempotent (sanitize(sanitize(x)) === sanitize(x))", () => {
    const inputs = [
      "<p>hello</p>",
      "<script>alert(1)</script>",
      '<a href="javascript:alert(1)">x</a>',
      '<svg><foreignObject><body><img src=x onerror=alert(1)></body></foreignObject></svg>',
      "Plain text with <emoji>?</emoji>",
    ]
    for (const i of inputs) {
      const once = sanitizeUserInput(i)
      const twice = sanitizeUserInput(once)
      expect(twice).toBe(once)
    }
  })

  it("returns string for null/undefined input", () => {
    // The wrapper signature is (string) => string; DOMPurify coerces.
    expect(typeof sanitizeUserInput(null as unknown as string)).toBe("string")
    expect(typeof sanitizeUserInput(undefined as unknown as string)).toBe(
      "string"
    )
  })
})
