/**
 * JSON-LD structured data emitter.
 *
 * Renders a `<script type="application/ld+json">` so search-engine and
 * AI-assistant crawlers (Googlebot, Bingbot, Perplexity-User, Claude
 * web_search, etc.) see canonical schema.org metadata on the initial HTML
 * payload. Must be rendered inside a Server Component so the JSON ships
 * on first-paint, not after hydration.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  )
}
