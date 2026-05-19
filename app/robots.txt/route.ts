/**
 * GET /robots.txt — plain-text robots policy.
 *
 * Why a Route Handler instead of the `MetadataRoute.Robots` convention:
 *   The Next.js `MetadataRoute.Robots` type can't express Cloudflare's
 *   `Content-Signal` directive (used by Vercel, Replicate, Resend) — it only
 *   emits the standard `User-agent` / `Allow` / `Disallow` / `Sitemap` /
 *   `Crawl-delay` keys. To emit the full 2026 industry-bar robots policy
 *   (including Content-Signal + the 2025-era AI-crawler list of GPTBot,
 *   ChatGPT-User, ClaudeBot, ClaudeUser, Claude-Web, OAI-SearchBot,
 *   Applebot-Extended, CCBot, Diffbot, MistralAI-User, etc.) we serve
 *   plain text directly.
 *
 *   Replaces:
 *     - app/robots.ts                (MetadataRoute.Robots — limited)
 *     - public/robots.txt            (static — couldn't include
 *                                     Content-Signal because it was
 *                                     authored before the spec landed)
 *
 *   Next.js resolves a `route.ts` under `app/robots.txt/` to the path
 *   `/robots.txt` exactly, so this file replaces both former sources.
 *
 *   References:
 *     - https://www.cloudflare.com/content-signals
 *     - https://platform.openai.com/docs/bots
 *     - https://docs.anthropic.com/en/docs/agents-and-tools/computer-use#crawler-controls
 *     - https://support.google.com/webmasters/answer/80553 (Google-Extended)
 *     - https://support.apple.com/en-us/HT204683 (Applebot-Extended)
 */
import { NextResponse } from "next/server"

export const dynamic = "force-static"
export const revalidate = 86_400

const ROBOTS_TXT = `# https://coasty.ai/robots.txt
# Coasty allows AI training and search indexing. We're an AI-first product —
# we want crawlers to find, index, retrieve, and cite our content.
#
# Discovery surfaces for agents:
#   - https://coasty.ai/llms.txt
#   - https://coasty.ai/llms-full.txt
#   - https://coasty.ai/sitemap.xml
#   - https://coasty.ai/api/discovery
#   - https://coasty.ai/.well-known/openapi.json
#   - https://coasty.ai/.well-known/mcp/server-card.json

User-agent: *
Allow: /
Disallow: /api/
Disallow: /c/
Disallow: /account
Disallow: /onboarding
Disallow: /auth/error
Disallow: /c/*/edit
Disallow: /p/*/settings
Sitemap: https://coasty.ai/sitemap.xml

# Cloudflare Content-Signal (https://www.cloudflare.com/content-signals)
# Tells AI crawlers we welcome retrieval, AI input (RAG / search-grounding),
# and AI training. Same posture as Vercel, Replicate, Resend.
Content-Signal: search=yes, ai-input=yes, ai-train=yes

# ─── OpenAI ──────────────────────────────────────────────────────────────
User-agent: GPTBot
Allow: /
Disallow: /api/
Disallow: /c/

User-agent: ChatGPT-User
Allow: /
Disallow: /api/
Disallow: /c/

User-agent: OAI-SearchBot
Allow: /
Disallow: /api/
Disallow: /c/

# ─── Anthropic ───────────────────────────────────────────────────────────
User-agent: ClaudeBot
Allow: /
Disallow: /api/
Disallow: /c/

User-agent: ClaudeUser
Allow: /
Disallow: /api/
Disallow: /c/

User-agent: Claude-Web
Allow: /
Disallow: /api/
Disallow: /c/

User-agent: anthropic-ai
Allow: /
Disallow: /api/
Disallow: /c/

# ─── Google ──────────────────────────────────────────────────────────────
User-agent: Google-Extended
Allow: /
Disallow: /api/
Disallow: /c/

User-agent: Googlebot
Allow: /
Disallow: /api/
Crawl-delay: 0

User-agent: Googlebot-Image
Allow: /
Disallow: /api/

# ─── Apple ───────────────────────────────────────────────────────────────
User-agent: Applebot
Allow: /
Disallow: /api/

User-agent: Applebot-Extended
Allow: /
Disallow: /api/

# ─── Meta ────────────────────────────────────────────────────────────────
User-agent: FacebookBot
Allow: /
Disallow: /api/

User-agent: Meta-ExternalAgent
Allow: /
Disallow: /api/

# ─── Perplexity ──────────────────────────────────────────────────────────
User-agent: PerplexityBot
Allow: /
Disallow: /api/
Disallow: /c/

User-agent: Perplexity-User
Allow: /
Disallow: /api/
Disallow: /c/

# ─── Mistral ─────────────────────────────────────────────────────────────
User-agent: MistralAI-User
Allow: /
Disallow: /api/
Disallow: /c/

# ─── Cohere ──────────────────────────────────────────────────────────────
User-agent: cohere-ai
Allow: /
Disallow: /api/

# ─── Common Crawl ────────────────────────────────────────────────────────
User-agent: CCBot
Allow: /
Disallow: /api/

# ─── Diffbot ─────────────────────────────────────────────────────────────
User-agent: Diffbot
Allow: /
Disallow: /api/

# ─── You.com ─────────────────────────────────────────────────────────────
User-agent: YouBot
Allow: /
Disallow: /api/

# ─── Microsoft Bing ──────────────────────────────────────────────────────
User-agent: Bingbot
Allow: /
Disallow: /api/
Crawl-delay: 0

# ─── Other major search crawlers ─────────────────────────────────────────
User-agent: Slurp
Allow: /
Disallow: /api/
Crawl-delay: 1

User-agent: DuckDuckBot
Allow: /
Disallow: /api/
Crawl-delay: 1

User-agent: Yandex
Allow: /
Disallow: /api/
Crawl-delay: 2

# ─── Opt-out: aggressive scrapers ────────────────────────────────────────
# Bytedance/TikTok crawler — historically scrapes aggressively, no useful
# inbound traffic for our segment.
User-agent: Bytespider
Disallow: /

# SEO/competitor scrapers — no value to us, high server cost.
User-agent: AhrefsBot
Disallow: /

User-agent: SemrushBot
Disallow: /

User-agent: MJ12bot
Disallow: /

User-agent: DotBot
Disallow: /

User-agent: PetalBot
Disallow: /

User-agent: BLEXBot
Disallow: /
`

const HEADERS = {
  "Content-Type": "text/plain; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  // 24h CDN cache — robots.txt is not load-bearing on freshness.
  "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
} as const

export async function GET() {
  return new NextResponse(ROBOTS_TXT, { headers: HEADERS })
}

export async function HEAD() {
  return new NextResponse(null, { headers: HEADERS })
}
