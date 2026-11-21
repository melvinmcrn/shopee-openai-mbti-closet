import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { items } from "./items.mjs";

test("AI draft details are editable before explicit confirmation and private to the owner", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const path of ["0000_stylist", "0001_private_files", "0002_private_file_expiry", "0103_wardrobe_extraction"]) {
      db.exec(readFileSync(new URL(`../../../../../drizzle/${path}.sql`, import.meta.url), "utf8"));
    }
    db.exec(`
      INSERT INTO users (id, auth_provider, auth_subject) VALUES (8, 'google', 'account'), (9, 'google', 'other');
      INSERT INTO private_files (file_id, user_id, state) VALUES ('private/8/cutout', 8, 'ready');
      INSERT INTO wardrobe_items (id, user_id, name, category, garment_type, color, image_file_id, extraction_source)
      VALUES (1, 8, 'Blue cotton tee', 'top', 'T-shirt', 'Blue', 'private/8/cutout', 'luna');
    `);
    const env = { DB: { prepare(sql) { return { bind(...params) {
      return { first: () => db.prepare(sql).get(...params), all: () => ({ results: db.prepare(sql).all(...params) }) };
    } }; } } };
    const list = (status, owner = 8) => items(new Request(`https://closet.example/api/wardrobe/items?status=${status}`), env, owner);
    const patch = (body, owner = 8) => items(new Request("https://closet.example/api/wardrobe/items/1", {
      method: "PATCH", body: JSON.stringify(body),
    }), env, owner, "1");

    assert.deepEqual((await (await list("draft")).json()).items, [{
      id: 1, name: "Blue cotton tee", category: "top", garmentType: "T-shirt", color: "Blue",
      extractionSource: "luna", imageFileId: "private/8/cutout", imageUrl: "/api/files/private%2F8%2Fcutout",
    }]);
    assert.deepEqual((await (await list("active")).json()).items, []);
    assert.deepEqual((await (await list("draft", 9)).json()).items, []);
    assert.equal((await patch({ garmentType: "Sneaker" }, 9)).status, 404);
    assert.equal((await patch({ garmentType: "x".repeat(81) })).status, 400);
    assert.equal((await patch({ garmentType: "  Cotton tee  " })).status, 200);
    assert.equal((await (await list("draft")).json()).items[0].garmentType, "Cotton tee");
    assert.equal((await patch({ name: "Indigo tee", category: "top", color: "Indigo", confirm: true })).status, 200);
    assert.deepEqual((await (await list("draft")).json()).items, []);
    assert.equal((await (await list("active")).json()).items[0].garmentType, "Cotton tee");
    assert.equal((await (await patch({ garmentType: null })).json()).item.garmentType, null);
  } finally {
    db.close();
  }
});
