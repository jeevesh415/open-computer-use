import Link from "next/link"
import { LandingHeader } from "@/app/components/landing/landing-header"
import { LandingFooter } from "@/app/components/landing/landing-footer"
import { ArrowRight, ArrowUpRight } from "lucide-react"
import { getBlogPosts } from "@/lib/blog/api"
import { JsonLd } from "@/app/components/seo/json-ld"
import { BlogListClient } from "./blog-list-client"

// Revalidate every 5 minutes — posts are upserted infrequently and the
// underlying Supabase fetch already has its own short cache, so 300s gives
// crawlers near-fresh content without round-tripping on every request.
export const revalidate = 300

/**
 * Blog index — Server Component.
 *
 * Data is fetched directly from the Supabase data layer (no internal HTTP
 * round-trip) so post titles, excerpts, dates, and authors land in the
 * initial HTML for SEO crawlers and AI search bots (Claude web_search,
 * Perplexity-User, Bingbot). The interactive category filter is delegated
 * to <BlogListClient />, a small client island.
 */
export default async function BlogPage() {
  const posts = await getBlogPosts()

  const blogJsonLd = {
    "@context": "https://schema.org",
    "@type": "Blog",
    name: "Coasty Blog",
    url: "https://coasty.ai/blog",
    publisher: {
      "@type": "Organization",
      name: "Coasty",
      url: "https://coasty.ai",
    },
    blogPost: posts.map((p) => ({
      "@type": "BlogPosting",
      headline: p.title,
      description: p.excerpt,
      author: { "@type": "Person", name: p.author },
      datePublished: p.date,
      url: `https://coasty.ai/blog/${p.id}`,
      articleSection: p.category,
    })),
  }

  return (
    <div className="relative min-h-screen bg-background isolate overflow-x-clip">
      <JsonLd data={blogJsonLd} />
      <LandingHeader />

      <main className="pt-32 sm:pt-36 pb-24">
        {/* Header */}
        <div className="max-w-5xl mx-auto px-7 sm:px-10 mb-16">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/50 mb-4">
            Blog
          </p>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.08] mb-5">
            Insights & Updates
          </h1>
          <p className="text-muted-foreground text-lg sm:text-xl max-w-xl leading-relaxed">
            Deep dives into autonomous AI agents, real case studies, engineering decisions, and where the industry is heading.
          </p>
        </div>

        {/* Filter + grid — client island for category interaction. The
            client component still renders server-side under RSC, so every
            post (title, excerpt, author, date, category) lands in the
            initial HTML for crawlers/AI search bots. */}
        <BlogListClient posts={posts} />

        {/* Divider */}
        <div className="max-w-5xl mx-auto px-7 sm:px-10">
          <div className="border-t border-border/30" />
        </div>

        {/* CTA */}
        <div className="max-w-5xl mx-auto px-7 sm:px-10">
          <div className="mt-24 sm:mt-28 text-center">
            <p className="text-muted-foreground/60 text-sm mb-6">
              Want to see Coasty in action?
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                href="/auth"
                className="inline-flex items-center gap-2.5 rounded-full font-semibold text-background bg-foreground px-8 py-3.5 text-[15px] cursor-pointer transition-transform duration-150 hover:scale-[1.02] hover:-translate-y-px active:scale-[0.98]"
              >
                Try Coasty Free
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/results"
                className="inline-flex items-center gap-2 rounded-full font-medium text-muted-foreground hover:text-foreground border border-border/40 hover:border-border/60 px-6 py-3 text-[14px] cursor-pointer transition-all duration-150 hover:scale-[1.02] hover:-translate-y-px active:scale-[0.98]"
              >
                View Case Studies
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            <p className="text-[11px] text-muted-foreground/30 mt-4">
              No credit card required
            </p>
          </div>
        </div>
      </main>

      <LandingFooter />
    </div>
  )
}
