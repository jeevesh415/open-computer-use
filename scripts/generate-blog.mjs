/**
 * AI Blog Content Generator & Publisher
 *
 * Generates SEO-optimized blog posts and /computer-use/ pages using Claude,
 * then pushes them to Supabase via the API. No redeploy needed.
 *
 * Usage:
 *   # EASIEST: Trigger the backend auto-blog engine (generates 50 posts, searches web, fully auto)
 *   node scripts/generate-blog.mjs --trigger
 *
 *   # Check status of the auto-blog engine
 *   node scripts/generate-blog.mjs --status
 *
 *   # Generate a single blog post on a specific topic (uses Anthropic API directly)
 *   node scripts/generate-blog.mjs --blog "computer use for invoice processing"
 *
 *   # Generate a computer-use SEO page
 *   node scripts/generate-blog.mjs --seo-page "invoice-processing"
 *
 *   # Generate a batch of blog posts from a keyword list
 *   node scripts/generate-blog.mjs --batch blog --count 5
 *
 *   # Generate a batch of SEO pages
 *   node scripts/generate-blog.mjs --batch seo --count 10
 *
 *   # List pending keywords (topics not yet published)
 *   node scripts/generate-blog.mjs --list-pending
 *
 * Environment variables:
 *   ANTHROPIC_API_KEY  — Claude API key (only needed for --blog/--batch, NOT for --trigger)
 *   INTERNAL_API_KEY   — Your app's internal API key for publishing
 *   BACKEND_URL        — Your deployed backend URL (default: http://localhost:3000)
 *   PYTHON_BACKEND_URL — Python backend URL (default: http://localhost:8001)
 */

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3000"

const args = process.argv.slice(2)
const needsAnthropic = args.includes("--blog") || args.includes("--batch") || args.includes("--seo-page")

if (needsAnthropic && !ANTHROPIC_API_KEY) {
  console.error("Error: ANTHROPIC_API_KEY environment variable is required for --blog/--batch/--seo-page")
  process.exit(1)
}

if (!INTERNAL_API_KEY) {
  console.error("Error: INTERNAL_API_KEY environment variable is required")
  process.exit(1)
}

// --- Keyword banks for auto-generation ---

const BLOG_TOPICS = [
  // Computer use + industry
  "computer use for healthcare automation",
  "computer use for legal document processing",
  "computer use for real estate listing management",
  "computer use for accounting and bookkeeping",
  "computer use for insurance claims processing",
  "computer use for HR onboarding automation",
  "computer use for supply chain management",
  "computer use for e-commerce store management",
  "computer use for financial reporting",
  "computer use for travel booking automation",
  // Computer use + task
  "how AI agents automate data entry with computer use",
  "computer use vs traditional RPA: a complete comparison",
  "the complete guide to AI computer use in 2026",
  "why computer use agents are replacing browser extensions",
  "computer use for automated web scraping at scale",
  "building workflows with computer use agents",
  "computer use for social media management",
  "computer use for competitive pricing intelligence",
  "how to automate invoice processing with computer use",
  "computer use for automated testing and QA",
  // Best computer use / comparison
  "best computer use agent 2026: complete ranking",
  "computer use agent benchmark comparison",
  "top 10 computer use tools compared",
  "what makes the best computer use AI agent",
  "computer use agent vs virtual assistant: key differences",
  // Deep dives
  "how computer use agents see and understand screens",
  "the technology behind AI computer use: a deep dive",
  "computer use security: how AI agents handle credentials safely",
  "computer use at scale: parallel execution with agent swarms",
  "the future of computer use agents: 2027 predictions",
  // Use case stories
  "how a startup automated their entire hiring pipeline with computer use",
  "computer use case study: automating 1000 customer emails per day",
  "from manual to autonomous: a computer use transformation story",
  "how computer use agents handle multi-step browser workflows",
  "computer use for startup operations: a founder's guide",
]

