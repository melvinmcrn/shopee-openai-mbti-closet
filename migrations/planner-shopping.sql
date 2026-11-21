CREATE TABLE IF NOT EXISTS planner_shopping_catalog (
  id TEXT PRIMARY KEY NOT NULL,
  occasion_group TEXT NOT NULL CHECK (occasion_group IN ('any', 'dressy', 'casual', 'active')),
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  sponsored INTEGER NOT NULL DEFAULT 0 CHECK (sponsored IN (0, 1))
);

INSERT INTO planner_shopping_catalog (id, occasion_group, title, url)
VALUES
  ('crossbody-bag', 'any', 'Compact crossbody bag', 'https://shopee.sg/search?keyword=compact%20crossbody%20bag'),
  ('stud-earrings', 'dressy', 'Simple stud earrings', 'https://shopee.sg/search?keyword=simple%20stud%20earrings'),
  ('canvas-tote', 'casual', 'Canvas tote bag', 'https://shopee.sg/search?keyword=canvas%20tote%20bag'),
  ('sports-cap', 'active', 'Lightweight sports cap', 'https://shopee.sg/search?keyword=lightweight%20sports%20cap')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS planner_hidden_suggestions (
  look_id TEXT NOT NULL REFERENCES planner_saved_looks(id) ON DELETE CASCADE,
  suggestion_id TEXT NOT NULL REFERENCES planner_shopping_catalog(id) ON DELETE CASCADE,
  PRIMARY KEY (look_id, suggestion_id)
);
