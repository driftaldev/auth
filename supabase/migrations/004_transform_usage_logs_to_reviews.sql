-- Transform usage_logs table to track complete reviews instead of individual LLM requests
-- This migration changes the purpose from tracking per-LLM-request to per-review

-- Step 1: Archive existing usage_logs data (optional - comment out if you want to keep old data)
-- CREATE TABLE IF NOT EXISTS public.usage_logs_archive AS SELECT * FROM public.usage_logs;

-- Step 2: Drop old indexes that won't be used anymore
DROP INDEX IF EXISTS public.idx_usage_provider;
DROP INDEX IF EXISTS public.idx_usage_status;

-- Step 3: Add new columns for review tracking
ALTER TABLE public.usage_logs
  ADD COLUMN IF NOT EXISTS email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS lines_of_code_reviewed INTEGER,
  ADD COLUMN IF NOT EXISTS review_duration_ms INTEGER,
  ADD COLUMN IF NOT EXISTS repository_name VARCHAR(255);

-- Step 4: Drop columns that are no longer needed for review tracking
ALTER TABLE public.usage_logs
  DROP COLUMN IF EXISTS prompt_tokens,
  DROP COLUMN IF EXISTS completion_tokens,
  DROP COLUMN IF EXISTS provider,
  DROP COLUMN IF EXISTS request_duration_ms,
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS error_message;

-- Step 5: Modify existing columns
ALTER TABLE public.usage_logs
  ALTER COLUMN model SET NOT NULL;

-- Step 6: Add constraints
ALTER TABLE public.usage_logs
  ADD CONSTRAINT check_lines_positive CHECK (lines_of_code_reviewed >= 0),
  ADD CONSTRAINT check_duration_positive CHECK (review_duration_ms >= 0);

-- Step 7: Create new indexes for review queries
CREATE INDEX IF NOT EXISTS idx_usage_email ON public.usage_logs(email);
CREATE INDEX IF NOT EXISTS idx_usage_repository ON public.usage_logs(repository_name);
CREATE INDEX IF NOT EXISTS idx_usage_email_created ON public.usage_logs(email, created_at DESC);

-- Step 8: Update RLS policies (they remain mostly the same)
-- Policies already exist and work with user_id, no changes needed

-- Step 9: Update the get_user_usage_stats function for new schema
CREATE OR REPLACE FUNCTION public.get_user_usage_stats(
  p_user_id UUID,
  p_days INTEGER DEFAULT 30
)
RETURNS TABLE (
  total_reviews BIGINT,
  total_tokens BIGINT,
  total_lines_reviewed BIGINT,
  avg_tokens_per_review NUMERIC,
  avg_lines_per_review NUMERIC,
  avg_duration_ms NUMERIC,
  models_used TEXT[],
  repositories TEXT[]
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT as total_reviews,
    COALESCE(SUM(total_tokens), 0)::BIGINT as total_tokens,
    COALESCE(SUM(lines_of_code_reviewed), 0)::BIGINT as total_lines_reviewed,
    COALESCE(AVG(total_tokens), 0)::NUMERIC as avg_tokens_per_review,
    COALESCE(AVG(lines_of_code_reviewed), 0)::NUMERIC as avg_lines_per_review,
    COALESCE(AVG(review_duration_ms), 0)::NUMERIC as avg_duration_ms,
    ARRAY_AGG(DISTINCT model) as models_used,
    ARRAY_AGG(DISTINCT repository_name) FILTER (WHERE repository_name IS NOT NULL) as repositories
  FROM public.usage_logs
  WHERE user_id = p_user_id
    AND created_at > NOW() - (p_days || ' days')::INTERVAL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 10: Update cleanup function
CREATE OR REPLACE FUNCTION public.cleanup_old_usage_logs()
RETURNS void AS $$
BEGIN
  DELETE FROM public.usage_logs
  WHERE created_at < NOW() - INTERVAL '90 days';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 11: Update table and column comments
COMMENT ON TABLE public.usage_logs IS 'Code review logs tracking complete review sessions with metadata';
COMMENT ON COLUMN public.usage_logs.email IS 'Email of the user who performed the review';
COMMENT ON COLUMN public.usage_logs.model IS 'LLM model used for the review (e.g., claude-3-5-sonnet-20241022)';
COMMENT ON COLUMN public.usage_logs.total_tokens IS 'Total tokens used across all LLM calls in this review';
COMMENT ON COLUMN public.usage_logs.lines_of_code_reviewed IS 'Number of lines of code reviewed (uncommitted changes or selected files)';
COMMENT ON COLUMN public.usage_logs.review_duration_ms IS 'Total time taken to complete the review in milliseconds';
COMMENT ON COLUMN public.usage_logs.repository_name IS 'Name of the repository being reviewed';
COMMENT ON FUNCTION public.get_user_usage_stats IS 'Get review statistics for a user over a time period';