const SEO_PAGE_TOPICS = [
  // Core tasks
  { slug: "data-entry", title: "AI Data Entry", stat: "10x", statLabel: "faster than manual entry" },
  { slug: "invoice-processing", title: "AI Invoice Processing", stat: "500+", statLabel: "invoices per hour" },
  { slug: "web-scraping", title: "AI Web Scraping", stat: "1000+", statLabel: "pages scraped per session" },
  { slug: "form-filling", title: "AI Form Filling", stat: "100+", statLabel: "forms filled per hour" },
  { slug: "email-management", title: "AI Email Management", stat: "200+", statLabel: "emails processed daily" },
  { slug: "report-generation", title: "AI Report Generation", stat: "50+", statLabel: "reports per day" },
  { slug: "social-media-posting", title: "AI Social Media Posting", stat: "20+", statLabel: "platforms managed" },
  { slug: "price-monitoring", title: "AI Price Monitoring", stat: "5000+", statLabel: "SKUs tracked" },
  { slug: "job-applications", title: "AI Job Applications", stat: "50+", statLabel: "applications per session" },
  { slug: "customer-support", title: "AI Customer Support", stat: "76%", statLabel: "tickets auto-resolved" },
  { slug: "lead-research", title: "AI Lead Research", stat: "100+", statLabel: "leads per hour" },
  { slug: "content-publishing", title: "AI Content Publishing", stat: "30+", statLabel: "posts published daily" },
  { slug: "crm-updates", title: "AI CRM Updates", stat: "500+", statLabel: "records updated per hour" },
  { slug: "file-management", title: "AI File Management", stat: "1000+", statLabel: "files organized" },
  { slug: "calendar-scheduling", title: "AI Calendar Scheduling", stat: "50+", statLabel: "meetings scheduled daily" },
  { slug: "pdf-processing", title: "AI PDF Processing", stat: "200+", statLabel: "PDFs processed per hour" },
  { slug: "spreadsheet-automation", title: "AI Spreadsheet Automation", stat: "100+", statLabel: "sheets processed" },
  { slug: "browser-testing", title: "AI Browser Testing", stat: "30+", statLabel: "test flows per session" },
  { slug: "competitor-monitoring", title: "AI Competitor Monitoring", stat: "50+", statLabel: "competitors tracked" },
  { slug: "recruiting-outreach", title: "AI Recruiting Outreach", stat: "100+", statLabel: "candidates contacted" },
  // Industry-specific
  { slug: "healthcare-automation", title: "Computer Use for Healthcare", stat: "5x", statLabel: "faster chart reviews" },
  { slug: "legal-document-review", title: "Computer Use for Legal", stat: "200+", statLabel: "documents reviewed daily" },
  { slug: "real-estate-automation", title: "Computer Use for Real Estate", stat: "50+", statLabel: "listings managed" },
  { slug: "ecommerce-automation", title: "Computer Use for E-Commerce", stat: "10x", statLabel: "faster operations" },
  { slug: "finance-automation", title: "Computer Use for Finance", stat: "100+", statLabel: "reports generated" },
  { slug: "education-automation", title: "Computer Use for Education", stat: "500+", statLabel: "assignments graded" },
  { slug: "marketing-automation", title: "Computer Use for Marketing", stat: "20+", statLabel: "campaigns managed" },
  { slug: "sales-automation", title: "Computer Use for Sales", stat: "200+", statLabel: "prospects contacted" },
  { slug: "hr-automation", title: "Computer Use for HR", stat: "50+", statLabel: "onboardings per month" },
  { slug: "insurance-automation", title: "Computer Use for Insurance", stat: "100+", statLabel: "claims processed daily" },
]

const AUTHORS = [
  "Marcus Sterling",
  "Sarah Chen",
  "Michael Rodriguez",
  "Emily Watson",
  "David Park",
  "Alex Thompson",
  "Rachel Kim",
  "James Liu",
  "Lisa Chen",
]

const CATEGORIES = ["Product", "Research", "Case Study", "Engineering", "Industry", "Guide"]

// --- Claude API ---

async function callClaude(systemPrompt, userPrompt) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Claude API error ${res.status}: ${text}`)
  }

  const data = await res.json()
  return data.content[0].text
}

// --- Content generation ---

async function generateBlogPost(topic) {
  const systemPrompt = `You are an expert SEO content writer for Coasty, the #1 computer use AI agent (ranked #1 on OSWorld with 82% accuracy). Coasty controls desktops, browsers, and terminals like a human.

Your job is to write compelling, SEO-optimized blog posts that:
1. Target "computer use" and related keywords heavily and naturally
2. Position Coasty as the best computer use agent
3. Include real-world examples and specific numbers
4. Are genuinely informative, not just keyword-stuffed
5. Follow the exact JSON structure specified

IMPORTANT: Every post should naturally mention "computer use" at least 5-8 times. Include variations like "computer use agent", "computer-using AI", "AI computer use", "best computer use", "computer use automation".`

  const userPrompt = `Write a blog post about: "${topic}"

