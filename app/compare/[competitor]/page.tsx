"use client"

import { useParams } from "next/navigation"
import Link from "next/link"
import { LandingHeader } from "@/app/components/landing/landing-header"
import { LandingFooter } from "@/app/components/landing/landing-footer"
import { ArrowRight, ArrowLeft, Check, X, Minus } from "lucide-react"
import { motion } from "framer-motion"
import { notFound } from "next/navigation"
import { useTranslations } from "next-intl"

type FeatureValue = true | false | "partial" | string

interface CompetitorData {
  name: string
  description: string
  features: Record<string, { coasty: FeatureValue; competitor: FeatureValue }>
  whyCoasty: string[]
  competitorStrengths: string[]
  pricing: { coasty: string; competitor: string }
}

const competitors: Record<string, CompetitorData> = {
  "anthropic-computer-use": {
    name: "Anthropic Computer Use",
    description: "Anthropic provides a Computer Use API through Claude that lets developers build agents capable of controlling a computer. Coasty is a production-ready platform built on top of computer use models with managed infrastructure.",
    features: {
      "OSWorld Benchmark Score": { coasty: "82%", competitor: "~15%" },
      "Managed VM Infrastructure": { coasty: true, competitor: false },
      "VM-Level Session Isolation": { coasty: true, competitor: false },
      "Built-in CAPTCHA Solving": { coasty: true, competitor: false },
      "Desktop App (Mac & Windows)": { coasty: true, competitor: false },
      "Browser Automation": { coasty: true, competitor: true },
      "Desktop Application Control": { coasty: true, competitor: true },
      "Terminal Access": { coasty: true, competitor: true },
      "Multi-Model Support": { coasty: true, competitor: false },
      "Real-time Screen Streaming": { coasty: true, competitor: false },
      "Open Source Framework": { coasty: true, competitor: false },
      "Production-Ready Platform": { coasty: true, competitor: false },
      "No Infrastructure Setup": { coasty: true, competitor: false },
      "24/7 Autonomous Operation": { coasty: true, competitor: "partial" },
    },
    whyCoasty: [
      "No need to build and manage your own infrastructure — Coasty handles VMs, networking, and security",
      "82% OSWorld score vs ~15% — dramatically higher task completion rate",
      "Built-in CAPTCHA solving for real-world automation that doesn't get blocked",
      "Desktop app for controlling your local machine without VMs",
      "Multi-model orchestration uses the best model for each task",
    ],
    competitorStrengths: [
      "Direct API access for custom integrations",
      "Part of the broader Claude ecosystem",
      "More flexibility for developers building custom solutions",
    ],
    pricing: { coasty: "From $20/month", competitor: "API usage-based pricing" },
  },
  "openai-operator": {
    name: "OpenAI Operator",
    description: "OpenAI Operator is a browser-based AI agent from OpenAI that can perform tasks on the web. Coasty provides full desktop control beyond just browser, with higher benchmark scores and true VM isolation.",
    features: {
      "OSWorld Benchmark Score": { coasty: "82%", competitor: "~40%" },
      "VM-Level Session Isolation": { coasty: true, competitor: false },
      "Built-in CAPTCHA Solving": { coasty: true, competitor: false },
      "Full Desktop Control": { coasty: true, competitor: false },
      "Browser Automation": { coasty: true, competitor: true },
      "Terminal Access": { coasty: true, competitor: false },
      "Desktop App (Mac & Windows)": { coasty: true, competitor: false },
      "Multi-Model Support": { coasty: true, competitor: false },
      "Open Source Framework": { coasty: true, competitor: false },
      "File Operations": { coasty: true, competitor: false },
      "Real-time Screen Streaming": { coasty: true, competitor: true },
      "Multi-Agent Orchestration": { coasty: true, competitor: false },
    },
    whyCoasty: [
      "82% OSWorld benchmark vs ~40% — state-of-the-art task completion",
      "Full desktop control, not just browser — controls any application",
      "True VM isolation per session for enterprise-grade security",
      "Multi-model support — not locked into a single AI provider",
      "Open source framework you can inspect and contribute to",
    ],
    competitorStrengths: [
      "Backed by OpenAI's brand and ecosystem",
      "Integrated with ChatGPT Pro subscription",
      "Simple consumer-friendly interface",
    ],
    pricing: { coasty: "From $20/month", competitor: "ChatGPT Pro ($200/month)" },
  },
  "adept-ai": {
    name: "Adept AI",
    description: "Adept AI is building AI agents that can use software tools. Coasty is already in production with the highest OSWorld benchmark score and a complete platform for autonomous computer use.",
    features: {
      "OSWorld Benchmark Score": { coasty: "82%", competitor: "Not published" },
      "Production-Ready Platform": { coasty: true, competitor: "partial" },
      "VM-Level Session Isolation": { coasty: true, competitor: false },
      "Built-in CAPTCHA Solving": { coasty: true, competitor: false },
      "Browser Automation": { coasty: true, competitor: true },
      "Desktop Control": { coasty: true, competitor: "partial" },
      "Terminal Access": { coasty: true, competitor: false },
      "Desktop App": { coasty: true, competitor: false },
      "Multi-Model Support": { coasty: true, competitor: false },
      "Open Source Framework": { coasty: true, competitor: false },
      "Public Pricing": { coasty: true, competitor: false },
    },
    whyCoasty: [
      "Publicly proven 82% OSWorld benchmark score",
      "Available now — production-ready with public pricing",
      "Complete platform with VM isolation, CAPTCHA solving, desktop app",
      "Open source framework for transparency and community contribution",
    ],
    competitorStrengths: [
      "Significant venture funding and research team",
      "Focus on enterprise workflow automation",
      "Custom model training for specific tasks",
    ],
    pricing: { coasty: "From $20/month", competitor: "Enterprise pricing (not public)" },
  },
  "multion": {
    name: "Multion",
    description: "Multion is an AI agent focused on browser automation tasks. Coasty goes beyond browser-only to offer full desktop control, terminal access, and multi-agent orchestration.",
    features: {
      "OSWorld Benchmark Score": { coasty: "82%", competitor: "Not published" },
      "Full Desktop Control": { coasty: true, competitor: false },
      "Browser Automation": { coasty: true, competitor: true },
      "Terminal Access": { coasty: true, competitor: false },
      "VM-Level Session Isolation": { coasty: true, competitor: false },
      "Built-in CAPTCHA Solving": { coasty: true, competitor: "partial" },
      "Desktop App": { coasty: true, competitor: false },
      "Multi-Model Support": { coasty: true, competitor: false },
      "File Operations": { coasty: true, competitor: false },
      "Multi-Agent Orchestration": { coasty: true, competitor: false },
      "Open Source Framework": { coasty: true, competitor: false },
    },
    whyCoasty: [
      "Full desktop control — not limited to just browser tasks",
      "Terminal access for command-line operations and system administration",
      "Multi-agent orchestration: browser, desktop, and terminal agents working together",
      "VM isolation ensures your data stays safe between sessions",
    ],
    competitorStrengths: [
      "Focused browser automation experience",
      "Chrome extension for easy setup",
      "API for developer integrations",
    ],
    pricing: { coasty: "From $20/month", competitor: "From $30/month" },
  },
  "browserbase": {
    name: "Browserbase",
    description: "Browserbase provides headless browser infrastructure for developers. Coasty is a complete AI employee platform that uses browser automation as one of many capabilities.",
    features: {
      "Complete AI Employee": { coasty: true, competitor: false },
      "Desktop Control": { coasty: true, competitor: false },
      "Browser Automation": { coasty: true, competitor: true },
      "Terminal Access": { coasty: true, competitor: false },
      "AI-Powered Task Completion": { coasty: true, competitor: false },
      "VM-Level Isolation": { coasty: true, competitor: "partial" },
      "CAPTCHA Solving": { coasty: true, competitor: false },
      "Desktop App": { coasty: true, competitor: false },
      "No Code Required": { coasty: true, competitor: false },
      "Multi-Agent Orchestration": { coasty: true, competitor: false },
      "Headless Browser API": { coasty: false, competitor: true },
    },
    whyCoasty: [
      "Complete AI employee, not just browser infrastructure",
      "No coding required — give natural language instructions",
      "Full desktop and terminal control beyond browser",
      "Built-in AI reasoning and task planning",
    ],
    competitorStrengths: [
      "Purpose-built browser infrastructure for developers",
      "Stealth mode and anti-detection features",
      "High-scale parallel browser sessions",
      "Developer-focused API and SDKs",
    ],
    pricing: { coasty: "From $20/month", competitor: "From $0 (usage-based)" },
  },
  "induced-ai": {
    name: "Induced AI",
    description: "Induced AI provides browser automation workflows. Coasty offers a broader AI employee platform with full desktop control, higher benchmark scores, and VM-level isolation.",
    features: {
      "OSWorld Benchmark Score": { coasty: "82%", competitor: "Not published" },
      "Full Desktop Control": { coasty: true, competitor: false },
      "Browser Automation": { coasty: true, competitor: true },
      "Terminal Access": { coasty: true, competitor: false },
      "VM-Level Isolation": { coasty: true, competitor: false },
      "CAPTCHA Solving": { coasty: true, competitor: "partial" },
      "Desktop App": { coasty: true, competitor: false },
      "Multi-Model Support": { coasty: true, competitor: false },
      "Open Source": { coasty: true, competitor: false },
      "Multi-Agent Orchestration": { coasty: true, competitor: false },
    },
    whyCoasty: [
      "Proven 82% on OSWorld — state-of-the-art performance",
      "Full desktop + terminal control, not just browser",
      "True VM isolation for security-sensitive tasks",
      "Open source framework for full transparency",
    ],
    competitorStrengths: [
      "Workflow builder for repeatable automations",
      "Focus on browser-based business processes",
      "Enterprise workflow templates",
    ],
    pricing: { coasty: "From $20/month", competitor: "Contact for pricing" },
  },
  "uipath": {
    name: "UiPath",
    description: "UiPath is a leading traditional RPA (Robotic Process Automation) platform. Coasty represents the next generation — AI-powered agents that use vision and reasoning instead of brittle scripts.",
    features: {
      "AI-Powered (No Scripts)": { coasty: true, competitor: false },
      "Adapts to UI Changes": { coasty: true, competitor: false },
      "Natural Language Instructions": { coasty: true, competitor: false },
      "No Developer Required": { coasty: true, competitor: false },
      "Browser Automation": { coasty: true, competitor: true },
      "Desktop Automation": { coasty: true, competitor: true },
      "VM-Level Isolation": { coasty: true, competitor: false },
      "CAPTCHA Solving": { coasty: true, competitor: false },
      "Setup Time": { coasty: "Minutes", competitor: "Weeks to months" },
      "Handles Unexpected Scenarios": { coasty: true, competitor: false },
      "Enterprise Support": { coasty: "partial", competitor: true },
      "Compliance Certifications": { coasty: "partial", competitor: true },
    },
    whyCoasty: [
      "No brittle scripts — Coasty uses AI vision to understand and adapt to any interface",
      "Natural language instructions instead of complex workflow builders",
      "Minutes to set up vs weeks of RPA development",
      "Handles unexpected scenarios and UI changes gracefully",
      "99% cost reduction compared to enterprise RPA licensing",
    ],
    competitorStrengths: [
      "Established enterprise presence and certifications (SOC 2, HIPAA)",
      "Extensive connector library for enterprise systems",
      "Proven track record in regulated industries",
      "Dedicated account management and support",
    ],
    pricing: { coasty: "From $20/month", competitor: "From $420/month (per robot)" },
  },
  "automation-anywhere": {
    name: "Automation Anywhere",
    description: "Automation Anywhere is an enterprise RPA platform. Coasty uses AI agents that see and understand interfaces, eliminating the need for brittle automation scripts.",
    features: {
      "AI-Powered (No Scripts)": { coasty: true, competitor: false },
      "Adapts to UI Changes": { coasty: true, competitor: false },
      "Natural Language Instructions": { coasty: true, competitor: false },
      "Browser Automation": { coasty: true, competitor: true },
      "Desktop Automation": { coasty: true, competitor: true },
      "VM-Level Isolation": { coasty: true, competitor: false },
      "CAPTCHA Solving": { coasty: true, competitor: false },
      "Setup Time": { coasty: "Minutes", competitor: "Weeks to months" },
      "Enterprise Support": { coasty: "partial", competitor: true },
      "Process Mining": { coasty: false, competitor: true },
    },
    whyCoasty: [
      "AI vision replaces brittle selectors and scripts",
      "Works on any interface without pre-programming",
      "Drastically lower cost — $20/mo vs enterprise licensing",
      "Instant setup with natural language, no training needed",
    ],
    competitorStrengths: [
      "Enterprise-grade compliance and certifications",
      "Process mining and analytics",
      "Large partner and integrator ecosystem",
      "Dedicated support for regulated industries",
    ],
    pricing: { coasty: "From $20/month", competitor: "Enterprise pricing (contact sales)" },
  },
  "virtual-assistant": {
    name: "Human Virtual Assistant",
    description: "Traditional virtual assistants are human workers hired to handle repetitive tasks. Coasty provides AI-powered automation that works 24/7 at a fraction of the cost.",
    features: {
      "24/7 Availability": { coasty: true, competitor: false },
      "Cost per Month": { coasty: "$20", competitor: "$3,000+" },
      "Instant Scalability": { coasty: true, competitor: false },
      "No Training Required": { coasty: true, competitor: false },
      "Consistent Quality": { coasty: true, competitor: "partial" },
      "Browser Automation": { coasty: true, competitor: true },
      "Desktop Tasks": { coasty: true, competitor: true },
      "Email & Communication": { coasty: true, competitor: true },
      "Complex Judgment Calls": { coasty: "partial", competitor: true },
      "Relationship Building": { coasty: false, competitor: true },
      "Creative Strategy": { coasty: "partial", competitor: true },
      "Parallel Task Execution": { coasty: true, competitor: false },
      "Full Audit Trail": { coasty: true, competitor: false },
    },
    whyCoasty: [
      "99% cost reduction: $20/mo vs $3,000+/mo for a human VA",
      "Works 24/7/365 with no breaks, sick days, or vacations",
      "Instant scalability — run multiple agents simultaneously",
      "Complete audit trail of every action taken",
      "No training or onboarding period needed",
    ],
    competitorStrengths: [
      "Human judgment for nuanced situations",
      "Relationship building and emotional intelligence",
      "Creative and strategic thinking",
      "Handling truly novel or ambiguous situations",
    ],
    pricing: { coasty: "From $20/month", competitor: "$2,000 - $5,000/month" },
  },
  "devin-ai": {
    name: "Devin AI",
    description: "Devin AI is an AI software engineer focused on coding tasks. Coasty is a general-purpose computer agent that handles any desktop task — from marketing to sales to QA to support.",
    features: {
      "General-Purpose Automation": { coasty: true, competitor: false },
      "Browser Automation": { coasty: true, competitor: "partial" },
      "Desktop Control": { coasty: true, competitor: false },
      "Terminal Access": { coasty: true, competitor: true },
      "Code Writing": { coasty: true, competitor: true },
      "Marketing Automation": { coasty: true, competitor: false },
      "Sales Prospecting": { coasty: true, competitor: false },
      "QA Testing": { coasty: true, competitor: false },
      "Email Automation": { coasty: true, competitor: false },
      "Form Filling": { coasty: true, competitor: false },
      "VM-Level Isolation": { coasty: true, competitor: true },
      "CAPTCHA Solving": { coasty: true, competitor: false },
      "Desktop App": { coasty: true, competitor: false },
      "OSWorld Benchmark": { coasty: "82%", competitor: "N/A (code focused)" },
    },
    whyCoasty: [
      "General-purpose agent for any computer task, not just coding",
      "Marketing, sales, QA, support, data entry — Coasty does it all",
      "82% on OSWorld benchmark for real-world computer tasks",
      "Built-in CAPTCHA solving for uninterrupted automation",
      "Desktop app for local machine control",
    ],
    competitorStrengths: [
      "Deep specialization in software engineering tasks",
      "GitHub integration and PR workflow",
      "Long-running coding sessions with persistent context",
      "Code review and debugging capabilities",
    ],
    pricing: { coasty: "From $20/month", competitor: "From $500/month" },
  },
}

