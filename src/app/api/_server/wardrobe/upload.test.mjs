import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { decode, encode } from "fast-png";
import sharp from "sharp";
import { normalizeWardrobePhoto } from "../../../../../server/normalize-wardrobe-photo.mjs";
import { requestWardrobeUpload } from "../../../wardrobe/add/request-wardrobe-upload.mjs";
import { wardrobeApi } from "../wardrobe-api.mjs";
import { sheetGrid } from "./extraction-sheet.mjs";

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
          bind(...params) {
            const args = /\?\d/.test(sql)
              ? [Object.fromEntries(params.map((value, index) => [String(index + 1), value]))]
              : params;
            const statement = sqlite.prepare(sql);
            return {
              first: async () => statement.get(...args),
              all: async () => ({ results: statement.all(...args) }),
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
      async get(fileId) {
        const file = files.get(fileId);
        return file && { size: file.body.byteLength, arrayBuffer: async () => file.body };
      },
      async delete(fileId) {
        files.delete(fileId);
      },
    },
  };

  function send(draftKey, userId = 1, photo = Uint8Array.of(0xff, 0xd8, 0xff, 0xd9)) {
    const form = new FormData();
    form.set("draftKey", draftKey);
    if (photo !== null) form.set("image", new Blob([photo]), "garment.jpg");
    const request = new Request("https://wardrobe.example/api/wardrobe/upload", {
      method: "POST",
      body: form,
    });
    return wardrobeApi(request, env, userId);
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
  assert.deepEqual(await (await send(draftKey)).json(), {
    id: row.id,
    extraction: { status: "manual", code: "extraction_unavailable" },
  });
});


const photoPng = encode({
  width: 2,
  height: 2,
  data: Uint8Array.of(10, 20, 30, 255, 30, 40, 50, 255, 50, 60, 70, 255, 80, 90, 100, 255),
});
const cutoutPng = encode({
  width: 2,
  height: 2,
  data: Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0, 50, 60, 70, 255, 80, 90, 100, 255),
});
const testPhoto = new File([photoPng], "shirt.png", { type: "image/png" });

function completedExtraction() {
  return Response.json({
    status: "completed",
    output: [
      { type: "image_generation_call", status: "completed", result: Buffer.from(cutoutPng).toString("base64") },
      {
        type: "message", role: "assistant", status: "completed",
        content: [{
          type: "output_text",
          text: JSON.stringify({
            garments: [{ name: "Test shirt", category: "top", garment_type: "Shirt", color: "Black" }],
          }),
        }],
      },
    ],
  });
}

function outfitExtraction() {
  const data = new Uint8Array(1024 * 1024 * 4);
  for (const [center, red] of [[256, 40], [768, 190]]) {
    for (let y = 460; y < 564; y++) {
      for (let x = center - 52; x < center + 52; x++) {
        data.set([red, 80, 120, 255], (y * 1024 + x) * 4);
      }
    }
  }
  const garments = [
    { name: "Cotton shirt", category: "top", garment_type: "Shirt", color: "White" },
    { name: "Linen trousers", category: "bottom", garment_type: "Trousers", color: "Brown" },
  ];
  return Response.json({
    status: "completed",
    output: [
      { type: "image_generation_call", status: "completed", result: Buffer.from(encode({ width: 1024, height: 1024, data })).toString("base64") },
      { type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify({ garments }) }] },
    ],
  });
}

function connectBrowserToWardrobe(t, env, providerResponse = completedExtraction) {
  env.OPENAI_API_KEY = "fixture-key";
  let appRequests = 0;
  let providerRequests = 0;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (url === "/api/wardrobe/upload") {
      appRequests++;
      assert.equal(init.method, "POST");
      return wardrobeApi(new Request("https://wardrobe.example" + url, init), env, 1);
    }
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(init.method, "POST");
    const sent = JSON.parse(init.body);
    assert.equal(sent.model, "gpt-6-luna");
    assert.equal(sent.input[0].content.filter(({ type }) => type === "input_image").length, 1);
    providerRequests++;
    return providerResponse(providerRequests);
  });
  return () => [appRequests, providerRequests];
}

