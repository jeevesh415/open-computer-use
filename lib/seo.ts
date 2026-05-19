import { getLocale, getTranslations } from "next-intl/server"
import { locales, type Locale } from "@/i18n/config"
import type { Metadata } from "next"

const BASE_URL = "https://coasty.ai"

// ─── Google Merchant Listings fields (shared across all Product / Offer
//     JSON-LD emissions) ────────────────────────────────────────────────────
//
// Google Search Console treats any Offer with a `price` + `priceCurrency` as
// a Merchant Listing candidate and warns when `image`, `availability`,
// `shippingDetails`, or `hasMerchantReturnPolicy` are missing. These helpers
// are the digital-product/SaaS-correct shapes for each of those fields.
//
// References:
//   - https://developers.google.com/search/docs/appearance/structured-data/merchant-listing
//   - https://developers.google.com/search/docs/appearance/structured-data/shipping-policy
//   - https://developers.google.com/search/docs/appearance/structured-data/return-policy
//
// Notes:
//   - `image` must live on the Product / SoftwareApplication node (NOT on
//     individual Offers). It SHOULD be an array of HTTPS URLs ideally
//     covering 1:1, 4:3, and 16:9 aspect ratios.
//   - `shippingDestination` is intentionally OMITTED — per Google, omission
//     means "all destinations worldwide", which is correct for a SaaS
//     subscription. There is no recognized "WORLD" / "001" token.
//   - `MerchantReturnNotPermitted` must NOT be paired with
//     `merchantReturnDays` (contradictory → GSC error).
//   - `applicableCountry` accepts up to 50 ISO 3166-1 alpha-2 codes; we ship
//     a representative top-markets list rather than a single country.

/** Product / SoftwareApplication image array (Merchant Listings critical). */
export const PRODUCT_IMAGES: readonly string[] = [
  "https://coasty.ai/demo-screenshot.png",
  "https://coasty.ai/demo-3-2.png",
  "https://coasty.ai/og-image.png",
]

/** Spread into every Offer that exposes `price` + `priceCurrency` to satisfy
 * Google Merchant Listings "recommended" fields. Safe for SaaS / digital
 * subscriptions: `shippingRate` is zero and `shippingDestination` is omitted
 * (= worldwide); the return policy uses `MerchantReturnNotPermitted` (no
 * subscription refunds), with the `merchantReturnDays` field intentionally
 * absent to avoid the contradictory-pairing GSC error. */
export const MERCHANT_LISTING_EXTRAS = {
  availability: "https://schema.org/InStock",
  itemCondition: "https://schema.org/NewCondition",
  shippingDetails: {
    "@type": "OfferShippingDetails",
    shippingRate: {
      "@type": "MonetaryAmount",
      value: "0",
      currency: "USD",
    },
    deliveryTime: {
      "@type": "ShippingDeliveryTime",
      handlingTime: {
        "@type": "QuantitativeValue",
        minValue: 0,
        maxValue: 0,
        unitCode: "DAY",
      },
      transitTime: {
        "@type": "QuantitativeValue",
        minValue: 0,
        maxValue: 0,
        unitCode: "DAY",
      },
    },
  },
  hasMerchantReturnPolicy: {
    "@type": "MerchantReturnPolicy",
    applicableCountry: ["US", "GB", "CA", "AU", "DE", "FR", "IN", "SG", "JP", "BR"],
    returnPolicyCategory: "https://schema.org/MerchantReturnNotPermitted",
  },
} as const

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
