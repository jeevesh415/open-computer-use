import type { Metadata } from "next"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { getTranslations } from "next-intl/server"
import { ArrowRight } from "lucide-react"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("errorPages.notFound")
  const title = t("metaTitle")
  const description = t("metaDescription")

  return {
    title,
    description,
    robots: { index: false, follow: true },
    alternates: { canonical: "https://coasty.ai/404" },
    openGraph: {
      title,
      description,
      url: "https://coasty.ai/404",
      type: "website",
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  }
}

export default function NotFound() {
  const t = useTranslations("errorPages.notFound")
  const ok = t("ok")
  const fail = t("fail")

  const logLines: Array<{
    label: string
    status: string
    tone: "ok" | "fail"
    cursor?: boolean
  }> = [
    { label: t("log.step1"), status: ok, tone: "ok" },
    { label: t("log.step2"), status: ok, tone: "ok" },
    { label: t("log.step3"), status: ok, tone: "ok" },
    { label: t("log.result"), status: fail, tone: "fail", cursor: true },
  ]

  const links = [
    { label: t("links.home"), href: "/" },
    { label: t("links.computerUse"), href: "/computer-use" },
    { label: t("links.pricing"), href: "/pricing" },
    { label: t("links.download"), href: "/download" },
    { label: t("links.blog"), href: "/blog" },
    { label: t("links.guide"), href: "/guide" },
  ]

  return (
    <main className="relative isolate flex min-h-svh w-full items-center justify-center overflow-hidden bg-background text-foreground">
      <DottedBackdrop />

      <div className="public-fade-up relative z-10 mx-auto flex w-full max-w-xl flex-col items-center px-4 py-12 text-center sm:px-6 sm:py-20 md:py-24">
        <FourOhFourMark />

        <AgentLog command={t("log.command")} lines={logLines} />

        <h1 className="mt-8 text-balance text-xl font-semibold tracking-tight sm:mt-10 sm:text-2xl md:text-3xl">
          {t("title")}
        </h1>
        <p className="mt-3 max-w-md text-balance text-sm text-muted-foreground sm:text-base">
          {t("description")}
        </p>

        <div className="mt-7 flex w-full flex-col items-center justify-center gap-3 sm:mt-8 sm:w-auto sm:flex-row sm:flex-wrap">
          <Link
            href="/"
            className="inline-flex h-11 w-full items-center justify-center rounded-full bg-foreground px-5 text-sm font-medium text-background transition-colors hover:bg-foreground/85 sm:h-10 sm:w-auto"
          >
            {t("primaryCta")}
          </Link>
          <Link
            href="/computer-use"
            className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-full border border-border bg-background/60 px-5 text-sm font-medium text-foreground backdrop-blur-sm transition-colors hover:bg-muted sm:h-10 sm:w-auto"
          >
            {t("secondaryCta")}
            <ArrowRight aria-hidden className="h-3.5 w-3.5" />
          </Link>
        </div>

        <nav
          aria-label={t("navLabel")}
          className="mt-10 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground sm:mt-12 sm:gap-x-5 sm:text-[11px] md:text-xs"
        >
          {links.map(({ label, href }) => (
            <Link
              key={href}
              href={href}
              className="py-1 transition-colors hover:text-foreground"
            >
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </main>
  )
}

function AgentLog({
  command,
  lines,
}: {
  command: string
  lines: Array<{
    label: string
    status: string
    tone: "ok" | "fail"
    cursor?: boolean
  }>
}) {
  return (
    <div className="mt-6 w-full max-w-[19rem] overflow-hidden text-left font-mono text-[10px] leading-relaxed text-muted-foreground sm:mt-8 sm:max-w-[22rem] sm:text-[11px] md:text-xs">
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="shrink-0 text-foreground/45">$</span>
        <span className="min-w-0 truncate text-foreground">{command}</span>
      </div>
      <ul className="mt-1.5 space-y-0.5">
        {lines.map(({ label, status, tone, cursor }, i) => (
          <li
            key={i}
            className="flex min-w-0 items-baseline gap-2 whitespace-nowrap"
          >
            <span aria-hidden className="shrink-0 text-foreground/35">
              ›
            </span>
            <span className="min-w-0 truncate">{label}</span>
            <span
              aria-hidden
              className="flex-1 select-none overflow-hidden whitespace-nowrap text-foreground/15"
            >
              {".".repeat(80)}
            </span>
            <span
              className={
                "shrink-0 rounded-[3px] px-1.5 py-px text-[10px] font-medium uppercase tracking-[0.08em] " +
                (tone === "ok"
                  ? "bg-foreground/5 text-muted-foreground"
                  : "bg-foreground text-background")
              }
            >
              {status}
            </span>
            {cursor ? (
              <span
                aria-hidden
                className="ml-0.5 inline-block h-[0.9em] w-[0.45em] translate-y-[0.05em] bg-foreground [animation:blink_1.1s_step-end_infinite]"
              />
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

function FourOhFourMark() {
  return (
    <div
      aria-hidden
      className="flex select-none items-baseline justify-center gap-[0.04em] font-mono text-[clamp(5.5rem,22vw,11rem)] font-medium leading-none tracking-tight tabular-nums"
    >
      <span>4</span>
      <span className="relative inline-block">
        <span>0</span>
        <span className="absolute inset-x-[18%] bottom-[14%] h-px bg-foreground" />
      </span>
      <span>4</span>
    </div>
  )
}

function DottedBackdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10 opacity-70 [background:radial-gradient(circle_at_center,color-mix(in_oklch,var(--foreground)_10%,transparent)_1px,transparent_1.5px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_at_center,black_25%,transparent_75%)]"
    />
  )
}
