import { MetadataRoute } from 'next'
import { getAllBlogPostIds, getAllSeoPageSlugs } from '@/lib/blog/api'

export const dynamic = 'force-dynamic'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = 'https://coasty.ai'

  // Fetch dynamic content from Supabase
  const [blogPostIds, seoPageSlugs] = await Promise.all([
    getAllBlogPostIds(),
    getAllSeoPageSlugs(),
  ])

  const competitorSlugs = [
    'anthropic-computer-use',
    'openai-operator',
    'adept-ai',
    'multion',
    'browserbase',
    'induced-ai',
    'uipath',
    'automation-anywhere',
    'virtual-assistant',
    'devin-ai',
  ]

  const useCaseSlugs = [
    'competitor-intel',
    'qa-bug-reports',
    'seo-gap-analysis',
    'data-extraction',
    'lead-generation',
    'site-audit',
    'ad-intelligence',
    'email-outreach',
    'design-review',
    'price-monitoring',
    'market-research',
    'email-campaigns',
  ]

  const staticPages: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1,
    },
    {
      url: `${baseUrl}/computer-use`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.95,
    },
    {
      url: `${baseUrl}/results`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    {
      url: `${baseUrl}/download`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.9,
    },
    {
      url: `${baseUrl}/blog`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.85,
    },
    {
      url: `${baseUrl}/compare`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.85,
    },
    {
      url: `${baseUrl}/guide`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    {
      url: `${baseUrl}/auth`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    {
      url: `${baseUrl}/terms`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    {
      url: `${baseUrl}/privacy`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.6,
    },
  ]

  const blogPages: MetadataRoute.Sitemap = blogPostIds.map((id) => ({
    url: `${baseUrl}/blog/${id}`,
    lastModified: new Date(),
    changeFrequency: 'weekly' as const,
    priority: 0.8,
  }))

  const comparePages: MetadataRoute.Sitemap = competitorSlugs.map((slug) => ({
    url: `${baseUrl}/compare/${slug}`,
    lastModified: new Date(),
    changeFrequency: 'monthly' as const,
    priority: 0.8,
  }))

  const useCasePages: MetadataRoute.Sitemap = useCaseSlugs.map((slug) => ({
    url: `${baseUrl}/use-cases/${slug}`,
    lastModified: new Date(),
    changeFrequency: 'monthly' as const,
    priority: 0.8,
  }))

  const computerUsePages: MetadataRoute.Sitemap = seoPageSlugs.map((slug) => ({
    url: `${baseUrl}/computer-use/${slug}`,
    lastModified: new Date(),
    changeFrequency: 'weekly' as const,
    priority: 0.85,
  }))

  return [
    ...staticPages,
    ...blogPages,
    ...comparePages,
    ...useCasePages,
    ...computerUsePages,
  ]
}
