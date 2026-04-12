import { getTranslations } from "next-intl/server"

export async function FAQSchema({ locale }: { locale: string }) {
  let t: (key: string) => string
  try {
    const trans = await getTranslations("seo")
    t = (key: string) => trans(key as never)
  } catch {
    // Fallback — will return English from the default messages
    t = (key: string) => key
  }

  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "inLanguage": locale,
    "mainEntity": Array.from({ length: 10 }, (_, i) => ({
      "@type": "Question",
      "name": t(`faq.q${i + 1}`),
      "acceptedAnswer": {
        "@type": "Answer",
        "text": t(`faq.a${i + 1}`),
      },
    })),
  }

  return (
    <script
      id="faq-schema"
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
    />
  )
}

export async function LocalizedSEOSchemas({ locale }: { locale: string }) {
  let t: (key: string) => string
  try {
    const trans = await getTranslations("seo")
    t = (key: string) => trans(key as never)
  } catch {
    t = (key: string) => key
  }

  const productSchema = {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": "Coasty AI Employee",
    "description": t("structuredData.productDescription"),
    "brand": { "@type": "Brand", "name": "Coasty" },
    "category": "Software > Productivity > AI Automation",
    "image": "https://coasty.ai/demo-screenshot.png",
    "url": "https://coasty.ai",
    "inLanguage": locale,
    "offers": [
      {
        "@type": "Offer",
        "name": "Free Tier",
        "price": "0",
        "priceCurrency": "USD",
        "priceValidUntil": "2027-12-31",
        "availability": "https://schema.org/InStock",
        "url": "https://coasty.ai/auth",
        "shippingDetails": {
          "@type": "OfferShippingDetails",
          "shippingRate": { "@type": "MonetaryAmount", "value": "0", "currency": "USD" },
          "deliveryTime": {
            "@type": "ShippingDeliveryTime",
            "handlingTime": { "@type": "QuantitativeValue", "minValue": "0", "maxValue": "0", "unitCode": "d" },
            "transitTime": { "@type": "QuantitativeValue", "minValue": "0", "maxValue": "0", "unitCode": "d" },
          },
          "shippingDestination": { "@type": "DefinedRegion", "addressCountry": "US" },
        },
        "hasMerchantReturnPolicy": {
          "@type": "MerchantReturnPolicy",
          "applicableCountry": "US",
          "returnPolicyCategory": "https://schema.org/MerchantReturnNotPermitted",
          "merchantReturnDays": "0",
        },
      },
      {
        "@type": "Offer",
        "name": "Starter Plan",
        "price": "20",
        "priceCurrency": "USD",
        "priceValidUntil": "2027-12-31",
        "availability": "https://schema.org/InStock",
        "url": "https://coasty.ai/auth",
        "shippingDetails": {
          "@type": "OfferShippingDetails",
          "shippingRate": { "@type": "MonetaryAmount", "value": "0", "currency": "USD" },
          "deliveryTime": {
            "@type": "ShippingDeliveryTime",
            "handlingTime": { "@type": "QuantitativeValue", "minValue": "0", "maxValue": "0", "unitCode": "d" },
            "transitTime": { "@type": "QuantitativeValue", "minValue": "0", "maxValue": "0", "unitCode": "d" },
          },
          "shippingDestination": { "@type": "DefinedRegion", "addressCountry": "US" },
        },
        "hasMerchantReturnPolicy": {
          "@type": "MerchantReturnPolicy",
          "applicableCountry": "US",
          "returnPolicyCategory": "https://schema.org/MerchantReturnNotPermitted",
          "merchantReturnDays": "0",
        },
      },
    ],
    "aggregateRating": {
      "@type": "AggregateRating",
      "ratingValue": "4.8",
      "bestRating": "5",
      "ratingCount": "1250",
    },
    "award": "#1 Ranked on OSWorld Benchmark — 82% completion rate across 369 real-world computer tasks",
  }

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": t("structuredData.breadcrumbs.home"), "item": "https://coasty.ai" },
      { "@type": "ListItem", "position": 2, "name": t("structuredData.breadcrumbs.caseStudies"), "item": "https://coasty.ai/results" },
      { "@type": "ListItem", "position": 3, "name": t("structuredData.breadcrumbs.blog"), "item": "https://coasty.ai/blog" },
      { "@type": "ListItem", "position": 4, "name": t("structuredData.breadcrumbs.download"), "item": "https://coasty.ai/download" },
      { "@type": "ListItem", "position": 5, "name": t("structuredData.breadcrumbs.compare"), "item": "https://coasty.ai/compare" },
    ],
  }

  const videoSchema = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "name": "Coasty AI Agent Case Studies & Demos",
    "description": "Watch Coasty autonomously complete real-world computer tasks — marketing campaigns, job applications, QA testing, and more.",
    "itemListElement": [
      {
        "@type": "VideoObject",
        "position": 1,
        "name": "Coasty AI Agent — Autonomous Reddit Marketing Campaign",
        "description": "Watch Coasty autonomously run a full Reddit marketing campaign: researching competitors, identifying subreddits, crafting posts, and engaging with comments.",
        "thumbnailUrl": "https://img.youtube.com/vi/icxgLDephHE/maxresdefault.jpg",
        "uploadDate": "2026-03-04T00:00:00+00:00",
        "contentUrl": "https://youtube.com/watch?v=icxgLDephHE",
        "embedUrl": "https://youtube.com/embed/icxgLDephHE",
      },
      {
        "@type": "VideoObject",
        "position": 2,
        "name": "Coasty AI Agent — Autonomous Sales Prospecting & Email Outreach",
        "description": "Coasty finds prospective customers, researches their companies, writes personalized outreach emails, and sends them autonomously.",
        "thumbnailUrl": "https://img.youtube.com/vi/qTvmGfg3HVw/maxresdefault.jpg",
        "uploadDate": "2026-02-28T00:00:00+00:00",
        "contentUrl": "https://youtube.com/watch?v=qTvmGfg3HVw",
        "embedUrl": "https://youtube.com/embed/qTvmGfg3HVw",
      },
      {
        "@type": "VideoObject",
        "position": 3,
        "name": "Coasty AI Agent — Automated QA Testing",
        "description": "Watch Coasty QA test its own product: navigating checkout flows, catching bugs, and filing detailed reports.",
        "thumbnailUrl": "https://img.youtube.com/vi/Wbo2o74hVIo/maxresdefault.jpg",
        "uploadDate": "2026-03-03T00:00:00+00:00",
        "contentUrl": "https://youtube.com/watch?v=Wbo2o74hVIo",
        "embedUrl": "https://youtube.com/embed/Wbo2o74hVIo",
      },
      {
        "@type": "VideoObject",
        "position": 4,
        "name": "Coasty AI Agent — Autonomous Job Applications",
        "description": "Coasty finds matching roles, tailors resumes, and submits job applications across multiple platforms.",
        "thumbnailUrl": "https://img.youtube.com/vi/mH-csaCa508/maxresdefault.jpg",
        "uploadDate": "2026-02-24T00:00:00+00:00",
        "contentUrl": "https://youtube.com/watch?v=mH-csaCa508",
        "embedUrl": "https://youtube.com/embed/mH-csaCa508",
      },
      {
        "@type": "VideoObject",
        "position": 5,
        "name": "Coasty AI Agent — Filling Out YC S26 Application",
        "description": "Watch Coasty fill out the entire Y Combinator application: 30+ fields across multiple pages, completed autonomously.",
        "thumbnailUrl": "https://img.youtube.com/vi/AnHJuRMLCnE/maxresdefault.jpg",
        "uploadDate": "2026-02-26T00:00:00+00:00",
        "contentUrl": "https://youtube.com/watch?v=AnHJuRMLCnE",
        "embedUrl": "https://youtube.com/embed/AnHJuRMLCnE",
      },
      {
        "@type": "VideoObject",
        "position": 6,
        "name": "Coasty AI Agent — Posting on Hacker News Autonomously",
        "description": "Coasty drafts a blog post, submits it to Hacker News, and engages with comments in real time.",
        "thumbnailUrl": "https://img.youtube.com/vi/A_OvNh51Npg/maxresdefault.jpg",
        "uploadDate": "2026-02-22T00:00:00+00:00",
        "contentUrl": "https://youtube.com/watch?v=A_OvNh51Npg",
        "embedUrl": "https://youtube.com/embed/A_OvNh51Npg",
      },
    ],
  }

  return (
    <>
      <script
        id="product-schema"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productSchema) }}
      />
      <script
        id="video-schema"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(videoSchema) }}
      />
      <script
        id="breadcrumb-schema"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
      />
    </>
  )
}
