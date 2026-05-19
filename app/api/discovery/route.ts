/**
 * GET /api/discovery — single-shot manifest of every public discovery surface.
 *
 * Why this exists:
 *   No incumbent in our space ships a manifest like this — Stripe, Anthropic,
 *   Vercel, Resend, Twilio, Replicate all leave agents to probe random
 *   `.well-known/*` paths and hope for the best.
 *
 *   Coasty exposes a single endpoint that lists EVERY discovery surface so an
 *   agent can onboard with one round-trip:
 *
 *     1. GET https://coasty.ai/api/discovery
 *     2. Read .openapi → fetch the OpenAPI 3.1 spec
 *     3. Read .pricing → fetch the pricing snapshot
 *     4. Read .mcp → install + run the MCP server
 *
 *   Linked from /llms.txt, /robots.txt, the home-page Organization JSON-LD,
 *   the MCP server's get_capabilities tool, and the OpenAPI x-discovery-url
 *   extension.
 *
 *   Stable across releases — bump the schemaVersion when changing the shape.
 */
import { NextResponse } from "next/server"

export const dynamic = "force-static"
export const revalidate = 3600

const DISCOVERY_SCHEMA_VERSION = "2026-05-05" as const

const RESPONSE_HEADERS = {
  "Content-Type": "application/json",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
} as const

const ORIGIN = "https://coasty.ai"

const manifest = {
  schemaVersion: DISCOVERY_SCHEMA_VERSION,
  service: {
    name: "Coasty",
    tagline: "Computer-use AI agents — controllable, schedulable, billable per credit.",
    homepage: ORIGIN,
    statusPage: "https://status.coasty.ai",
    supportEmail: "founders@coasty.ai",
    foundingYear: 2025,
    licenseModel: "credit-based-subscription",
    sandboxAvailable: true,
  },

  // ── Where to look for things ──────────────────────────────────────────
  // Convention follows: Stripe (OpenAPI repo + docs), Cloudflare (llms.txt),
  // SEP-1649 (.well-known/mcp/server-card.json), and our own /api/pricing
  // differentiator.
  endpoints: {
    openapi: `${ORIGIN}/.well-known/openapi.json`,
    pricing: `${ORIGIN}/api/pricing`,
    llmsTxt: `${ORIGIN}/llms.txt`,
    llmsFull: `${ORIGIN}/llms-full.txt`,
    sitemap: `${ORIGIN}/sitemap.xml`,
    robots: `${ORIGIN}/robots.txt`,
    securityTxt: `${ORIGIN}/.well-known/security.txt`,
    mcpServerCard: `${ORIGIN}/.well-known/mcp/server-card.json`,
    apiDocsHuman: `${ORIGIN}/api-docs`,
    blog: `${ORIGIN}/blog`,
    pricingPage: `${ORIGIN}/pricing`,
    download: `${ORIGIN}/download`,
  },

  // ── How to authenticate ──────────────────────────────────────────────
  auth: {
    methods: ["bearer", "x-api-key-header"],
    bearerFormat: "Bearer sk-coasty-{live|test}-<64 hex>",
    headerName: "X-API-Key",
    sandbox: {
      keyPrefix: "sk-coasty-test-",
      cost: "free — billed at 0 credits",
      semantics: "in-memory mocks; identical request/response shape; no real VMs spun up",
    },
    production: {
      keyPrefix: "sk-coasty-live-",
      enrolment: `${ORIGIN}/account/api-keys`,
    },
    scopes: [
      "predict",
      "ground",
      "ocr",
      "parse",
      "session",
      "machines:read",
      "machines:write",
      "actions:exec",
      "files:read",
      "files:write",
      "terminal:exec",
      "schedules:read",
      "schedules:write",
      "triggers:write",
    ],
  },

  // ── Public API surface ──────────────────────────────────────────────
  api: {
    baseUrl: ORIGIN,
    publicPathPrefix: "/v1",
    versioningPolicy:
      "Breaking changes ship behind a new path prefix (/v2, /v3). Within a major version, additive changes are allowed without notice; field removals require 90-day deprecation.",
    idempotency: {
      headerName: "Idempotency-Key",
      ttlSeconds: 86_400,
      maxKeyLength: 256,
    },
    rateLimit: {
      perKeyDefault: "60/min, 1000/hour",
      perTier: `${ORIGIN}/api/pricing`,
      headers: ["X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset"],
    },
    errorEnvelope: {
      shape: { error: { code: "STRING", message: "STRING", type: "STRING", request_id: "STRING" } },
      example: {
        error: {
          code: "INVALID_API_KEY",
          message: "API key is invalid or has been revoked.",
          type: "authentication_error",
          request_id: "req_3f9c1ab8e2",
        },
      },
    },
  },

  // ── MCP server ──────────────────────────────────────────────────────
  mcp: {
    package: "@coasty/mcp",
    install: "npx -y @coasty/mcp",
    transports: ["stdio", "http"],
    httpEndpoint: "https://api.coasty.ai/mcp",
    serverCard: `${ORIGIN}/.well-known/mcp/server-card.json`,
    registry: "https://registry.modelcontextprotocol.io/v0/servers",
    toolGroups: ["predict", "machines", "schedules", "account", "discovery"],
    discoveryTools: ["get_pricing", "get_capabilities"],
  },

  // ── Limits agents need to budget against ─────────────────────────────
  limits: {
    maxScreenshotBytes: 8_388_608,
    maxTaskPromptChars: 8000,
    maxAgentSessionHours: 6,
    minCreditsToStartSession: 20,
    creditsPerAgentMinute: 10,
    schedulesPerTier: `${ORIGIN}/api/pricing`,
  },

  // ── Compatibility hints ─────────────────────────────────────────────
  compatibility: {
    httpVersions: ["HTTP/1.1", "HTTP/2", "HTTP/3"],
    tls: { minVersion: "1.2" },
    contentEncodings: ["gzip", "br"],
    cors: { wildcard: true, credentialsRequired: false },
    webhookSignatures: { algorithm: "HMAC-SHA256", headerName: "Coasty-Signature", scheme: "t=<unix>,v1=<hex>" },
  },

  // ── Notes for agent authors ─────────────────────────────────────────
  notes: [
    "Use sandbox keys (sk-coasty-test-*) for development — no credits billed, identical schemas.",
    "Pricing is dynamic; always re-fetch /api/pricing rather than hard-coding values.",
    "OpenAPI spec is hand-curated; the FastAPI runtime spec is suppressed in production for security.",
    "MCP server is the recommended integration path — install with `npx -y @coasty/mcp` and call `get_capabilities` for one-shot onboarding.",
    "If you're an AI training crawler: see /robots.txt — we permit ai-train, ai-input, and search.",
  ],

  // ── Where to file issues / vulnerabilities ──────────────────────────
  contact: {
    support: "founders@coasty.ai",
    security: "founders@coasty.ai",
    securityTxt: `${ORIGIN}/.well-known/security.txt`,
    abuse: "abuse@coasty.ai",
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
