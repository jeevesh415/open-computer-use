"use client"

import { useParams } from "next/navigation"
import Link from "next/link"
import { LandingHeader } from "@/app/components/landing/landing-header"
import { LandingFooter } from "@/app/components/landing/landing-footer"
import { ArrowLeft, ArrowRight } from "lucide-react"
import { motion } from "framer-motion"
import { notFound } from "next/navigation"
import { useState, useEffect } from "react"
import { InternalLinks } from "@/components/seo/internal-links"
import type { SeoPage, ContentBlock } from "@/lib/blog/types"

export default function ComputerUseTaskPage() {
  const params = useParams()
  const [page, setPage] = useState<SeoPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFoundState, setNotFoundState] = useState(false)

  useEffect(() => {
    if (!params.task) return
    fetch(`/api/blog/seo-pages`)
      .then((res) => res.json())
      .then((data) => {
        if (!Array.isArray(data)) throw new Error("Bad data")
        const found = data.find((p: SeoPage) => p.slug === params.task)
        if (!found) throw new Error("Not found")
        setPage(found)
      })
      .catch(() => setNotFoundState(true))
      .finally(() => setLoading(false))
  }, [params.task])

  if (notFoundState) {
    notFound()
  }

  return (
    <div className="relative min-h-screen bg-background">
      <LandingHeader />

      <main className="pt-32 sm:pt-36 pb-24">
        {/* Back link */}
        <div className="max-w-3xl mx-auto px-7 sm:px-10 mb-10">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
            <Link
              href="/computer-use"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground/50 hover:text-foreground transition-colors duration-200"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              All Computer Use Tasks
            </Link>
          </motion.div>
        </div>

        {/* Loading */}
        {loading && (
          <div className="max-w-3xl mx-auto px-7 sm:px-10">
            <div className="space-y-4 animate-pulse">
              <div className="h-10 w-3/4 bg-muted rounded" />
              <div className="h-4 w-full bg-muted rounded" />
              <div className="h-4 w-full bg-muted rounded" />
              <div className="h-4 w-2/3 bg-muted rounded" />
            </div>
          </div>
        )}

        {page && (
          <>
            {/* Header */}
            <div className="max-w-3xl mx-auto px-7 sm:px-10 mb-12">
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/50 mb-4">
                  Computer Use
                </p>

                {page.hero_stat && (
                  <div className="flex items-baseline gap-3 mb-4">
                    <span className="text-5xl sm:text-6xl font-bold tracking-tight">{page.hero_stat}</span>
                    {page.hero_stat_label && (
                      <span className="text-lg text-muted-foreground">{page.hero_stat_label}</span>
                    )}
                  </div>
                )}

                <h1 className="text-3xl sm:text-4xl lg:text-[2.75rem] font-bold tracking-tight leading-[1.12] mb-4">
                  {page.headline}
                </h1>
                <p className="text-muted-foreground text-lg leading-relaxed max-w-2xl">
                  {page.meta_description}
                </p>
              </motion.div>
            </div>

            {/* Divider */}
            <div className="max-w-3xl mx-auto px-7 sm:px-10 mb-12">
              <div className="border-t border-border/30" />
            </div>

            {/* Content blocks */}
            <div className="max-w-3xl mx-auto px-7 sm:px-10">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.15 }}
                className="space-y-8"
              >
                {(page.content as ContentBlock[]).map((block, idx) => {
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
                          <h2 className="text-xl sm:text-2xl font-semibold tracking-tight">{block.title}</h2>
                        )}
                        {block.text && <p className="text-muted-foreground leading-relaxed">{block.text}</p>}
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
                      <div key={idx} className="border-l-2 border-foreground/20 pl-6 py-1">
                        <p className="text-foreground font-medium text-lg leading-relaxed">{block.text}</p>
                      </div>
                    )
                  }
                  if (block.type === "conclusion") {
                    return (
                      <div key={idx} className="pt-4 border-t border-border/20">
                        <p className="text-muted-foreground leading-relaxed italic">{block.text}</p>
                      </div>
                    )
                  }
                  return null
                })}
              </motion.div>
            </div>

            {/* Internal links */}
            <div className="max-w-3xl mx-auto px-7 sm:px-10 mt-16">
              <InternalLinks
                currentType="computer-use"
                currentId={page.slug}
              />
            </div>

            {/* CTA */}
            <div className="max-w-3xl mx-auto px-7 sm:px-10 mt-20">
              <div className="border-t border-border/30 pt-12 text-center">
                <h2 className="text-xl font-bold mb-3">Automate This with Computer Use</h2>
                <p className="text-sm text-muted-foreground/60 mb-6 max-w-md mx-auto">
                  Start using Coasty to handle {page.title.toLowerCase()} tasks autonomously.
                </p>
                <Link
                  href="/auth"
                  className="inline-flex items-center gap-2.5 rounded-full font-semibold text-background bg-foreground px-7 py-3 text-sm cursor-pointer transition-transform duration-150 hover:scale-[1.02] hover:-translate-y-px active:scale-[0.98]"
                >
                  Try Coasty Free
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </>
        )}
      </main>

      <LandingFooter />
    </div>
  )
}
