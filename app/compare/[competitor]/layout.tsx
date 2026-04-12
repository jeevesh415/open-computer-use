import { Metadata } from "next"
import { getTranslations, getLocale } from "next-intl/server"
import { getHreflangAlternates } from "@/lib/seo"

const competitorMeta: Record<string, { name: string; title: string; description: string; keywords: string[] }> = {
  "anthropic-computer-use": {
    name: "Anthropic Computer Use",
    title: "Coasty vs Anthropic Computer Use (Claude) — Full Comparison 2026",
    description: "Compare Coasty and Anthropic Computer Use (Claude). See how Coasty's managed platform with VM isolation, CAPTCHA solving, and 82% OSWorld score compares to Anthropic's raw API. Feature-by-feature breakdown.",
    keywords: ["Coasty vs Anthropic", "Anthropic Computer Use alternative", "Claude computer use vs Coasty", "best computer use agent"],
  },
  "openai-operator": {
    name: "OpenAI Operator",
    title: "Coasty vs OpenAI Operator — Full Comparison 2026",
    description: "Compare Coasty and OpenAI Operator for autonomous computer control. Coasty offers higher OSWorld scores (82%), true VM isolation, multi-model support, open source framework, and a desktop app.",
    keywords: ["Coasty vs OpenAI Operator", "OpenAI Operator alternative", "best AI agent for automation", "computer use agent comparison"],
  },
  "adept-ai": {
    name: "Adept AI",
    title: "Coasty vs Adept AI — Full Comparison 2026",
    description: "Compare Coasty and Adept AI for computer-using agent capabilities. Coasty is production-ready with 82% OSWorld benchmark, VM isolation, CAPTCHA solving, and $20/mo pricing.",
    keywords: ["Coasty vs Adept AI", "Adept AI alternative", "AI agent comparison", "computer use agent"],
  },
  "multion": {
    name: "Multion",
    title: "Coasty vs Multion — Full Comparison 2026",
    description: "Compare Coasty and Multion for browser and desktop automation. Coasty offers full desktop control beyond just browser, VM isolation, 82% OSWorld score, and built-in CAPTCHA solving.",
    keywords: ["Coasty vs Multion", "Multion alternative", "browser automation AI comparison", "best AI browser agent"],
  },
  "browserbase": {
    name: "Browserbase",
    title: "Coasty vs Browserbase — Full Comparison 2026",
    description: "Compare Coasty and Browserbase. While Browserbase provides browser infrastructure, Coasty is a complete AI employee with desktop control, terminal access, VM isolation, and 82% OSWorld benchmark.",
    keywords: ["Coasty vs Browserbase", "Browserbase alternative", "browser automation platform comparison"],
  },
  "induced-ai": {
    name: "Induced AI",
    title: "Coasty vs Induced AI — Full Comparison 2026",
    description: "Compare Coasty and Induced AI for autonomous web automation. Coasty offers full desktop + browser + terminal control, 82% OSWorld score, VM isolation, and CAPTCHA solving.",
    keywords: ["Coasty vs Induced AI", "Induced AI alternative", "AI web automation comparison"],
  },
  "uipath": {
    name: "UiPath",
    title: "Coasty vs UiPath — AI Agent vs Traditional RPA 2026",
    description: "Compare Coasty's AI-powered computer agent vs UiPath's traditional RPA. No brittle scripts — Coasty uses AI vision to adapt to any interface. 82% OSWorld benchmark. Starting at $20/mo vs enterprise licensing.",
    keywords: ["Coasty vs UiPath", "UiPath alternative", "AI vs RPA", "RPA alternative AI agent", "best automation tool 2026"],
  },
  "automation-anywhere": {
    name: "Automation Anywhere",
    title: "Coasty vs Automation Anywhere — AI Agent vs RPA 2026",
    description: "Compare Coasty's AI computer-using agent vs Automation Anywhere RPA. Coasty adapts to any interface with AI vision instead of brittle selectors. 82% OSWorld score. $20/mo vs enterprise pricing.",
    keywords: ["Coasty vs Automation Anywhere", "Automation Anywhere alternative", "AI agent vs RPA", "intelligent automation"],
  },
  "virtual-assistant": {
    name: "Human Virtual Assistant",
    title: "Coasty vs Hiring a Virtual Assistant — Cost & Capability Comparison",
    description: "Compare Coasty AI agent ($20/mo) vs hiring a human virtual assistant ($3,000+/mo). Coasty works 24/7, handles unlimited tasks, needs no training, and scales instantly. Full cost and capability breakdown.",
    keywords: ["AI vs virtual assistant", "virtual assistant alternative", "AI employee vs human hire", "VA replacement AI", "cheap virtual assistant alternative"],
  },
  "devin-ai": {
    name: "Devin AI",
    title: "Coasty vs Devin AI — Full Comparison 2026",
    description: "Compare Coasty and Devin AI. While Devin focuses on coding tasks, Coasty is a general-purpose computer agent for any desktop task — marketing, sales, QA, support, and more. 82% OSWorld benchmark.",
    keywords: ["Coasty vs Devin AI", "Devin AI alternative", "AI agent comparison", "best AI agent for automation"],
  },
}

export async function generateMetadata({ params }: { params: Promise<{ competitor: string }> }): Promise<Metadata> {
  const { competitor } = await params
  const meta = competitorMeta[competitor]
  if (!meta) return { title: "Comparison Not Found" }

  return {
    title: meta.title,
    description: meta.description,
    keywords: meta.keywords,
    openGraph: {
      title: meta.title,
      description: meta.description,
      url: `https://coasty.ai/compare/${competitor}`,
      type: "website",
      images: [{ url: "/demo-screenshot.png", width: 1200, height: 630, alt: meta.title }],
    },
    twitter: {
      card: "summary_large_image",
      title: meta.title,
      description: meta.description,
    },
    alternates: {
      canonical: `https://coasty.ai/compare/${competitor}`,
      languages: getHreflangAlternates(`/compare/${competitor}`),
    },
  }
}

export default function CompetitorLayout({ children }: { children: React.ReactNode }) {
  return children
}
