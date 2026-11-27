SET LOCAL search_path = app, pg_catalog;

ALTER TABLE users ADD COLUMN first_own_look_s BIGINT;
UPDATE users SET first_own_look_s = (
  SELECT MIN(FLOOR(EXTRACT(EPOCH FROM CAST(l.saved_at AS timestamp))))::bigint
  FROM saved_looks l JOIN saved_look_items i ON i.saved_look_id = l.id
  JOIN wardrobe_items w ON w.user_id = l.user_id AND w.id = i.item_id
  WHERE l.user_id = users.id AND w.sample_slug IS NULL AND COALESCE(w.extraction_source, '') <> 'fixture'
);

CREATE FUNCTION capture_first_own_look() RETURNS trigger
LANGUAGE plpgsql SET search_path = app, pg_catalog AS $$
DECLARE
  saved_s bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM wardrobe_items
    WHERE user_id = NEW.user_id AND id = NEW.item_id AND sample_slug IS NULL AND COALESCE(extraction_source, '') <> 'fixture') THEN
    SELECT FLOOR(EXTRACT(EPOCH FROM CAST(saved_at AS timestamp)))::bigint INTO saved_s
    FROM saved_looks WHERE id = NEW.saved_look_id;
    UPDATE users SET first_own_look_s = saved_s
    WHERE id = NEW.user_id AND (first_own_look_s IS NULL OR first_own_look_s > saved_s);
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION capture_first_own_look() FROM PUBLIC;
CREATE TRIGGER capture_first_own_look AFTER INSERT ON saved_look_items
  FOR EACH ROW EXECUTE FUNCTION capture_first_own_look();

CREATE TABLE journey_activity (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  observed_s BIGINT NOT NULL,
  activity TEXT NOT NULL CHECK (activity IN ('open', 'setup', 'planner', 'reopen', 'wear')),
  PRIMARY KEY (user_id, observed_s, activity)
);
CREATE INDEX journey_activity_by_time ON journey_activity(observed_s);
GRANT INSERT ON journey_activity TO mbti_closet_runtime;
