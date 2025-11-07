-- Create auth_codes table
-- Stores OAuth authorization codes for CLI authentication flow

CREATE TABLE IF NOT EXISTS public.auth_codes (
  code VARCHAR(255) PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  state VARCHAR(255) NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  used_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE public.auth_codes ENABLE ROW LEVEL SECURITY;

-- Policy: Service role can manage all auth codes (backend only)
CREATE POLICY "Service role can manage auth codes"
  ON public.auth_codes
  FOR ALL
  USING (auth.role() = 'service_role');

-- Policy: Authenticated users can view their own auth codes
CREATE POLICY "Users can view own auth codes"
  ON public.auth_codes
  FOR SELECT
  USING (auth.uid() = user_id);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_auth_codes_user_id ON public.auth_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_codes_expires_at ON public.auth_codes(expires_at);
CREATE INDEX IF NOT EXISTS idx_auth_codes_used ON public.auth_codes(used);
CREATE INDEX IF NOT EXISTS idx_auth_codes_state ON public.auth_codes(state);

-- Function to clean up expired auth codes
CREATE OR REPLACE FUNCTION public.cleanup_expired_auth_codes()
RETURNS void AS $$
BEGIN
  DELETE FROM public.auth_codes
  WHERE expires_at < NOW() - INTERVAL '1 hour';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add comment
COMMENT ON TABLE public.auth_codes IS 'OAuth authorization codes for CLI authentication flow';
COMMENT ON COLUMN public.auth_codes.code IS 'Short-lived authorization code (10 minutes)';
COMMENT ON COLUMN public.auth_codes.state IS 'CSRF protection token from CLI';
COMMENT ON COLUMN public.auth_codes.used IS 'Whether code has been exchanged for tokens';
