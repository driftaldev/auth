-- Update user_profiles table
-- Remove model preference columns (now stored in CLI config)
-- Add email column for easier querying

-- Step 1: Add email column
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS email VARCHAR(255);

-- Step 2: Populate email from auth.users for existing records
UPDATE public.user_profiles
SET email = auth.users.email
FROM auth.users
WHERE user_profiles.id = auth.users.id
  AND user_profiles.email IS NULL;

-- Step 3: Make email NOT NULL after populating
ALTER TABLE public.user_profiles
  ALTER COLUMN email SET NOT NULL;

-- Step 4: Drop model preference columns
ALTER TABLE public.user_profiles
  DROP COLUMN IF EXISTS primary_model,
  DROP COLUMN IF EXISTS fallback_model;

-- Step 5: Create index on email for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON public.user_profiles(email);

-- Step 6: Update the handle_new_user() trigger to populate email
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email)
  VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger already exists (on_auth_user_created), no need to recreate

-- Step 7: Update table comment
COMMENT ON TABLE public.user_profiles IS 'User profiles for driftal with cached email for easier querying';
COMMENT ON COLUMN public.user_profiles.email IS 'User email (denormalized from auth.users for query performance)';
