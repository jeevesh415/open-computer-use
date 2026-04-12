import type { Metadata } from "next"
import { getLocalizedMetadata } from "@/lib/seo"

export async function generateMetadata(): Promise<Metadata> {
  return getLocalizedMetadata("useCases", "/use-cases", [
    "AI agent use cases", "computer use agent", "business automation",
    "AI competitor research", "automated QA testing", "AI lead generation",
    "AI email outreach", "AI data extraction",
  ])
}

export default function UseCasesLayout({ children }: { children: React.ReactNode }) {
  return children
}
