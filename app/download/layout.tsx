import type { Metadata } from "next"
import { getLocalizedMetadata } from "@/lib/seo"

export async function generateMetadata(): Promise<Metadata> {
  return getLocalizedMetadata("download", "/download", [
    "Coasty desktop app", "AI desktop agent", "download AI agent",
    "computer use agent desktop app", "AI automation desktop app",
    "Mac AI agent", "Windows AI agent", "desktop automation software",
    "AI employee app download", "browser automation app",
  ])
}

export default function DownloadLayout({ children }: { children: React.ReactNode }) {
  return children
}
