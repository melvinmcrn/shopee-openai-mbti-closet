ALTER TABLE outfit_options ADD COLUMN look_kind TEXT CHECK (look_kind = 'occasion');
--> statement-breakpoint
CREATE TABLE outfit_option_catalog_items (
    user_id BIGINT NOT NULL,
    option_id BIGINT NOT NULL,
    slot TEXT NOT NULL CHECK (slot IN ('top', 'bottom', 'dress', 'shoes', 'outerwear', 'accessory')),
    item_id TEXT NOT NULL REFERENCES clothes_image_database(item_id) ON DELETE CASCADE,
    PRIMARY KEY (option_id, slot),
    UNIQUE (option_id, item_id),
    FOREIGN KEY (user_id, option_id) REFERENCES outfit_options(user_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX option_catalog_by_item ON outfit_option_catalog_items(item_id);
--> statement-breakpoint
CREATE TABLE saved_look_hidden_catalog_items (
    saved_look_id BIGINT NOT NULL REFERENCES saved_looks(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL REFERENCES clothes_image_database(item_id) ON DELETE CASCADE,
    PRIMARY KEY (saved_look_id, item_id)
);
--> statement-breakpoint
CREATE INDEX hidden_catalog_by_item ON saved_look_hidden_catalog_items(item_id);
