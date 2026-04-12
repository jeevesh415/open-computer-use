import { getBlogPosts } from "@/lib/blog/api"

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toRFC2822(dateStr: string): string {
  const date = new Date(dateStr + "T12:00:00Z");
  return date.toUTCString();
}

export const dynamic = "force-dynamic"

export async function GET() {
  const blogPosts = await getBlogPosts()

  if (blogPosts.length === 0) {
    return new Response("<rss></rss>", {
      headers: { "Content-Type": "application/xml" },
    })
  }

  const lastBuildDate = toRFC2822(blogPosts[0].date);

  const items = blogPosts
    .map(
      (post) => `    <item>
      <title>${escapeXml(post.title)}</title>
      <link>https://coasty.ai/blog/${post.id}</link>
      <description>${escapeXml(post.excerpt)}</description>
      <pubDate>${toRFC2822(post.date)}</pubDate>
      <guid isPermaLink="true">https://coasty.ai/blog/${post.id}</guid>
      <author>${escapeXml(post.author)}</author>
    </item>`
    )
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Coasty Blog - AI Agent Insights &amp; Computer Use Research</title>
    <description>Deep dives into autonomous AI agents, computer use technology, real-world case studies, and the future of AI employees. From the team behind the #1 ranked computer-using agent.</description>
    <link>https://coasty.ai/blog</link>
    <atom:link href="https://coasty.ai/blog/feed.xml" rel="self" type="application/rss+xml" />
    <language>en-us</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
