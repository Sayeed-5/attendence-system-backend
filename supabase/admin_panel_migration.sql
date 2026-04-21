-- Admin panel + soft delete migration
-- Run in Supabase SQL editor.

-- Roles safety: keep role values controlled.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_role_allowed_chk'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_role_allowed_chk
      CHECK (role IN ('student', 'teacher', 'admin'));
  END IF;
END $$;

-- ---------- users ----------
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS deleted_by uuid NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_active_idx
  ON public.users (lower(email))
  WHERE email IS NOT NULL AND is_deleted = false;

CREATE INDEX IF NOT EXISTS users_role_active_idx
  ON public.users (role, is_deleted);

-- ---------- sessions ----------
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS deleted_by uuid NULL;

CREATE INDEX IF NOT EXISTS sessions_active_not_deleted_idx
  ON public.sessions (is_active, is_deleted);

-- ---------- attendance ----------
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS deleted_by uuid NULL;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS admin_note text NULL;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS created_by_admin boolean NOT NULL DEFAULT false;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS updated_by_admin boolean NOT NULL DEFAULT false;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS updated_at timestamptz NULL;

CREATE UNIQUE INDEX IF NOT EXISTS attendance_unique_student_session_active_idx
  ON public.attendance (student_id, session_id)
  WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS attendance_session_active_idx
  ON public.attendance (session_id, is_deleted);
