import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { upload } from "./upload.mjs";

function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const migrations = new URL("../../../../../drizzle/", import.meta.url);
  for (const name of readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(new URL(name, migrations), "utf8"));
  }
  sqlite.exec(`
    INSERT INTO users (id, auth_provider, auth_subject)
    VALUES (1, 'google', 'one'), (2, 'google', 'two')
  `);

  const files = new Map();
  const env = {
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            const statement = sqlite.prepare(sql);
            return {
              first: async () => statement.get(...args),
              run: async () => statement.run(...args),
              execute: () => ({ results: statement.all(...args) }),
            };
          },
        };
      },
      async batch(statements) {
        sqlite.exec("BEGIN");
        try {
          const results = statements.map((statement) => statement.execute());
          sqlite.exec("COMMIT");
          return results;
        } catch (error) {
          sqlite.exec("ROLLBACK");
          throw error;
        }
      },
    },
    BUCKET: {
      async put(fileId, body, { httpMetadata }) {
        files.set(fileId, { body, httpMetadata });
      },
      async delete(fileId) {
        files.delete(fileId);
      },
    },
  };

  function send(draftKey, userId = 1, photo = Uint8Array.of(0xff, 0xd8, 0xff, 0xd9)) {
    const form = new FormData();
    form.set("draftKey", draftKey);
    form.set("image", new Blob([photo]), "garment.jpg");
    const request = new Request("https://wardrobe.example/api/wardrobe/upload", {
      method: "POST",
      body: form,
    });
    return upload(request, env, userId);
  }

  return { env, files, send, sqlite };
}

test("competing garment uploads keep one private file per account and draft key", async (t) => {
  const { env, files, send, sqlite } = fixture(t);
  const { promise: bothUploadsStarted, resolve } = Promise.withResolvers();
  const put = env.BUCKET.put;
  let attempts = 0;
  env.BUCKET.put = async (...args) => {
    attempts++;
    if (attempts === 2) resolve();
    await bothUploadsStarted;
    return put(...args);
  };

  const draftKey = crypto.randomUUID();
  const [first, competing] = await Promise.all([
    send(draftKey),
    send(draftKey.toUpperCase(), 1, Uint8Array.of(0xff, 0xd8, 0xff, 0xda)),
  ]);
  assert.equal(first.status, 200);
  assert.equal(competing.status, 200);
  const draft = await first.json();
  assert.deepEqual(await competing.json(), draft);
  assert.equal(attempts, 2);
  const row = sqlite.prepare("SELECT * FROM wardrobe_items WHERE id = ?").get(draft.id);
  assert.equal(row.confirmed_at, null);
  assert.match(row.image_file_id, /^private\/1\//);
  assert.deepEqual([...files.keys()], [row.image_file_id]);
  assert.equal(files.get(row.image_file_id).httpMetadata.contentType, "image/jpeg");
  assert.equal(sqlite.prepare("SELECT count(*) AS count FROM private_files").get().count, 1);

  assert.deepEqual(await (await send(draftKey)).json(), draft);
  assert.equal(attempts, 2);
  const otherOwner = await (await send(draftKey, 2)).json();
  assert.notEqual(otherOwner.id, draft.id);
  assert.equal(files.size, 2);
});

test("an ambiguous draft commit does not delete the attached photo", async (t) => {
  const { env, files, send, sqlite } = fixture(t);
  const realBatch = env.DB.batch;
  const draftKey = crypto.randomUUID();
  const error = new Error("D1 response unavailable");

  env.DB.batch = async () => { throw error; };
  await assert.rejects(send(draftKey), { message: error.message });
  assert.equal(files.size, 0);
  assert.equal(sqlite.prepare("SELECT count(*) AS count FROM private_files").get().count, 0);

  env.DB.batch = async (statements) => {
    await realBatch(statements);
    throw error;
  };
  await assert.rejects(send(draftKey), { message: error.message });
  const row = sqlite.prepare("SELECT id, image_file_id FROM wardrobe_items").get();
  assert.deepEqual([...files.keys()], [row.image_file_id]);
  assert.deepEqual(await (await send(draftKey)).json(), { id: row.id });
});
