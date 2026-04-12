-- Email Campaign Management Tables
-- Supports campaigns, per-recipient tracking, event logging, and unsubscribe management.

-- ── Campaigns ──
CREATE TABLE IF NOT EXISTS public.email_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    subject TEXT NOT NULL,
    subject_b TEXT,  -- A/B test variant
    from_address TEXT NOT NULL DEFAULT 'hello@coasty.ai',
    from_name TEXT NOT NULL DEFAULT 'Coasty',
    html_template TEXT NOT NULL,
    text_template TEXT,
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'sending', 'paused', 'completed', 'scheduled', 'cancelled')),
    segment TEXT NOT NULL DEFAULT 'all',
    segment_filter JSONB DEFAULT '{}',
    ab_split_pct INTEGER DEFAULT 50,
    scheduled_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_by TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.email_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on email_campaigns"
    ON public.email_campaigns FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- ── Recipients ──
CREATE TABLE IF NOT EXISTS public.email_recipients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES public.email_campaigns(id) ON DELETE CASCADE,
    user_id UUID,
    email TEXT NOT NULL,
    variables JSONB DEFAULT '{}',
    ab_variant TEXT DEFAULT 'A' CHECK (ab_variant IN ('A', 'B')),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'queued', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'failed', 'unsubscribed')),
    sent_at TIMESTAMPTZ,
    opened_at TIMESTAMPTZ,
    clicked_at TIMESTAMPTZ,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (campaign_id, email)
);

CREATE INDEX IF NOT EXISTS idx_email_recipients_campaign_status
    ON public.email_recipients (campaign_id, status);

CREATE INDEX IF NOT EXISTS idx_email_recipients_email
    ON public.email_recipients (email);

ALTER TABLE public.email_recipients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on email_recipients"
    ON public.email_recipients FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- ── Events (open, click, bounce, unsubscribe) ──
CREATE TABLE IF NOT EXISTS public.email_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES public.email_campaigns(id) ON DELETE CASCADE,
    recipient_id UUID NOT NULL REFERENCES public.email_recipients(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL
        CHECK (event_type IN ('sent', 'delivered', 'opened', 'clicked', 'bounced', 'unsubscribed', 'failed')),
    link_url TEXT,
    user_agent TEXT,
    ip_address TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_events_campaign_type
    ON public.email_events (campaign_id, event_type, created_at);

CREATE INDEX IF NOT EXISTS idx_email_events_recipient
    ON public.email_events (recipient_id, created_at);

ALTER TABLE public.email_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on email_events"
    ON public.email_events FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- ── Unsubscribes (global) ──
CREATE TABLE IF NOT EXISTS public.email_unsubscribes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    campaign_id UUID,
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_unsubscribes_email
    ON public.email_unsubscribes (email);

ALTER TABLE public.email_unsubscribes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on email_unsubscribes"
    ON public.email_unsubscribes FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- Auto-cleanup old events (90 days)
CREATE OR REPLACE FUNCTION public.cleanup_old_email_events()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    DELETE FROM public.email_events WHERE created_at < now() - INTERVAL '90 days';
END;
$$;
