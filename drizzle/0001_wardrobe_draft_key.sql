ALTER TABLE wardrobe_items ADD COLUMN draft_key TEXT;

CREATE UNIQUE INDEX wardrobe_draft_key_by_user ON wardrobe_items(user_id, draft_key);
