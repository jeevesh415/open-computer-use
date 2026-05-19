import type { Metadata } from "next"
import { getLocalizedMetadata, PRODUCT_IMAGES, MERCHANT_LISTING_EXTRAS } from "@/lib/seo"
import { JsonLd } from "@/app/components/seo/json-ld"
import { VISIBLE_TIERS, BOOST_PACKAGES } from "@/lib/pricing/tiers"

export async function generateMetadata(): Promise<Metadata> {
  return getLocalizedMetadata("pricing", "/pricing", [
    "Coasty pricing", "AI agent pricing", "computer use agent cost",
    "AI employee cost", "AI automation pricing", "cheap AI agent",
    "virtual assistant alternative price", "AI agent plans",
  ])
}

// ─── JSON-LD: Product + Offers + WebAPI ─────────────────────────────────────
//
// Built from the canonical pricing module so this never goes stale again.
// Subscription tiers with a numeric price become Offer objects; enterprise
// (priceUSD === null, "contact sales") is omitted from the offers array but
// still listed on the page itself. Boost packages are emitted as one-time
// purchase offers. Both arrays are reused on the WebAPI schema so search /
// AI crawlers see consistent pricing across docs and the API surface.
//
// Merchant Listings: every Offer spreads MERCHANT_LISTING_EXTRAS from
// `lib/seo.ts`, which carries `availability` + digital `shippingDetails` +
// `hasMerchantReturnPolicy` shapes Google Search Console expects on any
// Offer with price + priceCurrency. The parent Product carries the
// `image` array (Merchant Listings critical field).

// Omit eligibleQuantity for the "unlimited" tier — its sentinel credit
// value (999_999_999) would otherwise leak to crawlers / AI agents reading
// the JSON-LD schema as a literal billion-credit count.
const subscriptionOffers = VISIBLE_TIERS
  .filter((tier) => tier.priceUSD !== null)
  .map((tier) => {
    const isUnlimitedTier = tier.id === "unlimited"
    return {
      "@type": "Offer" as const,
      name: `${tier.name} Plan`,
      price: String(tier.priceUSD),
      priceCurrency: "USD",
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: tier.priceUSD,
        priceCurrency: "USD",
        billingDuration: "P1M",
        billingIncrement: 1,
      },
      category: "subscription",
      ...(isUnlimitedTier
        ? { description: "Unlimited credits per month" }
        : {
            eligibleQuantity: {
              "@type": "QuantitativeValue",
              value: tier.creditsPerMonth,
              unitText: "credits/month",
            },
          }),
      priceValidUntil: "2027-12-31",
      url: `https://coasty.ai/pricing#${tier.id}`,
      ...MERCHANT_LISTING_EXTRAS,
    }
  })

const boostOffers = BOOST_PACKAGES.map((pkg) => ({
  "@type": "Offer" as const,
  name: pkg.name,
  price: String(pkg.priceUSD),
  priceCurrency: "USD",
  category: "one-time-purchase",
  eligibleQuantity: {
    "@type": "QuantitativeValue",
    value: pkg.credits,
    unitText: "credits",
  },
  priceValidUntil: "2027-12-31",
  url: "https://coasty.ai/pricing#boosts",
  ...MERCHANT_LISTING_EXTRAS,
}))

const allOffers = [...subscriptionOffers, ...boostOffers]

const productLd = {
  "@context": "https://schema.org",
  "@type": "Product",
  name: "Coasty",
  description:
    "Computer-use AI agent platform — autonomous browser, desktop, and terminal automation with VM-level isolation. Subscription credits + one-time boost packages.",
  brand: { "@type": "Brand", name: "Coasty" },
  category: "Software > Productivity > AI Automation",
  image: PRODUCT_IMAGES,
  url: "https://coasty.ai/pricing",
  offers: allOffers,
}

const webApiLd = {
  "@context": "https://schema.org",
  "@type": "WebAPI",
  name: "Coasty API",
  description:
    "Computer-use AI: predict, ground, OCR, run virtual machines, schedule automation.",
  documentation: "https://coasty.ai/api-docs",
  termsOfService: "https://coasty.ai/terms",
  provider: {
    "@type": "Organization",
    name: "Coasty",
    url: "https://coasty.ai",
  },
  endpointUrl: "https://coasty.ai/v1/predict",
  endpointDescription: "https://coasty.ai/.well-known/openapi.json",
  potentialAction: [
    {
      "@type": "SearchAction",
      target: "https://coasty.ai/api-docs?q={search}",
      "query-input": "required name=search",
    },
  ],
  // Re-emit the full offer list (subscriptions + boosts) so machine-readable
  // pricing stays attached to the API surface the customer is actually
  // budgeting for.
  offers: allOffers,
}

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd data={productLd} />
      <JsonLd data={webApiLd} />
      {children}
    </>
  )
}
