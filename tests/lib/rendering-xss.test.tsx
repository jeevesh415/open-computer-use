// @vitest-environment jsdom
/**
 * Frontend rendering-pipeline XSS / mxss tests.
 *
 * Exercises the actual chat renderers — Markdown (react-markdown +
 * remark-gfm + remark-breaks + remarkAutoLink), LinkMarkdown (anchor
 * renderer), and the Shiki code-block fallback — against the OWASP
 * polyglot list and a battery of mutation-XSS vectors.
 *
 * Heavy peripheral deps (shiki async highlighter, next-themes,
 * phosphor-icons, framer-motion) are mocked so the suite stays focused on
 * sanitization and stays fast in CI. The `Markdown` component itself,
 * `LinkMarkdown`, and the SSR-fallback path of `CodeBlockCode` are NOT
 * mocked — they are the system under test.
 *
 * For each renderer, we assert that:
 *   - No <script>, <iframe>, <object>, <embed> tag appears in the DOM
 *   - No <svg> appears unless it is from the safe icon allowlist (we permit
 *     SVG only when it is rendered by our own React components, never from
 *     user input)
 *   - No on*= event-handler attribute appears
 *   - javascript:, data:text/html, vbscript: URLs do NOT become clickable
 *     <a href> targets
 *   - External links rendered by Markdown have target="_blank" and
 *     rel="noopener noreferrer"
 */
import React from "react"
import { describe, it, expect, vi, beforeAll } from "vitest"
import { render, cleanup } from "@testing-library/react"

// ---------------------------------------------------------------------------
// Mocks for heavy peripheral deps. None of these affect the sanitization
// path under test.
// ---------------------------------------------------------------------------

// next-themes: provide a simple stub.
vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light", setTheme: () => {} }),
  ThemeProvider: ({ children }: any) => children,
}))

// next/dynamic: render the imported component synchronously. The
// `<Markdown>` component is loaded via next/dynamic in
// `components/prompt-kit/message.tsx`. We don't actually exercise that
// path — we import `Markdown` directly — but other transitive deps may
// use next/dynamic.
vi.mock("next/dynamic", () => ({
  default: (loader: () => Promise<any>) => {
    let Comp: any = () => null
    loader().then((m) => {
      Comp = m.default ?? m
    })
    return (props: any) => React.createElement(Comp, props)
  },
}))

// shiki: avoid the real async highlighter (heavy WASM load). The
// CodeBlockCode component falls back to a plain <pre><code> render path
// when `highlightedHtml` is null — that's the path we exercise.
vi.mock("shiki", () => ({
  codeToHtml: vi.fn(async () => null),
}))

// framer-motion / motion: replace with plain divs. The reasoning component
// uses motion.div but only for animations.
vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: any) => children,
  motion: new Proxy(
    {},
    {
      get:
        (_: any, tag: string) =>
        ({ children, ...props }: any) =>
          React.createElement(tag === "default" ? "div" : tag, props, children),
    }
  ),
}))

// phosphor-icons: replace each icon with a span (so SVG-allowlist asserts
// don't trip on icon SVGs which we DO trust). vi.mock requires explicit
// named exports — list every icon used by the components under test.
vi.mock("@phosphor-icons/react", () => {
  const Icon = (props: any) =>
    React.createElement("span", { "data-icon": "phosphor", ...props })
  return {
    EnvelopeSimple: Icon,
    Phone: Icon,
    Link: Icon,
    Globe: Icon,
    CaretDown: Icon,
    CaretDownIcon: Icon,
    CaretUp: Icon,
    Monitor: Icon,
    Check: Icon,
    Copy: Icon,
    ArrowClockwise: Icon,
    Trash: Icon,
    default: Icon,
  }
})

// ---------------------------------------------------------------------------
// System under test (imported AFTER mocks above).
// ---------------------------------------------------------------------------
import { Markdown } from "@/components/prompt-kit/markdown"
import { LinkMarkdown } from "@/app/components/chat/link-markdown"
import {
  CodeBlock,
  CodeBlockCode,
} from "@/components/prompt-kit/code-block"
import { Reasoning } from "@/app/components/chat/reasoning"

