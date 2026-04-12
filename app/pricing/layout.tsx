import type { Metadata } from "next"
import { getLocalizedMetadata } from "@/lib/seo"

export async function generateMetadata(): Promise<Metadata> {
  return getLocalizedMetadata("pricing", "/pricing", [
    "Coasty pricing", "AI agent pricing", "computer use agent cost",
    "AI employee cost", "AI automation pricing", "cheap AI agent",
    "virtual assistant alternative price", "AI agent plans",
  ])
}

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return children
}
