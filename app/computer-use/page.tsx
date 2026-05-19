import Link from "next/link"
import {
  ArrowRight,
  ArrowUpRight,
  Monitor,
  Globe,
  Terminal,
  MousePointer2,
  FileText,
  Mail,
  Search,
  ShoppingCart,
  Users,
  BarChart3,
  Shield,
  Zap,
} from "lucide-react"
import { LandingHeader } from "@/app/components/landing/landing-header"
import { LandingFooter } from "@/app/components/landing/landing-footer"
import { JsonLd } from "@/app/components/seo/json-ld"
import { getSeoPages } from "@/lib/blog/api"

const CAPABILITIES = [
  { icon: Monitor, label: "Desktop Automation", desc: "Control any desktop application — click, type, scroll, drag" },
  { icon: Globe, label: "Browser Automation", desc: "Navigate websites, fill forms, extract data, handle logins" },
  { icon: Terminal, label: "Terminal Operations", desc: "Run shell commands, install packages, manage files" },
  { icon: MousePointer2, label: "UI Interaction", desc: "See the screen, understand context, take intelligent actions" },
  { icon: FileText, label: "Document Processing", desc: "Read, write, edit documents and spreadsheets" },
  { icon: Mail, label: "Email Automation", desc: "Compose, send, and manage emails autonomously" },
  { icon: Search, label: "Web Research", desc: "Search, scrape, and compile information from the web" },
  { icon: ShoppingCart, label: "E-commerce Tasks", desc: "Price monitoring, order management, product research" },
  { icon: Users, label: "CRM & Outreach", desc: "Manage leads, send personalized outreach, update records" },
  { icon: BarChart3, label: "Data Extraction", desc: "Scrape structured data from any website or application" },
  { icon: Shield, label: "QA Testing", desc: "Test user flows, find bugs, generate reports" },
  { icon: Zap, label: "Workflow Automation", desc: "Chain multi-step workflows across applications" },
]

const COMPARE_LINKS = [
  { slug: "anthropic-computer-use", label: "Anthropic Computer Use" },
  { slug: "openai-operator", label: "OpenAI Operator" },
  { slug: "adept-ai", label: "Adept AI" },
  { slug: "multion", label: "Multion" },
  { slug: "browserbase", label: "Browserbase" },
  { slug: "induced-ai", label: "Induced AI" },
  { slug: "uipath", label: "UiPath" },
  { slug: "automation-anywhere", label: "Automation Anywhere" },
  { slug: "devin-ai", label: "Devin AI" },
]

export const revalidate = 300

/**
 * Computer-Use SEO hub — Server Component.
 *
 * The capabilities grid, the dynamic SEO-page grid, and comparison links
 * are all rendered server-side so AI search bots and lightweight crawlers
 * see every link target on first paint. Emits TechArticle JSON-LD for
 * schema.org search-engine consumers.
 */
