import Link from "next/link"
import { notFound } from "next/navigation"
import { LandingHeader } from "@/app/components/landing/landing-header"
import { LandingFooter } from "@/app/components/landing/landing-footer"
import { ArrowLeft, ArrowRight } from "lucide-react"
import { InternalLinks } from "@/components/seo/internal-links"
import { FeaturedThumbnail } from "@/components/blog/post-thumbnail"
import { JsonLd } from "@/app/components/seo/json-ld"
import { getBlogPost } from "@/lib/blog/api"
import type { ContentBlock } from "@/lib/blog/types"

// Match the upstream Supabase cache window (60s s-maxage / 300s SWR) so
// crawlers see near-fresh content without per-request round-trips.
export const revalidate = 300

/**
 * Individual blog post — Server Component.
 *
 * Fetches the post directly from the Supabase data layer (no internal HTTP
 * hop) and renders the article body in the initial HTML so SEO crawlers
 * and AI search bots (Claude web_search, Perplexity-User, Bingbot) see the
 * full article text on first byte. Emits BlogPosting JSON-LD per the
 * schema.org spec, including articleBody so AI agents can quote the post
 * without a second request. The sibling `[id]/layout.tsx` already handles
 * `generateMetadata` for OpenGraph/Twitter — we don't duplicate it here.
 */
export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const post = await getBlogPost(id)

  if (!post) {
    notFound()
  }

  const formatDate = (date: string) =>
    new Date(date).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    })

  // Flatten ContentBlock[] → plain text for `articleBody`. JSON-LD wants a
  // single string the model can quote; we join section text and bullets
  // with newlines so paragraph boundaries survive.
  const articleBody = (post.content as ContentBlock[])
    .map((block) => {
      const parts: string[] = []
      if (block.title) parts.push(block.title)
      if (block.text) parts.push(block.text)
      if (block.bullets?.length) parts.push(block.bullets.join("\n"))
      return parts.join("\n")
    })
    .filter(Boolean)
    .join("\n\n")

  const description = post.meta_description || post.excerpt

  const postingJsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description,
    image: "https://coasty.ai/demo-screenshot.png",
    datePublished: post.date,
    dateModified: post.updated_at || post.date,
    author: { "@type": "Person", name: post.author },
    publisher: {
      "@type": "Organization",
      name: "Coasty",
      logo: {
        "@type": "ImageObject",
        url: "https://coasty.ai/logo_dark.svg",
      },
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": `https://coasty.ai/blog/${post.id}`,
    },
    articleBody,
    articleSection: post.category,
    keywords: post.keywords?.join(", "),
  }

  return (
    <div className="relative min-h-screen bg-background isolate overflow-x-clip">
      <JsonLd data={postingJsonLd} />
      <LandingHeader />

      <main className="pt-32 sm:pt-36 pb-24">
        {/* Back link */}
        <div className="max-w-3xl mx-auto px-7 sm:px-10 mb-10">
          <Link
            href="/blog"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground/50 hover:text-foreground transition-colors duration-200"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Blog
          </Link>
        </div>

        {/* Article header */}
        <article>
          <header className="max-w-3xl mx-auto px-7 sm:px-10 mb-12">
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/40 mb-4 block">
              {post.category}
            </span>
            <h1 className="text-3xl sm:text-4xl lg:text-[2.75rem] font-bold tracking-tight leading-[1.12] mb-6">
              {post.title}
            </h1>
            <div className="flex items-center gap-4 text-sm text-muted-foreground/50">
              <span>{post.author}</span>
              <span className="text-muted-foreground/20">|</span>
              <time dateTime={post.date}>{formatDate(post.date)}</time>
              <span className="text-muted-foreground/20">|</span>
              <span>{post.read_time}</span>
            </div>
          </header>

          {/* Hero thumbnail */}
          <div className="max-w-3xl mx-auto px-7 sm:px-10 mb-12">
            <FeaturedThumbnail postId={post.id} />
          </div>

          {/* Article content — rendered server-side so the full text is in
              the initial HTML for crawlers and AI search bots. */}
          <div className="max-w-3xl mx-auto px-7 sm:px-10">
            <div className="space-y-8">
              {(post.content as ContentBlock[]).map((block, idx) => {
                if (block.type === "intro") {
                  return (
                    <p
                      key={idx}
                      className="text-lg sm:text-xl text-muted-foreground leading-relaxed"
                    >
                      {block.text}
                    </p>
                  )
                }
                if (block.type === "section") {
                  return (
                    <div key={idx} className="space-y-4">
                      {block.title && (
                        <h2 className="text-xl sm:text-2xl font-semibold tracking-tight">
                          {block.title}
                        </h2>
                      )}
                      {block.text && (
                        <p className="text-muted-foreground leading-relaxed">
                          {block.text}
                        </p>
                      )}
                      {block.bullets && (
                        <ul className="space-y-2.5 pl-1">
                          {block.bullets.map((bullet, bIdx) => (
                            <li
                              key={bIdx}
                              className="flex items-start gap-3 text-muted-foreground leading-relaxed"
                            >
                              <span className="text-muted-foreground/30 mt-1.5 text-xs">
                                &#9679;
                              </span>
                              {bullet}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )
                }
                if (block.type === "highlight") {
                  return (
                    <div
                      key={idx}
                      className="border-l-2 border-foreground/20 pl-6 py-1"
                    >
                      <p className="text-foreground font-medium text-lg leading-relaxed">
                        {block.text}
                      </p>
                    </div>
                  )
                }
                if (block.type === "conclusion") {
                  return (
                    <div key={idx} className="pt-4 border-t border-border/20">
                      <p className="text-muted-foreground leading-relaxed italic">
                        {block.text}
                      </p>
                    </div>
                  )
                }
                return null
              })}
            </div>
          </div>
        </article>

        {/* Internal Links (client island — fetches related posts) */}
        <div className="max-w-3xl mx-auto px-7 sm:px-10 mt-16">
          <InternalLinks
            currentType="blog"
            currentId={post.id}
            category={post.category}
          />
        </div>

        {/* Bottom CTA */}
        <div className="max-w-3xl mx-auto px-7 sm:px-10 mt-20">
          <div className="border-t border-border/30 pt-12">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
              <div>
                <p className="text-sm text-muted-foreground/60 mb-1">
                  Want to see this in action?
                </p>
                <Link
                  href="/results"
                  className="text-sm text-foreground/70 hover:text-foreground transition-colors inline-flex items-center gap-1"
                >
                  View Case Studies <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
              <Link
                href="/auth"
                className="inline-flex items-center gap-2.5 rounded-full font-semibold text-background bg-foreground px-7 py-3 text-sm cursor-pointer transition-transform duration-150 hover:scale-[1.02] hover:-translate-y-px active:scale-[0.98]"
              >
                Try Coasty Free
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </main>

      <LandingFooter />
    </div>
  )
}
