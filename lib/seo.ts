import { getLocale, getTranslations } from "next-intl/server"
import { locales, type Locale } from "@/i18n/config"
import type { Metadata } from "next"

const BASE_URL = "https://coasty.ai"

/**
 * Generate hreflang alternate links for all supported locales.
 * Uses ?hl=xx parameter so search engines can crawl each language version.
 */
export function getHreflangAlternates(path: string = ""): Record<string, string> {
  const url = path ? `${BASE_URL}${path}` : BASE_URL
  const languages: Record<string, string> = {}
  for (const locale of locales) {
    languages[locale] = locale === "en" ? url : `${url}${url.includes("?") ? "&" : "?"}hl=${locale}`
  }
  languages["x-default"] = url
  return languages
}

/**
 * Build locale-aware metadata for a page.
 * Reads locale from cookies/headers via next-intl, then loads translated SEO strings.
 *
 * @param page - The page key in the `seo` namespace (e.g. "home", "compare", "download")
 * @param path - The canonical path (e.g. "/compare", "/download")
 * @param extraKeywords - Additional keywords to include
 */
export async function getLocalizedMetadata(
  page: string,
  path: string = "",
  extraKeywords?: string[],
): Promise<Metadata> {
  const locale = await getLocale()
  const t = await getTranslations("seo")

  const title = t(`${page}.title`)
  const description = t(`${page}.description`)
  const canonicalUrl = path ? `${BASE_URL}${path}` : BASE_URL

  const metadata: Metadata = {
    title,
    description,
    alternates: {
      canonical: canonicalUrl,
      languages: getHreflangAlternates(path),
    },
  }

  if (extraKeywords) {
    metadata.keywords = extraKeywords
  }

  // Add OG tags if the page has them
  try {
    const ogTitle = t(`${page}.ogTitle`)
    const ogDescription = t(`${page}.ogDescription`)
    metadata.openGraph = {
      title: ogTitle,
      description: ogDescription,
      url: canonicalUrl,
      type: "website",
      locale: locale === "en" ? "en_US" : locale,
      images: [{ url: "/demo-screenshot.png", width: 1200, height: 630, alt: ogTitle }],
    }
    metadata.twitter = {
      card: "summary_large_image",
      title: ogTitle,
      description: ogDescription,
    }
  } catch {
    // Page doesn't have OG tags — that's fine
  }

  return metadata
}
