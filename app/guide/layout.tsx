import type { Metadata } from "next"
import { getLocalizedMetadata } from "@/lib/seo"

export async function generateMetadata(): Promise<Metadata> {
  return getLocalizedMetadata("guide", "/guide", [
    "AI automation examples", "computer use agent capabilities",
    "AI desktop automation guide", "Coasty use cases", "AI employee tasks",
    "autonomous AI agent examples", "browser automation use cases",
    "AI virtual assistant capabilities", "RPA alternative", "AI computer control",
    "automated data entry", "AI sales prospecting", "AI job applications",
    "AI QA testing", "desktop automation examples",
  ])
}

export default function GuideLayout({ children }: { children: React.ReactNode }) {
  return children
}
