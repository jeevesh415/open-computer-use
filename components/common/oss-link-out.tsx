import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ArrowUpRight, ArrowLeft } from "lucide-react"

/**
 * Shared "this feature lives on coasty.ai" surface used by OSS-mode pages.
 *
 * Rendered as a plain server component (no client hooks) so it can be
 * dropped into any `app/**\/page.tsx` and exercised at render time. Production
 * pages never reach this — the OSS-mode branch is gated by `isOssMode()` at
 * the top of each page.
 *
 * Design notes (per project memory: minimal, hairline, one signature
 * element per surface):
 *   - Single primary CTA opens the matching coasty.ai page in a new tab
 *     (target=_blank + rel="noreferrer noopener" — never navigate the OSS
 *     app away from itself; the user always has a way back).
 *   - Secondary "Back to chat" link defaults to "/" so we never leave the
 *     user stranded after a stray click.
 *   - Uses the existing Button primitive (default + outline variants) and
 *     muted-foreground copy — no new color or surface introduced.
 */
export interface OssLinkOutProps {
  title: string
  description: string
  href: string
  ctaLabel: string
  /** Optional secondary action (defaults to a "Back to chat" link to "/"). */
  secondaryHref?: string
  secondaryLabel?: string
}

export function OssLinkOut({
  title,
  description,
  href,
  ctaLabel,
  secondaryHref = "/",
  secondaryLabel = "Back to chat",
}: OssLinkOutProps) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-md space-y-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Button asChild>
            <a href={href} target="_blank" rel="noreferrer noopener">
              {ctaLabel}
              <ArrowUpRight className="size-4" />
            </a>
          </Button>
          <Button asChild variant="outline">
            <Link href={secondaryHref}>
              <ArrowLeft className="size-4" />
              {secondaryLabel}
            </Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
