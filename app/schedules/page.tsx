import { LayoutApp } from "@/app/components/layout/layout-app";
import { SchedulesContent } from "@/app/components/schedules/schedules-content";
import { OssLinkOut } from "@/components/common/oss-link-out";
import { isOssMode } from "@/lib/oss-mode";

export const dynamic = "force-dynamic";

export default function SchedulesPage() {
  if (isOssMode()) {
    return (
      <OssLinkOut
        title="Schedules"
        description="Scheduled automation runs are managed on coasty.ai."
        href="https://coasty.ai/schedules"
        ctaLabel="Open schedules on coasty.ai"
      />
    );
  }

  return (
    <LayoutApp>
      <SchedulesContent />
    </LayoutApp>
  );
}
