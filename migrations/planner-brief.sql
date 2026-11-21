CREATE TABLE IF NOT EXISTS planner_briefs (
  account_id TEXT NOT NULL,
  id TEXT NOT NULL,
  occasion TEXT NOT NULL,
  timing TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  formality TEXT NOT NULL DEFAULT '',
  comfort TEXT NOT NULL DEFAULT '',
  preferences TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (account_id, id)
);
