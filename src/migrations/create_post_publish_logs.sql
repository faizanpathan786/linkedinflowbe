CREATE TABLE IF NOT EXISTS public.post_publish_logs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id          UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  attempt_number   INTEGER NOT NULL DEFAULT 1,
  status           TEXT NOT NULL CHECK (status IN ('success', 'failed', 'timeout')),
  http_status      INTEGER,
  linkedin_urn     TEXT,
  error_code       TEXT,
  error_message    TEXT,
  request_payload  JSONB,
  response_body    JSONB,
  duration_ms      INTEGER,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS post_publish_logs_post_id_idx ON public.post_publish_logs (post_id);
CREATE INDEX IF NOT EXISTS post_publish_logs_created_at_idx ON public.post_publish_logs (post_id, created_at DESC);
