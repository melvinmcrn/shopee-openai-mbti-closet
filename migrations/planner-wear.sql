CREATE TABLE IF NOT EXISTS planner_wear_history (
  id TEXT PRIMARY KEY NOT NULL,
  look_id TEXT NOT NULL REFERENCES planner_saved_looks(id) ON DELETE CASCADE,
  date TEXT NOT NULL CHECK (
    date >= '0001-01-01'
    AND date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    AND date(date, '+0 days') IS date
  ),
  rating INTEGER CHECK (rating IS NULL OR (typeof(rating) = 'integer' AND rating BETWEEN 1 AND 5)),
  note TEXT CHECK (note IS NULL OR length(note) <= 1000),
  UNIQUE (look_id, date)
);
