import { LayoutApp } from "@/app/components/layout/layout-app";
import { SwarmsContent } from "@/app/components/swarms/swarms-content";
import { OssLinkOut } from "@/components/common/oss-link-out";
import { isOssMode } from "@/lib/oss-mode";

export const dynamic = "force-dynamic";

export default function SwarmsPage() {
  if (isOssMode()) {
    return (
      <OssLinkOut
        title="Swarms"
        description="Multi-agent swarm runs are managed on coasty.ai."
        href="https://coasty.ai/swarms"
        ctaLabel="Open swarms on coasty.ai"
      />
    );
  }

  return (
    <LayoutApp>
      <SwarmsContent />
    </LayoutApp>
  );
}
