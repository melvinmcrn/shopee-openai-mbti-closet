ALTER TABLE app.wardrobe_items ADD COLUMN extraction_group_id BIGINT REFERENCES app.wardrobe_items(id);

CREATE INDEX wardrobe_extraction_group ON app.wardrobe_items(user_id, extraction_group_id, id)
    WHERE extraction_group_id IS NOT NULL AND archived_at IS NULL;
