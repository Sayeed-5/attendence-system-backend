-- Run in Supabase SQL Editor after your original CREATE TABLE statements.
-- Adds columns the Node backend expects (your tables use snake_case).
--
-- Optional (cleaner long-term): convert `timestamp` columns to `timestamptz` so Postgres
-- stores instants explicitly, e.g.:
--   ALTER TABLE sessions ALTER COLUMN start_time TYPE timestamptz USING start_time AT TIME ZONE 'UTC';

-- uuid_generate_v4 requires:
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------- users ----------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'firebase_uid'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'auth_user_id'
  ) THEN
    ALTER TABLE public.users RENAME COLUMN firebase_uid TO auth_user_id;
  END IF;
END $$;

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS auth_user_id text;

CREATE UNIQUE INDEX IF NOT EXISTS users_auth_user_id_uidx ON public.users (auth_user_id)
  WHERE auth_user_id IS NOT NULL;

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS profile_picture text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS semester text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS mobile_no text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS date text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS dept text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS subject text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS device_ids jsonb NOT NULL DEFAULT '[]'::jsonb;

-- ---------- sessions ----------
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS session_code text;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS time_limit integer NOT NULL DEFAULT 60;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS location jsonb;

-- ---------- attendance ----------
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS student_name text;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS student_email text;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS location jsonb;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS flags jsonb NOT NULL DEFAULT '[]'::jsonb;
