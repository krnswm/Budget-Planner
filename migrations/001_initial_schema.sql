-- Initial Postgres schema, translated from the SQLite original.
--
-- Deliberate differences from what SQLite held:
--
--   * Money is NUMERIC(12,2), not REAL. Binary floating point is the wrong
--     type for currency; sums accumulate error. This is a finance app.
--   * Foreign keys are real and enforced, with ON DELETE CASCADE. SQLite had
--     the declarations but ran with foreign_keys = OFF, so they did nothing
--     and account deletion had to delete child rows by hand.
--   * expenses carries indexes. It previously had none at all, so every
--     dashboard, insights and report query was a full table scan.
--   * day_of_month allows 1-31. The old CHECK capped it at 28 while the API
--     accepted 31, so days 29-31 failed as an opaque 500.
--   * spent_on is a real DATE. lib/db.js maps DATE to a 'YYYY-MM-DD' string
--     on read so the JSON contract the client sees is unchanged.
--   * is_active is BOOLEAN rather than INTEGER 0/1.
--
-- month_key stays TEXT: it is a 'YYYY-MM' bucket label, not a date, and it
-- is compared as a string throughout the application.

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  google_id     TEXT,
  full_name     TEXT,
  avatar_url    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partial unique index: many users may have no google_id, but a given
-- Google account must map to exactly one row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id
  ON users (google_id) WHERE google_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS monthly_budgets (
  id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  month_key    TEXT NOT NULL CHECK (month_key ~ '^\d{4}-\d{2}$'),
  total_budget NUMERIC(12, 2) NOT NULL CHECK (total_budget > 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, month_key)
);

CREATE TABLE IF NOT EXISTS expenses (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  month_key  TEXT NOT NULL CHECK (month_key ~ '^\d{4}-\d{2}$'),
  amount     NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  label      TEXT NOT NULL,
  category   TEXT NOT NULL DEFAULT 'Other',
  note       TEXT,
  spent_on   DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Every read path filters by user_id plus either month_key or spent_on.
CREATE INDEX IF NOT EXISTS idx_expenses_user_month ON expenses (user_id, month_key);
CREATE INDEX IF NOT EXISTS idx_expenses_user_spent_on ON expenses (user_id, spent_on);

CREATE TABLE IF NOT EXISTS category_limits (
  id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  month_key    TEXT NOT NULL CHECK (month_key ~ '^\d{4}-\d{2}$'),
  category     TEXT NOT NULL,
  limit_amount NUMERIC(12, 2) NOT NULL CHECK (limit_amount > 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, month_key, category)
);

CREATE INDEX IF NOT EXISTS idx_category_limits_user_month
  ON category_limits (user_id, month_key);

CREATE TABLE IF NOT EXISTS recurring_expenses (
  id                 INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id            INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  label              TEXT NOT NULL,
  amount             NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  category           TEXT NOT NULL DEFAULT 'Other',
  note               TEXT,
  day_of_month       INTEGER NOT NULL CHECK (day_of_month BETWEEN 1 AND 31),
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  last_applied_month TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recurring_user_active
  ON recurring_expenses (user_id, is_active);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reset_tokens_user_id ON password_reset_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_reset_tokens_expires_at ON password_reset_tokens (expires_at);

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  new_email   TEXT NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_verification_user_id
  ON email_verification_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_email_verification_expires_at
  ON email_verification_tokens (expires_at);