// ---------------------------------------------------------------------------
// OWASP polyglot list (https://github.com/0xsobky/HackVault/wiki/Unleashing-an-Ultimate-XSS-Polyglot)
// plus extra payloads requested by the test plan.
// ---------------------------------------------------------------------------
const OWASP_POLYGLOTS: string[] = [
  // Classic Ultimate Polyglot
  `jaVasCript:/*-/*\`/*\\\`/*'/*"/**/(/* */oNcliCk=alert() )//%0D%0A%0d%0a//</stYle/</titLe/</teXtarEa/</scRipt/--!>\\x3csVg/<sVg/oNloAd=alert()//>\\x3e`,
  // Common payloads
  `<script>alert('XSS')</script>`,
  `<img src=x onerror=alert(1)>`,
  `<svg/onload=alert(1)>`,
  `<iframe src="javascript:alert(1)"></iframe>`,
  `<object data="javascript:alert(1)"></object>`,
  `<embed src="javascript:alert(1)">`,
  `<a href="javascript:alert(1)">click</a>`,
  `<details open ontoggle=alert(1)>`,
  `<body onload=alert(1)>`,
  `"><script>alert(1)</script>`,
  `'-alert(1)-'`,
  `<math><mtext></form><form><mglyph><svg><mtext><textarea><path id="</textarea><img onerror=alert(1) src>">`,
  // mXSS vectors
  `<noscript><p title="</noscript><img src=1 onerror=alert(1)>"></p>`,
  `<svg><foreignObject><body><img src=x onerror=alert(1)></body></foreignObject></svg>`,
  `<style>@import 'javascript:alert(1)';</style>`,
  // CDATA + comments
  `<!--<![CDATA[<script>alert(1)</script>]]>-->`,
]

// Helper: scan a container for forbidden artifacts. Returns the list of
// failures so the assertion message names the offending node.
function findExecutablePayloads(root: HTMLElement): string[] {
  const failures: string[] = []

  if (root.querySelector("script")) failures.push("script tag found")
  if (root.querySelector("iframe")) failures.push("iframe tag found")
  if (root.querySelector("object")) failures.push("object tag found")
  if (root.querySelector("embed")) failures.push("embed tag found")
  if (root.querySelector("style")) failures.push("style tag found")
  if (root.querySelector("link")) failures.push("link tag found")
  if (root.querySelector("meta")) failures.push("meta tag found")

  // SVG: only allow SVGs marked with our trusted icon attribute. Markdown
  // input must never produce an SVG.
  const svgs = Array.from(root.querySelectorAll("svg"))
  for (const svg of svgs) {
    const trusted =
      svg.closest("[data-icon='phosphor']") !== null ||
      svg.getAttribute("data-icon") !== null
    if (!trusted) failures.push("untrusted svg found")
  }

  // Inline event handlers
  const all = Array.from(root.querySelectorAll("*"))
  for (const el of all) {
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.name)) {
        failures.push(`event handler ${attr.name} on <${el.tagName}>`)
      }
    }
  }

  // Anchors with dangerous schemes
  const anchors = Array.from(root.querySelectorAll("a[href]"))
  for (const a of anchors) {
    const href = (a.getAttribute("href") ?? "").trim().toLowerCase()
    if (href.startsWith("javascript:")) failures.push(`javascript: anchor`)
    if (href.startsWith("data:text/html")) failures.push(`data:text/html anchor`)
    if (href.startsWith("vbscript:")) failures.push(`vbscript: anchor`)
  }

  // Image / source with dangerous schemes
  const srcs = Array.from(root.querySelectorAll("[src]"))
  for (const el of srcs) {
    const src = (el.getAttribute("src") ?? "").trim().toLowerCase()
    if (src.startsWith("javascript:")) failures.push(`javascript: src`)
    if (src.startsWith("data:text/html")) failures.push(`data:text/html src`)
  }

  return failures
}