Return ONLY valid JSON (no markdown, no code fences) with this exact structure:
{
  "id": "slug-version-of-title",
  "title": "SEO-Optimized Title (include 'computer use' if relevant)",
  "excerpt": "2-3 sentence excerpt with keywords",
  "author": "${AUTHORS[Math.floor(Math.random() * AUTHORS.length)]}",
  "read_time": "X min",
  "category": "one of: Product, Research, Case Study, Engineering, Industry, Guide",
  "keywords": ["array", "of", "8-12", "seo", "keywords"],
  "meta_description": "160 char meta description with primary keyword",
  "content": [
    { "type": "intro", "text": "opening paragraph" },
    { "type": "section", "title": "Section Title", "text": "paragraph text" },
    { "type": "section", "title": "Section Title", "bullets": ["bullet 1", "bullet 2"] },
    { "type": "highlight", "text": "key quote or stat" },
    { "type": "section", "title": "Another Section", "text": "more text" },
    { "type": "conclusion", "text": "closing paragraph" }
  ]
}

Include 5-8 content blocks. Make the content substantial (800-1200 words total). The title should be compelling and include the primary keyword.`

  const raw = await callClaude(systemPrompt, userPrompt)

  // Parse JSON from response (handle potential markdown wrapping)
  let json = raw.trim()
  if (json.startsWith("```")) {
    json = json.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "")
  }

  const post = JSON.parse(json)
  post.date = new Date().toISOString().split("T")[0]
  post.featured = false
  post.published = true

  return post
}

async function generateSeoPage(topicObj) {
  const { slug, title, stat, statLabel } = topicObj

  const systemPrompt = `You are an expert SEO content writer for Coasty, the #1 computer use AI agent. You write landing pages for the /computer-use/ section of the website.

Each page targets a specific task/industry that computer use agents can automate. The goal is to rank for "[task] + computer use" and "[task] + AI agent" keywords.

These pages should:
1. Explain how Coasty's computer use agent handles this specific task
2. Include specific steps, benefits, and outcomes
3. Reference "computer use" naturally 5+ times
4. Be genuinely helpful and informative
5. Follow the exact JSON structure`

  const userPrompt = `Write a landing page for: "${title}" (slug: ${slug})
Hero stat: ${stat} ${statLabel}

Return ONLY valid JSON (no markdown, no code fences):
{
  "slug": "${slug}",
  "title": "${title}",
  "headline": "Compelling headline about this computer use capability",
  "meta_description": "160 char description targeting '${title.toLowerCase()} computer use agent'",
  "keywords": ["8-12 keywords targeting this task + computer use"],
  "hero_stat": "${stat}",
  "hero_stat_label": "${statLabel}",
  "content": [
    { "type": "intro", "text": "opening that explains this computer use capability" },
    { "type": "section", "title": "How It Works", "text": "explanation" },
    { "type": "section", "title": "Key Benefits", "bullets": ["benefit 1", "benefit 2", "benefit 3", "benefit 4"] },
    { "type": "highlight", "text": "impressive stat or claim" },
    { "type": "section", "title": "Use Cases", "text": "specific examples" },
    { "type": "conclusion", "text": "CTA-oriented closing" }
  ],
  "related_blog_ids": [],
  "related_use_case_slugs": [],
  "related_comparison_slugs": ["anthropic-computer-use", "openai-operator"]
}

Make content substantial (600-900 words). Focus on the specific task and how computer use agents solve it.`

  const raw = await callClaude(systemPrompt, userPrompt)

  let json = raw.trim()
  if (json.startsWith("```")) {
    json = json.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "")
  }

  const page = JSON.parse(json)
  page.published = true
  return page
}

// --- Publishing ---

async function publishBlogPost(post) {
  const res = await fetch(`${BACKEND_URL}/api/blog/posts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-key": INTERNAL_API_KEY,
    },
    body: JSON.stringify(post),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Failed to publish blog post: ${res.status} ${text}`)
  }

  return await res.json()
}

async function publishSeoPage(page) {
  const res = await fetch(`${BACKEND_URL}/api/blog/seo-pages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-key": INTERNAL_API_KEY,
    },
    body: JSON.stringify(page),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Failed to publish SEO page: ${res.status} ${text}`)
  }

  return await res.json()
}

