SET LOCAL search_path = app, pg_catalog;

ALTER TABLE outfit_requests ADD COLUMN resume_preview_file_id TEXT;
