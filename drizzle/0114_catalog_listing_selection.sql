ALTER TABLE outfit_enhancements ADD COLUMN search_group TEXT;
ALTER TABLE outfit_enhancements ADD COLUMN search_term TEXT;
ALTER TABLE shopping_suggestions ADD COLUMN search_group TEXT;
ALTER TABLE shopping_suggestions ADD COLUMN search_term TEXT;

DROP INDEX one_catalog_suggestion_per_gap;
ALTER TABLE shopping_suggestions RENAME COLUMN wardrobe_gap TO previous_gap;
ALTER TABLE shopping_suggestions ADD COLUMN wardrobe_gap TEXT CHECK (wardrobe_gap IN ('top', 'bottom', 'shoes', 'outerwear'));
UPDATE shopping_suggestions SET wardrobe_gap = previous_gap;
ALTER TABLE shopping_suggestions DROP COLUMN previous_gap;
CREATE UNIQUE INDEX one_catalog_suggestion_per_gap ON shopping_suggestions(saved_look_id, COALESCE(wardrobe_gap, 'general'))
    WHERE catalog_item_id IS NOT NULL;
