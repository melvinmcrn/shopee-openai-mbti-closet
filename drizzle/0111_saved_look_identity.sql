-- Keep issued look IDs stable even when the highest saved look is deleted.
CREATE TABLE saved_look_id_counter (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    last_id INTEGER NOT NULL
);
--> statement-breakpoint
INSERT INTO saved_look_id_counter (singleton, last_id)
SELECT 1, COALESCE(MAX(id), 0) FROM saved_looks;
--> statement-breakpoint
CREATE VIEW next_saved_look_id AS
    SELECT last_id + 1 AS id FROM saved_look_id_counter WHERE singleton = 1;
--> statement-breakpoint
CREATE TRIGGER saved_looks_advance_id AFTER INSERT ON saved_looks
BEGIN
    SELECT RAISE(ABORT, 'Saved look IDs cannot be reused')
    WHERE NEW.id <= (SELECT last_id FROM saved_look_id_counter WHERE singleton = 1);
    UPDATE saved_look_id_counter SET last_id = NEW.id WHERE singleton = 1;
END;
