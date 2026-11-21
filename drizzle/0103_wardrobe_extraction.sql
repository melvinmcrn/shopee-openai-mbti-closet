ALTER TABLE wardrobe_items ADD COLUMN extraction_source TEXT
    CHECK (extraction_source IN ('luna', 'fixture'));
