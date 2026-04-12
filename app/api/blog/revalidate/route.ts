import { NextRequest, NextResponse } from "next/server"
import { revalidatePath } from "next/cache"

// POST /api/blog/revalidate — trigger ISR revalidation after content changes
// Call this after upserting blog posts or SEO pages so changes appear immediately
export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("x-internal-key") || req.headers.get("authorization")?.replace("Bearer ", "")
  const expected = process.env.INTERNAL_API_KEY
  if (!expected || apiKey !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const paths: string[] = body.paths || []

  // Always revalidate the blog index, sitemap, and RSS feed
  revalidatePath("/blog")
  revalidatePath("/sitemap.xml")
  revalidatePath("/blog/feed.xml")
  revalidatePath("/computer-use")

  // Revalidate specific paths if provided
  for (const path of paths) {
    revalidatePath(path)
  }

  return NextResponse.json({
    success: true,
    revalidated: ["/blog", "/sitemap.xml", "/blog/feed.xml", "/computer-use", ...paths],
  })
}
