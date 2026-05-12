-- Create performance_cache table
CREATE TABLE IF NOT EXISTS public.performance_cache (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,

  -- Content hash for deduplication
  content_hash VARCHAR(64) NOT NULL,            -- SHA256(content)

  -- Cached predictions
  performance_score DECIMAL(3, 2),
  predicted_likes INT,
  predicted_comments INT,
  optimal_posting_hour INT,
  engagement_lift_percent DECIMAL(5, 2),

  -- Cache control
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP,                         -- 7 days from creation

  CONSTRAINT fk_performance_cache_user_id FOREIGN KEY (user_id) REFERENCES public."user"(id)
);

CREATE INDEX IF NOT EXISTS idx_performance_cache_user_content ON public.performance_cache(user_id, content_hash);
CREATE INDEX IF NOT EXISTS idx_performance_cache_expires ON public.performance_cache(expires_at);
