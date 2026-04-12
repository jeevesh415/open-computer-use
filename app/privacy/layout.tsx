import type { Metadata } from "next"
import { getLocalizedMetadata } from "@/lib/seo"

export async function generateMetadata(): Promise<Metadata> {
  return getLocalizedMetadata("privacy", "/privacy")
}

export default function PrivacyLayout({ children }: { children: React.ReactNode }) {
  return children
}