// ---------------------------------------------------------------------------
// Markdown — assistant-message renderer
// ---------------------------------------------------------------------------
describe("Markdown renderer (assistant message): OWASP polyglot list", () => {
  for (const payload of OWASP_POLYGLOTS) {
    it(`is safe against payload: ${payload.slice(0, 60).replace(/\n/g, " ")}…`, () => {
      const { container, unmount } = render(<Markdown>{payload}</Markdown>)
      const failures = findExecutablePayloads(container)
      expect(
        failures,
        `payload produced: ${failures.join(", ")}\nDOM: ${container.innerHTML.slice(0, 500)}`
      ).toEqual([])
      // Specific negative assertions
      expect(container.querySelector("script")).toBeNull()
      expect(container.querySelector("iframe")).toBeNull()
      expect(container.querySelector("object")).toBeNull()
      expect(container.querySelector("embed")).toBeNull()
      unmount()
    })
  }
})

describe("Markdown renderer: link / image safety", () => {
  it("[click](javascript:alert(1)) — anchor renders without javascript: scheme", () => {
    const { container, unmount } = render(
      <Markdown>{"[click](javascript:alert(1))"}</Markdown>
    )
    const anchors = Array.from(container.querySelectorAll("a"))
    for (const a of anchors) {
      const href = (a.getAttribute("href") ?? "").toLowerCase()
      expect(href.startsWith("javascript:")).toBe(false)
    }
    unmount()
  })

  it("![](data:text/html,<script>...) — image src is not data:text/html", () => {
    const { container, unmount } = render(
      <Markdown>
        {"![alt](data:text/html,<script>alert(1)</script>)"}
      </Markdown>
    )
    const imgs = Array.from(container.querySelectorAll("img"))
    for (const img of imgs) {
      const src = (img.getAttribute("src") ?? "").toLowerCase()
      expect(src.startsWith("data:text/html")).toBe(false)
    }
    expect(container.querySelector("script")).toBeNull()
    unmount()
  })

  it("raw <img src=x onerror=alert(1)> in markdown does not render as image", () => {
    const { container, unmount } = render(
      <Markdown>{"<img src=x onerror=alert(1)>"}</Markdown>
    )
    // react-markdown by default does not parse raw HTML, so the <img> tag
    // should not appear in the DOM at all. The literal source text may
    // appear as ESCAPED text content (which is safe).
    expect(container.querySelector("img")).toBeNull()
    expect(container.querySelector("[onerror]")).toBeNull()
    // No element has an attribute literally named onerror
    const allEls = Array.from(container.querySelectorAll("*"))
    for (const el of allEls) {
      for (const attr of Array.from(el.attributes)) {
        expect(attr.name.toLowerCase()).not.toBe("onerror")
      }
    }
    unmount()
  })

  it("reference-style link to javascript: does not produce javascript: anchor", () => {
    const md = [
      "Check [this][evil] out.",
      "",
      "[evil]: javascript:alert(1)",
    ].join("\n")
    const { container, unmount } = render(<Markdown>{md}</Markdown>)
    const anchors = Array.from(container.querySelectorAll("a"))
    for (const a of anchors) {
      const href = (a.getAttribute("href") ?? "").toLowerCase()
      expect(href.startsWith("javascript:")).toBe(false)
    }
    unmount()
  })

  it("HTML comment containing CDATA + script is not rendered", () => {
    const md = "<!--<![CDATA[<script>alert(1)</script>]]>-->"
    const { container, unmount } = render(<Markdown>{md}</Markdown>)
    expect(container.querySelector("script")).toBeNull()
    expect(container.innerHTML.toLowerCase()).not.toContain("<script")
    unmount()
  })

  it("markdown table with HTML in cells does not render the HTML", () => {
    const md = [
      "| col1 | col2 |",
      "| ---- | ---- |",
      "| <img src=x onerror=alert(1)> | <script>alert(1)</script> |",
    ].join("\n")
    const { container, unmount } = render(<Markdown>{md}</Markdown>)
    expect(container.querySelector("script")).toBeNull()
    expect(container.querySelector("img")).toBeNull()
    // No element has an `onerror` attribute
    const allEls = Array.from(container.querySelectorAll("*"))
    for (const el of allEls) {
      for (const attr of Array.from(el.attributes)) {
        expect(attr.name.toLowerCase()).not.toBe("onerror")
      }
    }
    // The table itself should still render (gfm)
    expect(container.querySelector("table")).not.toBeNull()
    unmount()
  })

  it("renders external https links via LinkMarkdown wrapper", () => {
    // LinkMarkdown renders a favicon <img>, so we just check that a real
    // anchor exists with the safe https href.
    const { container, unmount } = render(
      <Markdown>{"[example](https://example.com)"}</Markdown>
    )
    const anchors = Array.from(container.querySelectorAll("a"))
    expect(anchors.length).toBeGreaterThan(0)
    const a = anchors.find(
      (el) => (el.getAttribute("href") ?? "").startsWith("https://")
    )
    expect(a).toBeTruthy()
    unmount()
  })
})

