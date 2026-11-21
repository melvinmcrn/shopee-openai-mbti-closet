ALTER TABLE saved_looks ADD COLUMN pinned_preview_file_id TEXT;
--> statement-breakpoint
ALTER TABLE saved_looks ADD COLUMN pinned_preview_selection TEXT
    CHECK ((pinned_preview_file_id IS NULL) = (pinned_preview_selection IS NULL));
--> statement-breakpoint
CREATE INDEX saved_looks_by_preview_file ON saved_looks(pinned_preview_file_id)
    WHERE pinned_preview_file_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE saved_look_catalog_items (
    saved_look_id BIGINT NOT NULL REFERENCES saved_looks(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL REFERENCES clothes_image_database(item_id) ON DELETE CASCADE,
    search_group TEXT,
    search_term TEXT,
    catalog_slot TEXT CHECK (catalog_slot IN ('top','bottom','dress','shoes','outerwear','accessory')),
    wardrobe_gap TEXT CHECK (wardrobe_gap IN ('top','bottom','shoes','outerwear')),
    PRIMARY KEY (saved_look_id, item_id)
) WITHOUT ROWID;
--> statement-breakpoint
CREATE INDEX saved_catalog_by_item ON saved_look_catalog_items(item_id);
--> statement-breakpoint
DROP VIEW private_file_references;
--> statement-breakpoint
CREATE VIEW private_file_references AS
    SELECT user_id, face_photo_file_id AS file_id FROM profiles WHERE face_photo_file_id IS NOT NULL
    UNION ALL
    SELECT user_id, image_file_id FROM wardrobe_items
    UNION ALL
    SELECT user_id, preview_file_id FROM outfit_options WHERE preview_file_id IS NOT NULL
    UNION ALL
    SELECT user_id, file_id FROM (
        SELECT user_id, image_file_id_snapshot AS file_id FROM outfit_option_items WHERE image_file_id_snapshot IS NOT NULL
        UNION ALL
        SELECT user_id, image_file_id_snapshot FROM saved_look_items WHERE image_file_id_snapshot IS NOT NULL
        UNION ALL
        SELECT user_id, file_id FROM planner_previews
        UNION ALL
        SELECT user_id, pinned_preview_file_id FROM saved_looks WHERE pinned_preview_file_id IS NOT NULL
    );
--> statement-breakpoint
CREATE TRIGGER saved_preview_verify_insert BEFORE INSERT ON saved_looks
WHEN NEW.pinned_preview_file_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM planner_previews p JOIN private_files f ON f.file_id = p.file_id AND f.user_id = p.user_id
    WHERE p.file_id = NEW.pinned_preview_file_id AND p.user_id = NEW.user_id AND f.state = 'ready'
      AND p.option_id = NEW.source_option_id AND p.selection = NEW.pinned_preview_selection
)
BEGIN
    SELECT RAISE(ABORT, 'The selected try-on has changed');
END;
--> statement-breakpoint
CREATE TRIGGER saved_preview_verify_update BEFORE UPDATE OF pinned_preview_file_id, pinned_preview_selection, source_option_id, user_id ON saved_looks
WHEN NEW.pinned_preview_file_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM planner_previews p JOIN private_files f ON f.file_id = p.file_id AND f.user_id = p.user_id
    WHERE p.file_id = NEW.pinned_preview_file_id AND p.user_id = NEW.user_id AND f.state = 'ready'
      AND p.option_id = NEW.source_option_id AND p.selection = NEW.pinned_preview_selection
)
BEGIN
    SELECT RAISE(ABORT, 'The selected try-on has changed');
END;
--> statement-breakpoint
CREATE TRIGGER saved_preview_release_update AFTER UPDATE OF pinned_preview_file_id ON saved_looks
WHEN OLD.pinned_preview_file_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM private_file_references WHERE file_id = OLD.pinned_preview_file_id
)
BEGIN
    UPDATE private_files SET state='deleting' WHERE user_id=OLD.user_id AND file_id=OLD.pinned_preview_file_id;
END;
--> statement-breakpoint
CREATE TRIGGER saved_preview_release_delete AFTER DELETE ON saved_looks
WHEN OLD.pinned_preview_file_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM private_file_references WHERE file_id = OLD.pinned_preview_file_id
)
BEGIN
    UPDATE private_files SET state='deleting' WHERE user_id=OLD.user_id AND file_id=OLD.pinned_preview_file_id;
END;
