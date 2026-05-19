/**
 * GET /api/mcp-server-card  (also served at /.well-known/mcp/server-card.json
 * via a Next.js rewrite — see next.config.ts).
 *
 * SEP-1649 server-card: a public, agent-discoverable JSON descriptor of this
 * MCP server, mirroring what `mcp/manifest.json` and `mcp/server.json` ship
 * inside the npm package — but served from the marketing domain so a Claude /
 * Cursor / Windsurf user can paste `https://coasty.ai/.well-known/mcp/server-card.json`
 * and get an instant install hint.
 *
 * This route is hosted on the Next.js marketing site, NOT on the MCP server
 * itself. The MCP server's `coasty_get_capabilities` tool advertises this URL
 * so agents can fetch it without reading docs.
 *
 * Why a rewrite instead of `public/.well-known/mcp/server-card.json`:
 *   - keeps the JSON in code so we get type checking + a single source of
 *     version truth
 *   - lets us add per-region or per-tenant variants later without redeploying
 *     static assets
 *   - the `Cache-Control` header is set per response (5min browser, 1h CDN)
 *
 * Public, unauthenticated, cacheable. Schema URL points at the MCP spec's
 * v1 server-card schema so MCP hosts can validate.
 */
import { NextResponse } from "next/server"

// Render at request time but cache aggressively — the card changes once per
// MCP release.
export const dynamic = "force-static"
export const revalidate = 3600

const RESPONSE_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  // Long CDN cache + shorter browser cache. SWR keeps stale serves snappy.
  "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
  // Allow agents on a different origin to read the body.
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
} as const

const SERVER_CARD = {
  $schema: "https://modelcontextprotocol.io/schemas/server-card/v1",
  name: "@coasty/mcp",
  title: "Coasty Computer-Use",
  description:
    "Computer-use AI agents — predict UI actions, run machines, schedule jobs.",
  version: "1.1.0",
  vendor: { name: "Coasty", url: "https://coasty.ai" },
  icons: [
    {
      src: "https://coasty.ai/icon-512.svg",
      sizes: "512x512",
      type: "image/svg+xml",
    },
  ],
  packages: [
    {
      registry: "npm",
      name: "@coasty/mcp",
      version: "1.1.0",
      command: "npx -y @coasty/mcp",
    },
  ],
  remotes: [
    { transport: "http", url: "https://api.coasty.ai/mcp" },
  ],
  documentation_url: "https://coasty.ai/api-docs",
  openapi_url: "https://coasty.ai/.well-known/openapi.json",
} as const

export async function GET() {
  return NextResponse.json(SERVER_CARD, { headers: RESPONSE_HEADERS })
}

export async function HEAD() {
  return new NextResponse(null, { headers: RESPONSE_HEADERS })
}

export async function OPTIONS() {
  return new NextResponse(null, { headers: RESPONSE_HEADERS })
}
