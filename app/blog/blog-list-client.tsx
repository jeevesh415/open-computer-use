"use client"

import Link from "next/link"
import { cn } from "@/lib/utils"
import { ArrowUpRight, Search, X } from "lucide-react"
import { useDeferredValue, useEffect, useMemo, useState } from "react"
import type { CSSProperties } from "react"
import type { BlogPostListItem } from "@/lib/blog/types"
import { PostThumbnail, FeaturedThumbnail } from "@/components/blog/post-thumbnail"

interface BlogListClientProps {
  posts: BlogPostListItem[]
}

const INITIAL_PAGE_SIZE = 9
const PAGE_INCREMENT = 9

/**
 * Blog index — client island.
 *
 * Server delivers the full post list (great for SEO + AI crawlers — the
 * JSON-LD block in app/blog/page.tsx also enumerates every post). The
 * client adds three things on top:
 *
 *   1. **Search** — debounced via React 19's useDeferredValue. Matches
 *      against title, excerpt, author, and category. Combines with the
 *      category chips (AND, not OR).
 *   2. **Pagination** — only INITIAL_PAGE_SIZE cards mount on first
 *      paint; "Show more" reveals PAGE_INCREMENT more at a time. Keeps
 *      the DOM small on phones with 30+ posts.
 *   3. **content-visibility: auto** per card — cards scrolled off-screen
 *      skip paint/layout entirely. Combined with the cheaper
 *      PostThumbnail (no filter/backdrop-filter), scroll is smooth even
 *      on mid-range Android.
 *
 * ─── Hit-testing rationale (kept from the previous version) ─────────────
 *
 * The <Link> IS the card. No wrapper div between the user's tap and the
 * navigation. Hover/transition classes are gated `sm:` so touch devices
 * never get them. PostThumbnail/FeaturedThumbnail set
 * pointer-events-none on their decorative children. All three
 * mitigations together resolve the iOS Safari subpixel hit-test bug that
 * forced users to double-tap. See post-thumbnail.tsx and the
 * `@media (hover: none)` block in app/globals.css for details.
 */
