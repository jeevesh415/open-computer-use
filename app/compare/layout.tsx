import type { Metadata } from "next"
import { getLocalizedMetadata } from "@/lib/seo"

export async function generateMetadata(): Promise<Metadata> {
  const metadata = await getLocalizedMetadata("compare", "/compare", [
    "Coasty vs Anthropic Computer Use",
    "Coasty vs OpenAI Operator",
    "Coasty vs Adept AI",
    "Coasty vs UiPath",
    "AI agent comparison",
    "computer use agent alternatives",
    "best AI agent 2026",
    "RPA vs AI agent",
    "virtual assistant alternative",
  ])
  return metadata
}

export default function CompareLayout({ children }: { children: React.ReactNode }) {
  return children
}