function FeatureIcon({ value }: { value: FeatureValue }) {
  if (value === true) return <Check className="h-4 w-4 text-emerald-500" />
  if (value === false) return <X className="h-4 w-4 text-red-400/60" />
  if (value === "partial") return <Minus className="h-4 w-4 text-amber-400/70" />
  return <span className="text-sm font-medium">{value}</span>
}

export default function CompetitorPage() {
  const t = useTranslations("comparePage")
  const params = useParams()
  const slug = params.competitor as string
  const data = competitors[slug]

  if (!data) return notFound()

  return (
    <div className="min-h-screen bg-background">
      <LandingHeader />

      <main className="pt-32 sm:pt-36 pb-24">
        <div className="max-w-4xl mx-auto px-7 sm:px-10">
          {/* Back link */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mb-8"
          >
            <Link href="/compare" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground/60 hover:text-foreground transition-colors">
              <ArrowLeft className="h-3.5 w-3.5" />
              {t("allComparisons")}
            </Link>
          </motion.div>

          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="mb-12"
          >
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight leading-[1.2] mb-4">
              {t("vsLabel", { name: data.name })}
            </h1>
            <p className="text-muted-foreground text-lg leading-relaxed max-w-2xl">
              {data.description}
            </p>
          </motion.div>

          {/* Pricing comparison */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="grid grid-cols-2 gap-4 mb-12"
          >
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-primary/70 mb-2">Coasty</p>
              <p className="text-2xl font-bold">{data.pricing.coasty}</p>
            </div>
            <div className="rounded-xl border border-border/40 bg-card p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground/50 mb-2">{data.name}</p>
              <p className="text-2xl font-bold text-muted-foreground">{data.pricing.competitor}</p>
            </div>
          </motion.div>

          {/* Feature comparison table */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.15 }}
            className="mb-16"
          >
            <h2 className="text-xl font-semibold mb-6">{t("featureComparison")}</h2>
            <div className="rounded-xl border border-border/40 overflow-hidden">
              <div className="grid grid-cols-[1fr,100px,100px] sm:grid-cols-[1fr,140px,140px] bg-muted/30 border-b border-border/40 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground/50">Feature</p>
                <p className="text-xs font-semibold uppercase tracking-[0.15em] text-primary/70 text-center">Coasty</p>
                <p className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground/50 text-center">{data.name.split(" ").slice(0, 2).join(" ")}</p>
              </div>
              {Object.entries(data.features).map(([feature, values], i) => (
                <div
                  key={feature}
                  className={`grid grid-cols-[1fr,100px,100px] sm:grid-cols-[1fr,140px,140px] px-4 py-3 ${i % 2 === 0 ? "bg-card" : "bg-card/50"} ${i < Object.entries(data.features).length - 1 ? "border-b border-border/20" : ""}`}
                >
                  <p className="text-sm">{feature}</p>
                  <div className="flex items-center justify-center">
                    <FeatureIcon value={values.coasty} />
                  </div>
                  <div className="flex items-center justify-center">
                    <FeatureIcon value={values.competitor} />
                  </div>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Why Coasty */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="grid sm:grid-cols-2 gap-6 mb-16"
          >
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-6">
              <h3 className="font-semibold mb-4">{t("whyChooseCoasty")}</h3>
              <ul className="space-y-3">
                {data.whyCoasty.map((point) => (
                  <li key={point} className="flex items-start gap-2.5 text-sm text-muted-foreground leading-relaxed">
                    <Check className="h-4 w-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                    {point}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-border/40 bg-card p-6">
              <h3 className="font-semibold mb-4">{t("strengthsOf", { name: data.name })}</h3>
              <ul className="space-y-3">
                {data.competitorStrengths.map((point) => (
                  <li key={point} className="flex items-start gap-2.5 text-sm text-muted-foreground leading-relaxed">
                    <Check className="h-4 w-4 text-muted-foreground/40 mt-0.5 flex-shrink-0" />
                    {point}
                  </li>
                ))}
              </ul>
            </div>
          </motion.div>

          {/* CTA */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.25 }}
            className="text-center border-t border-border/30 pt-16"
          >
            <h2 className="text-2xl font-bold mb-3">
              {t("ctaTitle")}
            </h2>
            <p className="text-muted-foreground mb-6">
              {t("ctaDescription")}
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/auth">
                <motion.button
                  className="inline-flex items-center gap-2.5 rounded-full font-semibold text-background bg-foreground px-8 py-3.5 text-[15px] cursor-pointer"
                  whileHover={{ scale: 1.02, y: -1 }}
                  whileTap={{ scale: 0.98 }}
                >
                  {t("ctaButton")}
                  <ArrowRight className="h-4 w-4" />
                </motion.button>
              </Link>
              <Link href="/results">
                <motion.button
                  className="inline-flex items-center gap-2 rounded-full font-medium text-muted-foreground hover:text-foreground border border-border/40 hover:border-border/60 px-6 py-3 text-[14px] cursor-pointer transition-colors duration-200"
                  whileHover={{ scale: 1.02, y: -1 }}
                  whileTap={{ scale: 0.98 }}
                >
                  {t("watchCaseStudies")}
                </motion.button>
              </Link>
            </div>
            <p className="text-[11px] text-muted-foreground/30 mt-4">
              {t("noCreditCard")}
            </p>
          </motion.div>
        </div>
      </main>

      <LandingFooter />
    </div>
  )
}