export function BlogListClient({ posts }: BlogListClientProps) {
  const [activeCategory, setActiveCategory] = useState("All")
  const [query, setQuery] = useState("")
  const [visibleCount, setVisibleCount] = useState(INITIAL_PAGE_SIZE)

  // useDeferredValue lets the input stay responsive while filtering large
  // lists. React schedules the filter pass as a transition so keystrokes
  // never block.
  const deferredQuery = useDeferredValue(query)
  const isStale = query !== deferredQuery

  const categories = useMemo(
    () => ["All", ...Array.from(new Set(posts.map((p) => p.category)))],
    [posts],
  )

  const featured = posts.find((p) => p.featured)

  const matches = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase()
    return posts.filter((p) => {
      if (activeCategory !== "All" && p.category !== activeCategory) return false
      if (!q) return activeCategory === "All" ? !p.featured : true
      const haystack = `${p.title} ${p.excerpt} ${p.author} ${p.category}`.toLowerCase()
      return haystack.includes(q)
    })
  }, [posts, activeCategory, deferredQuery])

  // Reset visible window whenever the filter set changes — otherwise a
  // user who scrolled "Show more" and then typed a query would see a
  // confusingly large or small result count.
  useEffect(() => {
    setVisibleCount(INITIAL_PAGE_SIZE)
  }, [activeCategory, deferredQuery])

  const visiblePosts = matches.slice(0, visibleCount)
  const hasMore = matches.length > visibleCount
  const showFeatured = featured && activeCategory === "All" && deferredQuery.trim() === ""

  const formatDate = (date: string) =>
    new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })

  return (
    <>
      {/* ── Search + filter row ─────────────────────────────────────── */}
      <div className="max-w-5xl mx-auto px-5 sm:px-10 mb-8 sm:mb-10">
        <div className="flex flex-col gap-4 sm:gap-5">
          {/* Search box */}
          <label className="group relative block">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/40 transition-colors group-focus-within:text-foreground/70"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search posts by title, topic, or author"
              aria-label="Search blog posts"
              className={cn(
                "w-full rounded-full border border-border/40 bg-background/60 backdrop-blur-[2px]",
                "pl-11 pr-11 py-3 text-[15px] placeholder:text-muted-foreground/40 text-foreground",
                "outline-none focus-visible:border-border focus-visible:ring-[3px] focus-visible:ring-foreground/[0.06] transition-colors",
                "[&::-webkit-search-cancel-button]:hidden",
              )}
              autoComplete="off"
              spellCheck={false}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-3 top-1/2 -translate-y-1/2 grid place-items-center h-7 w-7 rounded-full text-muted-foreground/50 hover:text-foreground hover:bg-foreground/[0.06] transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </label>

          {/* Category chips */}
          <div className="flex flex-wrap gap-2">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveCategory(cat)}
                className={cn(
                  "rounded-full text-sm font-medium px-4 py-1.5 touch-manipulation transition-colors duration-200",
                  activeCategory === cat
                    ? "bg-foreground text-background"
                    : "text-muted-foreground/60 sm:hover:text-foreground border border-border/40 sm:hover:border-border/60",
                )}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Result meta — only render when there's signal: an active
              query, a non-All category, or zero matches. Keeps the
              default "All / no search" view uncluttered. */}
          {(deferredQuery.trim() !== "" || activeCategory !== "All" || matches.length === 0) && (
            <p
              className={cn(
                "text-[13px] text-muted-foreground/60 transition-opacity",
                isStale ? "opacity-50" : "opacity-100",
              )}
              aria-live="polite"
            >
              {matches.length === 0 ? (
                <>No posts match your search.</>
              ) : (
                <>
                  {matches.length} {matches.length === 1 ? "post" : "posts"}
                  {deferredQuery.trim() !== "" && (
                    <> matching <span className="text-foreground/80">&ldquo;{deferredQuery.trim()}&rdquo;</span></>
                  )}
                  {activeCategory !== "All" && (
                    <> in <span className="text-foreground/80">{activeCategory}</span></>
                  )}
                </>
              )}
            </p>
          )}
        </div>
      </div>

      {/* ── Featured post (only on the default view) ─────────────────── */}
      {showFeatured && (
        <div className="max-w-5xl mx-auto px-5 sm:px-10 mb-8 sm:mb-12">
          <Link
            href={`/blog/${featured.id}`}
            aria-label={`Read featured post: ${featured.title}`}
            className={cn(
              "blog-featured-enter group block touch-manipulation rounded-2xl overflow-hidden border border-border/40 bg-card",
              "sm:hover:border-border/60 sm:transition-colors sm:duration-300",
            )}
          >
            <FeaturedThumbnail postId={featured.id} />
            <div className="p-6 sm:p-10">
              <div className="flex items-start justify-between mb-4 sm:mb-6">
                <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground/40">
                    {featured.category}
                  </span>
                  <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-foreground/30 bg-foreground/5 px-2 py-0.5 rounded-full">
                    Featured
                  </span>
                </div>
                <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground/20 sm:group-hover:text-foreground/50 sm:transition-all sm:duration-200 sm:group-hover:-translate-y-0.5 sm:group-hover:translate-x-0.5" />
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-2 sm:mb-3 sm:group-hover:text-foreground/70 sm:transition-colors sm:duration-200 leading-tight">
                {featured.title}
              </h2>
              <p className="text-muted-foreground text-base sm:text-lg leading-relaxed mb-4 sm:mb-6 max-w-2xl">
                {featured.excerpt}
              </p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:text-sm text-muted-foreground/50">
                <span>{featured.author}</span>
                <span aria-hidden="true" className="text-muted-foreground/20">·</span>
                <span>{formatDate(featured.date)}</span>
                <span aria-hidden="true" className="text-muted-foreground/20">·</span>
                <span>{featured.read_time}</span>
              </div>
            </div>
          </Link>
        </div>
      )}

      {/* ── Post grid ────────────────────────────────────────────────── */}
      <div className="max-w-5xl mx-auto px-5 sm:px-10 mb-20 sm:mb-28">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-5">
          {visiblePosts.map((post, i) => (
            <Link
              key={post.id}
              href={`/blog/${post.id}`}
              aria-label={`Read post: ${post.title}`}
              style={{
                ["--blog-card-i" as string]: i,
                // Off-screen cards skip paint+layout. The intrinsic-size
                // hint keeps scrollbar/page height stable so the
                // reservation doesn't cause layout shift when cards
                // hydrate in.
                contentVisibility: "auto",
                containIntrinsicSize: "400px 380px",
              } as CSSProperties}
              className={cn(
                "blog-card-enter group flex flex-col h-full touch-manipulation rounded-xl overflow-hidden border border-border/30 bg-card",
                "sm:hover:border-border/60 sm:transition-colors sm:duration-300",
              )}
            >
              <PostThumbnail postId={post.id} />
              <div className="flex flex-col flex-1 p-4 sm:p-6">
                <div className="flex items-center justify-between mb-3 sm:mb-4">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground/40">
                    {post.category}
                  </span>
                  <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/20 sm:group-hover:text-foreground/50 sm:transition-all sm:duration-200 sm:group-hover:-translate-y-0.5 sm:group-hover:translate-x-0.5" />
                </div>
                <h3 className="font-semibold text-foreground sm:group-hover:text-foreground/70 sm:transition-colors sm:duration-200 mb-2 line-clamp-2 leading-snug">
                  {post.title}
                </h3>
                <p className="text-sm text-muted-foreground/70 leading-relaxed mb-3 sm:mb-4 line-clamp-3 flex-1">
                  {post.excerpt}
                </p>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground/40 mt-auto pt-3 sm:pt-4 border-t border-border/20">
                  <span>{post.author}</span>
                  <span aria-hidden="true" className="text-muted-foreground/15">·</span>
                  <span>{formatDate(post.date)}</span>
                  <span aria-hidden="true" className="text-muted-foreground/15">·</span>
                  <span>{post.read_time}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>

        {/* Empty state */}
        {matches.length === 0 && (
          <div className="text-center py-16">
            <p className="text-muted-foreground/60 text-sm mb-2">
              {deferredQuery.trim() !== ""
                ? `Nothing matched "${deferredQuery.trim()}".`
                : "No posts in this category yet."}
            </p>
            <button
              type="button"
              onClick={() => {
                setActiveCategory("All")
                setQuery("")
              }}
              className="mt-2 text-sm text-foreground/70 hover:text-foreground transition-colors underline underline-offset-4 touch-manipulation"
            >
              Reset filters
            </button>
          </div>
        )}

        {/* Pagination — Load more */}
        {hasMore && (
          <div className="mt-10 sm:mt-12 flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={() => setVisibleCount((n) => n + PAGE_INCREMENT)}
              className="inline-flex items-center gap-2 rounded-full font-medium text-foreground border border-border/50 hover:border-border bg-background/60 hover:bg-foreground/[0.04] px-6 py-2.5 text-sm transition-colors touch-manipulation"
            >
              Show more
              <span className="text-muted-foreground/50">
                ({matches.length - visibleCount} left)
              </span>
            </button>
            <p className="text-[11px] text-muted-foreground/40">
              Showing {visiblePosts.length} of {matches.length}
            </p>
          </div>
        )}
      </div>
    </>
  )
}
