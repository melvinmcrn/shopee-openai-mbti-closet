ALTER TABLE users ADD COLUMN first_own_look_s INTEGER;
--> statement-breakpoint
UPDATE users SET first_own_look_s = (
  SELECT MIN(unixepoch(l.saved_at))
  FROM saved_looks l JOIN saved_look_items i ON i.saved_look_id = l.id
  JOIN wardrobe_items w ON w.user_id = l.user_id AND w.id = i.item_id
  WHERE l.user_id = users.id AND w.sample_slug IS NULL AND COALESCE(w.extraction_source, '') <> 'fixture'
);
--> statement-breakpoint
-- Capture the achievement in the save transaction so deleting a look cannot undo it.
CREATE TRIGGER capture_first_own_look AFTER INSERT ON saved_look_items
WHEN EXISTS (SELECT 1 FROM wardrobe_items
  WHERE user_id = NEW.user_id AND id = NEW.item_id AND sample_slug IS NULL AND COALESCE(extraction_source, '') <> 'fixture')
BEGIN
  UPDATE users SET first_own_look_s = (SELECT unixepoch(saved_at) FROM saved_looks WHERE id = NEW.saved_look_id)
  WHERE id = NEW.user_id AND (first_own_look_s IS NULL OR
    first_own_look_s > (SELECT unixepoch(saved_at) FROM saved_looks WHERE id = NEW.saved_look_id));
END;
--> statement-breakpoint
CREATE TABLE journey_activity (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  observed_s INTEGER NOT NULL,
  activity TEXT NOT NULL CHECK (activity IN ('open', 'setup', 'planner', 'reopen', 'wear')),
  PRIMARY KEY (user_id, observed_s, activity)
) WITHOUT ROWID;
--> statement-breakpoint
CREATE INDEX journey_activity_by_time ON journey_activity(observed_s);
