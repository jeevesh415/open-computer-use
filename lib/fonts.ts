/**
 * Centralized font-family stacks for surfaces that cannot consume the
 * primary `--font-geist-sans` / `--font-geist-mono` CSS variables loaded
 * via `next/font` in `app/layout.tsx`.
 *
 * Out-of-band surfaces include:
 *   - SVG `<text>` elements (no Tailwind cascade)
 *   - Server-rendered HTML responses (OG image, OAuth bridge, error page)
 *   - Embedded HTML strings opened in a new window for print/PDF export
 *   - HTML5 Canvas 2D contexts (animated favicon)
 *   - xterm.js terminals (require an explicit font-family string)
 *
 * To change the *primary* site font, edit `app/layout.tsx` — the rest of
 * the UI cascades from there. Edit this file only when the brand decision
 * specifically targets these out-of-band surfaces (e.g. switching the
 * export-PDF aesthetic, swapping the terminal font, etc.).
 */

/**
 * Apple-first sans stack used inside PDF / print HTML exports — favors
 * `SF Pro` to match the curated document aesthetic.
 *
 * Used by: swarms-content.tsx, swarm-panel.tsx (download-as-PDF flow).
 */
export const EXPORT_SANS_STACK =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Helvetica Neue", sans-serif'

/**
 * Apple-first mono stack for `<code>` blocks inside PDF / print HTML exports.
 *
 * Used by: swarms-content.tsx, swarm-panel.tsx.
 */
export const EXPORT_MONO_STACK = '"SF Mono", "Fira Code", "Consolas", monospace'

/**
 * Cross-platform sans stack for plain HTML responses where the document
 * does not load Tailwind / next/font (auth bridge, simple inline pages).
 * Includes 'Segoe UI' for Windows and 'system-ui' for everything else.
 *
 * Used by: app/auth/desktop-callback/route.ts.
 */
export const SYSTEM_SANS_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"

/**
 * Lightweight system stack for inline SVG `<text>` and `next/og` image
 * rendering. Prefers `system-ui` first (the canonical CSS generic that
 * the browser resolves to its UI font) with Apple + sans-serif as floor.
 *
 * Used by: opengraph-image.tsx, global-error.tsx, chat-input.tsx (SVG
 * labels), billing-section.tsx (SVG chart axes).
 */
export const SVG_SYSTEM_STACK = "system-ui, -apple-system, sans-serif"

/**
 * Generic monospace family for SVG `<text>` placeholders.
 *
 * Used by: app/api/machines/[id]/screenshot/route.ts (placeholder SVG).
 */
export const SVG_MONO_STACK = "monospace"

/**
 * xterm.js terminal mono stack — JetBrains Mono first with platform-
 * specific fallbacks (Menlo on macOS, Consolas via "Courier New" on
 * Windows) and the monospace generic as floor.
 *
 * Used by: ssh-terminal.tsx.
 */
export const TERMINAL_MONO_STACK =
  '"JetBrains Mono", Menlo, Monaco, "Courier New", monospace'

/**
 * Decorative serif used by the canvas-rendered animated favicon. The
 * canvas 2D context cannot read CSS variables, so the stack is embedded
 * directly into the `ctx.font` shorthand.
 *
 * Used by: components/animated-favicon.tsx.
 */
export const FAVICON_SERIF_STACK =
  '"Instrument Serif", "Times New Roman", Georgia, serif'
