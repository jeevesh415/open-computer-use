import { createServiceClient } from "@/lib/supabase/service"
import type { BlogPost, BlogPostListItem, SeoPage } from "./types"
import type { SupabaseClient } from "@supabase/supabase-js"

// The typed Database doesn't include blog_posts/seo_pages yet,
// so we cast to an untyped client for these dynamic tables.
function getClient(): SupabaseClient | null {
  return createServiceClient() as SupabaseClient | null
}

/**
 * Best-effort hostname extraction for an upstream-fetch failure log.
 *
 * Background: 2026-04-23 18:27Z → 04-24 04:53Z, the blog routes produced 47
 * `Failed to fetch blog post <slug>: TypeError: fetch failed → ConnectTimeoutError`
 * lines with no hostname in the message — debugging took an hour to localise
 * the upstream because the only visible artefact was the slug.  The
 * supabase-js client wraps undici under the hood; when the *connection*
 * fails (vs a structured Postgrest error), the exception surfaces as a
 * generic `TypeError: fetch failed` whose `.cause` is the underlying
 * `ConnectTimeoutError` / `EAI_AGAIN` / etc.
 *
 * We can't easily reach into the supabase client to get the URL it tried,
 * so we fall back to the configured `SUPABASE_URL` env var which is the
 * real upstream host.  Returning the bare hostname (no scheme, no path) is
 * deliberate — that's what someone debugging in CloudWatch will dig for.
 */
function upstreamHost(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  if (!url) return "<supabase-url-not-configured>"
  try {
    return new URL(url).host
  } catch {
    return "<invalid-supabase-url>"
  }
}

/**
 * Format a connection-failure exception into one diagnostic line.
 *
 * Captures both the high-level message ("fetch failed") and the underlying
 * cause (`ConnectTimeoutError`, `getaddrinfo ENOTFOUND`, etc.) so we can
 * tell next time whether the upstream is unreachable, throttling us, or
 * sending malformed responses.
 */
function describeFetchError(err: unknown): string {
  if (err instanceof Error) {
    // Node 18+ wraps the underlying error in `cause`.
    const cause = (err as Error & { cause?: unknown }).cause
    const causeStr =
      cause instanceof Error
        ? `${cause.name}: ${cause.message}`
        : cause
        ? String(cause)
        : ""
    return causeStr ? `${err.name}: ${err.message} (cause: ${causeStr})` : `${err.name}: ${err.message}`
  }
  return String(err)
}

// --- Blog Posts ---

export async function getBlogPosts(): Promise<BlogPostListItem[]> {
  const supabase = getClient()
  if (!supabase) return []

  try {
    const { data, error } = await supabase
      .from("blog_posts")
      .select("id, title, excerpt, author, date, read_time, category, featured")
      .eq("published", true)
      .order("date", { ascending: false })

    if (error) {
      console.error(
        `Failed to fetch blog posts (postgrest): ${error.message} [host=${upstreamHost()}]`,
      )
      return []
    }

    return (data ?? []) as BlogPostListItem[]
  } catch (err) {
    // Connection-level failure: supabase host unreachable, DNS, TLS, etc.
    // Fall back to an empty list so the caller (blog index, RSS feed,
    // sitemap generator, internal-links sidebar) keeps rendering instead
    // of returning a 500 page.  The user sees an empty blog index, not a
    // crash; meanwhile we get a debuggable log line with the actual host.
    console.error(
      `Failed to fetch blog posts (connection): ${describeFetchError(err)} [host=${upstreamHost()}]`,
    )
    return []
  }
}

export async function getBlogPost(id: string): Promise<BlogPost | null> {
  const supabase = getClient()
  if (!supabase) return null

  try {
    const { data, error } = await supabase
      .from("blog_posts")
      .select("*")
      .eq("id", id)
      .eq("published", true)
      .single()

    if (error) {
      // PGRST116 = no rows returned for `.single()` — this is a legitimate
      // "post doesn't exist" 404 case, not an upstream failure.  Log at
      // info-level so it doesn't pollute the ERROR signal.
      if (error.code === "PGRST116") {
        console.info(`Blog post not found: ${id}`)
        return null
      }
      console.error(
        `Failed to fetch blog post ${id} (postgrest): ${error.message} [host=${upstreamHost()}]`,
      )
      return null
    }

    return (data as BlogPost) ?? null
  } catch (err) {
    // Connection-level failure (host unreachable, DNS, TLS handshake fail,
    // proxy/cf 5xx surfaced as TypeError).  The page route should render
    // its 404 fallback rather than crash.  Log with the slug AND host so
    // the next time this happens for ~10 hours we can localise the
    // upstream from the first log line.
    console.error(
      `Failed to fetch blog post ${id} (connection): ${describeFetchError(err)} [host=${upstreamHost()}]`,
    )
    return null
  }
}

export async function getAllBlogPostIds(): Promise<string[]> {
  const supabase = getClient()
  if (!supabase) return []

  try {
    const { data, error } = await supabase
      .from("blog_posts")
      .select("id")
      .eq("published", true)
      .order("date", { ascending: false })

    if (error) {
      console.error(
        `Failed to list blog post ids (postgrest): ${error.message} [host=${upstreamHost()}]`,
      )
      return []
    }
    return (data ?? []).map((p: any) => p.id)
  } catch (err) {
    // Used by sitemap + static-params generation; an empty list at build
    // time is recoverable (subsequent builds will rediscover slugs once
    // the upstream is back) — far better than a build crash.
    console.error(
      `Failed to list blog post ids (connection): ${describeFetchError(err)} [host=${upstreamHost()}]`,
    )
    return []
  }
}

