import { NextRequest, NextResponse } from "next/server"
import { getBlogPost } from "@/lib/blog/api"

// GET /api/blog/posts/[id] — public, returns a single blog post
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const post = await getBlogPost(id)

  if (!post) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 })
  }

  return NextResponse.json(post, {
    headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
  })
}
