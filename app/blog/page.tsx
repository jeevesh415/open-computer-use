"use client"

import Link from "next/link"
import { cn } from "@/lib/utils"
import { LandingHeader } from "@/app/components/landing/landing-header"
import { GuideLines } from "@/app/components/landing/guide-lines"
import { LandingFooter } from "@/app/components/landing/landing-footer"
import { ArrowRight, ArrowUpRight } from "lucide-react"
import { motion } from "framer-motion"
import { useState, useEffect } from "react"
import type { BlogPostListItem } from "@/lib/blog/types"
import { PostThumbnail, FeaturedThumbnail } from "@/components/blog/post-thumbnail"

const fade = {
  hidden: { opacity: 0, y: 24 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, delay: i * 0.04, ease: [0.25, 0.1, 0.25, 1] as const },
  }),
}

export default function BlogPage() {
  const [activeCategory, setActiveCategory] = useState("All")
  const [blogPosts, setBlogPosts] = useState<BlogPostListItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/blog/posts")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setBlogPosts(data)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const categories = ["All", ...Array.from(new Set(blogPosts.map((p) => p.category)))]

  const featured = blogPosts.find((p) => p.featured)
  const filtered =
    activeCategory === "All"
      ? blogPosts.filter((p) => !p.featured)
      : blogPosts.filter((p) => p.category === activeCategory && !p.featured)

  const formatDate = (date: string) =>
    new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })

  return (
    <div className="relative min-h-screen bg-background">
      <GuideLines />
      <LandingHeader />

      <main className="pt-32 sm:pt-36 pb-24">
        {/* Header */}
        <div className="max-w-5xl mx-auto px-7 sm:px-10 mb-16">
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6 }}
            className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/50 mb-4"
          >
            Blog
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.05 }}
            className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.08] mb-5"
          >
            Insights & Updates
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-muted-foreground text-lg sm:text-xl max-w-xl leading-relaxed"
          >
            Deep dives into autonomous AI agents, real case studies, engineering decisions, and where the industry is heading.
          </motion.p>
        </div>

        {/* Category Filter */}
        <div className="max-w-5xl mx-auto px-7 sm:px-10 mb-12">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.15 }}
            className="flex flex-wrap gap-2"
          >
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={cn(
                  "rounded-full text-sm font-medium px-4 py-1.5 transition-colors duration-200",
                  activeCategory === cat
                    ? "bg-foreground text-background"
                    : "text-muted-foreground/60 hover:text-foreground border border-border/40 hover:border-border/60"
                )}
              >
                {cat}
              </button>
            ))}
          </motion.div>
        </div>

        {/* Loading state */}
        {loading && (
          <div className="max-w-5xl mx-auto px-7 sm:px-10 mb-28">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-48 rounded-xl border border-border/30 bg-card animate-pulse" />
              ))}
            </div>
          </div>
        )}

        {/* Featured Post */}
        {!loading && featured && activeCategory === "All" && (
          <div className="max-w-5xl mx-auto px-7 sm:px-10 mb-12">
            <motion.div
              initial={{ opacity: 0, y: 28 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
            >
              <Link href={`/blog/${featured.id}`}>
                <div className="group rounded-2xl overflow-hidden border border-border/40 bg-card hover:border-border/60 transition-all duration-300">
                  <FeaturedThumbnail postId={featured.id} />
                  <div className="p-8 sm:p-10">
                    <div className="flex items-start justify-between mb-6">
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground/40">
                          {featured.category}
                        </span>
                        <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-foreground/30 bg-foreground/5 px-2 py-0.5 rounded-full">
                          Featured
                        </span>
                      </div>
                      <ArrowUpRight className="h-4 w-4 text-muted-foreground/20 group-hover:text-foreground/50 transition-all duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                    </div>
                    <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3 group-hover:text-foreground/70 transition-colors duration-200">
                      {featured.title}
                    </h2>
                    <p className="text-muted-foreground text-base sm:text-lg leading-relaxed mb-6 max-w-2xl">
                      {featured.excerpt}
                    </p>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground/50">
                      <span>{featured.author}</span>
                      <span className="text-muted-foreground/20">|</span>
                      <span>{formatDate(featured.date)}</span>
                      <span className="text-muted-foreground/20">|</span>
                      <span>{featured.read_time}</span>
                    </div>
                  </div>
                </div>
              </Link>
            </motion.div>
          </div>
        )}

        {/* Post Grid */}
        {!loading && (
          <div className="max-w-5xl mx-auto px-7 sm:px-10 mb-28">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
              {filtered.map((post, i) => (
                <motion.div
                  key={post.id}
                  custom={i}
                  initial="hidden"
                  animate="show"
                  variants={fade}
                >
                  <Link href={`/blog/${post.id}`}>
                    <div className="h-full rounded-xl overflow-hidden border border-border/30 bg-card hover:border-border/60 transition-colors duration-300 flex flex-col group">
                      <PostThumbnail postId={post.id} />
                      <div className="flex flex-col flex-1 p-5 sm:p-6">
                        <div className="flex items-center justify-between mb-4">
                          <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground/40">
                            {post.category}
                          </span>
                          <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/20 group-hover:text-foreground/50 transition-all duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                        </div>
                        <h3 className="font-semibold text-foreground group-hover:text-foreground/70 transition-colors duration-200 mb-2 line-clamp-2 leading-snug">
                          {post.title}
                        </h3>
                        <p className="text-sm text-muted-foreground/70 leading-relaxed mb-4 line-clamp-3 flex-1">
                          {post.excerpt}
                        </p>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground/40 mt-auto pt-4 border-t border-border/20">
                          <span>{post.author}</span>
                          <span className="text-muted-foreground/15">|</span>
                          <span>{formatDate(post.date)}</span>
                          <span className="text-muted-foreground/15">|</span>
                          <span>{post.read_time}</span>
                        </div>
                      </div>
                    </div>
                  </Link>
                </motion.div>
              ))}
            </div>

            {filtered.length === 0 && !loading && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center py-16"
              >
                <p className="text-muted-foreground/50 text-sm">No posts in this category yet.</p>
                <button
                  onClick={() => setActiveCategory("All")}
                  className="mt-3 text-sm text-foreground/60 hover:text-foreground transition-colors underline underline-offset-4"
                >
                  View all posts
                </button>
              </motion.div>
            )}
          </div>
        )}

        {/* Divider */}
        <div className="max-w-5xl mx-auto px-7 sm:px-10">
          <div className="border-t border-border/30" />
        </div>

        {/* CTA */}
        <div className="max-w-5xl mx-auto px-7 sm:px-10">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="mt-24 sm:mt-28 text-center"
          >
            <p className="text-muted-foreground/60 text-sm mb-6">
              Want to see Coasty in action?
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/auth">
                <motion.button
                  className="inline-flex items-center gap-2.5 rounded-full font-semibold text-background bg-foreground px-8 py-3.5 text-[15px] cursor-pointer"
                  whileHover={{ scale: 1.02, y: -1 }}
                  whileTap={{ scale: 0.98 }}
                >
                  Try Coasty Free
                  <ArrowRight className="h-4 w-4" />
                </motion.button>
              </Link>
              <Link href="/results">
                <motion.button
                  className="inline-flex items-center gap-2 rounded-full font-medium text-muted-foreground hover:text-foreground border border-border/40 hover:border-border/60 px-6 py-3 text-[14px] cursor-pointer transition-colors duration-200"
                  whileHover={{ scale: 1.02, y: -1 }}
                  whileTap={{ scale: 0.98 }}
                >
                  View Case Studies
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </motion.button>
              </Link>
            </div>
            <p className="text-[11px] text-muted-foreground/30 mt-4">
              No credit card required
            </p>
          </motion.div>
        </div>
      </main>

      <LandingFooter />
    </div>
  )
}
