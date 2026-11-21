CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    auth_provider TEXT NOT NULL,
    auth_subject TEXT NOT NULL,
    email TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (auth_provider, auth_subject)
);

CREATE TABLE profiles (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    height_cm REAL CHECK (height_cm > 0),
    weight_kg REAL CHECK (weight_kg > 0),
    face_photo_file_id TEXT,
    setup_completed_at TEXT
);

CREATE TABLE style_preferences (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    style TEXT NOT NULL,
    PRIMARY KEY (user_id, style)
);

CREATE TABLE wardrobe_items (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('top','bottom','dress','shoes','outerwear','accessory','other')),
    garment_type TEXT,
    color TEXT,
    image_file_id TEXT NOT NULL CHECK (length(trim(image_file_id)) > 0),
    confirmed_at TEXT,
    archived_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, id)
);

CREATE INDEX wardrobe_by_category ON wardrobe_items(user_id, category)
    WHERE confirmed_at IS NOT NULL AND archived_at IS NULL;

CREATE TABLE outfit_requests (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    occasion TEXT NOT NULL CHECK (length(trim(occasion)) > 0),
    planned_for TEXT,
    location_or_weather TEXT,
    formality TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, id)
);

CREATE TABLE request_comfort_choices (
    request_id INTEGER NOT NULL REFERENCES outfit_requests(id) ON DELETE CASCADE,
    choice TEXT NOT NULL,
    PRIMARY KEY (request_id, choice)
);

CREATE TABLE request_clothing_choices (
    request_id INTEGER NOT NULL REFERENCES outfit_requests(id) ON DELETE CASCADE,
    category TEXT NOT NULL CHECK (category IN ('top','bottom','dress','shoes','outerwear','accessory')),
    garment_type TEXT NOT NULL,
    PRIMARY KEY (request_id, category, garment_type)
);

CREATE TABLE generation_runs (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    request_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed')),
    model TEXT,
    prompt_version TEXT,
    error_code TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, id),
    FOREIGN KEY (user_id, request_id) REFERENCES outfit_requests(user_id, id) ON DELETE CASCADE
);

CREATE TABLE outfit_options (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    run_id INTEGER NOT NULL,
    position INTEGER NOT NULL CHECK (position > 0),
    title TEXT NOT NULL,
    explanation TEXT,
    preview_file_id TEXT,
    UNIQUE (run_id, position),
    UNIQUE (user_id, id),
    FOREIGN KEY (user_id, run_id) REFERENCES generation_runs(user_id, id) ON DELETE CASCADE
);

CREATE TABLE outfit_option_items (
    user_id INTEGER NOT NULL,
    option_id INTEGER NOT NULL,
    slot TEXT NOT NULL,
    item_id INTEGER NOT NULL,
    item_name TEXT NOT NULL,
    PRIMARY KEY (option_id, slot),
    FOREIGN KEY (user_id, option_id) REFERENCES outfit_options(user_id, id) ON DELETE CASCADE,
    FOREIGN KEY (user_id, item_id) REFERENCES wardrobe_items(user_id, id)
);

CREATE TABLE saved_looks (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    source_option_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    saved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, id),
    FOREIGN KEY (user_id, source_option_id) REFERENCES outfit_options(user_id, id) ON DELETE CASCADE
);

CREATE TABLE saved_look_items (
    user_id INTEGER NOT NULL,
    saved_look_id INTEGER NOT NULL,
    slot TEXT NOT NULL,
    item_id INTEGER NOT NULL,
    item_name TEXT NOT NULL,
    PRIMARY KEY (saved_look_id, slot),
    FOREIGN KEY (user_id, saved_look_id) REFERENCES saved_looks(user_id, id) ON DELETE CASCADE,
    FOREIGN KEY (user_id, item_id) REFERENCES wardrobe_items(user_id, id)
);

CREATE TABLE wear_feedback (
    id INTEGER PRIMARY KEY,
    saved_look_id INTEGER NOT NULL REFERENCES saved_looks(id) ON DELETE CASCADE,
    worn_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    rating INTEGER CHECK (rating IN (1,2,3,4,5)),
    note TEXT
);

CREATE TABLE shopping_suggestions (
    id INTEGER PRIMARY KEY,
    saved_look_id INTEGER NOT NULL REFERENCES saved_looks(id) ON DELETE CASCADE,
    product_name TEXT NOT NULL,
    merchant TEXT,
    product_url TEXT NOT NULL,
    is_sponsored INTEGER NOT NULL DEFAULT 0 CHECK (is_sponsored IN (0,1)),
    disclosure_text TEXT,
    hidden_at TEXT
);

CREATE INDEX saved_looks_by_user ON saved_looks(user_id, saved_at DESC);
CREATE INDEX wears_by_look ON wear_feedback(saved_look_id, worn_at DESC);
