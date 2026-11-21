CREATE TABLE IF NOT EXISTS planner_saved_looks (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL,
  option_id TEXT NOT NULL,
  occasion TEXT NOT NULL,
  slots TEXT NOT NULL,
  original_slots TEXT NOT NULL,
  explanation TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS planner_saved_looks_account_created_idx
  ON planner_saved_looks (account_id, created_at DESC, id DESC);
