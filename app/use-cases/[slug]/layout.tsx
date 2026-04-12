import { Metadata } from "next"
import { USE_CASES } from "../data"

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const uc = USE_CASES.find((u) => u.slug === slug)
  if (!uc) return { title: "Use Case Not Found" }
  return {
    title: `${uc.label} - Coasty AI Agent`,
    description: uc.outcome,
    keywords: [`AI ${uc.label.toLowerCase()}`, `automated ${uc.label.toLowerCase()}`, "computer use agent", "Coasty AI", "business automation"],
    openGraph: {
      title: `${uc.label} - Coasty AI Agent`,
      description: uc.outcome,
      url: `https://coasty.ai/use-cases/${uc.slug}`,
      type: "website",
      images: [{ url: "/demo-screenshot.png", width: 1200, height: 630 }],
    },
    alternates: { canonical: `https://coasty.ai/use-cases/${uc.slug}` },
  }
}

export default function UseCaseLayout({ children }: { children: React.ReactNode }) {
  return children
}
