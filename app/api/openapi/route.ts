/**
 * GET /api/openapi
 *
 * Serves the hand-curated OpenAPI 3.1 spec for Coasty's public `/v1/*` surface.
 *
 * Why this exists: backend/main.py disables FastAPI's auto-generated
 * `/openapi.json` in production because it leaks the entire admin/internal
 * route tree. This handler is the public, hand-curated replacement — only
 * `/v1/*` endpoints, with examples, request/response schemas, and pricing
 * context. Sourced from `lib/openapi/coasty-v1.ts`.
 *
 * Caching strategy:
 *   public, max-age=300, s-maxage=3600, stale-while-revalidate=86400
 *
 * The spec is static at request time (built from a const) so the CDN can
 * keep it for an hour and clients (Postman, Stoplight, AI agents) can cache
 * it for 5 minutes. SWR=86400 keeps stale copies alive for a day if the
 * origin briefly fails, so docs never go dark.
 *
 * CORS: open (`*`) — the spec is public and meant to be loaded from any
 * tooling site (editor.swagger.io, redocly, Stoplight, agent runtimes).
 *
 * Mounted at three URLs (rewrites in next.config.ts):
 *   /api/openapi
 *   /openapi.json             (Vercel + most agents)
 *   /.well-known/openapi.json (Stripe + Twilio convention)
 */

import { NextResponse } from "next/server";

import { COASTY_OPENAPI_SPEC } from "@/lib/openapi/coasty-v1";

// Allow caching of the function output at the edge — the spec doesn't depend
// on request, cookies, or headers.
export const dynamic = "force-static";
export const revalidate = 3600;

const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  // Useful for tooling that probes for the spec format.
  "X-Coasty-OpenAPI-Version": "3.1.0",
  "X-Coasty-API-Version": "1.0.0",
} as const;

export async function GET() {
  return NextResponse.json(COASTY_OPENAPI_SPEC, { headers: HEADERS });
}

export async function HEAD() {
  return new NextResponse(null, { headers: HEADERS });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      ...HEADERS,
      "Access-Control-Max-Age": "86400",
    },
  });
}
