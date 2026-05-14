-- Add publishing status tracking and idempotency columns to posts table
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS publishing_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failure_reason TEXT;

-- Partial unique index prevents two workers from picking up the same post
CREATE UNIQUE INDEX IF NOT EXISTS posts_idempotency_key_unique
  ON public.posts (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Expand status check constraint to include 'publishing' and 'cancelled'
DO $$ BEGIN
  ALTER TABLE public.posts DROP CONSTRAINT IF EXISTS posts_status_check;
  ALTER TABLE public.posts ADD CONSTRAINT posts_status_check
    CHECK (status IN ('draft', 'scheduled', 'publishing', 'published', 'failed', 'cancelled'));
EXCEPTION WHEN others THEN NULL;
END $$;
