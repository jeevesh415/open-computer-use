/**
 * GET /.well-known/ai-plugin.json (rewritten to /api/ai-plugin)
 *
 * Legacy ChatGPT-plugin discovery manifest. The plugin store is deprecated
 * in 2026, but several agent platforms (and many internal corporate AI
 * gateways) still probe this path for service descriptors. Cheap to ship
 * and signals "we are agent-friendly" to crawlers checking common paths.
 *
 * Spec: https://platform.openai.com/docs/plugins/getting-started/plugin-manifest
 *
 * Modern agents should prefer:
 *   - /api/discovery (single manifest, all surfaces)
 *   - /.well-known/mcp/server-card.json (MCP)
 *   - /.well-known/openapi.json (OpenAPI 3.1)
 */
import { NextResponse } from "next/server"

export const dynamic = "force-static"
export const revalidate = 86400

const ORIGIN = "https://coasty.ai"

const RESPONSE_HEADERS = {
  "Content-Type": "application/json",
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "public, max-age=3600, s-maxage=86400",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
} as const

const manifest = {
  schema_version: "v1",
  name_for_human: "Coasty",
  name_for_model: "coasty_computer_use",
  description_for_human:
    "AI agents that operate computers — predict UI actions, run virtual machines, schedule automation.",
  description_for_model:
    "Coasty exposes computer-use AI tools: predict UI actions from screenshots, ground UI elements, run OCR, provision/control virtual machines, and schedule recurring automation jobs. Authenticate with sk-coasty-{live|test}-* API keys. Sandbox keys are free. Use /api/pricing to budget calls. Full /v1/* surface is documented at /.well-known/openapi.json. For native MCP integration, install @coasty/mcp via npm.",
  auth: {
    type: "user_http",
    authorization_type: "bearer",
  },
  api: {
    type: "openapi",
    url: `${ORIGIN}/.well-known/openapi.json`,
    has_user_authentication: true,
  },
  logo_url: `${ORIGIN}/icon-512.svg`,
  contact_email: "founders@coasty.ai",
  legal_info_url: `${ORIGIN}/terms`,
  // Custom extensions readable by modern agents:
  x_coasty: {
    discovery_manifest: `${ORIGIN}/api/discovery`,
    pricing_endpoint: `${ORIGIN}/api/pricing`,
    mcp_install: "npx -y @coasty/mcp",
    mcp_server_card: `${ORIGIN}/.well-known/mcp/server-card.json`,
    sandbox_keys: "sk-coasty-test-* (free, in-memory mocks)",
  },
} as const

export async function GET() {
  return NextResponse.json(manifest, { headers: RESPONSE_HEADERS })
}

export async function HEAD() {
  return new NextResponse(null, { headers: RESPONSE_HEADERS })
}

export async function OPTIONS() {
  return new NextResponse(null, { headers: RESPONSE_HEADERS })
}