// ---------------------------------------------------------------------------
// LinkMarkdown — direct exercise (used by Markdown for <a> tags)
// ---------------------------------------------------------------------------
describe("LinkMarkdown: external link attribute hardening", () => {
  it("external https link gets target=_blank and rel=noopener noreferrer", () => {
    const { container, unmount } = render(
      <LinkMarkdown href="https://example.com">example</LinkMarkdown>
    )
    const a = container.querySelector("a")
    expect(a).not.toBeNull()
    expect(a!.getAttribute("target")).toBe("_blank")
    const rel = a!.getAttribute("rel") ?? ""
    expect(rel).toContain("noopener")
    expect(rel).toContain("noreferrer")
    unmount()
  })

  it("internal link does NOT get target=_blank (avoids dock-tab abuse)", () => {
    const { container, unmount } = render(
      <LinkMarkdown href="/internal/path">internal</LinkMarkdown>
    )
    const a = container.querySelector("a")
    expect(a).not.toBeNull()
    expect(a!.getAttribute("target")).not.toBe("_blank")
    unmount()
  })

  it("mailto link does NOT get target=_blank", () => {
    const { container, unmount } = render(
      <LinkMarkdown href="mailto:test@example.com">mail</LinkMarkdown>
    )
    const a = container.querySelector("a")
    expect(a).not.toBeNull()
    expect(a!.getAttribute("target")).not.toBe("_blank")
    unmount()
  })
})

// ---------------------------------------------------------------------------
// Code blocks — Shiki SSR fallback path (the path executed before the
// async highlighter resolves; in our mock setup, it is always taken).
// ---------------------------------------------------------------------------
describe("Code block renderer (Shiki fallback): content is escaped", () => {
  it("code with closing tags + injected script is rendered as escaped text", () => {
    const evil = `</code></pre><script>alert(1)</script>`
    const { container, unmount } = render(
      <CodeBlock>
        <CodeBlockCode code={evil} language="js" />
      </CodeBlock>
    )
    expect(container.querySelector("script")).toBeNull()
    // The literal payload text should appear inside <code>
    const codeEl = container.querySelector("code")
    expect(codeEl).not.toBeNull()
    expect(codeEl!.textContent).toContain("alert(1)")
    expect(codeEl!.textContent).toContain("<script>")
    unmount()
  })

  it("very long code block (10000 chars) does not crash and renders safely", () => {
    const long = "a".repeat(10000)
    const { container, unmount } = render(
      <CodeBlock>
        <CodeBlockCode code={long} language="js" />
      </CodeBlock>
    )
    const codeEl = container.querySelector("code")
    expect(codeEl).not.toBeNull()
    expect((codeEl!.textContent ?? "").length).toBeGreaterThan(9000)
    expect(container.querySelector("script")).toBeNull()
    unmount()
  })

  it("invalid language hint <script> is treated as a string (no XSS)", () => {
    const { container, unmount } = render(
      <CodeBlock>
        <CodeBlockCode code={"console.log(1)"} language={"<script>"} />
      </CodeBlock>
    )
    expect(container.querySelector("script")).toBeNull()
    // The fallback path renders the code as text, language is irrelevant.
    expect(container.querySelector("code")).not.toBeNull()
    unmount()
  })

  it("Markdown fenced code block with </script> inside does not break out", () => {
    const md = "```js\n</script><script>alert(1)</script>\n```"
    const { container, unmount } = render(<Markdown>{md}</Markdown>)
    expect(container.querySelector("script")).toBeNull()
    // The content should be visible as text somewhere
    expect(container.textContent).toContain("alert(1)")
    unmount()
  })
})

