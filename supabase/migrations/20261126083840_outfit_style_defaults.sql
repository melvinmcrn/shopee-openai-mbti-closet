SET LOCAL search_path = app, pg_catalog;

ALTER TABLE outfit_requests ADD COLUMN styles TEXT NOT NULL DEFAULT '[]'
    CHECK (jsonb_typeof(styles::jsonb) = 'array');
