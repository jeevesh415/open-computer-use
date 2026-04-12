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
import { PostHogProvider } from "@/lib/posthog/provider"
import { PostHogPageView } from "@/lib/posthog/page-view"
import { LocalizedSEOSchemas } from "./seo-schemas"
import { NextIntlClientProvider } from "next-intl"
import { getLocale, getMessages, getTranslations } from "next-intl/server"
import { locales, rtlLocales, type Locale } from "@/i18n/config"
import { getHreflangAlternates } from "@/lib/seo"

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
      creator: "@coasty_ai",
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
            "description": seoT("structuredData.appDescription"),
            "applicationCategory": "ProductivityApplication",
            "operatingSystem": "Web Browser, Windows, macOS",
            "offers": [
              {
                "@type": "Offer",
                "name": "Free Tier",
                "price": "0",
                "priceCurrency": "USD",
                "priceValidUntil": "2027-12-31",
                "availability": "https://schema.org/InStock",
                "shippingDetails": {
                  "@type": "OfferShippingDetails",
                  "shippingRate": { "@type": "MonetaryAmount", "value": "0", "currency": "USD" },
                  "deliveryTime": {
                    "@type": "ShippingDeliveryTime",
                    "handlingTime": { "@type": "QuantitativeValue", "minValue": "0", "maxValue": "0", "unitCode": "d" },
                    "transitTime": { "@type": "QuantitativeValue", "minValue": "0", "maxValue": "0", "unitCode": "d" }
                  },
                  "shippingDestination": { "@type": "DefinedRegion", "addressCountry": "US" }
                },
                "hasMerchantReturnPolicy": {
                  "@type": "MerchantReturnPolicy",
                  "applicableCountry": "US",
                  "returnPolicyCategory": "https://schema.org/MerchantReturnNotPermitted",
                  "merchantReturnDays": "0"
                }
              },
              {
                "@type": "Offer",
                "name": "Starter Plan",
                "price": "20",
                "priceCurrency": "USD",
                "billingIncrement": "month",
                "priceValidUntil": "2027-12-31",
                "availability": "https://schema.org/InStock",
                "shippingDetails": {
                  "@type": "OfferShippingDetails",
                  "shippingRate": { "@type": "MonetaryAmount", "value": "0", "currency": "USD" },
                  "deliveryTime": {
                    "@type": "ShippingDeliveryTime",
                    "handlingTime": { "@type": "QuantitativeValue", "minValue": "0", "maxValue": "0", "unitCode": "d" },
                    "transitTime": { "@type": "QuantitativeValue", "minValue": "0", "maxValue": "0", "unitCode": "d" }
                  },
                  "shippingDestination": { "@type": "DefinedRegion", "addressCountry": "US" }
                },
                "hasMerchantReturnPolicy": {
                  "@type": "MerchantReturnPolicy",
                  "applicableCountry": "US",
                  "returnPolicyCategory": "https://schema.org/MerchantReturnNotPermitted",
                  "merchantReturnDays": "0"
                }
              }
            ],
            "aggregateRating": {
              "@type": "AggregateRating",
              "ratingValue": "4.8",
              "bestRating": "5",
              "ratingCount": "1250"
            },
            "award": "#1 Ranked Computer-Use Agent — 82% OSWorld Benchmark (369 real-world tasks)",
            "featureList": [
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
              "Open Source Framework",
              "24/7 Autonomous Operation"
            ],
            "screenshot": "https://coasty.ai/demo-screenshot.png",
            "sameAs": [
              "https://x.com/coasty_ai",
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
            "logo": "https://coasty.ai/logo_light.svg",
            "description": seoT("structuredData.orgDescription"),
            "foundingDate": "2025",
            "knowsAbout": ["Computer Use Agents", "AI Automation", "Desktop Automation", "Browser Automation", "Autonomous AI Agents", "Virtual Machine Isolation"],
            "sameAs": [
              "https://x.com/coasty_ai",
              "https://github.com/anthropics/open-computer-use",
              "https://www.producthunt.com/products/coasty"
            ],
            "contactPoint": {
              "@type": "ContactPoint",
              "contactType": "customer support",
              "email": "support@coasty.ai",
              "availableLanguage": availableLanguages
            }
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
            "downloadUrl": "https://coasty.ai/download",
            "applicationCategory": "BusinessApplication",
            "operatingSystem": "Web Browser, Windows 10+, macOS 10.15+",
            "softwareVersion": "1.5.0",
            "description": seoT("structuredData.softwareDescription"),
            "award": "#1 Ranked Computer-Use Agent — 82% OSWorld Benchmark",
            "isAccessibleForFree": true,
            "offers": {
              "@type": "AggregateOffer",
              "lowPrice": "0",
              "highPrice": "20",
              "priceCurrency": "USD",
              "offerCount": "2"
            },
            "aggregateRating": {
              "@type": "AggregateRating",
              "ratingValue": "4.8",
              "bestRating": "5",
              "ratingCount": "1250"
            },
            "featureList": [
              "82% OSWorld Benchmark Score",
              "Autonomous Browser Automation",
              "Full Desktop Control",
              "Built-in CAPTCHA Solving",
              "VM-Level Session Isolation",
              "Multi-Model AI (OpenAI, Anthropic, Google, Mistral)",
              "Desktop App for Mac & Windows",
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
        <NextIntlClientProvider locale={locale} messages={messages}>
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
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
