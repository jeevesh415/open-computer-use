"use client"

import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { useEffect, useState } from "react"
import type { BlogPostListItem } from "@/lib/blog/types"

interface InternalLinksProps {
  currentType: "blog" | "computer-use" | "compare" | "use-case"
  currentId: string
  category?: string
}

const COMPARE_PAGES = [
  { slug: "anthropic-computer-use", label: "Coasty vs Anthropic Computer Use" },
  { slug: "openai-operator", label: "Coasty vs OpenAI Operator" },
  { slug: "adept-ai", label: "Coasty vs Adept AI" },
  { slug: "multion", label: "Coasty vs Multion" },
  { slug: "browserbase", label: "Coasty vs Browserbase" },
  { slug: "induced-ai", label: "Coasty vs Induced AI" },
  { slug: "uipath", label: "Coasty vs UiPath" },
  { slug: "automation-anywhere", label: "Coasty vs Automation Anywhere" },
  { slug: "devin-ai", label: "Coasty vs Devin AI" },
]

const USE_CASE_PAGES = [
  { slug: "competitor-intel", label: "AI Competitor Intelligence" },
  { slug: "qa-bug-reports", label: "AI QA Bug Reports" },
  { slug: "seo-gap-analysis", label: "AI SEO Gap Analysis" },
  { slug: "data-extraction", label: "AI Data Extraction" },
  { slug: "lead-generation", label: "AI Lead Generation" },
  { slug: "site-audit", label: "AI Site Audit" },
  { slug: "email-outreach", label: "AI Email Outreach" },
  { slug: "market-research", label: "AI Market Research" },
]

export function InternalLinks({ currentType, currentId, category }: InternalLinksProps) {
  const [relatedPosts, setRelatedPosts] = useState<BlogPostListItem[]>([])

  useEffect(() => {
    fetch("/api/blog/posts")
      .then((res) => res.json())
      .then((data) => {
        if (!Array.isArray(data)) return
        // Show posts from same category, excluding current post
        const filtered = data
          .filter((p: BlogPostListItem) => p.id !== currentId)
          .filter((p: BlogPostListItem) => !category || p.category === category || data.indexOf(p) < 5)
          .slice(0, 3)
        setRelatedPosts(filtered)
      })
      .catch(() => {})
  }, [currentId, category])

  // Pick relevant cross-links based on current page type
  const compareLinks = COMPARE_PAGES.filter((p) => p.slug !== currentId).slice(0, 3)
  const useCaseLinks = USE_CASE_PAGES.filter((p) => p.slug !== currentId).slice(0, 3)

  return (
    <div className="space-y-8">
      {/* Related blog posts */}
      {relatedPosts.length > 0 && currentType !== "blog" && (
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted-foreground/50 mb-4">
            From the Blog
          </h3>
          <div className="space-y-2">
            {relatedPosts.map((post) => (
              <Link
                key={post.id}
                href={`/blog/${post.id}`}
                className="flex items-center justify-between group py-2 border-b border-border/20 last:border-0"
              >
                <span className="text-sm text-foreground/70 group-hover:text-foreground transition-colors line-clamp-1">
                  {post.title}
                </span>
                <ArrowRight className="h-3 w-3 text-muted-foreground/30 group-hover:text-foreground/50 transition-colors flex-shrink-0 ml-4" />
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Related blog posts for blog pages */}
      {relatedPosts.length > 0 && currentType === "blog" && (
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted-foreground/50 mb-4">
            Related Articles
          </h3>
          <div className="space-y-2">
            {relatedPosts.map((post) => (
              <Link
                key={post.id}
                href={`/blog/${post.id}`}
                className="flex items-center justify-between group py-2 border-b border-border/20 last:border-0"
              >
                <span className="text-sm text-foreground/70 group-hover:text-foreground transition-colors line-clamp-1">
                  {post.title}
                </span>
                <ArrowRight className="h-3 w-3 text-muted-foreground/30 group-hover:text-foreground/50 transition-colors flex-shrink-0 ml-4" />
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Compare pages */}
      {currentType !== "compare" && (
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted-foreground/50 mb-4">
            Compare Coasty
          </h3>
          <div className="flex flex-wrap gap-2">
            {compareLinks.map((page) => (
              <Link
                key={page.slug}
                href={`/compare/${page.slug}`}
                className="text-xs text-muted-foreground/60 hover:text-foreground border border-border/30 hover:border-border/60 rounded-full px-3 py-1 transition-colors"
              >
                {page.label}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Use case pages */}
      {currentType !== "use-case" && (
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted-foreground/50 mb-4">
            Computer Use For
          </h3>
          <div className="flex flex-wrap gap-2">
            {useCaseLinks.map((page) => (
              <Link
                key={page.slug}
                href={`/use-cases/${page.slug}`}
                className="text-xs text-muted-foreground/60 hover:text-foreground border border-border/30 hover:border-border/60 rounded-full px-3 py-1 transition-colors"
              >
                {page.label}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Computer Use hub */}
      <div>
        <Link
          href="/computer-use"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground/50 hover:text-foreground transition-colors"
        >
          Explore all Computer Use capabilities <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  )
}
