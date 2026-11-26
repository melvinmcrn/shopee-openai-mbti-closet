ALTER TABLE outfit_requests ADD COLUMN styles TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(styles) AND json_type(styles) = 'array');
