export interface ContentBlock {
  type: "intro" | "section" | "highlight" | "conclusion"
  text?: string
  title?: string
  bullets?: string[]
}

export interface BlogPost {
  id: string
  title: string
  excerpt: string
  author: string
  date: string
  read_time: string
  category: string
  featured: boolean
  content: ContentBlock[]
  keywords: string[]
  meta_description: string | null
  published: boolean
  created_at: string
  updated_at: string
}

export interface BlogPostListItem {
  id: string
  title: string
  excerpt: string
  author: string
  date: string
  read_time: string
  category: string
  featured: boolean
}

export interface SeoPage {
  slug: string
  title: string
  headline: string
  meta_description: string
  keywords: string[]
  hero_stat: string | null
  hero_stat_label: string | null
  content: ContentBlock[]
  related_blog_ids: string[]
  related_use_case_slugs: string[]
  related_comparison_slugs: string[]
  published: boolean
  created_at: string
  updated_at: string
}
