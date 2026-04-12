import type { Metadata } from "next"
import { getLocalizedMetadata } from "@/lib/seo"

export async function generateMetadata(): Promise<Metadata> {
  return getLocalizedMetadata("terms", "/terms")
}

export default function TermsLayout({ children }: { children: React.ReactNode }) {
  return children
}
