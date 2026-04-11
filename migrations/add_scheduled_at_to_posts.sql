ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ NULL;

-- Index so the cron query (WHERE status = 'scheduled' AND scheduled_at <= NOW()) is fast
CREATE INDEX IF NOT EXISTS idx_posts_scheduled
  ON public.posts (status, scheduled_at)
  WHERE status = 'scheduled';
