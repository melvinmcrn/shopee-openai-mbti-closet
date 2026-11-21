import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { sample } from "./sample.mjs";

function setup() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../../drizzle/0000_stylist.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../../drizzle/0002_sample.sql", import.meta.url), "utf8"));
  sqlite.exec(`
    INSERT INTO users (id, auth_provider, auth_subject)
    VALUES (1, 'google', 'one'), (2, 'google', 'two')
  `);

  const objects = new Map();
  const env = {
    DB: {
      prepare(sql) {
        return {
          bind(...parameters) {
            return {
              all: async () => ({ results: sqlite.prepare(sql).all(...parameters) }),
              execute: () => {
                const statement = sqlite.prepare(sql);
                if (statement.columns().length > 0) return { results: statement.all(...parameters) };
                return statement.run(...parameters);
              },
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
      async put(key, data, options) {
        objects.set(key, { data: Buffer.from(data), options });
      },
    },
  };

  const assetDirectory = new URL("../../public/sample-wardrobe/", import.meta.url);
  globalThis.SITE_ASSETS = Object.fromEntries(readdirSync(assetDirectory).map((name) => [
    `/sample-wardrobe/${name}`,
    ["image/webp", readFileSync(new URL(name, assetDirectory)).toString("base64")],
  ]));

  async function loadSamples(userId) {
    const response = await sample(new Request("https://example.com/api/wardrobe/sample", { method: "POST" }), env, userId);
    assert.equal(response.status, 200);
    return (await response.json()).items;
  }

  return { env, loadSamples, objects, sqlite };
}

test("sample drafts are durable, distinct, and scoped to each wardrobe", async () => {
  const { loadSamples, objects, sqlite } = setup();
  const [items, duplicate] = await Promise.all([loadSamples(1), loadSamples(1)]);
  assert.deepEqual(duplicate, items);
  assert.equal(items.length, 7);
  assert.equal(objects.size, 7);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM wardrobe_items WHERE confirmed_at IS NULL").get().count, 7);

  const shoes = items.filter((item) => item.category === "shoes");
  assert.equal(shoes.length, 2);
  assert.notEqual(shoes[0].id, shoes[1].id);
  assert.notEqual(shoes[0].imageUrl, shoes[1].imageUrl);
  assert.notDeepEqual(objects.get(shoes[0].imageFileId).data, objects.get(shoes[1].imageFileId).data);
  for (const item of items) {
    assert.match(item.imageFileId, /^users\/1\//);
    assert.equal(objects.get(item.imageFileId).data.toString("ascii", 8, 12), "WEBP");
  }

  const otherWardrobe = await loadSamples(2);
  assert.equal(otherWardrobe.length, 7);
  assert.ok(otherWardrobe.every((item) => item.imageFileId.startsWith("users/2/")));
  assert.ok(otherWardrobe.every((item) => !items.some(({ id }) => id === item.id)));

  sqlite.prepare("UPDATE wardrobe_items SET name = ?, confirmed_at = CURRENT_TIMESTAMP WHERE id = ?").run("Edited name", items[0].id);
  sqlite.prepare("UPDATE wardrobe_items SET archived_at = CURRENT_TIMESTAMP WHERE id = ?").run(items[1].id);
  const afterEdit = await loadSamples(1);
  assert.equal(afterEdit.find(({ id }) => id === items[0].id).name, "Edited name");
  assert.ok(!afterEdit.some(({ id }) => id === items[1].id));
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM wardrobe_items WHERE user_id = 1").get().count, 7);
});

test("an interrupted sample load can be retried without incomplete drafts", async () => {
  const { env, loadSamples, sqlite } = setup();
  const put = env.BUCKET.put;
  env.BUCKET.put = async (key, ...args) => {
    if (key.endsWith("/black-penny-loafers.webp")) throw new Error("Storage unavailable");
    return put(key, ...args);
  };
  await assert.rejects(loadSamples(1), /Storage unavailable/);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM wardrobe_items").get().count, 0);

  env.BUCKET.put = put;
  assert.equal((await loadSamples(1)).length, 7);
});
