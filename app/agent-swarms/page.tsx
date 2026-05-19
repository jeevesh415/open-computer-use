import { OssLinkOut } from "@/components/common/oss-link-out"
import { isOssMode } from "@/lib/oss-mode"
import { AgentSwarmsContent } from "./agent-swarms-content"

export default function AgentSwarmsPage() {
  if (isOssMode()) {
    return (
      <OssLinkOut
        title="Agent swarms"
        description="Multi-agent swarm runs are managed on coasty.ai."
        href="https://coasty.ai/swarms"
        ctaLabel="Open swarms on coasty.ai"
      />
    )
  }

  return <AgentSwarmsContent />
}
