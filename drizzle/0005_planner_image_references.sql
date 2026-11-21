CREATE TABLE planner_previews (
    user_id INTEGER NOT NULL,
    option_id INTEGER NOT NULL,
    selection TEXT NOT NULL,
    file_id TEXT NOT NULL UNIQUE,
    PRIMARY KEY (user_id, option_id, selection),
    FOREIGN KEY (user_id, option_id) REFERENCES outfit_options(user_id, id) ON DELETE CASCADE
);
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
    );
--> statement-breakpoint

CREATE INDEX outfit_option_items_snapshot_files ON outfit_option_items(image_file_id_snapshot) WHERE image_file_id_snapshot IS NOT NULL;
--> statement-breakpoint

CREATE TRIGGER outfit_option_items_verify_snapshot BEFORE INSERT ON outfit_option_items
WHEN NEW.category_snapshot IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM wardrobe_items WHERE user_id = NEW.user_id AND id = NEW.item_id
      AND confirmed_at IS NOT NULL AND archived_at IS NULL
      AND category = NEW.slot AND category = NEW.category_snapshot
      AND image_file_id = NEW.image_file_id_snapshot
)
BEGIN
    SELECT RAISE(ABORT, 'Selected garment changed. Refresh your wardrobe.');
END;
--> statement-breakpoint

CREATE TRIGGER outfit_option_items_release_snapshot AFTER DELETE ON outfit_option_items
WHEN OLD.image_file_id_snapshot IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM private_file_references WHERE file_id = OLD.image_file_id_snapshot
)
BEGIN
    INSERT INTO private_files(file_id,user_id,state) VALUES (OLD.image_file_id_snapshot,OLD.user_id,'deleting')
    ON CONFLICT(file_id) DO UPDATE SET state='deleting' WHERE private_files.user_id=excluded.user_id;
END;
--> statement-breakpoint

CREATE INDEX saved_look_items_snapshot_files ON saved_look_items(image_file_id_snapshot) WHERE image_file_id_snapshot IS NOT NULL;
--> statement-breakpoint

CREATE TRIGGER saved_look_items_verify_snapshot BEFORE INSERT ON saved_look_items
WHEN NEW.category_snapshot IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM wardrobe_items WHERE user_id = NEW.user_id AND id = NEW.item_id
      AND confirmed_at IS NOT NULL AND archived_at IS NULL
      AND category = NEW.slot AND category = NEW.category_snapshot
      AND image_file_id = NEW.image_file_id_snapshot
)
BEGIN
    SELECT RAISE(ABORT, 'Selected garment changed. Refresh your wardrobe.');
END;
--> statement-breakpoint

CREATE TRIGGER saved_look_items_release_snapshot AFTER DELETE ON saved_look_items
WHEN OLD.image_file_id_snapshot IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM private_file_references WHERE file_id = OLD.image_file_id_snapshot
)
BEGIN
    INSERT INTO private_files(file_id,user_id,state) VALUES (OLD.image_file_id_snapshot,OLD.user_id,'deleting')
    ON CONFLICT(file_id) DO UPDATE SET state='deleting' WHERE private_files.user_id=excluded.user_id;
END;

--> statement-breakpoint

CREATE TRIGGER planner_preview_verify_insert BEFORE INSERT ON planner_previews
WHEN NOT EXISTS (SELECT 1 FROM private_files WHERE file_id=NEW.file_id AND user_id=NEW.user_id AND state='ready')
BEGIN
    SELECT RAISE(ABORT, 'Private preview is unavailable');
END;

--> statement-breakpoint

CREATE TRIGGER planner_preview_verify_update BEFORE UPDATE ON planner_previews
WHEN NOT EXISTS (SELECT 1 FROM private_files WHERE file_id=NEW.file_id AND user_id=NEW.user_id AND state='ready')
BEGIN
    SELECT RAISE(ABORT, 'Private preview is unavailable');
END;

--> statement-breakpoint

CREATE TRIGGER planner_preview_release_update AFTER UPDATE ON planner_previews
WHEN NOT EXISTS (SELECT 1 FROM private_file_references WHERE file_id=OLD.file_id)
BEGIN
    UPDATE private_files SET state='deleting' WHERE user_id=OLD.user_id AND file_id=OLD.file_id;
END;

--> statement-breakpoint

CREATE TRIGGER planner_preview_release_delete AFTER DELETE ON planner_previews
WHEN NOT EXISTS (SELECT 1 FROM private_file_references WHERE file_id=OLD.file_id)
BEGIN
    UPDATE private_files SET state='deleting' WHERE user_id=OLD.user_id AND file_id=OLD.file_id;
END;
