ALTER TABLE app.outfit_enhancements ADD COLUMN search_group TEXT;
ALTER TABLE app.outfit_enhancements ADD COLUMN search_term TEXT;
ALTER TABLE app.shopping_suggestions ADD COLUMN search_group TEXT;
ALTER TABLE app.shopping_suggestions ADD COLUMN search_term TEXT;

ALTER TABLE app.shopping_suggestions DROP CONSTRAINT shopping_suggestions_wardrobe_gap_check;
ALTER TABLE app.shopping_suggestions ADD CONSTRAINT shopping_suggestions_wardrobe_gap_check
    CHECK (wardrobe_gap IN ('top', 'bottom', 'shoes', 'outerwear'));
