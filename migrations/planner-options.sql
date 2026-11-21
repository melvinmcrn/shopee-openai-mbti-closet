CREATE TABLE IF NOT EXISTS planner_options (
  account_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  brief_id TEXT NOT NULL,
  option_json TEXT NOT NULL,
  PRIMARY KEY (account_id, id)
);
