"use client"

import { useState } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { motion } from "framer-motion"
import { ArrowRight, ArrowLeft, Check, MessageSquare, ChevronDown } from "lucide-react"
import { LandingHeader } from "@/app/components/landing/landing-header"
import { LandingFooter } from "@/app/components/landing/landing-footer"
import { USE_CASES, getUseCaseBySlug } from "../data"
import { cn } from "@/lib/utils"

const fadeIn = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
}

const stagger = {
  visible: {
    transition: { staggerChildren: 0.08 },
  },
}

// ── Local atoms (same vocabulary as agent-swarms / 404) ────────────────────

function PrimaryButton({
  href,
  children,
  className,
}: {
  href: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex h-11 items-center gap-2 rounded-full bg-foreground px-6 text-sm font-medium text-background transition-colors hover:bg-foreground/85",
        className,
      )}
    >
      {children}
    </Link>
  )
}

function GhostButton({
  href,
  children,
  className,
}: {
  href: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex h-11 items-center gap-1.5 rounded-full border border-border bg-background/60 px-6 text-sm font-medium text-foreground backdrop-blur-sm transition-colors hover:bg-muted",
        className,
      )}
    >
      {children}
    </Link>
  )
}

function MonoTag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/60 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground backdrop-blur-sm">
      {children}
    </span>
  )
}

