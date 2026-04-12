-- Auto-refill settings for credit top-ups
CREATE TABLE IF NOT EXISTS auto_refill_settings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    enabled boolean NOT NULL DEFAULT false,
    package_id text NOT NULL DEFAULT 'boost-small',
    threshold integer NOT NULL DEFAULT 50,
    max_refills_per_day integer NOT NULL DEFAULT 5,
    refills_today integer NOT NULL DEFAULT 0,
    refills_today_reset_at timestamptz NOT NULL DEFAULT now(),
    last_refill_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE auto_refill_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own auto-refill settings"
    ON auto_refill_settings FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own auto-refill settings"
    ON auto_refill_settings FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own auto-refill settings"
    ON auto_refill_settings FOR UPDATE
    USING (auth.uid() = user_id);

-- Service role bypass for webhook/server-side operations
CREATE POLICY "Service role full access to auto_refill_settings"
    ON auto_refill_settings FOR ALL
    USING (auth.role() = 'service_role');

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS idx_auto_refill_settings_user_id ON auto_refill_settings(user_id);