// ---------------------------------------------------------------------------
// Math — KaTeX is NOT wired into the Markdown component (verified by
// inspecting components/prompt-kit/markdown.tsx). The plumbed `enableMath`
// prop is unused. We assert math content does not somehow render with
// dangerous artifacts.
// ---------------------------------------------------------------------------
describe("Math (KaTeX-style payloads): no execution, no DoS", () => {
  it("\\href{javascript:alert(1)}{click} — no javascript: anchor", () => {
    const md = "Math: $\\href{javascript:alert(1)}{click}$"
    const { container, unmount } = render(
      <Markdown enableMath={true}>{md}</Markdown>
    )
    const anchors = Array.from(container.querySelectorAll("a"))
    for (const a of anchors) {
      const href = (a.getAttribute("href") ?? "").toLowerCase()
      expect(href.startsWith("javascript:")).toBe(false)
    }
    expect(container.querySelector("script")).toBeNull()
    unmount()
  })

  it("deep \\frac sequence (100 nested) — no DoS, no script", () => {
    // Use a *sequential* (linear-size) chain rather than tree-doubling
    // (exponential). 100 levels of `\frac{1}{...}` is what a real user
    // could plausibly paste; tree-doubling would be 2^100 chars and is not
    // a realistic input.
    let payload = "1"
    for (let i = 0; i < 100; i++) payload = `\\frac{1}{${payload}}`
    const md = `$${payload}$`
    const start = Date.now()
    const { container, unmount } = render(
      <Markdown enableMath={true}>{md}</Markdown>
    )
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(5000)
    expect(container.querySelector("script")).toBeNull()
    unmount()
  })
})

// ---------------------------------------------------------------------------
// Reasoning renderer — wraps Markdown + animations
// ---------------------------------------------------------------------------
describe("Reasoning renderer: HTML/markdown is sanitized", () => {
  it("reasoning text with <script> never produces a script element", () => {
    const evil = `Thinking… <script>alert(1)</script> done.`
    const { container, unmount } = render(<Reasoning reasoning={evil} />)
    expect(container.querySelector("script")).toBeNull()
    // The literal text "<script>" may appear as escaped text
    // (&lt;script&gt;) — that's safe, but no real <script> element exists.
    unmount()
  })

  it("reasoning text with markdown image of data:text/html — sanitized", () => {
    const evil = "Thinking… ![](data:text/html,<script>alert(1)</script>)"
    const { container, unmount } = render(<Reasoning reasoning={evil} />)
    const imgs = Array.from(container.querySelectorAll("img"))
    for (const img of imgs) {
      const src = (img.getAttribute("src") ?? "").toLowerCase()
      expect(src.startsWith("data:text/html")).toBe(false)
    }
    expect(container.querySelector("script")).toBeNull()
    unmount()
  })

  it("reasoning text with raw <img onerror=...> does not produce an image", () => {
    const evil = `<img src=x onerror=alert(1)>`
    const { container, unmount } = render(<Reasoning reasoning={evil} />)
    expect(container.querySelector("img")).toBeNull()
    // No actual onerror attribute
    const allEls = Array.from(container.querySelectorAll("*"))
    for (const el of allEls) {
      for (const attr of Array.from(el.attributes)) {
        expect(/^on/i.test(attr.name)).toBe(false)
      }
    }
    unmount()
  })
})

