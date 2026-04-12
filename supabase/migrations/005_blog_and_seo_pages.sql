-- Blog posts table (dynamic, no redeploy needed)
CREATE TABLE IF NOT EXISTS blog_posts (
  id TEXT PRIMARY KEY,                          -- slug, e.g. "agent-swarm-launch"
  title TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT 'Coasty Team',
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  read_time TEXT NOT NULL DEFAULT '5 min',
  category TEXT NOT NULL DEFAULT 'Product',
  featured BOOLEAN NOT NULL DEFAULT FALSE,
  content JSONB NOT NULL DEFAULT '[]'::jsonb,   -- array of ContentBlock
  keywords TEXT[] DEFAULT '{}',                 -- SEO keywords
  meta_description TEXT,                        -- custom meta description (falls back to excerpt)
  published BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Programmatic SEO pages for /computer-use/[task]
CREATE TABLE IF NOT EXISTS seo_pages (
  slug TEXT PRIMARY KEY,                        -- e.g. "data-entry", "invoice-processing"
  title TEXT NOT NULL,
  headline TEXT NOT NULL,
  meta_description TEXT NOT NULL,
  keywords TEXT[] DEFAULT '{}',
  hero_stat TEXT,                               -- e.g. "500+"
  hero_stat_label TEXT,                         -- e.g. "forms filled per hour"
  content JSONB NOT NULL DEFAULT '[]'::jsonb,   -- flexible content blocks
  related_blog_ids TEXT[] DEFAULT '{}',         -- internal linking to blog posts
  related_use_case_slugs TEXT[] DEFAULT '{}',   -- internal linking to /use-cases/
  related_comparison_slugs TEXT[] DEFAULT '{}', -- internal linking to /compare/
  published BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast filtering
CREATE INDEX IF NOT EXISTS idx_blog_posts_published ON blog_posts(published, date DESC);
CREATE INDEX IF NOT EXISTS idx_blog_posts_category ON blog_posts(category) WHERE published = TRUE;
CREATE INDEX IF NOT EXISTS idx_blog_posts_featured ON blog_posts(featured) WHERE published = TRUE AND featured = TRUE;
CREATE INDEX IF NOT EXISTS idx_seo_pages_published ON seo_pages(published);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER blog_posts_updated_at
  BEFORE UPDATE ON blog_posts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER seo_pages_updated_at
  BEFORE UPDATE ON seo_pages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS: Public read access, service role write
ALTER TABLE blog_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_pages ENABLE ROW LEVEL SECURITY;

-- Anyone can read published posts
CREATE POLICY "Public can read published blog posts"
  ON blog_posts FOR SELECT
  USING (published = TRUE);

CREATE POLICY "Public can read published seo pages"
  ON seo_pages FOR SELECT
  USING (published = TRUE);

-- Service role can do everything (used by generation script + API)
CREATE POLICY "Service role full access blog posts"
  ON blog_posts FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access seo pages"
  ON seo_pages FOR ALL
  USING (auth.role() = 'service_role');
