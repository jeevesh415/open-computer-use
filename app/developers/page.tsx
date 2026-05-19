import { notFound } from "next/navigation"
import { LayoutApp } from "@/app/components/layout/layout-app"
import { DevelopersContent } from "@/app/components/developers/developers-content"
import { DEVELOPERS_API_ENABLED } from "@/lib/feature-flags"

export const dynamic = "force-dynamic"

export default function DevelopersPage() {
  if (!DEVELOPERS_API_ENABLED) notFound()

  return (
    <LayoutApp>
      <DevelopersContent />
    </LayoutApp>
  )
}
