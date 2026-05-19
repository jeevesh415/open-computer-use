"use client"

/**
 * FAQSection — minimal, single-column Q&A list.
 *
 * One question expands at a time. The list rows are not cards — separated
 * by a single hairline rule so the eye reads them as a continuous sequence.
 * A single inline CTA sits below the list for visitors who still need to
 * talk to a human.
 */

import { motion, AnimatePresence } from "framer-motion"
import { useState } from "react"
import { Plus, ArrowUpRight } from "lucide-react"
import { cn } from "@/lib/utils"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { LandingSectionHeader, LandingSectionTopGlow } from "../section-shell"

const FAQ_KEYS = ["whatIsCoasty", "howDifferent", "whatTasks", "whatAreCredits", "localComputer", "dataSafe"] as const

const EASE = [0.22, 1, 0.36, 1] as const

export function FAQSection({ isMobile }: { isMobile: boolean }) {
  const t = useTranslations()
  const [activeIndex, setActiveIndex] = useState<number | null>(null)

  const handleToggle = (index: number) => {
    setActiveIndex((current) => (current === index ? null : index))
  }

  return (
    <section
      id="faq"
      className={cn(
        "relative py-20 sm:py-24 lg:py-32 px-8 sm:px-10",
        // 2xl-only side padding clears the hero task-shot gutter cards
        // (~280px deep on each side at 1536px+).
        "2xl:px-[280px]",
      )}
    >
      <LandingSectionTopGlow />
      <div className="max-w-2xl w-full mx-auto">
        <LandingSectionHeader
          title={t("faq.title")}
          subtitle={t("faq.subtitle")}
          isMobile={isMobile}
        />

        <ul className="border-t border-foreground/10" role="list">
          {FAQ_KEYS.map((faqKey, index) => {
            const isActive = activeIndex === index
            return (
              <motion.li
                key={faqKey}
                initial={{ opacity: 0, y: 8 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0, margin: "0px 0px -80px 0px" }}
                transition={{ duration: 0.5, ease: EASE, delay: index * 0.05 }}
                className="border-b border-foreground/10"
              >
                <button
                  type="button"
                  onClick={() => handleToggle(index)}
                  aria-expanded={isActive}
                  aria-controls={`faq-panel-${index}`}
                  id={`faq-trigger-${index}`}
                  className="group flex w-full items-center gap-4 py-5 sm:py-6 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20 focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-sm"
                >
                  <span
                    className={cn(
                      "flex-1 transition-colors duration-300",
                      isMobile ? "text-base" : "text-base sm:text-lg",
                      isActive
                        ? "font-medium text-foreground"
                        : "text-foreground/85 group-hover:text-foreground",
                    )}
                  >
                    {t(`faq.items.${faqKey}.question`)}
                  </span>
                  <motion.span
                    animate={{ rotate: isActive ? 45 : 0 }}
                    transition={{ duration: 0.3, ease: EASE }}
                    className={cn(
                      "shrink-0 inline-flex h-6 w-6 items-center justify-center transition-colors duration-300",
                      isActive ? "text-foreground" : "text-foreground/45 group-hover:text-foreground/80",
                    )}
                    aria-hidden
                  >
                    <Plus className="h-4 w-4" strokeWidth={1.5} />
                  </motion.span>
                </button>

                <AnimatePresence initial={false}>
                  {isActive && (
                    <motion.div
                      key="content"
                      id={`faq-panel-${index}`}
                      role="region"
                      aria-labelledby={`faq-trigger-${index}`}
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{
                        height: { duration: 0.35, ease: EASE },
                        opacity: { duration: 0.25, ease: EASE },
                      }}
                      className="overflow-hidden"
                    >
                      <p
                        className={cn(
                          "pb-6 pr-10 leading-relaxed text-muted-foreground/70",
                          isMobile ? "text-sm" : "text-[15px] sm:text-base",
                        )}
                      >
                        {t(`faq.items.${faqKey}.answer`)}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.li>
            )
          })}
        </ul>

        {/* Footer line — single inline CTA, no card chrome */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0, margin: "0px 0px -80px 0px" }}
          transition={{ duration: 0.5, ease: EASE, delay: 0.2 }}
          className={cn(
            "mt-10 flex items-center justify-center gap-2 sm:gap-3",
            isMobile ? "flex-col" : "flex-row flex-wrap",
          )}
        >
          <span
            className={cn(
              "text-foreground/60",
              isMobile ? "text-sm" : "text-sm sm:text-base",
            )}
          >
            Still have questions?
          </span>
          <Link
            href="https://cal.com/coasty/15min"
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex items-center gap-1.5 text-sm font-medium text-foreground transition-colors hover:text-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20 focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-sm"
          >
            <span className="relative">
              Book a 15-min call
              <span className="absolute -bottom-0.5 left-0 h-px w-full origin-left bg-foreground/30 transition-transform duration-300 group-hover:scale-x-0" />
            </span>
            <ArrowUpRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>
        </motion.div>
      </div>
    </section>
  )
}
