-- Add analysis columns to posts table
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS published_hour INT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS published_day_of_week INT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS final_like_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS final_comment_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS final_share_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS engagement_rate DECIMAL(5, 2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS content_length INT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS hashtag_count INT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS mention_count INT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS tone_score DECIMAL(3, 2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS predicted_engagement INT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS performance_score DECIMAL(3, 2) DEFAULT NULL;

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_posts_published_hour ON public.posts(user_id, published_hour, status);
CREATE INDEX IF NOT EXISTS idx_posts_published_day ON public.posts(user_id, published_day_of_week, status);
