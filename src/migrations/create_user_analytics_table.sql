-- Create user_analytics table
CREATE TABLE IF NOT EXISTS public.user_analytics (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) UNIQUE NOT NULL,

  -- Best posting times
  best_posting_hour INT DEFAULT 9,              -- 0-23
  best_posting_day INT DEFAULT 2,               -- 0-6 (Tuesday)

  -- JSON columns for hour/day breakdowns
  engagement_by_hour JSONB DEFAULT '{}',        -- {0: 2.1, 1: 1.8, ...}
  engagement_by_day JSONB DEFAULT '{}',         -- {0: 1.5, 1: 3.2, ...}

  -- Aggregated metrics
  avg_engagement_rate DECIMAL(5, 2) DEFAULT 0.03,
  avg_post_length INT DEFAULT 140,
  avg_hashtag_count INT DEFAULT 3,
  avg_tone_score DECIMAL(3, 2) DEFAULT 0.2,

  -- Growth tracking
  follower_growth_rate DECIMAL(5, 2) DEFAULT 0.05,
  engagement_growth_rate DECIMAL(5, 2) DEFAULT 0.08,

  -- Timestamps
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_user_analytics_user_id FOREIGN KEY (user_id) REFERENCES public."user"(id),
  UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_analytics_user_id ON public.user_analytics(user_id);
