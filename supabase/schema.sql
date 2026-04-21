-- If you already use snake_case tables (firebase_uid, teacher_id, …), run
-- align_snake_case_schema.sql instead; the backend maps to camelCase in JSON via mappers.js.
--
-- Attendance System — Supabase schema aligned with Backend/routes/*.js
-- Run this in Supabase → SQL Editor (adjust if you already have data / conflicting names).
--
-- Why quoted names like "firebaseUid"?
-- PostgreSQL folds unquoted identifiers to lowercase. PostgREST (Supabase API) then
-- expects the exact camelCase names used in the JS client — e.g. firebaseUid, not firebaseuid.
--
-- users.id should be uuid (matches this backend). If you used bigint/serial, migrate ids
-- before adding FKs, or keep tables without strict FKs.

-- ---------------------------------------------------------------------------
-- 0) users base table (no-op if you already created it)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "firebaseUid" text,
  name text,
  email text,
  "profilePicture" text,
  role text,
  "regNo" text,
  branch text,
  semester text,
  "mobileNo" text,
  date text,
  dept text,
  subject text,
  "deviceIds" jsonb NOT NULL DEFAULT '[]'::jsonb
);

-- ---------------------------------------------------------------------------
-- 1) Optional: rename snake_case / lowercase columns if you created them first
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'firebase_uid'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'firebaseUid'
  ) THEN
    ALTER TABLE public.users RENAME COLUMN firebase_uid TO "firebaseUid";
  END IF;

  -- Unquoted CREATE (firebaseUid text) becomes column firebaseuid — PostgREST still needs "firebaseUid"
  IF EXISTS (
    SELECT 1 FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'users' AND a.attname = 'firebaseuid' AND a.attnum > 0 AND NOT a.attisdropped
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'users' AND a.attname = 'firebaseUid' AND a.attnum > 0 AND NOT a.attisdropped
  ) THEN
    ALTER TABLE public.users RENAME COLUMN firebaseuid TO "firebaseUid";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'profile_picture'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'profilePicture'
  ) THEN
    ALTER TABLE public.users RENAME COLUMN profile_picture TO "profilePicture";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'regno'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'regNo'
  ) THEN
    ALTER TABLE public.users RENAME COLUMN regno TO "regNo";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'mobileno'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'mobileNo'
  ) THEN
    ALTER TABLE public.users RENAME COLUMN mobileno TO "mobileNo";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'deviceids'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'deviceIds'
  ) THEN
    ALTER TABLE public.users RENAME COLUMN deviceids TO "deviceIds";
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) users — add any missing columns (safe if column already exists)
-- ---------------------------------------------------------------------------
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "firebaseUid" text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "profilePicture" text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS role text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "regNo" text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS branch text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS semester text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "mobileNo" text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS date text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS dept text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS subject text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "deviceIds" jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS users_firebase_uid_unique ON public.users ("firebaseUid")
  WHERE "firebaseUid" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3) sessions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "teacherId" uuid NOT NULL,
  subject text NOT NULL DEFAULT '',
  "sessionCode" text NOT NULL,
  "startTime" timestamptz NOT NULL DEFAULT now(),
  "endTime" timestamptz,
  "timeLimit" integer NOT NULL DEFAULT 60,
  location jsonb NOT NULL DEFAULT '{}'::jsonb,
  radius numeric NOT NULL DEFAULT 100,
  "isActive" boolean NOT NULL DEFAULT false,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS "teacherId" uuid;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS subject text;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS "sessionCode" text;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS "startTime" timestamptz;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS "endTime" timestamptz;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS "timeLimit" integer;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS location jsonb;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS radius numeric;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS "isActive" boolean;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS "createdAt" timestamptz;

CREATE INDEX IF NOT EXISTS sessions_teacher_id_idx ON public.sessions ("teacherId");
CREATE INDEX IF NOT EXISTS sessions_session_code_idx ON public.sessions ("sessionCode");
CREATE INDEX IF NOT EXISTS sessions_is_active_idx ON public.sessions ("isActive");

-- ---------------------------------------------------------------------------
-- 4) attendance
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "studentId" uuid NOT NULL,
  "sessionId" uuid NOT NULL,
  "studentName" text,
  "studentEmail" text,
  "timestamp" timestamptz NOT NULL DEFAULT now(),
  location jsonb NOT NULL DEFAULT '{}'::jsonb,
  "deviceId" text NOT NULL DEFAULT '',
  score integer NOT NULL DEFAULT 100,
  status text NOT NULL DEFAULT 'present',
  flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS "studentId" uuid;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS "sessionId" uuid;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS "studentName" text;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS "studentEmail" text;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS "timestamp" timestamptz;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS location jsonb;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS "deviceId" text;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS score integer;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS flags jsonb;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS "createdAt" timestamptz;

CREATE INDEX IF NOT EXISTS attendance_session_id_idx ON public.attendance ("sessionId");
CREATE INDEX IF NOT EXISTS attendance_student_id_idx ON public.attendance ("studentId");
