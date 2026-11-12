-- Melli Architect bot (Cloudflare D1). The site's server pushes the profile
-- list here; the bot stores Telegram links, pending self-edits, anonymous
-- conversations and join requests.

-- Profiles as pushed by the site server. Replaced on every sync.
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_en TEXT,
  year INTEGER,
  student_number TEXT,
  telegram_username TEXT,      -- lower case, without @; never shown publicly
  invite_hash TEXT,            -- SHA-256 of the one-time invite token
  published INTEGER NOT NULL DEFAULT 0,
  card TEXT NOT NULL DEFAULT '{}' -- current editable values, as JSON
);
CREATE INDEX IF NOT EXISTS profiles_username ON profiles (telegram_username);
CREATE INDEX IF NOT EXISTS profiles_invite ON profiles (invite_hash);

-- One Telegram account per profile.
CREATE TABLE IF NOT EXISTS links (
  profile_id TEXT PRIMARY KEY,
  telegram_id TEXT NOT NULL UNIQUE,
  telegram_username TEXT,
  first_name TEXT,
  accepts_messages INTEGER NOT NULL DEFAULT 0,
  linked_at INTEGER NOT NULL
);

-- Per-user bot state for multi-step input, and language.
CREATE TABLE IF NOT EXISTS sessions (
  telegram_id TEXT PRIMARY KEY,
  lang TEXT NOT NULL DEFAULT 'fa',
  state TEXT,
  data TEXT,
  updated_at INTEGER NOT NULL
);

-- Self-edits waiting for an admin.
CREATE TABLE IF NOT EXISTS edits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id TEXT NOT NULL,
  telegram_id TEXT NOT NULL,
  field TEXT NOT NULL,
  value TEXT,                  -- JSON value for text and flag fields
  file_id TEXT,                -- Telegram file id for photo and résumé uploads
  file_name TEXT,
  mime TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  note TEXT,
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);
CREATE INDEX IF NOT EXISTS edits_status ON edits (status, created_at);

-- Anonymous conversations started from a profile's Contact button.
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,     -- the visitor who pressed Contact
  recipient_id TEXT NOT NULL,  -- the graduate's Telegram id
  sender_revealed INTEGER NOT NULL DEFAULT 0,
  recipient_revealed INTEGER NOT NULL DEFAULT 0,
  closed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS conversations_pair ON conversations (sender_id, recipient_id);

CREATE TABLE IF NOT EXISTS blocks (
  recipient_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (recipient_id, sender_id)
);

-- Graduates who are not in the archive yet can ask to be added.
CREATE TABLE IF NOT EXISTS join_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT NOT NULL,
  telegram_username TEXT,
  name TEXT NOT NULL,
  student_number TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | rejected
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);

-- Daily message counters for rate limiting.
CREATE TABLE IF NOT EXISTS usage (
  telegram_id TEXT NOT NULL,
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (telegram_id, day, kind)
);

-- Telegram may deliver an update twice; each is handled once.
CREATE TABLE IF NOT EXISTS seen_updates (
  update_id INTEGER PRIMARY KEY,
  seen_at INTEGER NOT NULL
);
