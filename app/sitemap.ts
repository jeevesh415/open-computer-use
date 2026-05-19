import { MetadataRoute } from 'next'
import {
  getAllBlogPostsForSitemap,
  getAllSeoPagesForSitemap,
} from '@/lib/blog/api'
import { DEVELOPERS_API_ENABLED } from '@/lib/feature-flags'

export const dynamic = 'force-dynamic'

/**
 * Hand-bumped `lastModified` for static pages.
 *
 * Why hand-bumped instead of `new Date()`:
 *   - Vercel rebuilds reset file mtimes, so we can't read them.
 *   - Stamping `new Date()` on every URL on every build trains crawlers
 *     (Google, Bing, ChatGPT browse, Perplexity) to ignore `lastModified`
 *     entirely — defeats the field's purpose.
 *   - For pages whose content actually changes, bump the constant in the
 *     `STATIC_PAGE_LAST_MODIFIED` map below as part of the same PR.
 *
 * For dynamic content (blog posts, SEO pages, etc.) we fetch real
 * `updated_at` from Supabase via `getAllBlogPostsForSitemap()` and
 * `getAllSeoPagesForSitemap()` — so those URLs always have truthful
 * timestamps without manual maintenance.
 */
const STATIC_PAGE_LAST_MODIFIED: Record<string, string> = {
  '/':                    '2026-05-05', // landing — bumped on landing edits
  '/computer-use':        '2026-05-05', // headline product surface
  '/results':             '2026-05-05',
  '/download':            '2026-04-22',
  '/blog':                '2026-05-05', // index re-renders when posts ship
  '/compare':             '2026-04-22',
  '/guide':               '2026-04-22',
  '/api-docs':            '2026-05-05',
  '/pricing':             '2026-05-05',
  '/auth':                '2026-04-01',
  '/terms':               '2026-04-22',
  '/privacy':             '2026-04-22',
  // Discovery surfaces — agent-readable. Low priority but listed so
  // crawlers can find them on first pass.
  '/api/discovery':       '2026-05-05',
  '/api/pricing':         '2026-05-05',
  '/.well-known/openapi.json': '2026-05-05',
  '/llms.txt':            '2026-05-05',
  '/llms-full.txt':       '2026-05-05',
}

const COMPETITOR_SLUGS = [
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
] as const

const USE_CASE_SLUGS = [
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
] as const

/**
 * Last-modified stamp for the `/compare/{slug}` and `/use-cases/{slug}`
 * pages. These are templated marketing pages — content moves rarely.
 * Bump this constant when you edit the underlying templates.
 */
