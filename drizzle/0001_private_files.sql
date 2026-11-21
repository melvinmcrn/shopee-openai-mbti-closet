CREATE TABLE private_files (
    file_id TEXT PRIMARY KEY NOT NULL,
    user_id INTEGER NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('uploading', 'ready', 'deleting')),
    cleanup_attempts INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint

CREATE INDEX private_files_pending_cleanup ON private_files(user_id, cleanup_attempts, file_id)
    WHERE state = 'deleting';
--> statement-breakpoint

-- These include archived garments and files retained for outfit history.
CREATE VIEW private_file_references AS
    SELECT user_id, face_photo_file_id AS file_id FROM profiles WHERE face_photo_file_id IS NOT NULL
    UNION ALL
    SELECT user_id, image_file_id FROM wardrobe_items
    UNION ALL
    SELECT user_id, preview_file_id FROM outfit_options WHERE preview_file_id IS NOT NULL;
--> statement-breakpoint

-- New references require a ready file owned by the same account. Unchanged legacy
-- references continue to work. Detaching the final reference queues cleanup inside
-- the same statement, so the object cannot be reattached during R2 deletion.

CREATE INDEX profiles_by_file ON profiles(face_photo_file_id);
--> statement-breakpoint

CREATE TRIGGER profiles_file_insert
BEFORE INSERT ON profiles
WHEN NEW.face_photo_file_id IS NOT NULL
    AND NOT EXISTS (
        SELECT 1 FROM private_files
        WHERE file_id = NEW.face_photo_file_id AND user_id = NEW.user_id AND state = 'ready'
    )
BEGIN
    SELECT RAISE(ABORT, 'Private file is unavailable to this account');
END;
--> statement-breakpoint

CREATE TRIGGER profiles_file_update
BEFORE UPDATE OF face_photo_file_id, user_id ON profiles
WHEN NEW.face_photo_file_id IS NOT NULL
    AND (OLD.face_photo_file_id IS NOT NEW.face_photo_file_id OR OLD.user_id IS NOT NEW.user_id)
    AND NOT EXISTS (
        SELECT 1 FROM private_files
        WHERE file_id = NEW.face_photo_file_id AND user_id = NEW.user_id AND state = 'ready'
    )
BEGIN
    SELECT RAISE(ABORT, 'Private file is unavailable to this account');
END;
--> statement-breakpoint

CREATE TRIGGER profiles_file_cleanup_after_replace
AFTER UPDATE OF face_photo_file_id ON profiles
WHEN OLD.face_photo_file_id IS NOT NULL
    AND OLD.face_photo_file_id IS NOT NEW.face_photo_file_id
    AND NOT EXISTS (SELECT 1 FROM private_file_references WHERE file_id = OLD.face_photo_file_id)
BEGIN
    INSERT INTO private_files (file_id, user_id, state)
    VALUES (OLD.face_photo_file_id, OLD.user_id, 'deleting')
    ON CONFLICT(file_id) DO UPDATE SET state = 'deleting'
    WHERE private_files.user_id = excluded.user_id;
END;
--> statement-breakpoint

CREATE TRIGGER profiles_file_cleanup_after_delete
AFTER DELETE ON profiles
WHEN OLD.face_photo_file_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM private_file_references WHERE file_id = OLD.face_photo_file_id)
BEGIN
    INSERT INTO private_files (file_id, user_id, state)
    VALUES (OLD.face_photo_file_id, OLD.user_id, 'deleting')
    ON CONFLICT(file_id) DO UPDATE SET state = 'deleting'
    WHERE private_files.user_id = excluded.user_id;
END;
--> statement-breakpoint

CREATE INDEX wardrobe_items_by_file ON wardrobe_items(image_file_id);
--> statement-breakpoint

CREATE TRIGGER wardrobe_items_file_insert
BEFORE INSERT ON wardrobe_items
WHEN NEW.image_file_id IS NOT NULL
    AND NOT EXISTS (
        SELECT 1 FROM private_files
        WHERE file_id = NEW.image_file_id AND user_id = NEW.user_id AND state = 'ready'
    )
BEGIN
    SELECT RAISE(ABORT, 'Private file is unavailable to this account');
END;
--> statement-breakpoint