// ---------------------------------------------------------------------------
// Tool-result-style content: tool results are rendered as plain text by
// the existing tool-invocation component (verified: app/components/chat/
// tool-invocation.tsx renders status strings, no markdown). The defensive
// invariant we test here is: even if a future regression were to feed tool
// result text into <Markdown>, raw HTML still must not execute.
// ---------------------------------------------------------------------------
describe("Tool result text routed through Markdown — defensive invariant", () => {
  it("tool result with HTML payload is not rendered as raw HTML", () => {
    const result = `Result: <iframe src="https://evil.com"></iframe><script>alert(1)</script>`
    const { container, unmount } = render(<Markdown>{result}</Markdown>)
    expect(container.querySelector("iframe")).toBeNull()
    expect(container.querySelector("script")).toBeNull()
    unmount()
  })
})

// ---------------------------------------------------------------------------
// Mutation XSS suite
// ---------------------------------------------------------------------------
describe("Mutation XSS (mxss) vectors", () => {
  const mxssVectors: Array<{ name: string; payload: string }> = [
    {
      name: "<noscript> mutation",
      payload: `<noscript><p title="</noscript><img src=1 onerror=alert(1)>"></p>`,
    },
    {
      name: "SVG foreignObject embedding HTML",
      payload: `<svg><foreignObject><body><img src=x onerror=alert(1)></body></foreignObject></svg>`,
    },
    {
      name: "@import javascript: from <style>",
      payload: `<style>@import 'javascript:alert(1)';</style>`,
    },
    {
      name: "math/mglyph polyglot",
      payload: `<math><mtext></form><form><mglyph><svg><mtext><textarea><path id="</textarea><img onerror=alert(1) src>">`,
    },
  ]

  for (const { name, payload } of mxssVectors) {
    it(`${name} renders without executable artifacts`, () => {
      const { container, unmount } = render(<Markdown>{payload}</Markdown>)
      expect(container.querySelector("script")).toBeNull()
      expect(container.querySelector("style")).toBeNull()
      expect(container.querySelector("iframe")).toBeNull()
      // No raw <img> from raw-HTML payloads (react-markdown strips raw HTML)
      const imgs = Array.from(container.querySelectorAll("img"))
      for (const img of imgs) {
        const src = (img.getAttribute("src") ?? "").toLowerCase()
        // Only favicon images from LinkMarkdown should survive — those are
        // https URLs, never `1` or `x`.
        expect(src).not.toBe("1")
        expect(src).not.toBe("x")
      }
      // No on*= attributes anywhere
      const allEls = Array.from(container.querySelectorAll("*"))
      for (const el of allEls) {
        for (const attr of Array.from(el.attributes)) {
          expect(/^on/i.test(attr.name)).toBe(false)
        }
      }
      unmount()
    })
  }
})

// ---------------------------------------------------------------------------
// External link hardening — Markdown-produced external anchors
// ---------------------------------------------------------------------------
describe("External anchors from Markdown have target=_blank rel=noopener noreferrer", () => {
  it("https link gets safe rel/target", () => {
    const { container, unmount } = render(
      <Markdown>{"[link](https://example.com)"}</Markdown>
    )
    // Find anchors with https hrefs (LinkMarkdown produces these).
    const anchors = Array.from(container.querySelectorAll("a")).filter((a) =>
      (a.getAttribute("href") ?? "").startsWith("https://")
    )
    expect(anchors.length).toBeGreaterThan(0)
    for (const a of anchors) {
      expect(a.getAttribute("target")).toBe("_blank")
      const rel = a.getAttribute("rel") ?? ""
      expect(rel).toContain("noopener")
      expect(rel).toContain("noreferrer")
    }
    unmount()
  })
})