async function triggerRevalidation(paths = []) {
  try {
    await fetch(`${BACKEND_URL}/api/blog/revalidate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-key": INTERNAL_API_KEY,
      },
      body: JSON.stringify({ paths }),
    })
  } catch (e) {
    console.warn("Revalidation request failed (non-critical):", e.message)
  }
}

async function getExistingBlogIds() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/blog/posts`)
    const data = await res.json()
    return Array.isArray(data) ? data.map((p) => p.id) : []
  } catch {
    return []
  }
}

async function getExistingSeoSlugs() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/blog/seo-pages`)
    const data = await res.json()
    return Array.isArray(data) ? data.map((p) => p.slug) : []
  } catch {
    return []
  }
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2)
  const PYTHON_BACKEND_URL = process.env.PYTHON_BACKEND_URL || "http://localhost:8001"

  if (args.includes("--help") || args.length === 0) {
    console.log(`
AI Blog Content Generator & Publisher

Usage:
  node scripts/generate-blog.mjs --trigger              Trigger backend auto-engine (50 posts, web search, fully auto)
  node scripts/generate-blog.mjs --status               Check auto-blog engine status
  node scripts/generate-blog.mjs --blog "topic"         Generate single post (needs ANTHROPIC_API_KEY)
  node scripts/generate-blog.mjs --seo-page "slug"      Generate single SEO page
  node scripts/generate-blog.mjs --batch blog --count 5  Batch generate blog posts
  node scripts/generate-blog.mjs --batch seo --count 10  Batch generate SEO pages
  node scripts/generate-blog.mjs --list-pending          List pending topics