CREATE TRIGGER wardrobe_items_file_update
BEFORE UPDATE OF image_file_id, user_id ON wardrobe_items
WHEN NEW.image_file_id IS NOT NULL
    AND (OLD.image_file_id IS NOT NEW.image_file_id OR OLD.user_id IS NOT NEW.user_id)
    AND NOT EXISTS (
        SELECT 1 FROM private_files
        WHERE file_id = NEW.image_file_id AND user_id = NEW.user_id AND state = 'ready'
    )
BEGIN
    SELECT RAISE(ABORT, 'Private file is unavailable to this account');
END;
--> statement-breakpoint

CREATE TRIGGER wardrobe_items_file_cleanup_after_replace
AFTER UPDATE OF image_file_id ON wardrobe_items
WHEN OLD.image_file_id IS NOT NULL
    AND OLD.image_file_id IS NOT NEW.image_file_id
    AND NOT EXISTS (SELECT 1 FROM private_file_references WHERE file_id = OLD.image_file_id)
BEGIN
    INSERT INTO private_files (file_id, user_id, state)
    VALUES (OLD.image_file_id, OLD.user_id, 'deleting')
    ON CONFLICT(file_id) DO UPDATE SET state = 'deleting'
    WHERE private_files.user_id = excluded.user_id;
END;
--> statement-breakpoint

CREATE TRIGGER wardrobe_items_file_cleanup_after_delete
AFTER DELETE ON wardrobe_items
WHEN OLD.image_file_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM private_file_references WHERE file_id = OLD.image_file_id)
BEGIN
    INSERT INTO private_files (file_id, user_id, state)
    VALUES (OLD.image_file_id, OLD.user_id, 'deleting')
    ON CONFLICT(file_id) DO UPDATE SET state = 'deleting'
    WHERE private_files.user_id = excluded.user_id;
END;
--> statement-breakpoint

CREATE INDEX outfit_options_by_file ON outfit_options(preview_file_id);
--> statement-breakpoint

CREATE TRIGGER outfit_options_file_insert
BEFORE INSERT ON outfit_options
WHEN NEW.preview_file_id IS NOT NULL
    AND NOT EXISTS (
        SELECT 1 FROM private_files
        WHERE file_id = NEW.preview_file_id AND user_id = NEW.user_id AND state = 'ready'
    )
BEGIN
    SELECT RAISE(ABORT, 'Private file is unavailable to this account');
END;
--> statement-breakpoint

CREATE TRIGGER outfit_options_file_update
BEFORE UPDATE OF preview_file_id, user_id ON outfit_options
WHEN NEW.preview_file_id IS NOT NULL
    AND (OLD.preview_file_id IS NOT NEW.preview_file_id OR OLD.user_id IS NOT NEW.user_id)
    AND NOT EXISTS (
        SELECT 1 FROM private_files
        WHERE file_id = NEW.preview_file_id AND user_id = NEW.user_id AND state = 'ready'
    )
BEGIN
    SELECT RAISE(ABORT, 'Private file is unavailable to this account');
END;
--> statement-breakpoint

CREATE TRIGGER outfit_options_file_cleanup_after_replace
AFTER UPDATE OF preview_file_id ON outfit_options
WHEN OLD.preview_file_id IS NOT NULL
    AND OLD.preview_file_id IS NOT NEW.preview_file_id
    AND NOT EXISTS (SELECT 1 FROM private_file_references WHERE file_id = OLD.preview_file_id)
BEGIN
    INSERT INTO private_files (file_id, user_id, state)
    VALUES (OLD.preview_file_id, OLD.user_id, 'deleting')
    ON CONFLICT(file_id) DO UPDATE SET state = 'deleting'
    WHERE private_files.user_id = excluded.user_id;
END;
--> statement-breakpoint

CREATE TRIGGER outfit_options_file_cleanup_after_delete
AFTER DELETE ON outfit_options
WHEN OLD.preview_file_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM private_file_references WHERE file_id = OLD.preview_file_id)
BEGIN
    INSERT INTO private_files (file_id, user_id, state)
    VALUES (OLD.preview_file_id, OLD.user_id, 'deleting')
    ON CONFLICT(file_id) DO UPDATE SET state = 'deleting'
    WHERE private_files.user_id = excluded.user_id;
END;
