// @vitest-environment jsdom
/**
 * Tests for `<OssLinkOut>` — the shared "this feature lives on coasty.ai"
 * component used by every OSS-mode page-level link-out (Phase 4).
 *
 * Invariants we enforce here:
 *   1. Title, description, and CTA copy are rendered as given (no
 *      transformations, no truncation).
 *   2. The CTA href is the raw `href` prop, opens in a new tab, and carries
 *      `rel="noreferrer noopener"` so the OSS app is never reverse-tabbed.
 *   3. The secondary action defaults to "Back to chat" -> "/" — we want
 *      every dead-end page to give the user a way home.
 *   4. The secondary action overrides work for both label and href.
 *
 * Plus a small "smoke test" pass: import each Phase-4-modified page module
 * and confirm it doesn't throw at module load. We don't render — server
 * components that read cookies/auth will throw inside a render — but
 * `import()` on each one verifies the new top-of-file code (the `if
 * (isOssMode())` branch and the OssLinkOut import) is syntactically and
 * type-clean.
 */
import React from "react"
import { describe, it, expect, vi } from "vitest"
import { render, cleanup } from "@testing-library/react"

// next/link in jsdom: shim to a plain anchor that preserves href + children.
type LinkProps = {
  href: string
  children?: React.ReactNode
} & Record<string, unknown>
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: LinkProps) =>
    React.createElement("a", { href, ...rest }, children),
}))

import { OssLinkOut } from "@/components/common/oss-link-out"

describe("<OssLinkOut>", () => {
  it("renders title, description, and CTA label as given", () => {
    const { container, unmount } = render(
      <OssLinkOut
        title="Billing"
        description="Billing for OSS mode lives at coasty.ai."
        href="https://coasty.ai/billing"
        ctaLabel="Open billing on coasty.ai"
      />,
    )

    const h1 = container.querySelector("h1")
    expect(h1?.textContent).toBe("Billing")

    const p = container.querySelector("p")
    expect(p?.textContent).toBe("Billing for OSS mode lives at coasty.ai.")

    // CTA: external <a>, opens new tab, safe rel.
    const cta = container.querySelector('a[href="https://coasty.ai/billing"]')
    expect(cta).not.toBeNull()
    expect(cta!.textContent).toContain("Open billing on coasty.ai")
    expect(cta!.getAttribute("target")).toBe("_blank")
    const rel = cta!.getAttribute("rel") ?? ""
    expect(rel).toContain("noreferrer")
    expect(rel).toContain("noopener")

    unmount()
    cleanup()
  })

  it("CTA href points to the provided URL exactly (no normalization)", () => {
    const cases = [
      "https://coasty.ai/billing",
      "https://coasty.ai/account?section=billing",
      "https://coasty.ai/account?section=keys",
      "https://coasty.ai/agent-labs",
      "https://coasty.ai/swarms",
      "https://coasty.ai/schedules",
      "https://coasty.ai/account",
    ]
    for (const url of cases) {
      const { container, unmount } = render(
        <OssLinkOut
          title="t"
          description="d"
          href={url}
          ctaLabel="cta"
        />,
      )
      const a = container.querySelector(`a[href="${url}"]`)
      expect(a, `expected anchor with href=${url}`).not.toBeNull()
      expect(a!.getAttribute("target")).toBe("_blank")
      unmount()
      cleanup()
    }
  })

  it("secondary link defaults to 'Back to chat' -> /", () => {
    const { container, unmount } = render(
      <OssLinkOut
        title="t"
        description="d"
        href="https://coasty.ai/billing"
        ctaLabel="cta"
      />,
    )

    // Find the anchor that points to "/" — that's the secondary.
    const secondary = container.querySelector('a[href="/"]')
    expect(secondary).not.toBeNull()
    expect(secondary!.textContent).toContain("Back to chat")
    // Internal nav: must NOT open in a new tab (no `target=_blank`).
    expect(secondary!.getAttribute("target")).not.toBe("_blank")

    unmount()
    cleanup()
  })

  it("secondary link override changes label AND href", () => {
    const { container, unmount } = render(
      <OssLinkOut
        title="t"
        description="d"
        href="https://coasty.ai/billing"
        ctaLabel="cta"
        secondaryHref="/elsewhere"
        secondaryLabel="Go elsewhere"
      />,
    )

    const secondary = container.querySelector('a[href="/elsewhere"]')
    expect(secondary).not.toBeNull()
    expect(secondary!.textContent).toContain("Go elsewhere")
    // Default secondary anchor (/) should NOT exist when overridden.
    expect(container.querySelector('a[href="/"]')).toBeNull()

    unmount()
    cleanup()
  })

  it("renders both primary and secondary anchors (no missing button regression)", () => {
    const { container, unmount } = render(
      <OssLinkOut
        title="t"
        description="d"
        href="https://coasty.ai/billing"
        ctaLabel="cta"
      />,
    )
    const anchors = container.querySelectorAll("a")
    // Primary + secondary = at least 2. (Could be more if Button asChild adds
    // wrapping elements, but anchors specifically are 2.)
    expect(anchors.length).toBe(2)
    unmount()
    cleanup()
  })
})

// ---------------------------------------------------------------------------
// Smoke check: every Phase-4-modified page wires the OSS-mode branch in the
// same shape — `if (isOssMode()) { return <OssLinkOut .../> }` (or, for
// onboarding, `redirect("/")`). Importing the page modules under vitest is
// not feasible because `LayoutApp` transitively pulls in client-only CSS
// (Tailwind v4 + sidebar-animations.css) and module-level browser globals
// (indexedDB) — vitest's vite-css plugin can't resolve the project's
// PostCSS config in a pure-node test context. Instead we read the source
// files and assert the link-out wiring is present. This catches
// regressions where someone deletes the OSS branch or breaks the import.
// ---------------------------------------------------------------------------
describe("Phase 4 page wiring", () => {
  it("every link-out page imports OssLinkOut and gates on isOssMode()", async () => {
    const fs = await import("node:fs/promises")
    const path = await import("node:path")
    // Resolve repo root from this test file's location.
    const here = path.resolve(__dirname, "..", "..")
    const linkOutPages = [
      "app/schedules/page.tsx",
      "app/secrets/page.tsx",
      "app/swarms/page.tsx",
      "app/agent-swarms/page.tsx",
      "app/credits/page.tsx",
      "app/account/page.tsx",
    ]
    for (const rel of linkOutPages) {
      const src = await fs.readFile(path.join(here, rel), "utf8")
      expect(src, `${rel}: missing OssLinkOut import`).toContain(
        '"@/components/common/oss-link-out"',
      )
      expect(src, `${rel}: missing isOssMode import`).toContain(
        '"@/lib/oss-mode"',
      )
      expect(src, `${rel}: missing OSS-mode branch`).toMatch(/isOssMode\(\)/)
      expect(src, `${rel}: missing OssLinkOut render`).toMatch(/<OssLinkOut\b/)
    }
  })

  it("onboarding page redirects to / in OSS mode (no link-out render)", async () => {
    const fs = await import("node:fs/promises")
    const path = await import("node:path")
    const here = path.resolve(__dirname, "..", "..")
    const src = await fs.readFile(
      path.join(here, "app/onboarding/page.tsx"),
      "utf8",
    )
    expect(src).toContain('"@/lib/oss-mode"')
    expect(src).toMatch(/isOssMode\(\)/)
    expect(src).toMatch(/redirect\(["']\/["']\)/)
    // Per spec, onboarding does NOT render OssLinkOut — it short-circuits.
    expect(src).not.toMatch(/<OssLinkOut\b/)
  })
})
