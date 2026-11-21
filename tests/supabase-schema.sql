-- Run with psql -v ON_ERROR_STOP=1 against a disposable database after migration.
BEGIN;

CREATE ROLE mbti_schema_test_unprivileged NOLOGIN;
DO $$
BEGIN
    IF has_schema_privilege('mbti_schema_test_unprivileged', 'app', 'USAGE') THEN
        RAISE EXCEPTION 'Database schema is exposed to an unrelated role';
    END IF;
END
$$;

SET LOCAL ROLE mbti_closet_runtime;
SET LOCAL search_path = app, pg_catalog;

DO $$
DECLARE
    owner_id BIGINT;
    other_id BIGINT;
    request_id BIGINT := 9007199254740990;
    run_id BIGINT;
    selected_option BIGINT;
    garment_id BIGINT;
    second_garment_id BIGINT;
    returned_date TEXT;
BEGIN
    INSERT INTO users(auth_provider, auth_subject)
    VALUES ('google', 'supabase-schema-owner') RETURNING id, created_at INTO owner_id, returned_date;
    INSERT INTO users(auth_provider, auth_subject)
    VALUES ('google', 'supabase-schema-other') RETURNING id INTO other_id;
    IF owner_id IS NULL OR other_id IS NULL OR returned_date !~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$' THEN
        RAISE EXCEPTION 'User identity or SQLite-compatible timestamp default is missing';
    END IF;

    INSERT INTO private_files(file_id, user_id, state)
    VALUES ('photo', owner_id, 'ready'), ('garment', owner_id, 'ready'),
           ('replacement', owner_id, 'ready'), ('preview', owner_id, 'ready');
    INSERT INTO profiles(user_id, face_photo_file_id) VALUES (owner_id, 'photo');
    BEGIN
        INSERT INTO profiles(user_id, face_photo_file_id) VALUES (other_id, 'photo');
        RAISE EXCEPTION 'Another account attached the profile photo';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;

    UPDATE private_files SET state = 'deleting' WHERE file_id = 'photo';
    IF (SELECT state FROM private_files WHERE file_id = 'photo') <> 'ready' THEN
        RAISE EXCEPTION 'A file with live references was claimed for deletion';
    END IF;
    DELETE FROM profiles WHERE user_id = owner_id;
    IF (SELECT state FROM private_files WHERE file_id = 'photo') <> 'deleting' THEN
        RAISE EXCEPTION 'Deleting a profile failed to queue its detached photo';
    END IF;

    INSERT INTO wardrobe_items(user_id, name, category, image_file_id, confirmed_at)
    VALUES (owner_id, 'Sweater', 'top', 'garment', utc_timestamp()) RETURNING id INTO garment_id;
    INSERT INTO wardrobe_items(user_id, name, category, image_file_id)
    VALUES (owner_id, 'Second sweater', 'top', 'garment') RETURNING id INTO second_garment_id;

    INSERT INTO outfit_requests(id, user_id, occasion) VALUES (request_id, owner_id, 'Dinner');
    INSERT INTO generation_runs(user_id, request_id) VALUES (owner_id, request_id) RETURNING id INTO run_id;
    INSERT INTO outfit_options(user_id, run_id, position, title)
    VALUES (owner_id, run_id, 1, 'Dinner option') RETURNING id INTO selected_option;

    BEGIN
        INSERT INTO outfit_option_items(user_id, option_id, slot, item_id, item_name, category_snapshot, image_file_id_snapshot)
        VALUES (owner_id, selected_option, 'shoes', garment_id, 'Sweater', 'shoes', 'garment');
        RAISE EXCEPTION 'A snapshot accepted a mismatched garment category';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;
    INSERT INTO outfit_option_items(user_id, option_id, slot, item_id, item_name, category_snapshot, image_file_id_snapshot)
    VALUES (owner_id, selected_option, 'top', garment_id, 'Sweater', 'top', 'garment');

    UPDATE wardrobe_items SET image_file_id = 'replacement' WHERE id IN (garment_id, second_garment_id);
    IF (SELECT state FROM private_files WHERE file_id = 'garment') <> 'ready' THEN
        RAISE EXCEPTION 'The original garment image was queued while a snapshot still referenced it';
    END IF;
    DELETE FROM outfit_option_items WHERE option_id = selected_option;
    IF (SELECT state FROM private_files WHERE file_id = 'garment') <> 'deleting' THEN
        RAISE EXCEPTION 'A detached snapshot image was not queued for cleanup';
    END IF;

    BEGIN
        INSERT INTO planner_previews(user_id, option_id, selection, file_id)
        VALUES (owner_id, selected_option, 'invalid', 'photo');
        RAISE EXCEPTION 'A preview attached a file already queued for deletion';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;
    INSERT INTO planner_previews(user_id, option_id, selection, file_id)
    VALUES (owner_id, selected_option, 'selected', 'preview');
    DELETE FROM outfit_options WHERE id = selected_option;
    IF (SELECT state FROM private_files WHERE file_id = 'preview') <> 'deleting' THEN
        RAISE EXCEPTION 'Deleting an option failed to queue its detached preview';
    END IF;
END
$$;

ROLLBACK;
