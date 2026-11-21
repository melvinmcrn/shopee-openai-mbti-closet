CREATE TABLE profile_photo_cleanup (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_key TEXT NOT NULL,
    available_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, file_key)
);
