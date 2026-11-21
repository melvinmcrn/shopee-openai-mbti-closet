SET LOCAL search_path = app, pg_catalog;

ALTER TABLE saved_looks ADD COLUMN pinned_preview_file_id TEXT;
ALTER TABLE saved_looks ADD COLUMN pinned_preview_selection TEXT
    CHECK ((pinned_preview_file_id IS NULL) = (pinned_preview_selection IS NULL));
CREATE INDEX saved_looks_by_preview_file ON saved_looks(pinned_preview_file_id)
    WHERE pinned_preview_file_id IS NOT NULL;

CREATE TABLE saved_look_catalog_items (
    saved_look_id BIGINT NOT NULL REFERENCES saved_looks(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL REFERENCES clothes_image_database(item_id) ON DELETE CASCADE,
    search_group TEXT,
    search_term TEXT,
    catalog_slot TEXT CHECK (catalog_slot IN ('top','bottom','dress','shoes','outerwear','accessory')),
    wardrobe_gap TEXT CHECK (wardrobe_gap IN ('top','bottom','shoes','outerwear')),
    PRIMARY KEY (saved_look_id, item_id)
);
CREATE INDEX saved_catalog_by_item ON saved_look_catalog_items(item_id);
GRANT SELECT, INSERT ON saved_look_catalog_items TO mbti_closet_runtime;

CREATE OR REPLACE VIEW private_file_references AS
    SELECT user_id, face_photo_file_id AS file_id FROM profiles WHERE face_photo_file_id IS NOT NULL
    UNION ALL
    SELECT user_id, image_file_id FROM wardrobe_items
    UNION ALL
    SELECT user_id, preview_file_id FROM outfit_options WHERE preview_file_id IS NOT NULL
    UNION ALL
    SELECT user_id, image_file_id_snapshot FROM outfit_option_items WHERE image_file_id_snapshot IS NOT NULL
    UNION ALL
    SELECT user_id, image_file_id_snapshot FROM saved_look_items WHERE image_file_id_snapshot IS NOT NULL
    UNION ALL
    SELECT user_id, file_id FROM planner_previews
    UNION ALL
    SELECT user_id, pinned_preview_file_id FROM saved_looks WHERE pinned_preview_file_id IS NOT NULL;

CREATE FUNCTION check_saved_preview() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = app, pg_catalog
AS $$
BEGIN
    IF NEW.pinned_preview_file_id IS NULL THEN RETURN NEW; END IF;
    PERFORM 1 FROM planner_previews
    WHERE file_id = NEW.pinned_preview_file_id AND option_id = NEW.source_option_id
        AND user_id = NEW.user_id AND selection = NEW.pinned_preview_selection
    FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'The selected try-on has changed' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION check_saved_preview() FROM PUBLIC;
CREATE TRIGGER saved_preview_check_generated BEFORE INSERT OR UPDATE OF pinned_preview_file_id, pinned_preview_selection, source_option_id, user_id ON saved_looks
    FOR EACH ROW EXECUTE FUNCTION check_saved_preview();
CREATE TRIGGER saved_preview_check_private_file BEFORE INSERT OR UPDATE OF pinned_preview_file_id, user_id ON saved_looks
    FOR EACH ROW EXECUTE FUNCTION check_private_file_attachment('pinned_preview_file_id');
CREATE TRIGGER saved_preview_release_private_file AFTER UPDATE OF pinned_preview_file_id OR DELETE ON saved_looks
    FOR EACH ROW EXECUTE FUNCTION enqueue_detached_private_file('pinned_preview_file_id', 'registered_only');
