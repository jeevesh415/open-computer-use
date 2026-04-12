import { Metadata } from "next"
import { getBlogPost } from "@/lib/blog/api"

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const post = await getBlogPost(id)

  if (!post) return { title: "Blog Post Not Found" }

  const description = post.meta_description || post.excerpt

  return {
    title: `${post.title} - Coasty Blog`,
    description,
    keywords: [
      ...(post.keywords || []),
      post.category, "AI agent", "computer use agent", "Coasty", "autonomous AI", "desktop automation",
    ],
    authors: [{ name: post.author }],
    openGraph: {
      title: post.title,
      description,
      url: `https://coasty.ai/blog/${id}`,
      type: "article",
      publishedTime: post.date,
      authors: [post.author],
      siteName: "Coasty Blog",
      images: [{ url: "/demo-screenshot.png", width: 1200, height: 630, alt: post.title }],
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description,
    },
    alternates: { canonical: `https://coasty.ai/blog/${id}` },
  }
}

export default function BlogPostLayout({ children }: { children: React.ReactNode }) {
  return children
}
