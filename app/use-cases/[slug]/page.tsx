"use client"

import { useState } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { motion } from "framer-motion"
import { ArrowRight, ArrowLeft, Check, MessageSquare, Zap, ChevronDown } from "lucide-react"
import { LandingHeader } from "@/app/components/landing/landing-header"
import { LandingFooter } from "@/app/components/landing/landing-footer"
import { GuideLines } from "@/app/components/landing/guide-lines"
import { USE_CASES, USE_CASE_COLORS, getUseCaseBySlug } from "../data"
import { cn } from "@/lib/utils"

const fadeIn = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
}

const stagger = {
  visible: {
    transition: { staggerChildren: 0.1 },
  },
}

export default function UseCasePage() {
  const params = useParams()
  const slug = params.slug as string
  const uc = getUseCaseBySlug(slug)
  const [openFaq, setOpenFaq] = useState<number | null>(null)

  if (!uc) {
    return (
      <div className="relative min-h-screen bg-background">
        <GuideLines />
        <LandingHeader />
        <main className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <h1 className="text-4xl font-bold mb-4">Use case not found</h1>
            <p className="text-muted-foreground mb-8">The use case you are looking for does not exist.</p>
            <Link
              href="/use-cases"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-primary text-primary-foreground font-medium hover:opacity-90 transition-opacity"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to use cases
            </Link>
          </div>
        </main>
        <LandingFooter />
      </div>
    )
  }

  const colors = USE_CASE_COLORS[uc.color]
  const Icon = uc.icon
  const otherUseCases = USE_CASES.filter((u) => u.slug !== uc.slug).slice(0, 3)

  return (
    <div className="relative min-h-screen bg-background">
      <GuideLines />
      <LandingHeader />

      <main>
        {/* Hero Section */}
        <section className="pt-32 pb-16 px-6">
          <div className="max-w-5xl mx-auto">
            <motion.div
              initial="hidden"
              animate="visible"
              variants={stagger}
            >
              <motion.div variants={fadeIn} transition={{ duration: 0.5 }}>
                <Link
                  href="/use-cases"
                  className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8"
                >
                  <ArrowLeft className="w-4 h-4" />
                  All use cases
                </Link>
              </motion.div>

              <motion.div
                variants={fadeIn}
                transition={{ duration: 0.5, delay: 0.05 }}
                className="mb-6"
              >
                <span
                  className={cn(
                    "inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium border",
                    colors.bg,
                    colors.text,
                    colors.border
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {uc.label}
                </span>
              </motion.div>

              <motion.h1
                variants={fadeIn}
                transition={{ duration: 0.5, delay: 0.1 }}
                className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight mb-6"
              >
                {uc.headline}
              </motion.h1>

              <motion.p
                variants={fadeIn}
                transition={{ duration: 0.5, delay: 0.15 }}
                className="text-lg text-muted-foreground max-w-2xl mb-12"
              >
                {uc.description}
              </motion.p>

              <motion.div
                variants={fadeIn}
                transition={{ duration: 0.5, delay: 0.2 }}
                className="mb-12"
              >
                <span className={cn("text-7xl lg:text-8xl font-bold", colors.text)}>
                  {uc.heroStat}
                </span>
                <p className="text-lg text-muted-foreground mt-2">{uc.heroStatLabel}</p>
              </motion.div>

              <motion.div variants={fadeIn} transition={{ duration: 0.5, delay: 0.25 }}>
                <Link
                  href="/auth"
                  className={cn(
                    "inline-flex items-center gap-2 px-8 py-4 rounded-full text-white font-medium text-lg transition-opacity hover:opacity-90",
                    colors.bgSolid
                  )}
                >
                  Try this now
                  <ArrowRight className="w-5 h-5" />
                </Link>
              </motion.div>
            </motion.div>
          </div>
        </section>

        {/* How it Works */}
        <section className="py-24 px-6">
          <div className="max-w-4xl mx-auto">
            <motion.h2
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={fadeIn}
              transition={{ duration: 0.5 }}
              className="text-3xl sm:text-4xl font-bold mb-16"
            >
              How it works
            </motion.h2>

            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={stagger}
              className="space-y-12"
            >
              {uc.steps.map((step, i) => (
                <motion.div
                  key={i}
                  variants={fadeIn}
                  transition={{ duration: 0.5 }}
                  className="flex gap-6"
                >
                  <div className="flex-shrink-0">
                    <span className={cn("text-3xl font-bold", colors.text)}>
                      {String(i + 1).padStart(2, "0")}
                    </span>
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold mb-2">{step.title}</h3>
                    <p className="text-muted-foreground">{step.description}</p>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </section>

        {/* What You Get */}
        <section className="py-24 px-6 border-t border-border/40">
          <div className="max-w-4xl mx-auto">
            <motion.h2
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={fadeIn}
              transition={{ duration: 0.5 }}
              className="text-3xl sm:text-4xl font-bold mb-12"
            >
              What you get
            </motion.h2>

            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={stagger}
              className="grid grid-cols-1 md:grid-cols-2 gap-4"
            >
              {uc.deliverables.map((item, i) => (
                <motion.div
                  key={i}
                  variants={fadeIn}
                  transition={{ duration: 0.4 }}
                  className="flex items-start gap-3 p-4 rounded-xl border border-border/40 bg-card/50"
                >
                  <Check className={cn("w-5 h-5 mt-0.5 flex-shrink-0", colors.text)} />
                  <span className="text-sm">{item}</span>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </section>

        {/* Example Prompt */}
        <section className="py-24 px-6 border-t border-border/40">
          <div className="max-w-4xl mx-auto">
            <motion.h2
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={fadeIn}
              transition={{ duration: 0.5 }}
              className="text-3xl sm:text-4xl font-bold mb-8"
            >
              Try it yourself
            </motion.h2>

            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={fadeIn}
              transition={{ duration: 0.5, delay: 0.1 }}
              className={cn(
                "rounded-2xl border p-6 sm:p-8 mb-8",
                colors.border,
                "bg-muted/30"
              )}
            >
              <div className="flex items-center gap-2 mb-4">
                <MessageSquare className={cn("w-4 h-4", colors.text)} />
                <span className="text-sm font-medium text-muted-foreground">Example prompt</span>
              </div>
              <p className="text-base sm:text-lg leading-relaxed">{uc.examplePrompt}</p>
            </motion.div>

            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={fadeIn}
              transition={{ duration: 0.5, delay: 0.2 }}
            >
              <Link
                href="/auth"
                className={cn(
                  "inline-flex items-center gap-2 px-8 py-4 rounded-full text-white font-medium transition-opacity hover:opacity-90",
                  colors.bgSolid
                )}
              >
                Run this on Coasty
                <ArrowRight className="w-5 h-5" />
              </Link>
            </motion.div>
          </div>
        </section>

        {/* FAQ Section */}
        <section className="py-24 px-6 border-t border-border/40">
          <div className="max-w-3xl mx-auto">
            <motion.h2
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={fadeIn}
              transition={{ duration: 0.5 }}
              className="text-3xl sm:text-4xl font-bold mb-12"
            >
              Common questions
            </motion.h2>

            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={stagger}
              className="space-y-3"
            >
              {uc.faqs.map((faq, i) => (
                <motion.div
                  key={i}
                  variants={fadeIn}
                  transition={{ duration: 0.4 }}
                  className="rounded-xl border border-border/40 overflow-hidden"
                >
                  <button
                    onClick={() => setOpenFaq(openFaq === i ? null : i)}
                    className="w-full flex items-center justify-between gap-4 p-5 text-left hover:bg-muted/30 transition-colors"
                  >
                    <span className="font-medium">{faq.q}</span>
                    <ChevronDown
                      className={cn(
                        "w-5 h-5 flex-shrink-0 text-muted-foreground transition-transform duration-200",
                        openFaq === i && "rotate-180"
                      )}
                    />
                  </button>
                  <div
                    className={cn(
                      "grid transition-all duration-200 ease-in-out",
                      openFaq === i ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                    )}
                  >
                    <div className="overflow-hidden">
                      <p className="px-5 pb-5 text-muted-foreground">{faq.a}</p>
                    </div>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </section>

        {/* Bottom CTA */}
        <section className="py-24 px-6 border-t border-border/40">
          <div className="max-w-4xl mx-auto text-center">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={stagger}
            >
              <motion.h2
                variants={fadeIn}
                transition={{ duration: 0.5 }}
                className="text-3xl sm:text-4xl font-bold mb-6"
              >
                Ready to get started?
              </motion.h2>

              <motion.div
                variants={fadeIn}
                transition={{ duration: 0.5, delay: 0.1 }}
                className="mb-4"
              >
                <span className={cn("text-6xl lg:text-7xl font-bold", colors.text)}>
                  {uc.heroStat}
                </span>
                <p className="text-lg text-muted-foreground mt-2">{uc.heroStatLabel}</p>
              </motion.div>

              <motion.div
                variants={fadeIn}
                transition={{ duration: 0.5, delay: 0.2 }}
                className="mt-10"
              >
                <Link
                  href="/auth"
                  className={cn(
                    "inline-flex items-center gap-2 px-8 py-4 rounded-full text-white font-medium text-lg transition-opacity hover:opacity-90",
                    colors.bgSolid
                  )}
                >
                  Get started free
                  <Zap className="w-5 h-5" />
                </Link>
              </motion.div>
            </motion.div>
          </div>
        </section>

        {/* Other Use Cases */}
        <section className="py-24 px-6 border-t border-border/40">
          <div className="max-w-5xl mx-auto">
            <motion.h2
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={fadeIn}
              transition={{ duration: 0.5 }}
              className="text-3xl sm:text-4xl font-bold mb-12"
            >
              Explore more use cases
            </motion.h2>

            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={stagger}
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6"
            >
              {otherUseCases.map((other) => {
                const otherColors = USE_CASE_COLORS[other.color]
                const OtherIcon = other.icon
                return (
                  <motion.div
                    key={other.slug}
                    variants={fadeIn}
                    transition={{ duration: 0.4 }}
                  >
                    <Link
                      href={`/use-cases/${other.slug}`}
                      className="block p-6 rounded-2xl border border-border/40 bg-card/50 hover:bg-card/80 transition-colors group"
                    >
                      <div className={cn("inline-flex p-2.5 rounded-xl mb-4", otherColors.bg)}>
                        <OtherIcon className={cn("w-5 h-5", otherColors.text)} />
                      </div>
                      <h3 className="font-semibold mb-2 group-hover:underline">{other.label}</h3>
                      <p className="text-sm text-muted-foreground line-clamp-2">{other.headline}</p>
                      <div className="flex items-center gap-1 mt-4 text-sm font-medium">
                        Learn more
                        <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                      </div>
                    </Link>
                  </motion.div>
                )
              })}
            </motion.div>
          </div>
        </section>
      </main>

      <LandingFooter />
    </div>
  )
}
