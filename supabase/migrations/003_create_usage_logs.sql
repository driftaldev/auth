-- Create usage_logs table
-- Tracks LLM API usage for analytics and monitoring

CREATE TABLE IF NOT EXISTS public.usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  model VARCHAR(100) NOT NULL,
  provider VARCHAR(50) NOT NULL,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  request_duration_ms INTEGER,
  status VARCHAR(20) DEFAULT 'success',
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE public.usage_logs ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own usage logs
CREATE POLICY "Users can view own usage"
  ON public.usage_logs
  FOR SELECT
  USING (auth.uid() = user_id);

-- Policy: Service role can insert usage logs (backend only)
CREATE POLICY "Service role can insert usage"
  ON public.usage_logs
  FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- Policy: Service role can view all usage logs (for admin)
CREATE POLICY "Service role can view all usage"
  ON public.usage_logs
  FOR SELECT
  USING (auth.role() = 'service_role');

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_usage_user_id ON public.usage_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_created_at ON public.usage_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_usage_model ON public.usage_logs(model);
CREATE INDEX IF NOT EXISTS idx_usage_provider ON public.usage_logs(provider);
CREATE INDEX IF NOT EXISTS idx_usage_status ON public.usage_logs(status);

-- Create composite index for common queries
CREATE INDEX IF NOT EXISTS idx_usage_user_created ON public.usage_logs(user_id, created_at DESC);

-- Function to get user usage statistics
CREATE OR REPLACE FUNCTION public.get_user_usage_stats(
  p_user_id UUID,
  p_days INTEGER DEFAULT 30
)
RETURNS TABLE (
  total_requests BIGINT,
  total_tokens BIGINT,
  total_prompt_tokens BIGINT,
  total_completion_tokens BIGINT,
  avg_tokens_per_request NUMERIC,
  models_used TEXT[]
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT as total_requests,
    COALESCE(SUM(total_tokens), 0)::BIGINT as total_tokens,
    COALESCE(SUM(prompt_tokens), 0)::BIGINT as total_prompt_tokens,
    COALESCE(SUM(completion_tokens), 0)::BIGINT as total_completion_tokens,
    COALESCE(AVG(total_tokens), 0)::NUMERIC as avg_tokens_per_request,
    ARRAY_AGG(DISTINCT model) as models_used
  FROM public.usage_logs
  WHERE user_id = p_user_id
    AND created_at > NOW() - (p_days || ' days')::INTERVAL
    AND status = 'success';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to clean up old usage logs (keep last 90 days)
CREATE OR REPLACE FUNCTION public.cleanup_old_usage_logs()
RETURNS void AS $$
BEGIN
  DELETE FROM public.usage_logs
  WHERE created_at < NOW() - INTERVAL '90 days';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add comments
COMMENT ON TABLE public.usage_logs IS 'LLM API usage logs for analytics and monitoring';
COMMENT ON COLUMN public.usage_logs.model IS 'LLM model used (e.g., claude-3-5-sonnet-20241022)';
COMMENT ON COLUMN public.usage_logs.provider IS 'LLM provider (anthropic or openai)';
COMMENT ON COLUMN public.usage_logs.status IS 'Request status (success, error, rate_limited)';
COMMENT ON FUNCTION public.get_user_usage_stats IS 'Get usage statistics for a user over a time period';
