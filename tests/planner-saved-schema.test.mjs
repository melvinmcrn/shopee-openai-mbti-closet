import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { getLook, listLooks } from "../src/app/api/_server/planner/saved.mjs";

test("Saved looks remain readable before the photo-mode migration", async (t) => {
  const database = new DatabaseSync(":memory:");
  t.after(() => database.close());
  const migrations = new URL("../drizzle/", import.meta.url);
  const modeMigration = "0109_saved_look_photo_mode.sql";
  for (const file of readdirSync(migrations).filter(name => name.endsWith(".sql") && name < modeMigration).sort()) {
    database.exec(readFileSync(new URL(file, migrations), "utf8"));
  }
  const db = {
    prepare(sql) {
      return {
        bind(...params) {
          return { all: async () => ({ results: database.prepare(sql).all(...params) }) };
        },
      };
    },
  };

  assert.deepEqual(await listLooks(db, 1), []);
  database.exec(`
    INSERT INTO users (id, auth_provider, auth_subject) VALUES
      (1, 'google', 'fixture-user'), (2, 'google', 'fixture-other');
    INSERT INTO outfit_requests (id, user_id, occasion) VALUES (1, 1, 'Dinner');
    INSERT INTO generation_runs (id, user_id, request_id) VALUES (1, 1, 1);
    INSERT INTO outfit_options (id, user_id, run_id, position, title) VALUES (1, 1, 1, 1, 'Cream outfit');
    INSERT INTO saved_looks (id, user_id, source_option_id, name) VALUES (1, 1, 1, 'Cream outfit');
  `);
  const [before] = await listLooks(db, 1);
  assert.equal(before.id, "1");
  assert.equal(before.occasion, "Cream outfit");
  assert.equal(before.previewRef, null);
  assert.deepEqual(await getLook(db, 1, "1"), before);
  assert.equal(await getLook(db, 2, "1"), null);

  database.exec(readFileSync(new URL(modeMigration, migrations), "utf8"));
  database.exec("UPDATE saved_looks SET use_profile_photo = 1 WHERE id = 1");
  assert.deepEqual(await getLook(db, 1, "1"), before);
  database.exec("UPDATE saved_looks SET use_profile_photo = 0 WHERE id = 1");
  assert.deepEqual(await getLook(db, 1, "1"), before);
});
