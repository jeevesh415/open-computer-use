import { OssLinkOut } from "@/components/common/oss-link-out"
import { isOssMode } from "@/lib/oss-mode"
import { AccountContent } from "./account-content"

export default function AccountPage() {
  if (isOssMode()) {
    return (
      <OssLinkOut
        title="Account"
        description="Account settings are managed on coasty.ai."
        href="https://coasty.ai/account"
        ctaLabel="Open account on coasty.ai"
      />
    )
  }

  return <AccountContent />
}
