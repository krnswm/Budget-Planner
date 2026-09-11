-- Session storage, moved off the filesystem.
--
-- Sessions previously lived in db/sessions.db via connect-sqlite3. Vercel's
-- filesystem is read-only and each invocation is isolated, so a file-backed
-- store cannot work there: logins would appear to succeed and then vanish.
--
-- This is the table layout connect-pg-simple expects. Column names and types
-- are fixed by that library, which is why they do not follow the naming used
-- elsewhere in this schema.

CREATE TABLE IF NOT EXISTS session (
  sid    VARCHAR NOT NULL COLLATE "default",
  sess   JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'session_pkey'
  ) THEN
    ALTER TABLE session
      ADD CONSTRAINT session_pkey PRIMARY KEY (sid) NOT DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END
$$;

-- Expired-session sweeps filter on this column.
CREATE INDEX IF NOT EXISTS idx_session_expire ON session (expire);