Environment variables:
  ANTHROPIC_API_KEY     Claude API key (only for --blog/--batch)
  INTERNAL_API_KEY      App internal API key
  BACKEND_URL           Next.js URL (default: http://localhost:3000)
  PYTHON_BACKEND_URL    Python backend URL (default: http://localhost:8001)
`)
    process.exit(0)
  }

  // --trigger: Hit the Python backend to start a full generation run
  if (args.includes("--trigger")) {
    if (!INTERNAL_API_KEY) {
      console.error("Error: INTERNAL_API_KEY required")
      process.exit(1)
    }
    console.log(`Triggering auto-blog engine at ${PYTHON_BACKEND_URL}...`)
    const res = await fetch(`${PYTHON_BACKEND_URL}/api/auto-blog/trigger`, {
      method: "POST",
      headers: { "x-internal-key": INTERNAL_API_KEY },
    })
    if (!res.ok) {
      console.error(`Failed: ${res.status} ${await res.text()}`)
      process.exit(1)
    }
    const data = await res.json()
    console.log("Triggered successfully!")
    console.log(`  Status: ${data.status}`)
    console.log(`  ${data.message}`)
    console.log(`\nThe engine will generate ~50 blog posts + SEO pages in the background.`)
    console.log(`Check progress: node scripts/generate-blog.mjs --status`)
    return
  }

  // --status: Check engine status
  if (args.includes("--status")) {
    if (!INTERNAL_API_KEY) {
      console.error("Error: INTERNAL_API_KEY required")
      process.exit(1)
    }
    const res = await fetch(`${PYTHON_BACKEND_URL}/api/auto-blog/status`, {
      headers: { "x-internal-key": INTERNAL_API_KEY },
    })
    if (!res.ok) {
      console.error(`Failed: ${res.status} ${await res.text()}`)
      process.exit(1)
    }
    const data = await res.json()
    console.log("\nAuto-Blog Engine Status:")
    console.log(`  Engine:    ${data.engine}`)
    console.log(`  Bedrock:   ${data.bedrock_configured ? "configured" : "NOT configured"}`)
    console.log(`  Supabase:  ${data.supabase_configured ? "configured" : "NOT configured"}`)
    console.log(`  Search:    ${data.search_configured ? "configured" : "NOT configured"}`)
    if (data.blog_posts_count !== undefined) {
      console.log(`  Blog posts: ${data.blog_posts_count}`)
      console.log(`  SEO pages:  ${data.seo_pages_count}`)
    }
    if (data.db_error) console.log(`  DB Error:  ${data.db_error}`)
    return
  }

  if (args.includes("--list-pending")) {
    const existingBlogs = await getExistingBlogIds()
    const existingSeo = await getExistingSeoSlugs()

    console.log("\n📝 Pending blog topics:")
    BLOG_TOPICS.forEach((topic, i) => {
      console.log(`  ${i + 1}. ${topic}`)
    })

    console.log(`\n📄 Pending SEO pages (${SEO_PAGE_TOPICS.length - existingSeo.length} remaining):`)
    SEO_PAGE_TOPICS.filter((t) => !existingSeo.includes(t.slug)).forEach((t) => {
      console.log(`  - ${t.slug}: ${t.title} (${t.stat} ${t.statLabel})`)
    })

    console.log(`\nExisting: ${existingBlogs.length} blog posts, ${existingSeo.length} SEO pages`)
    return
  }

  const blogIdx = args.indexOf("--blog")
  if (blogIdx !== -1) {
    const topic = args[blogIdx + 1]
    if (!topic) {
      console.error("Error: --blog requires a topic string")
      process.exit(1)
    }

    console.log(`Generating blog post: "${topic}"...`)
    const post = await generateBlogPost(topic)
    console.log(`Generated: "${post.title}" (${post.id})`)

    console.log("Publishing...")
    await publishBlogPost(post)
    await triggerRevalidation([`/blog/${post.id}`])
    console.log(`Published! View at: ${BACKEND_URL}/blog/${post.id}`)
    return
  }

  const seoIdx = args.indexOf("--seo-page")
  if (seoIdx !== -1) {
    const slug = args[seoIdx + 1]
    if (!slug) {
      console.error("Error: --seo-page requires a slug")
      process.exit(1)
    }

    const topic = SEO_PAGE_TOPICS.find((t) => t.slug === slug)
    if (!topic) {
      console.error(`Error: Unknown slug "${slug}". Use --list-pending to see available slugs.`)
      process.exit(1)
    }

    console.log(`Generating SEO page: "${topic.title}"...`)
    const page = await generateSeoPage(topic)
    console.log(`Generated: "${page.title}"`)

    console.log("Publishing...")
    await publishSeoPage(page)
    await triggerRevalidation([`/computer-use/${slug}`])
    console.log(`Published! View at: ${BACKEND_URL}/computer-use/${slug}`)
    return
  }

  const batchIdx = args.indexOf("--batch")
  if (batchIdx !== -1) {
    const type = args[batchIdx + 1]
    const countIdx = args.indexOf("--count")
    const count = countIdx !== -1 ? parseInt(args[countIdx + 1]) || 5 : 5

    if (type === "blog") {
      const existing = await getExistingBlogIds()
      console.log(`Generating ${count} blog posts... (${existing.length} already exist)`)

      // Pick topics that don't seem to already exist
      const topics = BLOG_TOPICS.slice(0, count)

      for (let i = 0; i < topics.length; i++) {
        console.log(`\n[${i + 1}/${topics.length}] Generating: "${topics[i]}"...`)
        try {
          const post = await generateBlogPost(topics[i])
          console.log(`  Title: "${post.title}"`)
          await publishBlogPost(post)
          console.log(`  Published: /blog/${post.id}`)
        } catch (e) {
          console.error(`  Error: ${e.message}`)
        }

        // Small delay to avoid rate limits
        if (i < topics.length - 1) {
          await new Promise((r) => setTimeout(r, 2000))
        }
      }

      await triggerRevalidation()
      console.log(`\nDone! Generated ${topics.length} blog posts.`)
    } else if (type === "seo") {
      const existing = await getExistingSeoSlugs()
      const pending = SEO_PAGE_TOPICS.filter((t) => !existing.includes(t.slug)).slice(0, count)

      console.log(`Generating ${pending.length} SEO pages... (${existing.length} already exist)`)

      for (let i = 0; i < pending.length; i++) {
        console.log(`\n[${i + 1}/${pending.length}] Generating: "${pending[i].title}"...`)
        try {
          const page = await generateSeoPage(pending[i])
          console.log(`  Title: "${page.title}"`)
          await publishSeoPage(page)
          console.log(`  Published: /computer-use/${pending[i].slug}`)
        } catch (e) {
          console.error(`  Error: ${e.message}`)
        }

        if (i < pending.length - 1) {
          await new Promise((r) => setTimeout(r, 2000))
        }
      }

      await triggerRevalidation()
      console.log(`\nDone! Generated ${pending.length} SEO pages.`)
    } else {
      console.error("Error: --batch type must be 'blog' or 'seo'")
      process.exit(1)
    }
    return
  }

  console.error("Unknown command. Use --help for usage.")
  process.exit(1)
}

main().catch((e) => {
  console.error("Fatal error:", e)
  process.exit(1)
})
