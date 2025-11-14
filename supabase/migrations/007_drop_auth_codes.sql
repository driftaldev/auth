-- Drop auth_codes table
-- Auth codes will now be stored locally in CLI ~/.driftal directory instead of database

-- Step 1: Drop the cleanup function first (depends on table)
DROP FUNCTION IF EXISTS public.cleanup_expired_auth_codes();

-- Step 2: Drop all indexes
DROP INDEX IF EXISTS public.idx_auth_codes_user_id;
DROP INDEX IF EXISTS public.idx_auth_codes_expires_at;
DROP INDEX IF EXISTS public.idx_auth_codes_used;
DROP INDEX IF EXISTS public.idx_auth_codes_state;

-- Step 3: Drop all RLS policies (required before dropping table)
DROP POLICY IF EXISTS "Service role can manage auth codes" ON public.auth_codes;
DROP POLICY IF EXISTS "Users can view own auth codes" ON public.auth_codes;

-- Step 4: Drop the table
DROP TABLE IF EXISTS public.auth_codes CASCADE;

-- Note: Auth codes will now be managed client-side in ~/.driftal/auth_codes.json
-- This change reduces database load and simplifies the architecture
-- The CLI will handle code generation, expiration, and validation locally
