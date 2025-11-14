-- Create review_issues table
-- Stores individual issues found during code reviews (normalized relationship with usage_logs)

CREATE TABLE IF NOT EXISTS public.review_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id UUID NOT NULL REFERENCES public.usage_logs(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  file_path TEXT NOT NULL,
  line_number INTEGER,
  description TEXT,
  suggestion TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE public.review_issues ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view issues from their own reviews
CREATE POLICY "Users can view own review issues"
  ON public.review_issues
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.usage_logs
      WHERE usage_logs.id = review_issues.review_id
      AND usage_logs.user_id = auth.uid()
    )
  );

-- Policy: Service role can insert review issues (backend only)
CREATE POLICY "Service role can insert review issues"
  ON public.review_issues
  FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- Policy: Service role can view all review issues (for admin)
CREATE POLICY "Service role can view all review issues"
  ON public.review_issues
  FOR SELECT
  USING (auth.role() = 'service_role');

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_review_issues_review_id ON public.review_issues(review_id);
CREATE INDEX IF NOT EXISTS idx_review_issues_severity ON public.review_issues(severity);
CREATE INDEX IF NOT EXISTS idx_review_issues_file_path ON public.review_issues(file_path);
CREATE INDEX IF NOT EXISTS idx_review_issues_created_at ON public.review_issues(created_at);

-- Composite index for common queries (review_id + severity)
CREATE INDEX IF NOT EXISTS idx_review_issues_review_severity ON public.review_issues(review_id, severity);

-- Function to get issue counts by severity for a review
CREATE OR REPLACE FUNCTION public.get_review_issue_summary(p_review_id UUID)
RETURNS TABLE (
  total_issues BIGINT,
  critical_count BIGINT,
  high_count BIGINT,
  medium_count BIGINT,
  low_count BIGINT,
  files_affected BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT as total_issues,
    COUNT(*) FILTER (WHERE severity = 'critical')::BIGINT as critical_count,
    COUNT(*) FILTER (WHERE severity = 'high')::BIGINT as high_count,
    COUNT(*) FILTER (WHERE severity = 'medium')::BIGINT as medium_count,
    COUNT(*) FILTER (WHERE severity = 'low')::BIGINT as low_count,
    COUNT(DISTINCT file_path)::BIGINT as files_affected
  FROM public.review_issues
  WHERE review_id = p_review_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get all issues for a specific review
CREATE OR REPLACE FUNCTION public.get_review_issues(
  p_review_id UUID,
  p_severity VARCHAR DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  severity VARCHAR,
  file_path TEXT,
  line_number INTEGER,
  description TEXT,
  suggestion TEXT,
  created_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
  IF p_severity IS NULL THEN
    RETURN QUERY
    SELECT
      review_issues.id,
      review_issues.title,
      review_issues.severity,
      review_issues.file_path,
      review_issues.line_number,
      review_issues.description,
      review_issues.suggestion,
      review_issues.created_at
    FROM public.review_issues
    WHERE review_issues.review_id = p_review_id
    ORDER BY
      CASE review_issues.severity
        WHEN 'critical' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        WHEN 'low' THEN 4
      END,
      review_issues.file_path,
      review_issues.line_number;
  ELSE
    RETURN QUERY
    SELECT
      review_issues.id,
      review_issues.title,
      review_issues.severity,
      review_issues.file_path,
      review_issues.line_number,
      review_issues.description,
      review_issues.suggestion,
      review_issues.created_at
    FROM public.review_issues
    WHERE review_issues.review_id = p_review_id
      AND review_issues.severity = p_severity
    ORDER BY review_issues.file_path, review_issues.line_number;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add comments
COMMENT ON TABLE public.review_issues IS 'Individual issues found during code reviews';
COMMENT ON COLUMN public.review_issues.review_id IS 'Foreign key to the review log (usage_logs table)';
COMMENT ON COLUMN public.review_issues.title IS 'Brief title/summary of the issue';
COMMENT ON COLUMN public.review_issues.severity IS 'Issue severity level (critical, high, medium, low)';
COMMENT ON COLUMN public.review_issues.file_path IS 'Path to the file where the issue was found';
COMMENT ON COLUMN public.review_issues.line_number IS 'Line number where the issue occurs (nullable for file-level issues)';
COMMENT ON COLUMN public.review_issues.description IS 'Detailed description of the issue';
COMMENT ON COLUMN public.review_issues.suggestion IS 'Suggested fix or improvement';
COMMENT ON FUNCTION public.get_review_issue_summary IS 'Get count of issues by severity for a specific review';
COMMENT ON FUNCTION public.get_review_issues IS 'Get all issues for a review, optionally filtered by severity';
