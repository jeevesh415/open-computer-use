import { NextRequest, NextResponse } from "next/server"
import { getSeoPages, upsertSeoPage } from "@/lib/blog/api"

// GET /api/blog/seo-pages — public, returns all published SEO pages
export async function GET() {
  const pages = await getSeoPages()
  return NextResponse.json(pages, {
    headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
  })
}

// POST /api/blog/seo-pages — protected, upsert an SEO page
export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("x-internal-key") || req.headers.get("authorization")?.replace("Bearer ", "")
  const expected = process.env.INTERNAL_API_KEY
  if (!expected || apiKey !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json()
  if (!body.slug || !body.title || !body.content) {
    return NextResponse.json({ error: "Missing required fields: slug, title, content" }, { status: 400 })
  }

  const result = await upsertSeoPage({
    slug: body.slug,
    title: body.title,
    headline: body.headline || body.title,
    meta_description: body.meta_description || "",
    keywords: body.keywords || [],
    hero_stat: body.hero_stat || null,
    hero_stat_label: body.hero_stat_label || null,
    content: body.content,
    related_blog_ids: body.related_blog_ids || [],
    related_use_case_slugs: body.related_use_case_slugs || [],
    related_comparison_slugs: body.related_comparison_slugs || [],
    published: body.published !== false,
  })

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 500 })
  }

  return NextResponse.json({ success: true, slug: body.slug })
}
