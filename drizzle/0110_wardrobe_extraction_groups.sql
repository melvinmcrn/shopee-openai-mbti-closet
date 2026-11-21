ALTER TABLE wardrobe_items ADD COLUMN extraction_group_id INTEGER REFERENCES wardrobe_items(id);
--> statement-breakpoint
CREATE INDEX wardrobe_extraction_group ON wardrobe_items(user_id, extraction_group_id, id)
    WHERE extraction_group_id IS NOT NULL AND archived_at IS NULL;
