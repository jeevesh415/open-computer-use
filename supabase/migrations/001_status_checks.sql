-- Status checks table for tracking service health over time
CREATE TABLE IF NOT EXISTS status_checks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  service_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('operational', 'degraded', 'outage')),
  latency INTEGER, -- response time in ms, null if outage
  message TEXT, -- error message if not operational
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for querying by service + time range (the main query pattern)
CREATE INDEX idx_status_checks_service_time ON status_checks (service_name, checked_at DESC);

-- Index for cleanup of old records
CREATE INDEX idx_status_checks_checked_at ON status_checks (checked_at);

-- Auto-delete records older than 7 days (run as a periodic cleanup)
-- This can be called via a Supabase pg_cron extension or manually
CREATE OR REPLACE FUNCTION cleanup_old_status_checks()
RETURNS void AS $$
BEGIN
  DELETE FROM status_checks WHERE checked_at < now() - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql;

-- Enable RLS
ALTER TABLE status_checks ENABLE ROW LEVEL SECURITY;

-- Service role has full CRUD access (requires auth.role() = 'service_role')
CREATE POLICY "Service role full access" ON status_checks
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Public/anonymous users can only read (status page is public)
CREATE POLICY "Public read access" ON status_checks
  FOR SELECT
  TO anon, authenticated
  USING (true);
