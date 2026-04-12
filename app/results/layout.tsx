import type { Metadata } from "next"
import { getLocalizedMetadata } from "@/lib/seo"

export async function generateMetadata(): Promise<Metadata> {
  return getLocalizedMetadata("results", "/results", [
    "AI agent case studies", "computer use agent demo", "autonomous AI examples",
    "AI employee results", "Coasty demos", "AI automation examples",
    "browser automation demo", "AI marketing automation", "AI job application",
    "AI QA testing",
  ])
}

export default function ResultsLayout({ children }: { children: React.ReactNode }) {
  return children
}