/**
 * Sitemap-tuned variant of {@link getAllBlogPostIds} that includes the
 * real `updated_at` (or fallback `date`) so `app/sitemap.ts` can emit
 * truthful `lastModified` values instead of build-time-now stamps.
 *
 * Crawlers (Google, Bing, ChatGPT browse) use `lastModified` to decide
 * recrawl priority — emitting `new Date()` for every URL on every build
 * trains them to ignore the field entirely. Returning the actual write
 * timestamp restores its meaning.
 */
export interface BlogPostSitemapEntry {
  id: string
  /** ISO-8601 string. Prefer `updated_at`; fall back to `date` if null. */
  lastModified: string
}

export async function getAllBlogPostsForSitemap(): Promise<BlogPostSitemapEntry[]> {
  const supabase = getClient()
  if (!supabase) return []

  try {
    const { data, error } = await supabase
      .from("blog_posts")
      .select("id, date, updated_at")
      .eq("published", true)
      .order("date", { ascending: false })

    if (error) {
      console.error(
        `Failed to list blog posts for sitemap (postgrest): ${error.message} [host=${upstreamHost()}]`,
      )
      return []
    }
    return (data ?? []).map(
      (p: { id: string; date: string; updated_at: string | null }) => ({
        id: p.id,
        lastModified: p.updated_at ?? p.date,
      }),
    )
  } catch (err) {
    console.error(
      `Failed to list blog posts for sitemap (connection): ${describeFetchError(err)} [host=${upstreamHost()}]`,
    )
    return []
  }
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

  try {
    const { data, error } = await supabase
      .from("seo_pages")
      .select("*")
      .eq("published", true)
      .order("slug", { ascending: true })

    if (error) {
      console.error(
        `Failed to fetch SEO pages (postgrest): ${error.message} [host=${upstreamHost()}]`,
      )
      return []
    }
    return (data ?? []) as SeoPage[]
  } catch (err) {
    console.error(
      `Failed to fetch SEO pages (connection): ${describeFetchError(err)} [host=${upstreamHost()}]`,
    )
    return []
  }
}

export async function getSeoPage(slug: string): Promise<SeoPage | null> {
  const supabase = getClient()
  if (!supabase) return null

  try {
    const { data, error } = await supabase
      .from("seo_pages")
      .select("*")
      .eq("slug", slug)
      .eq("published", true)
      .single()

    if (error) {
      // Same PGRST116 demotion as getBlogPost — not-found is not an error.
      if (error.code !== "PGRST116") {
        console.error(
          `Failed to fetch SEO page ${slug} (postgrest): ${error.message} [host=${upstreamHost()}]`,
        )
      }
      return null
    }
    return (data as SeoPage) ?? null
  } catch (err) {
    console.error(
      `Failed to fetch SEO page ${slug} (connection): ${describeFetchError(err)} [host=${upstreamHost()}]`,
    )
    return null
  }
}

export async function getAllSeoPageSlugs(): Promise<string[]> {
  const supabase = getClient()
  if (!supabase) return []

  try {
    const { data, error } = await supabase
      .from("seo_pages")
      .select("slug")
      .eq("published", true)

    if (error) {
      console.error(
        `Failed to list SEO page slugs (postgrest): ${error.message} [host=${upstreamHost()}]`,
      )
      return []
    }
    return (data ?? []).map((p: any) => p.slug)
  } catch (err) {
    console.error(
      `Failed to list SEO page slugs (connection): ${describeFetchError(err)} [host=${upstreamHost()}]`,
    )
    return []
  }
}

/**
 * Sitemap-tuned variant of {@link getAllSeoPageSlugs}. Returns slug +
 * real `updated_at` so `app/sitemap.ts` can emit truthful `lastModified`
 * values for `/computer-use/{slug}` URLs.
 *
 * Falls back to `created_at` if `updated_at` is null (newly imported
 * pages can have null updated_at until first edit).
 */
export interface SeoPageSitemapEntry {
  slug: string
  /** ISO-8601 string. Prefer `updated_at`, fall back to `created_at`. */
  lastModified: string
}

export async function getAllSeoPagesForSitemap(): Promise<SeoPageSitemapEntry[]> {
  const supabase = getClient()
  if (!supabase) return []

  try {
    const { data, error } = await supabase
      .from("seo_pages")
      .select("slug, created_at, updated_at")
      .eq("published", true)
      .order("slug", { ascending: true })

    if (error) {
      console.error(
        `Failed to list SEO pages for sitemap (postgrest): ${error.message} [host=${upstreamHost()}]`,
      )
      return []
    }
    return (data ?? []).map(
      (p: { slug: string; created_at: string; updated_at: string | null }) => ({
        slug: p.slug,
        lastModified: p.updated_at ?? p.created_at,
      }),
    )
  } catch (err) {
    console.error(
      `Failed to list SEO pages for sitemap (connection): ${describeFetchError(err)} [host=${upstreamHost()}]`,
    )
    return []
  }
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
