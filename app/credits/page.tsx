import { OssLinkOut } from "@/components/common/oss-link-out"
import { isOssMode } from "@/lib/oss-mode"
import { CreditsContent } from "./credits-content"

export default function CreditsPage() {
  if (isOssMode()) {
    return (
      <OssLinkOut
        title="Credits"
        description="Credits and billing are managed on coasty.ai."
        href="https://coasty.ai/account?section=billing"
        ctaLabel="Open billing on coasty.ai"
      />
    )
  }

  return <CreditsContent />
}
