"use client"

import { useParams } from "next/navigation"
import Link from "next/link"
import { LandingHeader } from "@/app/components/landing/landing-header"
import { GuideLines } from "@/app/components/landing/guide-lines"
import { LandingFooter } from "@/app/components/landing/landing-footer"
import { ArrowLeft, ArrowRight } from "lucide-react"
import { motion } from "framer-motion"
import { notFound } from "next/navigation"
import { useState, useEffect } from "react"
import { InternalLinks } from "@/components/seo/internal-links"
import type { BlogPost } from "@/lib/blog/types"
import type { ContentBlock } from "@/lib/blog/types"
import { FeaturedThumbnail } from "@/components/blog/post-thumbnail"

export default function BlogPostPage() {
  const params = useParams()
  const [post, setPost] = useState<BlogPost | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFoundState, setNotFoundState] = useState(false)

  useEffect(() => {
    if (!params.id) return
    fetch(`/api/blog/posts/${params.id}`)
      .then((res) => {
        if (!res.ok) throw new Error("Not found")
        return res.json()
      })
      .then((data) => setPost(data))
      .catch(() => setNotFoundState(true))
      .finally(() => setLoading(false))
  }, [params.id])

  if (notFoundState) {
    notFound()
  }

  const formatDate = (date: string) =>
    new Date(date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })

  return (
    <div className="relative min-h-screen bg-background">
      <GuideLines />
      <LandingHeader />

      <main className="pt-32 sm:pt-36 pb-24">
        {/* Back link */}
        <div className="max-w-3xl mx-auto px-7 sm:px-10 mb-10">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4 }}
          >
            <Link
              href="/blog"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground/50 hover:text-foreground transition-colors duration-200"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Blog
            </Link>
          </motion.div>
        </div>

        {/* Loading state */}
        {loading && (
          <div className="max-w-3xl mx-auto px-7 sm:px-10">
            <div className="space-y-4 animate-pulse">
              <div className="h-4 w-20 bg-muted rounded" />
              <div className="h-10 w-3/4 bg-muted rounded" />
              <div className="h-4 w-48 bg-muted rounded" />
              <div className="border-t border-border/30 mt-8 pt-8" />
              <div className="h-4 w-full bg-muted rounded" />
              <div className="h-4 w-full bg-muted rounded" />
              <div className="h-4 w-2/3 bg-muted rounded" />
            </div>
          </div>
        )}

        {post && (
          <>
            {/* Article header */}
            <div className="max-w-3xl mx-auto px-7 sm:px-10 mb-12">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6 }}
              >
                <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/40 mb-4 block">
                  {post.category}
                </span>
                <h1 className="text-3xl sm:text-4xl lg:text-[2.75rem] font-bold tracking-tight leading-[1.12] mb-6">
                  {post.title}
                </h1>
                <div className="flex items-center gap-4 text-sm text-muted-foreground/50">
                  <span>{post.author}</span>
                  <span className="text-muted-foreground/20">|</span>
                  <span>{formatDate(post.date)}</span>
                  <span className="text-muted-foreground/20">|</span>
                  <span>{post.read_time}</span>
                </div>
              </motion.div>
            </div>

            {/* Hero thumbnail */}
            <div className="max-w-3xl mx-auto px-7 sm:px-10 mb-12">
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.08 }}
              >
                <FeaturedThumbnail postId={post.id} />
              </motion.div>
            </div>

            {/* Article content */}
            <div className="max-w-3xl mx-auto px-7 sm:px-10">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.15 }}
                className="space-y-8"
              >
                {(post.content as ContentBlock[]).map((block, idx) => {
                  if (block.type === "intro") {
                    return (
                      <p key={idx} className="text-lg sm:text-xl text-muted-foreground leading-relaxed">
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
                              <li key={bIdx} className="flex items-start gap-3 text-muted-foreground leading-relaxed">
                                <span className="text-muted-foreground/30 mt-1.5 text-xs">&#9679;</span>
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
              </motion.div>
            </div>

            {/* Internal Links */}
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
                    <p className="text-sm text-muted-foreground/60 mb-1">Want to see this in action?</p>
                    <Link
                      href="/results"
                      className="text-sm text-foreground/70 hover:text-foreground transition-colors inline-flex items-center gap-1"
                    >
                      View Case Studies <ArrowRight className="h-3 w-3" />
                    </Link>
                  </div>
                  <Link href="/auth">
                    <motion.button
                      className="inline-flex items-center gap-2.5 rounded-full font-semibold text-background bg-foreground px-7 py-3 text-sm cursor-pointer"
                      whileHover={{ scale: 1.02, y: -1 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      Try Coasty Free
                      <ArrowRight className="h-4 w-4" />
                    </motion.button>
                  </Link>
                </div>
              </div>
            </div>
          </>
        )}
      </main>

      <LandingFooter />
    </div>
  )
}
