/**
 * GET /api/pricing — public, machine-readable pricing snapshot.
 *
 * Why this exists:
 *   - Replaces three duplicated pricing zones (see lib/pricing/tiers.ts header).
 *   - Gives AI agents (Claude, ChatGPT plugins, Perplexity, custom MCP clients)
 *     a stable JSON shape to budget calls without scraping HTML.
 *   - Linked from /llms.txt, /.well-known/ai-plugin.json, and the MCP server's
 *     get_pricing tool.
 *
 * Public, unauthenticated, cacheable (1h CDN, 5m browser). Schema versioned
 * via SCHEMA_VERSION so consumers can detect breaking changes.
 */
import { NextResponse } from "next/server"
import { buildPricingSnapshot } from "@/lib/pricing/tiers"

// Render at request time but cache aggressively — pricing changes rarely.
export const dynamic = "force-static"
export const revalidate = 3600

const RESPONSE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  // Long CDN cache + shorter browser cache. SWR keeps stale serves snappy.
  "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
  // Allow agents that hit this from a different origin to read the body.
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
} as const

export async function GET() {
  return NextResponse.json(buildPricingSnapshot(), { headers: RESPONSE_HEADERS })
}

export async function HEAD() {
  return new NextResponse(null, { headers: RESPONSE_HEADERS })
}

export async function OPTIONS() {
  return new NextResponse(null, { headers: RESPONSE_HEADERS })
}
