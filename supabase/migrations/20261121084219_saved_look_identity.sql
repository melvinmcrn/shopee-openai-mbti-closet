-- Use the same native sequence as the saved_looks identity column.
CREATE VIEW app.next_saved_look_id AS
    SELECT nextval(pg_get_serial_sequence('app.saved_looks', 'id')) AS id;

GRANT SELECT ON app.next_saved_look_id TO mbti_closet_runtime;
