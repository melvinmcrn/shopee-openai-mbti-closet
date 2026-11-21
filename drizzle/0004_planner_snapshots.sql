ALTER TABLE outfit_option_items ADD COLUMN category_snapshot TEXT;
--> statement-breakpoint
ALTER TABLE outfit_option_items ADD COLUMN color_snapshot TEXT;
--> statement-breakpoint
ALTER TABLE outfit_option_items ADD COLUMN image_file_id_snapshot TEXT;
--> statement-breakpoint

ALTER TABLE saved_look_items ADD COLUMN category_snapshot TEXT;
--> statement-breakpoint
ALTER TABLE saved_look_items ADD COLUMN color_snapshot TEXT;
--> statement-breakpoint
ALTER TABLE saved_look_items ADD COLUMN image_file_id_snapshot TEXT;
