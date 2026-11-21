ALTER TABLE wardrobe_items ADD COLUMN sample_slug TEXT;

CREATE UNIQUE INDEX wardrobe_sample_slug ON wardrobe_items(user_id, sample_slug);
