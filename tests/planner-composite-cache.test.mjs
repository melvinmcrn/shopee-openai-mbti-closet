import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { getLook } from "../src/app/api/_server/planner/saved.mjs";
import { previewSelection } from "../src/app/api/_server/planner/preview-files.mjs";

const top = { id: "13", name: "Shirt", imageRef: "shirt", category: "top" };
const jacket = { id: "14", name: "Jacket", imageRef: "jacket", category: "outerwear" };
const product = {
  id: "1", title: "Black boots", category: "men shoes", imageUrl: "https://example.test/listing",
  searchGroup: "men", searchTerm: "men shoes", ocrImage: "clothes_image_database/boots.jpg",
};

test("a composited preview is specific to the profile, original photo, wardrobe sources, and exact catalog listing", () => {
  const slots = { other: { id: "7", name: "Base outfit", category: "other", imageRef: "base-photo" } };
  const key = (profile, effective, items) => previewSelection(slots, true, items, profile, effective);
  const effective = { ...slots, top };
  const first = key("face", effective, [product]);
  assert.equal(JSON.parse(first)[0], "photo-v5");
  const previousComposite = previewSelection(slots, true, [product], "face", effective, "photo-v4");
  assert.deepEqual(JSON.parse(previousComposite), ["photo-v4", ...JSON.parse(first).slice(1)]);
  const identityOnly = previewSelection(slots, true, [product], "face", effective, undefined, true);
  assert.deepEqual(JSON.parse(identityOnly), [...JSON.parse(first), true]);
  for (const version of ["inventory-v3", "inventory-v4"]) {
    const legacy = previewSelection(slots, true, [product], "face", effective, version);
    assert.deepEqual(JSON.parse(legacy), [version, true, "face", [["other", "7", "base-photo", "Base outfit"]],
      [[product.id, product.imageUrl, product.title, product.category]]]);
  }
  assert.equal(first, key("face", { top: { ...top, id: 13 }, ...slots }, [product]));
  assert.notEqual(first, key("another-face", effective, [product]));
  assert.notEqual(first, key("face", { ...effective, other: { ...slots.other, imageRef: "new-base" } }, [product]));
  assert.notEqual(first, key("face", { ...effective, top: { ...top, imageRef: "changed-shirt" } }, [product]));
  assert.notEqual(first, key("face", { ...effective, outerwear: jacket }, [product]));
  for (const change of [{ id: "2" }, { searchGroup: "unisex" }, { searchTerm: "men boots" }, { ocrImage: "new-boots.jpg" }]) {
    assert.notEqual(first, key("face", effective, [{ ...product, ...change }]));
  }
  assert.notEqual(first, key("face", effective, []));
});

test("Saved resolves the composite of its actual base coverage and available wardrobe pieces", async t => {
  const database = new DatabaseSync(":memory:");
  t.after(() => database.close());
  const migrations = new URL("../drizzle/", import.meta.url);
  for (const name of readdirSync(migrations).filter(name => name.endsWith(".sql")).sort()) {
    database.exec(readFileSync(new URL(name, migrations), "utf8"));
  }
  const coverage = JSON.stringify({ top: false, bottom: true, dress: false, outerwear: false, shoes: true });
  database.exec(`
    INSERT INTO users (id,auth_provider,auth_subject) VALUES (1,'test','owner');
    INSERT INTO outfit_requests (id,user_id,occasion) VALUES (1,1,'Dinner');
    INSERT INTO generation_runs (id,user_id,request_id) VALUES (1,1,1);
    INSERT INTO outfit_options (id,user_id,run_id,position,title) VALUES (1,1,1,1,'Dinner');
    INSERT INTO private_files (file_id,user_id,state) VALUES
      ('face',1,'ready'),('shirt',1,'ready'),('jacket',1,'ready'),('complete',1,'ready'),('old-render',1,'ready');
    INSERT INTO profiles (user_id,face_photo_file_id) VALUES (1,'face');
    INSERT INTO wardrobe_items (id,user_id,category,name,image_file_id,confirmed_at) VALUES
      (13,1,'top','Shirt','shirt',CURRENT_TIMESTAMP),(14,1,'outerwear','Jacket','jacket',CURRENT_TIMESTAMP);
    INSERT INTO saved_looks (id,user_id,source_option_id,name,use_profile_photo) VALUES (1,1,1,'Dinner',1);
    INSERT INTO saved_look_items(user_id,saved_look_id,slot,item_id,item_name) VALUES (1,1,'outerwear',14,'Jacket');
  `);
  database.prepare("UPDATE private_files SET base_coverage=? WHERE file_id='face'").run(coverage);
  const slots = { outerwear: jacket };
  const complete = previewSelection(slots, true, [], "face", { ...slots, top });
  const insert = database.prepare("INSERT INTO planner_previews VALUES (1,1,?,?)");
  insert.run(JSON.stringify(["inventory-v3", true, "face", [["outerwear", "14", "jacket", "Jacket"]], []]), "old-render");
  const db = { prepare(sql) { return { bind(...params) {
    return { all: async () => ({ results: database.prepare(sql).all(...params) }) };
  } }; } };
  assert.equal((await getLook(db, 1, "1")).previewRef, null);
  insert.run(complete, "complete");
  assert.equal((await getLook(db, 1, "1")).previewRef, "complete");
  database.exec("UPDATE wardrobe_items SET archived_at=CURRENT_TIMESTAMP WHERE id=13");
  assert.equal((await getLook(db, 1, "1")).previewRef, null);
});