test("one client upload POST runs one provider request, then returns a private unconfirmed cutout draft", async (t) => {
  const { env, files, send, sqlite } = fixture(t);
  const calls = connectBrowserToWardrobe(t, env);
  const key = crypto.randomUUID();
  const response = await requestWardrobeUpload(key, testPhoto);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const result = await response.json();
  assert.equal(result.extraction.status, "ready");
  const { item, source } = result.extraction;
  assert.equal(item.id, result.id);
  assert.equal(source, "luna");
  assert.equal(item.name, "Test shirt");
  assert.equal(item.category, "top");
  assert.equal(item.garmentType, "Shirt");
  assert.equal(item.color, "Black");
  assert.match(item.imageFileId, /^private\/1\//);
  assert.deepEqual([...files.keys()], [item.imageFileId]);
  assert.deepEqual(files.get(item.imageFileId).body, cutoutPng);
  assert.equal(sqlite.prepare("SELECT confirmed_at FROM wardrobe_items").get().confirmed_at, null);
  assert.deepEqual(calls(), [1, 1]);

  assert.deepEqual(await (await requestWardrobeUpload(key, testPhoto)).json(), result);
  assert.deepEqual(await (await requestWardrobeUpload(key)).json(), result);
  assert.deepEqual(calls(), [3, 1]);
  assert.equal(sqlite.prepare("SELECT count(*) AS count FROM wardrobe_items").get().count, 1);
  assert.equal((await send(key, 2, null)).status, 404);
  assert.equal((await send(crypto.randomUUID(), 1, null)).status, 404);
  assert.deepEqual(calls(), [3, 1]);
});

test("when extraction fails, one POST returns the existing private draft for review and a key-only retry can recover", async (t) => {
  const { env, files, send, sqlite } = fixture(t);
  const calls = connectBrowserToWardrobe(t, env, (n) =>
    n === 1 ? Response.json({ error: { code: "provider_failure" } }, { status: 500 }) : completedExtraction());
  const key = crypto.randomUUID();
  const response = await requestWardrobeUpload(key, testPhoto);
  assert.equal(response.status, 200);
  const failed = await response.json();
  assert.deepEqual(failed.extraction, { status: "manual", code: "extraction_failed" });
  const row = sqlite.prepare("SELECT * FROM wardrobe_items").get();
  assert.equal(row.id, failed.id);
  assert.equal(row.confirmed_at, null);
  assert.equal(row.name, "Untitled garment");
  assert.deepEqual(files.get(row.image_file_id).body, photoPng);
  assert.deepEqual(calls(), [1, 1]);
  assert.equal((await send(key, 2, null)).status, 404);

  const retry = await requestWardrobeUpload(key);
  const recovered = await retry.json();
  assert.equal(retry.status, 200);
  assert.equal(recovered.id, failed.id);
  assert.equal(recovered.extraction.status, "ready");
  assert.deepEqual([...files.keys()], [recovered.extraction.item.imageFileId]);
  assert.deepEqual(calls(), [2, 2]);
  assert.equal(sqlite.prepare("SELECT count(*) AS count FROM wardrobe_items").get().count, 1);
});

test("retry does not resurrect an archived draft or extract an already confirmed manual item", async (t) => {
  const { send, sqlite } = fixture(t);
  const provider = t.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected fetch"); });
  const key = crypto.randomUUID();
  const response = await send(key, 1, photoPng);
  const { id } = await response.json();
  sqlite.prepare("UPDATE wardrobe_items SET confirmed_at = 'now' WHERE id = ?").run(id);
  const confirmed = await send(key, 1, null);
  assert.equal(confirmed.status, 409);
  assert.equal((await confirmed.json()).code, "draft_changed");

  sqlite.prepare("UPDATE wardrobe_items SET archived_at = 'now' WHERE id = ?").run(id);
  assert.equal((await send(key, 1, photoPng)).status, 404);
  assert.equal(sqlite.prepare("SELECT count(*) AS count FROM wardrobe_items").get().count, 1);
  assert.equal(provider.mock.callCount(), 0);
});

function postBatch(env, entries, userId = 1) {
  const form = new FormData();
  form.set("batch", JSON.stringify(entries.map(({ key }) => key)));
  for (const { key, photo } of entries) {
    if (photo) form.set("image:" + key, photo);
  }
  return wardrobeApi(new Request("https://wardrobe.example/api/wardrobe/upload", { method: "POST", body: form }), env, userId);
}

test("extracts a full-resolution portrait JPEG on upload and on a key-only retry of a saved draft", async (t) => {
  const { env, sqlite } = fixture(t);
  const jpeg = await sharp({
    create: { width: 4032, height: 3024, channels: 3, background: "navy" },
  }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const photo = new File([jpeg], "image.jpg", { type: "image/jpeg" });
  const savedKey = crypto.randomUUID();
  env.OPENAI_API_KEY = "fixture-key";
  const provider = t.mock.method(globalThis, "fetch", (_url, init) => {
    const content = JSON.parse(init.body).input[0].content;
    const { image_url } = content.find(({ type }) => type === "input_image");
    const input = decode(Buffer.from(image_url.split(",")[1], "base64"));
    assert.deepEqual([input.width, input.height], [768, 1024]);
    return completedExtraction();
  });
  const { items: [saved] } = await (await postBatch(env, [{ key: savedKey, photo }])).json();
  assert.deepEqual(saved.extraction, { status: "manual", code: "unsupported_photo" });
  assert.equal(provider.mock.callCount(), 0);

  env.normalizeWardrobePhoto = normalizeWardrobePhoto;

  const { items: [retried] } = await (await postBatch(env, [{ key: savedKey }])).json();
  assert.equal(retried.id, saved.id);
  assert.equal(retried.extraction.status, "ready");
  const { items: [fresh] } = await (await postBatch(env, [{ key: crypto.randomUUID(), photo }])).json();
  assert.equal(fresh.extraction.status, "ready");
  assert.equal(provider.mock.callCount(), 2);
  assert.equal(sqlite.prepare("SELECT count(*) AS count FROM wardrobe_items").get().count, 2);
});

function responseSheet(count, { gapBleed = false, blankSlot, duplicateSlot = false } = {}) {
  const grid = sheetGrid(count);
  const data = new Uint8Array(grid.width * grid.height * 4);
  const slots = [];
  for (let i = 0; i < count; i++) {
    const red = 32 + i;
    const top = Math.floor(i / grid.columns) * grid.tile + Math.floor(grid.tile / 2) - 32;
    const left = (i % grid.columns) * grid.tile + Math.floor(grid.tile / 2) - 32;
    if (i !== blankSlot) {
      for (let y = 0; y < 64; y++) {
        for (let x = 0; x < 64; x++) data.set([red, 64, 128, 255], ((top + y) * grid.width + left + x) * 4);
      }
    }
    slots.unshift({
      slot: duplicateSlot && i === 1 ? 1 : i + 1,
      garments: [{ name: `Shirt ${i + 1}`, category: "top", garment_type: "Shirt", color: "Blue" }],
    });
  }
  if (gapBleed) data[3] = 255;
  const bytes = encode({ width: grid.width, height: grid.height, data });
  return Response.json({
    status: "completed",
    output: [
      { type: "image_generation_call", status: "completed", result: Buffer.from(bytes).toString("base64") },
      { type: "message", role: "assistant", status: "completed", content: [{
        type: "output_text", text: JSON.stringify({ slots }),
      }] },
    ],
  });
}

test("a 20-photo multipart upload makes one live-style Responses request and stores matched private drafts", async (t) => {
  const { env, files, sqlite } = fixture(t);
  env.OPENAI_API_KEY = "mock-key";
  const entries = Array.from({ length: 20 }, () => ({ key: crypto.randomUUID(), photo: testPhoto }));
  const grid = sheetGrid(20);
  const provider = t.mock.method(globalThis, "fetch", (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    const sent = JSON.parse(init.body);
    assert.equal(sent.model, "gpt-6-luna");
    assert.deepEqual(sent.reasoning, { effort: "high" });
    assert.equal(sent.service_tier, "fast");
    assert.equal(sent.store, false);
    assert.equal(sent.max_tool_calls, 1);
    assert.equal(sent.tools[0].size, `${grid.width}x${grid.height}`);
    const image = sent.input[0].content.find(({ type }) => type === "input_image");
    const input = decode(Buffer.from(image.image_url.split(",")[1], "base64"));
    assert.equal(input.width, grid.width);
    assert.equal(input.height, grid.height);
    assert.equal(sent.text.format.schema.properties.slots.items.properties.slot.enum.length, 20);
    return responseSheet(20);
  });
  const response = await postBatch(env, entries);
  assert.equal(response.status, 200);
  const { items } = await response.json();
  assert.equal(items.length, 20);
  for (const [i, item] of items.entries()) {
    assert.equal(item.draftKey, entries[i].key);
    assert.equal(item.extraction.status, "ready");
    assert.equal(item.extraction.item.name, `Shirt ${i + 1}`);
    const file = decode(files.get(item.extraction.item.imageFileId).body);
    assert.equal(file.data[(Math.floor(file.height / 2) * file.width + Math.floor(file.width / 2)) * 4], 32 + i);
    assert.equal(file.data[3], 0);
  }
  assert.equal(files.size, 20);
  assert.equal(sqlite.prepare("SELECT count(*) AS count FROM wardrobe_items WHERE confirmed_at IS NULL").get().count, 20);
  assert.equal(provider.mock.callCount(), 1);

  const repeated = await (await postBatch(env, entries.map(({ key }) => ({ key })))).json();
  assert.deepEqual(repeated.items, items);
  assert.equal(provider.mock.callCount(), 1);
  const foreign = await (await postBatch(env, entries.map(({ key }) => ({ key })), 2)).json();
  assert.ok(foreign.items.every(({ status, id }) => status === 404 && !id));
});

test("an empty cutout slot keeps that original and retry uses the same draft without re-uploading", async (t) => {
  const { env, files, sqlite } = fixture(t);
  env.OPENAI_API_KEY = "mock-key";
  let calls = 0;
  const provider = t.mock.method(globalThis, "fetch", (url, init) => {
    const size = JSON.parse(init.body).tools[0].size;
    assert.equal(size, calls === 0 ? "1216x608" : "1024x1024");
    return calls++ === 0 ? responseSheet(2, { blankSlot: 0 }) : completedExtraction();
  });
  const entries = Array.from({ length: 2 }, () => ({ key: crypto.randomUUID(), photo: testPhoto }));
  const { items } = await (await postBatch(env, entries)).json();
  assert.equal(items[0].extraction.status, "manual");
  assert.equal(items[1].extraction.status, "ready");
  const originalId = sqlite.prepare("SELECT image_file_id FROM wardrobe_items WHERE id = ?").get(items[0].id).image_file_id;
  assert.deepEqual(files.get(originalId).body, photoPng);
  const retried = await (await postBatch(env, [{ key: entries[0].key }])).json();
  assert.equal(retried.items[0].id, items[0].id);
  assert.equal(retried.items[0].extraction.status, "ready");
  assert.equal(provider.mock.callCount(), 2);
});

for (const malformed of [{ gapBleed: true }, { duplicateSlot: true }]) {
  test("ambiguous batch sheet or metadata leaves the originals safely in manual review " + Object.keys(malformed)[0], async (t) => {
    const { env, files } = fixture(t);
    env.OPENAI_API_KEY = "mock-key";
    t.mock.method(console, "warn", () => {});
    const provider = t.mock.method(globalThis, "fetch", () => responseSheet(2, malformed));
    const entries = Array.from({ length: 2 }, () => ({ key: crypto.randomUUID(), photo: testPhoto }));
    const { items } = await (await postBatch(env, entries)).json();
    assert.ok(items.every((item) => item.extraction.status === "manual"));
    assert.equal(files.size, 2);
    for (const { body } of files.values()) assert.deepEqual(body, photoPng);
    assert.equal(provider.mock.callCount(), 1);
  });
}

test("rejects more than 20 photos, duplicate keys, and oversized batch data before creating drafts", async (t) => {
  const { env, files, sqlite } = fixture(t);
  const tooMany = Array.from({ length: 21 }, () => ({ key: crypto.randomUUID(), photo: testPhoto }));
  assert.equal((await postBatch(env, tooMany)).status, 400);
  const [one] = tooMany;
  assert.equal((await postBatch(env, [one, { ...one, key: one.key.toUpperCase() }])).status, 400);
  assert.equal((await postBatch(env, [{
    ...one, photo: new File([new Uint8Array(3_950_001)], "oversized.jpg", { type: "image/jpeg" }),
  }])).status, 413);
  assert.equal(sqlite.prepare("SELECT count(*) AS count FROM wardrobe_items").get().count, 0);
  assert.equal(files.size, 0);
});

test("concurrent extraction of one outfit stores independently reviewable garments and replays their current state", async (t) => {
  const { env, files, send, sqlite } = fixture(t);
  const key = crypto.randomUUID();
  const { id } = await (await send(key, 1, photoPng)).json();
  env.OPENAI_API_KEY = "mock-key";
  const original = sqlite.prepare("SELECT image_file_id FROM wardrobe_items WHERE id = ?").get(id).image_file_id;
  const both = Promise.withResolvers();
  let requests = 0;
  const provider = t.mock.method(globalThis, "fetch", async () => {
    if (++requests === 2) both.resolve();
    await both.promise;
    return outfitExtraction();
  });
  const [first, second] = await Promise.all([send(key, 1, null), send(key, 1, null)]);
  const result = await first.json();
  assert.equal(result.extraction.status, "ready");
  assert.deepEqual(await second.json(), result);
  const { items } = result.extraction;
  assert.deepEqual(items.map((item) => item.name), ["Cotton shirt", "Linen trousers"]);
  assert.deepEqual(result.extraction.item, items[0]);
  assert.equal(items[0].id, id);
  assert.notEqual(items[0].id, items[1].id);
  assert.notEqual(items[0].imageFileId, items[1].imageFileId);
  assert.equal(files.size, 2);
  assert.equal(files.has(original), false);
  assert.deepEqual(items.map((item) => {
    const png = decode(files.get(item.imageFileId).body);
    return png.data[(Math.floor(png.height / 2) * png.width + Math.floor(png.width / 2)) * 4];
  }), [40, 190]);
  const itemUrl = "https://wardrobe.example/api/wardrobe/items/";
  const updated = await wardrobeApi(new Request(itemUrl + items[1].id, {
    method: "PATCH", body: JSON.stringify({ name: "Travel trousers", confirm: true }),
  }), env, 1);
  assert.equal(updated.status, 200);
  const deletion = { method: "DELETE", body: JSON.stringify({ savedLookIds: [] }) };
  assert.equal((await wardrobeApi(new Request(itemUrl + id, deletion), env, 1)).status, 204);
  const surviving = await (await send(key, 1, photoPng)).json();
  assert.equal(surviving.id, items[1].id);
  assert.deepEqual(surviving.extraction.items, [{ ...items[1], name: "Travel trousers" }]);
  assert.equal((await send(key, 2, null)).status, 404);
  assert.equal((await wardrobeApi(new Request(itemUrl + items[1].id, deletion), env, 1)).status, 204);
  assert.equal((await send(key, 1, null)).status, 404);
  assert.equal(provider.mock.callCount(), 2);
});

test("a failed sibling insert leaves the original private photo available for a complete retry", async (t) => {
  const { env, files, send, sqlite } = fixture(t);
  env.OPENAI_API_KEY = "mock-key";
  t.mock.method(globalThis, "fetch", outfitExtraction);
  t.mock.method(console, "warn", () => {});
  sqlite.exec(`
    CREATE TRIGGER reject_sibling BEFORE INSERT ON wardrobe_items
    WHEN NEW.name = 'Linen trousers' BEGIN SELECT RAISE(ABORT, 'write interrupted'); END;
  `);
  const key = crypto.randomUUID();
  const failed = await (await send(key, 1, photoPng)).json();
  assert.equal(failed.extraction.status, "manual");
  const rows = sqlite.prepare("SELECT name, image_file_id, extraction_source FROM wardrobe_items").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "Untitled garment");
  assert.equal(rows[0].extraction_source, null);
  assert.deepEqual([...files.keys()], [rows[0].image_file_id]);
  assert.deepEqual(files.get(rows[0].image_file_id).body, photoPng);
  sqlite.exec("DROP TRIGGER reject_sibling");
  const recovered = await (await send(key, 1, null)).json();
  assert.equal(recovered.id, failed.id);
  assert.equal(recovered.extraction.status, "ready");
  assert.equal(recovered.extraction.items.length, 2);
  assert.equal(files.size, 2);
});
