import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import "./globals.css"
import "./mobile-performance.css"
import { ConditionalLayout } from "./conditional-layout"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ChatsProvider } from "@/lib/chat-store/chats/provider"
import { ChatSessionProvider } from "@/lib/chat-store/session/provider"
import { ModelProvider } from "@/lib/model-store/provider"
import { TanstackQueryProvider } from "@/lib/tanstack-query/tanstack-query-provider"
import { UserPreferencesProvider } from "@/lib/user-preference-store/provider"
import { UserProvider } from "@/lib/user-store/provider"
import { getUserProfile } from "@/lib/user/api"
import { ThemeProvider } from "next-themes"
import Script from "next/script"
import { LayoutClient } from "./layout-client"
import { AnimatedFavicon } from "@/components/animated-favicon"
import { PostHogProvider } from "@/lib/posthog/provider"
import { PostHogPageView } from "@/lib/posthog/page-view"
import { LocalizedSEOSchemas } from "./seo-schemas"
import { IntlClientProvider } from "./intl-client-provider"
import { getLocale, getMessages, getTranslations } from "next-intl/server"
import { locales, rtlLocales, type Locale } from "@/i18n/config"
import { getHreflangAlternates, PRODUCT_IMAGES, MERCHANT_LISTING_EXTRAS } from "@/lib/seo"
import { VISIBLE_TIERS, BOOST_PACKAGES } from "@/lib/pricing/tiers"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale()
  const t = await getTranslations("seo")

  return {
    title: {
      default: t("home.title"),
      template: t("home.titleTemplate", { title: "%s" }),
    },
    description: t("home.description"),
    keywords: [
      "computer use agent", "AI computer control", "AI agent desktop automation",
      "computer-using AI", "AI employee", "autonomous AI agent",
      "browser automation AI", "desktop automation agent", "AI virtual assistant",
      "OSWorld benchmark", "AI that controls computer", "AI desktop agent",
      "Coasty AI", "Coasty computer use",
      "Anthropic computer use alternative", "Claude computer use alternative",
      "OpenAI Operator alternative", "Google Project Mariner alternative",
      "Adept AI alternative", "Multion alternative", "Browserbase alternative",
      "Induced AI alternative", "Convergence AI alternative", "Devin AI alternative",
      "UiPath alternative", "Automation Anywhere alternative",
      "RPA alternative AI", "virtual assistant replacement AI",
      "AI form filler", "AI email sender", "AI web scraper agent",
      "autonomous browser agent", "AI task automation",
      "sandboxed AI agent", "VM isolated AI agent", "CAPTCHA solving AI",
      "AI for spreadsheets", "AI job application agent", "AI sales prospecting",
      "AI QA testing agent", "AI marketing automation agent",
      "best computer use agent 2026", "AI that browses the web",
      "AI workflow automation", "multi-model AI platform",
      "AI productivity tools", "open source computer use agent", "AI agent platform",
    ],
    authors: [{ name: "Coasty Team" }],
    creator: "Coasty",
    publisher: "Coasty",
    openGraph: {
      type: "website",
      locale: locale === "en" ? "en_US" : locale,
      url: "https://coasty.ai",
      siteName: "Coasty - #1 Computer-Use AI Agent",
      title: t("home.ogTitle"),
      description: t("home.ogDescription"),
      images: [
        {
          url: "/demo-screenshot.png",
          width: 1920,
          height: 1080,
          alt: t("home.ogTitle"),
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: t("home.ogTitle"),
      description: t("home.twitterDescription"),
      images: ["/demo-screenshot.png"],
      creator: "@coastyai",
      site: "@coastyai",
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-video-preview": -1,
        "max-image-preview": "large",
        "max-snippet": -1,
      },
    },
    alternates: {
      canonical: "https://coasty.ai",
      languages: getHreflangAlternates(),
    },
    category: "productivity",
    applicationName: "Coasty",
    referrer: "origin-when-cross-origin",
    formatDetection: {
      email: false,
      address: false,
      telephone: false,
    },
    icons: {
      icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
      apple: [{ url: "/apple-icon", type: "image/png", sizes: "180x180" }],
    },
    metadataBase: new URL("https://coasty.ai"),
    manifest: "/manifest.json",
    verification: {
      google: "google-site-verification-code",
      yandex: "yandex-verification-code",
    },
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const isDev = process.env.NODE_ENV === "development"
  const userProfile = await getUserProfile()

  let locale = "en"
  let messages = {}
  let seoT: (key: string) => string = (key) => key
  try {
    locale = await getLocale()
    messages = await getMessages()
    const t = await getTranslations("seo")
    seoT = (key: string) => t(key as never)
  } catch {
    // Fallback to English if i18n fails (e.g. during static generation)
    const fallback = await import("../messages/en.json")
    messages = fallback.default
  }
  const dir = rtlLocales.includes(locale as Locale) ? "rtl" : "ltr"
  const availableLanguages = locales.map(l => l === "fil" ? "Filipino" : l)

  // ─── Canonical pricing → JSON-LD offers ──────────────────────────────────
  // Sourced from `lib/pricing/tiers.ts` so structured data never goes stale.
  // Used by the WebApplication and SoftwareApplication blocks below.
  //
  // Merchant Listings: every Offer spreads MERCHANT_LISTING_EXTRAS from
  // `lib/seo.ts`, which carries the SaaS-correct `availability` + digital
  // `shippingDetails` + `hasMerchantReturnPolicy` shapes Google Search
  // Console expects on any Offer with price + priceCurrency. Removing them
  // (as we briefly did) triggered GSC warnings — they belong on every
  // Offer even for digital subscriptions.
  const purchasableTiers = VISIBLE_TIERS.filter(t => t.priceUSD !== null)
  // Omit eligibleQuantity for the "unlimited" tier — its sentinel credit
  // value (999_999_999) would otherwise leak as a structured-data spam
  // signal to crawlers. Use a description field instead.
  const tierOffers = purchasableTiers.map(tier => {
    const isUnlimitedTier = tier.id === "unlimited"
    return {
      "@type": "Offer",
      "name": `${tier.name} Plan`,
      "price": String(tier.priceUSD),
      "priceCurrency": "USD",
      "priceSpecification": {
        "@type": "UnitPriceSpecification",
        "price": tier.priceUSD,
        "priceCurrency": "USD",
        "billingDuration": "P1M",
        "billingIncrement": 1
      },
      "category": "subscription",
      ...(isUnlimitedTier
        ? {
            "description":
              "Unlimited computer-use agent runs at a flat $249/month — the cheapest flat-rate unlimited plan in the computer-use category. Includes 2 machines, 10 schedules, and 1 concurrent agent (abuse cap).",
          }
        : {
            "eligibleQuantity": {
              "@type": "QuantitativeValue",
              "value": tier.creditsPerMonth,
              "unitText": "credits/month"
            },
          }),
      "priceValidUntil": "2027-12-31",
      "url": `https://coasty.ai/pricing#${tier.id}`,
      ...MERCHANT_LISTING_EXTRAS,
    }
  })
  // High/low for the SoftwareApplication AggregateOffer summary.
  const tierPrices = purchasableTiers.map(t => t.priceUSD as number)
  const boostPrices = BOOST_PACKAGES.map(p => p.priceUSD)
  const allPrices = [...tierPrices, ...boostPrices]
  const lowPrice = Math.min(...allPrices)
  const highPrice = Math.max(...allPrices)

  return (
    <html lang={locale} dir={dir} suppressHydrationWarning>
      <head>
        {!isDev ? (
          <Script
            async
            src="https://analytics.umami.is/script.js"
            data-website-id="42e5b68c-5478-41a6-bc68-088d029cee52"
          />
        ) : null}
        {/* Structured Data for SEO */}
        <Script
          id="structured-data"
          type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebApplication",
            "name": "Coasty",
            "alternateName": ["Coasty AI", "Coasty Computer Use Agent", "Coasty AI Employee"],
            "url": "https://coasty.ai",
            "logo": "https://coasty.ai/logo_light.svg",
            "image": PRODUCT_IMAGES,
            "description": seoT("structuredData.appDescription"),
            "applicationCategory": "ProductivityApplication",
            "operatingSystem": "Web Browser, Windows, macOS",
            "offers": tierOffers,
            "aggregateRating": {
              "@type": "AggregateRating",
              "ratingValue": "4.8",
              "bestRating": "5",
              "ratingCount": "1250"
            },
            "award": [
              "#1 Ranked Computer-Use Agent — 82% OSWorld Benchmark (369 real-world tasks)",
              "Cheapest flat-rate Unlimited computer-use plan — $249/month"
            ],
            "featureList": [
              "82% OSWorld Benchmark — #1 in production",
              "$249/mo Unlimited plan — flat-rate, no credit caps",
              "Autonomous Browser Automation",
              "Desktop Application Control",
              "Terminal & Command Execution",
              "Form Filling & Data Entry",
              "Email Composing & Sending",
              "Spreadsheet Management",
              "CAPTCHA Solving Pipeline",
              "VM-Level Session Isolation",
              "Multi-Model AI Support (OpenAI, Anthropic, Google, Mistral)",
              "Real-time Screen Streaming",
              "File Operations & Management",
              "Web Scraping & Data Extraction",
              "Multi-Agent Orchestration",
              "Desktop App for Mac & Windows",
              "First-party MCP Server (26 tools, Claude Desktop / Cursor / Windsurf compatible)",
              "Open Source Framework",
              "24/7 Autonomous Operation"
            ],
            "screenshot": "https://coasty.ai/demo-screenshot.png",
            "sameAs": [
              "https://x.com/coastyai",
              "https://www.linkedin.com/company/coastyai/",
              "https://github.com/anthropics/open-computer-use"
            ]
          })
        }}
      />
      <Script
        id="organization-data"
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Organization",
            "name": "Coasty",
            "alternateName": "Coasty AI",
            "url": "https://coasty.ai",
            "logo": "https://coasty.ai/logo_dark.svg",
            "description": seoT("structuredData.orgDescription"),
            "foundingDate": "2025",
            "knowsAbout": ["Computer Use Agents", "AI Automation", "Desktop Automation", "Browser Automation", "Autonomous AI Agents", "Virtual Machine Isolation"],
            "sameAs": [
              "https://x.com/coastyai",
              "https://twitter.com/coastyai",
              "https://github.com/anthropics/open-computer-use",
              "https://www.linkedin.com/company/coastyai/",
              "https://www.producthunt.com/products/coasty"
            ],
            "contactPoint": [
              {
                "@type": "ContactPoint",
                "contactType": "customer support",
                "email": "founders@coasty.ai",
                "areaServed": "Worldwide",
                "availableLanguage": availableLanguages
              }
            ]
          })
        }}
      />
      <Script
        id="website-data"
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebSite",
            "name": "Coasty",
            "alternateName": ["Coasty AI", "Coasty Computer Use Agent"],
            "url": "https://coasty.ai",
            "description": seoT("structuredData.websiteDescription"),
            "potentialAction": {
              "@type": "SearchAction",
              "target": {
                "@type": "EntryPoint",
                "urlTemplate": "https://coasty.ai/search?q={search_term_string}"
              },
              "query-input": "required name=search_term_string"
            }
          })
        }}
      />
      <Script
        id="product-data"
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            "name": "Coasty AI Employee",
            "alternateName": ["Coasty Desktop", "Coasty Computer Use Agent"],
            "url": "https://coasty.ai",
            "image": PRODUCT_IMAGES,
            "downloadUrl": "https://coasty.ai/download",
            "applicationCategory": "BusinessApplication",
            "operatingSystem": "Web Browser, Windows 10+, macOS 10.15+",
            "softwareVersion": "1.5.0",
            "description": seoT("structuredData.softwareDescription"),
            "award": [
              "#1 Ranked Computer-Use Agent — 82% OSWorld Benchmark",
              "Cheapest flat-rate Unlimited computer-use plan — $249/month"
            ],
            "isAccessibleForFree": true,
            "offers": {
              "@type": "AggregateOffer",
              "lowPrice": String(lowPrice),
              "highPrice": String(highPrice),
              "priceCurrency": "USD",
              "offerCount": String(tierOffers.length + BOOST_PACKAGES.length),
              // Mirror the merchant fields on the AggregateOffer node itself.
              // Google's Merchant Listings crawler may pick the parent node
              // as "the seller Offer" and flag the fields as missing on
              // THAT node, even when the nested children have them. Spreading
              // the helper here keeps belt-and-suspenders coverage so both
              // the summary and the per-tier children pass validation.
              ...MERCHANT_LISTING_EXTRAS,
              // Embed the individual Offers so each tier's `shippingDetails`,
              // `hasMerchantReturnPolicy`, and `availability` are also visible
              // on each detailed Offer (Google parses both layers).
              "offers": tierOffers,
            },
            "aggregateRating": {
              "@type": "AggregateRating",
              "ratingValue": "4.8",
              "bestRating": "5",
              "ratingCount": "1250"
            },
            "featureList": [
              "82% OSWorld Benchmark Score (#1 in production)",
              "$249/month Unlimited plan — flat-rate, no credit caps (cheapest in market)",
              "Autonomous Browser Automation",
              "Full Desktop Control",
              "Built-in CAPTCHA Solving",
              "VM-Level Session Isolation",
              "Multi-Model AI (OpenAI, Anthropic, Google, Mistral)",
              "Desktop App for Mac & Windows",
              "First-party MCP Server (npx -y @coasty/mcp, 26 tools)",
              "24/7 Operation",
              "Open Source Framework"
            ],
            "screenshot": "https://coasty.ai/demo-screenshot.png"
          })
        }}
      />
        <LocalizedSEOSchemas locale={locale} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        <AnimatedFavicon />
        <IntlClientProvider locale={locale} messages={messages as Record<string, unknown>}>
          <PostHogProvider>
            <PostHogPageView />
            <TanstackQueryProvider>
              <LayoutClient />
              <UserProvider initialUser={userProfile}>
                <ModelProvider>
                  <ChatsProvider userId={userProfile?.id}>
                    <ChatSessionProvider>
                      <UserPreferencesProvider
                        userId={userProfile?.id}
                        initialPreferences={userProfile?.preferences}
                      >
                        <TooltipProvider
                          delayDuration={200}
                          skipDelayDuration={500}
                        >
                          <ThemeProvider
                            attribute="class"
                            defaultTheme="system"
                            enableSystem={true}
                            disableTransitionOnChange
                          >
                            {children}
                          </ThemeProvider>
                        </TooltipProvider>
                      </UserPreferencesProvider>
                    </ChatSessionProvider>
                  </ChatsProvider>
                </ModelProvider>
              </UserProvider>
            </TanstackQueryProvider>
          </PostHogProvider>
        </IntlClientProvider>
      </body>
    </html>
  )
}
