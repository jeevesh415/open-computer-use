import { createServiceClient } from "@/lib/supabase/service"
import type { BlogPost, BlogPostListItem, SeoPage } from "./types"
import type { SupabaseClient } from "@supabase/supabase-js"

// The typed Database doesn't include blog_posts/seo_pages yet,
// so we cast to an untyped client for these dynamic tables.
function getClient(): SupabaseClient | null {
  return createServiceClient() as SupabaseClient | null
}

// --- Blog Posts ---

export async function getBlogPosts(): Promise<BlogPostListItem[]> {
  const supabase = getClient()
  if (!supabase) return []

  const { data, error } = await supabase
    .from("blog_posts")
    .select("id, title, excerpt, author, date, read_time, category, featured")
    .eq("published", true)
    .order("date", { ascending: false })

  if (error) {
    console.error("Failed to fetch blog posts:", error.message)
    return []
  }

  return (data ?? []) as BlogPostListItem[]
}

export async function getBlogPost(id: string): Promise<BlogPost | null> {
  const supabase = getClient()
  if (!supabase) return null

  const { data, error } = await supabase
    .from("blog_posts")
    .select("*")
    .eq("id", id)
    .eq("published", true)
    .single()

  if (error) {
    console.error(`Failed to fetch blog post ${id}:`, error.message)
    return null
  }

  return (data as BlogPost) ?? null
}

export async function getAllBlogPostIds(): Promise<string[]> {
  const supabase = getClient()
  if (!supabase) return []

  const { data, error } = await supabase
    .from("blog_posts")
    .select("id")
    .eq("published", true)
    .order("date", { ascending: false })

  if (error) return []
  return (data ?? []).map((p: any) => p.id)
}

export async function upsertBlogPost(post: Omit<BlogPost, "created_at" | "updated_at">): Promise<{ success: boolean; error?: string }> {
  const supabase = getClient()
  if (!supabase) return { success: false, error: "Supabase not configured" }

  const { error } = await supabase
    .from("blog_posts")
    .upsert(post as any, { onConflict: "id" })

  if (error) return { success: false, error: error.message }
  return { success: true }
}

// --- SEO Pages ---

export async function getSeoPages(): Promise<SeoPage[]> {
  const supabase = getClient()
  if (!supabase) return []

  const { data, error } = await supabase
    .from("seo_pages")
    .select("*")
    .eq("published", true)
    .order("slug", { ascending: true })

  if (error) {
    console.error("Failed to fetch SEO pages:", error.message)
    return []
  }

  return (data ?? []) as SeoPage[]
}

export async function getSeoPage(slug: string): Promise<SeoPage | null> {
  const supabase = getClient()
  if (!supabase) return null

  const { data, error } = await supabase
    .from("seo_pages")
    .select("*")
    .eq("slug", slug)
    .eq("published", true)
    .single()

  if (error) return null
  return (data as SeoPage) ?? null
}

export async function getAllSeoPageSlugs(): Promise<string[]> {
  const supabase = getClient()
  if (!supabase) return []

  const { data, error } = await supabase
    .from("seo_pages")
    .select("slug")
    .eq("published", true)

  if (error) return []
  return (data ?? []).map((p: any) => p.slug)
}

export async function upsertSeoPage(page: Omit<SeoPage, "created_at" | "updated_at">): Promise<{ success: boolean; error?: string }> {
  const supabase = getClient()
  if (!supabase) return { success: false, error: "Supabase not configured" }

  const { error } = await supabase
    .from("seo_pages")
    .upsert(page as any, { onConflict: "slug" })

  if (error) return { success: false, error: error.message }
  return { success: true }
}
