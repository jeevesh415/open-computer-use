import { LayoutApp } from "@/app/components/layout/layout-app"
import { SecretsContent } from "@/app/components/secrets/secrets-content"
import { OssLinkOut } from "@/components/common/oss-link-out"
import { isOssMode } from "@/lib/oss-mode"

export const dynamic = "force-dynamic"

export default function SecretsPage() {
  if (isOssMode()) {
    return (
      <OssLinkOut
        title="Secrets"
        description="Secrets and credential management live on coasty.ai."
        href="https://coasty.ai/secrets"
        ctaLabel="Open secrets on coasty.ai"
      />
    )
  }

  return (
    <LayoutApp>
      <SecretsContent />
    </LayoutApp>
  )
}
