import { Metadata } from "next"
import { getSeoPage } from "@/lib/blog/api"

export async function generateMetadata({ params }: { params: Promise<{ task: string }> }): Promise<Metadata> {
  const { task } = await params
  const page = await getSeoPage(task)

  if (!page) {
    return { title: "Computer Use — Coasty AI Agent" }
  }

  const title = `${page.title} — Computer Use AI Agent | Coasty`
  const description = page.meta_description

  return {
    title,
    description,
    keywords: [
      ...page.keywords,
      "computer use", "computer use agent", "AI agent", "Coasty",
      "desktop automation", "browser automation", "best computer use",
    ],
    openGraph: {
      title,
      description,
      url: `https://coasty.ai/computer-use/${task}`,
      type: "article",
      siteName: "Coasty",
      images: [{ url: "/demo-screenshot.png", width: 1200, height: 630, alt: page.title }],
    },
    twitter: {
      card: "summary_large_image",
      title: page.title,
      description,
    },
    alternates: { canonical: `https://coasty.ai/computer-use/${task}` },
  }
}

export default function ComputerUseTaskLayout({ children }: { children: React.ReactNode }) {
  return children
}
