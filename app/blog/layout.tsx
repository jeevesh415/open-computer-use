import type { Metadata } from "next"
import { getLocalizedMetadata } from "@/lib/seo"

export async function generateMetadata(): Promise<Metadata> {
  return getLocalizedMetadata("blog", "/blog", [
    "AI agent blog", "computer use agent articles", "autonomous AI insights",
    "AI employee blog", "OSWorld benchmark analysis", "browser automation blog",
    "AI automation articles", "desktop agent engineering", "AI agent research",
  ])
}

export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return children
}
