import { NextRequest, NextResponse } from "next/server"
import { getBlogPosts, upsertBlogPost } from "@/lib/blog/api"

// GET /api/blog/posts — public, returns all published blog posts
export async function GET() {
  const posts = await getBlogPosts()
  return NextResponse.json(posts, {
    headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
  })
}

// POST /api/blog/posts — protected, upsert a blog post
export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("x-internal-key") || req.headers.get("authorization")?.replace("Bearer ", "")
  const expected = process.env.INTERNAL_API_KEY
  if (!expected || apiKey !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json()
  if (!body.id || !body.title || !body.content) {
    return NextResponse.json({ error: "Missing required fields: id, title, content" }, { status: 400 })
  }

  const result = await upsertBlogPost({
    id: body.id,
    title: body.title,
    excerpt: body.excerpt || "",
    author: body.author || "Coasty Team",
    date: body.date || new Date().toISOString().split("T")[0],
    read_time: body.read_time || "5 min",
    category: body.category || "Product",
    featured: body.featured || false,
    content: body.content,
    keywords: body.keywords || [],
    meta_description: body.meta_description || null,
    published: body.published !== false,
  })

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 500 })
  }

  return NextResponse.json({ success: true, id: body.id })
}
