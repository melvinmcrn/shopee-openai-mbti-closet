ALTER TABLE private_files ADD COLUMN state_changed_at INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE INDEX private_files_expiry ON private_files(user_id, state_changed_at, file_id)
    WHERE state IN ('ready', 'uploading');