const COMPARE_USE_CASE_LAST_MODIFIED = '2026-04-22'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = 'https://coasty.ai'

  // Real `updated_at` from Supabase for dynamic content
  const [blogPosts, seoPages] = await Promise.all([
    getAllBlogPostsForSitemap(),
    getAllSeoPagesForSitemap(),
  ])

  // Static pages — hand-bumped lastModified
  const staticPages: MetadataRoute.Sitemap = [
    { url: baseUrl,                       lastModified: new Date(STATIC_PAGE_LAST_MODIFIED['/']),             changeFrequency: 'daily',   priority: 1.0 },
    { url: `${baseUrl}/computer-use`,     lastModified: new Date(STATIC_PAGE_LAST_MODIFIED['/computer-use']), changeFrequency: 'daily',   priority: 0.95 },
    { url: `${baseUrl}/results`,          lastModified: new Date(STATIC_PAGE_LAST_MODIFIED['/results']),      changeFrequency: 'weekly',  priority: 0.9 },
    { url: `${baseUrl}/download`,         lastModified: new Date(STATIC_PAGE_LAST_MODIFIED['/download']),     changeFrequency: 'monthly', priority: 0.9 },
    { url: `${baseUrl}/blog`,             lastModified: new Date(STATIC_PAGE_LAST_MODIFIED['/blog']),         changeFrequency: 'daily',   priority: 0.85 },
    { url: `${baseUrl}/compare`,          lastModified: new Date(STATIC_PAGE_LAST_MODIFIED['/compare']),      changeFrequency: 'weekly',  priority: 0.85 },
    ...(DEVELOPERS_API_ENABLED
      ? [{ url: `${baseUrl}/api-docs`,     lastModified: new Date(STATIC_PAGE_LAST_MODIFIED['/api-docs']),     changeFrequency: 'weekly' as const,  priority: 0.85 }]
      : []),
    { url: `${baseUrl}/pricing`,          lastModified: new Date(STATIC_PAGE_LAST_MODIFIED['/pricing']),      changeFrequency: 'weekly',  priority: 0.85 },
    { url: `${baseUrl}/guide`,            lastModified: new Date(STATIC_PAGE_LAST_MODIFIED['/guide']),        changeFrequency: 'weekly',  priority: 0.8 },
    { url: `${baseUrl}/auth`,             lastModified: new Date(STATIC_PAGE_LAST_MODIFIED['/auth']),         changeFrequency: 'monthly', priority: 0.7 },
    { url: `${baseUrl}/terms`,            lastModified: new Date(STATIC_PAGE_LAST_MODIFIED['/terms']),        changeFrequency: 'monthly', priority: 0.6 },
    { url: `${baseUrl}/privacy`,          lastModified: new Date(STATIC_PAGE_LAST_MODIFIED['/privacy']),      changeFrequency: 'monthly', priority: 0.6 },
  ]

  // Discovery surfaces — agents discovering us via search may pick them
  // up. Lower priority so they don't outrank human-facing pages.
  const discoveryPages: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/api/discovery`,            lastModified: new Date(STATIC_PAGE_LAST_MODIFIED['/api/discovery']),            changeFrequency: 'weekly',  priority: 0.4 },
    { url: `${baseUrl}/api/pricing`,              lastModified: new Date(STATIC_PAGE_LAST_MODIFIED['/api/pricing']),              changeFrequency: 'weekly',  priority: 0.4 },
    { url: `${baseUrl}/.well-known/openapi.json`, lastModified: new Date(STATIC_PAGE_LAST_MODIFIED['/.well-known/openapi.json']), changeFrequency: 'weekly',  priority: 0.4 },
    { url: `${baseUrl}/llms.txt`,                 lastModified: new Date(STATIC_PAGE_LAST_MODIFIED['/llms.txt']),                 changeFrequency: 'weekly',  priority: 0.4 },
    { url: `${baseUrl}/llms-full.txt`,            lastModified: new Date(STATIC_PAGE_LAST_MODIFIED['/llms-full.txt']),            changeFrequency: 'weekly',  priority: 0.4 },
  ]

  // Blog posts — real `updated_at` (or `date` fallback) from Supabase
  const blogPages: MetadataRoute.Sitemap = blogPosts.map((p) => ({
    url: `${baseUrl}/blog/${p.id}`,
    lastModified: new Date(p.lastModified),
    changeFrequency: 'weekly' as const,
    priority: 0.8,
  }))

  // SEO pages /computer-use/{slug} — real `updated_at` from Supabase
  const computerUsePages: MetadataRoute.Sitemap = seoPages.map((p) => ({
    url: `${baseUrl}/computer-use/${p.slug}`,
    lastModified: new Date(p.lastModified),
    changeFrequency: 'weekly' as const,
    priority: 0.85,
  }))

  // Comparison pages — templated marketing, hand-bumped
  const comparePages: MetadataRoute.Sitemap = COMPETITOR_SLUGS.map((slug) => ({
    url: `${baseUrl}/compare/${slug}`,
    lastModified: new Date(COMPARE_USE_CASE_LAST_MODIFIED),
    changeFrequency: 'monthly' as const,
    priority: 0.8,
  }))

  // Use-case pages — templated marketing, hand-bumped
  const useCasePages: MetadataRoute.Sitemap = USE_CASE_SLUGS.map((slug) => ({
    url: `${baseUrl}/use-cases/${slug}`,
    lastModified: new Date(COMPARE_USE_CASE_LAST_MODIFIED),
    changeFrequency: 'monthly' as const,
    priority: 0.8,
  }))

  return [
    ...staticPages,
    ...discoveryPages,
    ...blogPages,
    ...comparePages,
    ...useCasePages,
    ...computerUsePages,
  ]
}