export default async function ComputerUseHub() {
  const seoPages = await getSeoPages()

  const techArticleJsonLd = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: "Computer-Use AI: Coasty Platform",
    description:
      "Coasty is the #1 ranked computer-use AI agent on OSWorld. Automate desktop, browser, and terminal tasks with an autonomous AI that sees the screen and takes intelligent actions.",
    proficiencyLevel: "Beginner",
    dependencies: "Web browser, API key (free tier available)",
    author: { "@type": "Organization", name: "Coasty" },
    datePublished: "2026-05-05",
    mainEntityOfPage: "https://coasty.ai/computer-use",
    publisher: {
      "@type": "Organization",
      name: "Coasty",
      url: "https://coasty.ai",
      logo: {
        "@type": "ImageObject",
        url: "https://coasty.ai/logo_dark.svg",
      },
    },
  }

  return (
    <div className="relative min-h-screen bg-background">
      <JsonLd data={techArticleJsonLd} />
      <LandingHeader />

      <main className="pt-32 sm:pt-36 pb-24">
        {/* Hero */}
        <div className="max-w-5xl mx-auto px-7 sm:px-10 mb-20">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground/50 mb-4">
            Computer Use AI Agent
          </p>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.08] mb-5">
            The #1 Computer Use Agent
          </h1>
          <p className="text-muted-foreground text-lg sm:text-xl max-w-2xl leading-relaxed mb-8">
            Coasty is the best computer use AI agent — ranked #1 on OSWorld with 82% accuracy.
            It controls desktops, browsers, and terminals like a human, automating any task you can do on a computer.
          </p>
          <div className="flex gap-4">
            <Link
              href="/auth"
              className="inline-flex items-center gap-2.5 rounded-full font-semibold text-background bg-foreground px-8 py-3.5 text-[15px] cursor-pointer transition-transform duration-150 hover:scale-[1.02] hover:-translate-y-px active:scale-[0.98]"
            >
              Try Computer Use Free
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/results"
              className="inline-flex items-center gap-2 rounded-full font-medium text-muted-foreground hover:text-foreground border border-border/40 hover:border-border/60 px-6 py-3 text-[14px] cursor-pointer transition-all duration-150 hover:scale-[1.02] hover:-translate-y-px active:scale-[0.98]"
            >
              Watch Demos
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>

        {/* Capabilities Grid */}
        <div className="max-w-5xl mx-auto px-7 sm:px-10 mb-20">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-8">
            What Can Computer Use Do?
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {CAPABILITIES.map((cap) => (
              <div
                key={cap.label}
                className="rounded-xl border border-border/30 bg-card p-5 space-y-2"
              >
                <cap.icon className="h-5 w-5 text-muted-foreground/50" />
                <h3 className="font-semibold text-sm">{cap.label}</h3>
                <p className="text-xs text-muted-foreground/70 leading-relaxed">{cap.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Dynamic SEO pages grid */}
        {seoPages.length > 0 && (
          <div className="max-w-5xl mx-auto px-7 sm:px-10 mb-20">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3">
              Computer Use for Every Task
            </h2>
            <p className="text-muted-foreground mb-8 max-w-xl">
              Explore how Coasty&apos;s computer use agent handles specific tasks across industries and workflows.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {seoPages.map((page) => (
                <Link key={page.slug} href={`/computer-use/${page.slug}`}>
                  <div className="group rounded-xl border border-border/30 bg-card hover:border-border/60 transition-colors p-5 h-full">
                    <div className="flex items-center justify-between mb-3">
                      {page.hero_stat && (
                        <span className="text-2xl font-bold text-foreground/80">{page.hero_stat}</span>
                      )}
                      <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/20 group-hover:text-foreground/50 transition-colors" />
                    </div>
                    <h3 className="font-semibold text-sm mb-1 group-hover:text-foreground/70 transition-colors">
                      {page.title}
                    </h3>
                    {page.hero_stat_label && (
                      <p className="text-xs text-muted-foreground/50">{page.hero_stat_label}</p>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Comparison links */}
        <div className="max-w-5xl mx-auto px-7 sm:px-10 mb-20">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3">
            Best Computer Use Agent Comparison
          </h2>
          <p className="text-muted-foreground mb-8 max-w-xl">
            See how Coasty compares to other computer use and AI agent platforms.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {COMPARE_LINKS.map((comp) => (
              <Link
                key={comp.slug}
                href={`/compare/${comp.slug}`}
                className="flex items-center justify-between rounded-lg border border-border/30 hover:border-border/60 px-4 py-3 transition-colors group"
              >
                <span className="text-sm text-foreground/70 group-hover:text-foreground transition-colors">
                  Coasty vs {comp.label}
                </span>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/30 group-hover:text-foreground/50 transition-colors" />
              </Link>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="max-w-5xl mx-auto px-7 sm:px-10">
          <div className="border-t border-border/30 pt-16 text-center">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-4">
              Start Using AI Computer Use Today
            </h2>
            <p className="text-muted-foreground mb-8 max-w-lg mx-auto">
              Join thousands of teams using Coasty to automate desktop, browser, and terminal tasks with the #1 ranked computer use AI agent.
            </p>
            <Link
              href="/auth"
              className="inline-flex items-center gap-2.5 rounded-full font-semibold text-background bg-foreground px-8 py-3.5 text-[15px] cursor-pointer transition-transform duration-150 hover:scale-[1.02] hover:-translate-y-px active:scale-[0.98]"
            >
              Try Coasty Free
              <ArrowRight className="h-4 w-4" />
            </Link>
            <p className="text-[11px] text-muted-foreground/30 mt-4">No credit card required</p>
          </div>
        </div>
      </main>

      <LandingFooter />
    </div>
  )
}
