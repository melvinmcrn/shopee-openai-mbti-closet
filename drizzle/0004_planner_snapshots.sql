ALTER TABLE outfit_option_items ADD COLUMN category_snapshot TEXT;
ALTER TABLE outfit_option_items ADD COLUMN color_snapshot TEXT;
ALTER TABLE outfit_option_items ADD COLUMN image_file_id_snapshot TEXT;

ALTER TABLE saved_look_items ADD COLUMN category_snapshot TEXT;
ALTER TABLE saved_look_items ADD COLUMN color_snapshot TEXT;
ALTER TABLE saved_look_items ADD COLUMN image_file_id_snapshot TEXT;
