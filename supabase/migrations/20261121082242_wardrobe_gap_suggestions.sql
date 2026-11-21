ALTER TABLE app.shopping_suggestions ADD COLUMN wardrobe_gap TEXT CHECK (wardrobe_gap IN ('top', 'bottom'));
DROP INDEX app.one_catalog_suggestion_per_look;
CREATE UNIQUE INDEX one_catalog_suggestion_per_gap ON app.shopping_suggestions(saved_look_id, COALESCE(wardrobe_gap, 'general'))
    WHERE catalog_item_id IS NOT NULL;