function SectionHeading({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <h2
      className={cn(
        "text-balance font-semibold tracking-tight text-foreground",
        "text-[26px] leading-[1.1] sm:text-3xl lg:text-4xl",
        className,
      )}
    >
      {children}
    </h2>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function UseCasePage() {
  const params = useParams()
  const slug = params.slug as string
  const uc = getUseCaseBySlug(slug)
  const [openFaq, setOpenFaq] = useState<number | null>(null)

  if (!uc) {
    return (
      <div className="relative min-h-screen bg-background">
        <LandingHeader />
        <main className="flex min-h-screen items-center justify-center px-6">
          <div className="text-center">
            <h1 className="mb-4 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              Use case not found
            </h1>
            <p className="mb-8 text-muted-foreground">
              The use case you are looking for does not exist.
            </p>
            <PrimaryButton href="/use-cases">
              <ArrowLeft className="h-4 w-4" />
              Back to use cases
            </PrimaryButton>
          </div>
        </main>
        <LandingFooter />
      </div>
    )
  }

  const Icon = uc.icon
  const otherUseCases = USE_CASES.filter((u) => u.slug !== uc.slug).slice(0, 3)

  return (
    <div className="relative min-h-screen bg-background">
      <LandingHeader />

      <main>
        {/* ── Hero ── */}
        <section className="relative overflow-hidden px-6 pt-28 pb-16 sm:pt-32 sm:pb-20">
          {/* Dotted radial backdrop — signature element */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 opacity-60 [background:radial-gradient(circle_at_center,color-mix(in_oklch,var(--foreground)_10%,transparent)_1px,transparent_1.5px)] [background-size:24px_24px] [mask-image:radial-gradient(ellipse_at_center,black_15%,transparent_70%)]"
          />

          <div className="mx-auto max-w-5xl">
            <motion.div initial="hidden" animate="visible" variants={stagger}>
              <div className="public-fade-up">
                <Link
                  href="/use-cases"
                  className="mb-10 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  All use cases
                </Link>
              </div>

              <motion.div
                variants={fadeIn}
                transition={{ duration: 0.5, delay: 0.05 }}
                className="mb-6"
              >
                <MonoTag>
                  <Icon className="h-3 w-3" />
                  {uc.label}
                </MonoTag>
              </motion.div>

              <motion.h1
                variants={fadeIn}
                transition={{ duration: 0.5, delay: 0.1 }}
                className="mb-6 text-balance font-semibold tracking-tight leading-[1.05] text-foreground text-4xl sm:text-5xl lg:text-6xl"
              >
                {uc.headline}
              </motion.h1>

              <motion.p
                variants={fadeIn}
                transition={{ duration: 0.5, delay: 0.15 }}
                className="mb-12 max-w-2xl text-balance text-base leading-relaxed text-muted-foreground sm:text-lg"
              >
                {uc.description}
              </motion.p>

              <motion.div
                variants={fadeIn}
                transition={{ duration: 0.5, delay: 0.2 }}
                className="mb-12 flex items-baseline gap-4"
              >
                <span className="font-semibold tracking-tight tabular-nums text-foreground text-6xl sm:text-7xl lg:text-8xl">
                  {uc.heroStat}
                </span>
                <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  {uc.heroStatLabel}
                </span>
              </motion.div>

              <div
                className="public-fade-up"
                style={{ ["--card-d" as string]: 250 }}
              >
                <PrimaryButton href="/auth">
                  Try this now
                  <ArrowRight className="h-4 w-4" />
                </PrimaryButton>
              </div>
            </motion.div>
          </div>
        </section>

        {/* ── How it Works ── */}
        <section className="px-6 py-20 sm:py-24">
          <div className="mx-auto max-w-4xl">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.2 }}
              variants={fadeIn}
              transition={{ duration: 0.5 }}
              className="mb-14"
            >
              <SectionHeading>How it works</SectionHeading>
            </motion.div>

            <motion.ol
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.1 }}
              variants={stagger}
              className="space-y-10 sm:space-y-12"
            >
              {uc.steps.map((step, i) => (
                <motion.li
                  key={i}
                  variants={fadeIn}
                  transition={{ duration: 0.5 }}
                  className="flex gap-5 sm:gap-7"
                >
                  <div className="flex-shrink-0 pt-1">
                    <span className="font-mono text-xs uppercase tracking-[0.22em] text-muted-foreground/50 tabular-nums">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                  </div>
                  <div className="flex-1">
                    <h3 className="mb-1.5 text-base font-semibold text-foreground sm:text-lg">
                      {step.title}
                    </h3>
                    <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">
                      {step.description}
                    </p>
                  </div>
                </motion.li>
              ))}
            </motion.ol>
          </div>
        </section>

        {/* ── What You Get ── */}
        <section className="px-6 py-20 sm:py-24">
          <div className="mx-auto max-w-4xl">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.2 }}
              variants={fadeIn}
              transition={{ duration: 0.5 }}
              className="mb-12"
            >
              <SectionHeading>What you get</SectionHeading>
            </motion.div>

            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.1 }}
              variants={stagger}
              className="grid grid-cols-1 gap-3 md:grid-cols-2"
            >
              {uc.deliverables.map((item, i) => (
                <motion.div
                  key={i}
                  variants={fadeIn}
                  transition={{ duration: 0.4 }}
                  className="flex items-start gap-3 rounded-xl border border-border/50 bg-card/30 p-4 backdrop-blur-sm transition-colors hover:border-border hover:bg-card/50"
                >
                  <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-500" />
                  <span className="text-sm leading-relaxed text-foreground/85">{item}</span>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </section>

        {/* ── Example Prompt ── */}
        <section className="px-6 py-20 sm:py-24">
          <div className="mx-auto max-w-3xl">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.2 }}
              variants={fadeIn}
              transition={{ duration: 0.5 }}
              className="mb-10"
            >
              <SectionHeading>Try it yourself</SectionHeading>
            </motion.div>

            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.1 }}
              variants={fadeIn}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="mb-8 rounded-2xl border border-border bg-card/30 p-6 backdrop-blur-sm sm:p-8"
            >
              <div className="mb-4 flex items-center gap-2">
                <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  Example prompt
                </span>
              </div>
              <p className="text-balance text-base leading-relaxed text-foreground/90 sm:text-lg">
                {uc.examplePrompt}
              </p>
            </motion.div>

            <div
              className="public-fade-up"
              style={{ ["--card-d" as string]: 200 }}
            >
              <PrimaryButton href="/auth">
                Run this on Coasty
                <ArrowRight className="h-4 w-4" />
              </PrimaryButton>
            </div>
          </div>
        </section>

        {/* ── FAQ ── */}
        <section className="px-6 py-20 sm:py-24">
          <div className="mx-auto max-w-3xl">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.2 }}
              variants={fadeIn}
              transition={{ duration: 0.5 }}
              className="mb-12"
            >
              <SectionHeading>Common questions</SectionHeading>
            </motion.div>

            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.1 }}
              variants={stagger}
              className="overflow-hidden rounded-xl border border-border/60 bg-card/20 backdrop-blur-sm"
            >
              {uc.faqs.map((faq, i) => {
                const isOpen = openFaq === i
                return (
                  <motion.div
                    key={i}
                    variants={fadeIn}
                    transition={{ duration: 0.4 }}
                    className={cn(
                      i < uc.faqs.length - 1 && "border-b border-border/40",
                    )}
                  >
                    <button
                      onClick={() => setOpenFaq(isOpen ? null : i)}
                      className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-muted/30 sm:px-6 sm:py-5"
                    >
                      <span className="text-sm font-medium text-foreground sm:text-base">
                        {faq.q}
                      </span>
                      <ChevronDown
                        className={cn(
                          "h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform duration-200",
                          isOpen && "rotate-180",
                        )}
                      />
                    </button>
                    <div
                      className={cn(
                        "grid transition-all duration-200 ease-in-out",
                        isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                      )}
                    >
                      <div className="overflow-hidden">
                        <p className="px-5 pb-5 text-sm leading-relaxed text-muted-foreground sm:px-6 sm:pb-6 sm:text-[15px]">
                          {faq.a}
                        </p>
                      </div>
                    </div>
                  </motion.div>
                )
              })}
            </motion.div>
          </div>
        </section>

        {/* ── Bottom CTA ── */}
        <section className="px-6 py-20 sm:py-24">
          <div className="mx-auto max-w-3xl text-center">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.2 }}
              variants={stagger}
            >
              <motion.div variants={fadeIn} transition={{ duration: 0.5 }}>
                <SectionHeading className="mb-6">Ready to get started?</SectionHeading>
              </motion.div>

              <motion.div
                variants={fadeIn}
                transition={{ duration: 0.5, delay: 0.1 }}
                className="mb-10 flex items-baseline justify-center gap-3"
              >
                <span className="font-semibold tracking-tight tabular-nums text-foreground text-5xl sm:text-6xl lg:text-7xl">
                  {uc.heroStat}
                </span>
                <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  {uc.heroStatLabel}
                </span>
              </motion.div>

              <div
                className="public-fade-up flex flex-wrap items-center justify-center gap-3"
                style={{ ["--card-d" as string]: 200 }}
              >
                <PrimaryButton href="/auth">
                  Get started free
                  <ArrowRight className="h-4 w-4" />
                </PrimaryButton>
                <GhostButton href="/use-cases">
                  Explore more
                </GhostButton>
              </div>
            </motion.div>
          </div>
        </section>

        {/* ── Other Use Cases ── */}
        <section className="px-6 py-20 sm:py-24">
          <div className="mx-auto max-w-5xl">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.2 }}
              variants={fadeIn}
              transition={{ duration: 0.5 }}
              className="mb-12"
            >
              <SectionHeading>Explore more use cases</SectionHeading>
            </motion.div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
              {otherUseCases.map((other, i) => {
                const OtherIcon = other.icon
                return (
                  <div
                    key={other.slug}
                    className="public-card-enter"
                    style={{
                      ["--card-i" as string]: i,
                      ["--card-stagger-ms" as string]: "60ms",
                    }}
                  >
                    <Link
                      href={`/use-cases/${other.slug}`}
                      className="group block h-full overflow-hidden rounded-xl border border-border/40 bg-card/30 p-6 backdrop-blur-sm transition-colors duration-300 hover:border-border hover:bg-card/60"
                    >
                      <div className="relative">
                        <OtherIcon
                          aria-hidden
                          className="absolute -right-1 -top-1 size-16 text-foreground/[0.04] transition-all duration-500 group-hover:scale-110 group-hover:text-foreground/[0.07] dark:text-foreground/[0.05]"
                          strokeWidth={1}
                        />
                        <div className="relative mb-3 flex items-center gap-2">
                          <OtherIcon className="size-3.5 text-muted-foreground/60" />
                          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                            {other.label}
                          </span>
                        </div>
                      </div>

                      <h3 className="mb-2 text-balance text-base font-semibold text-foreground">
                        {other.headline}
                      </h3>
                      <p className="line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">
                        {other.outcome}
                      </p>
                      <div className="mt-5 flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground transition-colors group-hover:text-foreground">
                        <span>Learn more</span>
                        <ArrowRight className="size-3 transition-transform duration-200 group-hover:translate-x-0.5" />
                      </div>
                    </Link>
                  </div>
                )
              })}
            </div>
          </div>
        </section>
      </main>

      <LandingFooter />
    </div>
  )
}
