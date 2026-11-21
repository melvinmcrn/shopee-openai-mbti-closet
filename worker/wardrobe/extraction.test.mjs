import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { decode, encode } from "fast-png";
import { retryPrivateFileCleanup } from "../private-files.mjs";
import { fileUrl } from "../wardrobe-files.mjs";
import { extract } from "./extract.mjs";
import { fixtures } from "./extraction-fixtures.mjs";

const original = "private/9/abcde000-0000-4000-8000-000000000000";
const request = () => new Request("https://closet.example/api/wardrobe/items/1/extract", { method: "POST" });
const fixturePhoto = (name) => readFile(new URL("./extraction-fixtures/" + name + ".png", import.meta.url));

function scenario(bytes, config) {
  const db = new DatabaseSync(":memory:");
  const migrations = new URL("../../drizzle/", import.meta.url);
  const filesInOrder = readdirSync(migrations).sort();
  for (const name of ["stylist", "private_files", "private_file_expiry", "wardrobe_extraction"]) {
    const file = filesInOrder.find((entry) => entry.endsWith("_" + name + ".sql"));
    assert.ok(file, "Missing migration for " + name);
    db.exec(readFileSync(new URL(file, migrations), "utf8"));
  }
  db.exec("INSERT INTO users (id, auth_provider, auth_subject) VALUES (9, 'google', 'subject')");
  db.prepare("INSERT INTO private_files (file_id,user_id,state) VALUES (?,9,'ready')").run(original);
  db.prepare("INSERT INTO wardrobe_items (id,user_id,name,category,image_file_id) VALUES (1,9,'Untitled garment','other',?)").run(original);
  const files = new Map([[original, { bytes, type: "image/png" }]]);
  const env = {
    ...config,
    DB: {
      prepare: (sql) => ({
        bind: (...params) => ({
          first: async () => db.prepare(sql).get(...params) ?? null,
          all: async () => ({ results: db.prepare(sql).all(...params) }),
          run: async () => db.prepare(sql).run(...params),
        }),
      }),
    },
    BUCKET: {
      get: async (key) => {
        const file = files.get(key);
        return file && { size: file.bytes.byteLength, arrayBuffer: async () => file.bytes };
      },
      put: async (key, bytes, options) => {
        files.set(key, { bytes, type: options.httpMetadata.contentType });
      },
      delete: async (key) => files.delete(key),
    },
  };
  return { db, env, files, run: (owner = 9) => extract(request(), env, owner, "1") };
}

const fixtureChecks = {
  shirt: { fabric: [[120, 125]], background: [[120, 30]] },
  accessory: { fabric: [[120, 165]], background: [[120, 75]] },
  shoes: { fabric: [[115, 100], [134, 173]], background: [[124, 123]] },
  pants: { fabric: [[92, 160], [148, 160]], background: [[120, 174]] },
};
const pixel = (png, [x, y]) => Array.from(png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 4));

for (const fixture of fixtures) {
  test("extracts the " + fixture.photo + " fixture with private transparent pixels", async () => {
    const bytes = await fixturePhoto(fixture.photo);
    const { run, files, db } = scenario(bytes, { WARDROBE_EXTRACTION_FIXTURES: "1" });
    const response = await run();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    const { item, source } = await response.json();
    assert.equal(source, "fixture");
    assert.equal(item.name, fixture.name);
    assert.equal(item.category, fixture.category);
    assert.equal(item.garmentType, fixture.garment_type);
    assert.equal(item.color, fixture.color);
    assert.equal(item.imageUrl, fileUrl(item.imageFileId));
    assert.match(item.imageFileId, /^private\/9\/[0-9a-f-]{36}$/);
    assert.equal(files.size, 1);
    assert.equal(files.get(item.imageFileId).type, "image/png");
    const draft = db.prepare("SELECT confirmed_at, extraction_source FROM wardrobe_items").get();
    assert.equal(draft.confirmed_at, null);
    assert.equal(draft.extraction_source, "fixture");

    const png = decode(files.get(item.imageFileId).bytes);
    const photo = decode(bytes);
    assert.equal(png.channels, 4);
    const { fabric, background } = fixtureChecks[fixture.photo];
    for (const [x, y] of fabric) {
      const offset = (y * photo.width + x) * 3;
      assert.deepEqual(pixel(png, [x, y]), [...photo.data.subarray(offset, offset + 3), 255]);
    }
    for (const point of [[0, 0], ...background]) assert.deepEqual(pixel(png, point), [0, 0, 0, 0]);

    assert.deepEqual(await (await run()).json(), { source, item });
    assert.equal((await run(10)).status, 404);
  });
}

test("requires explicit fixtures and refuses to classify unknown photos without Luna", async () => {
  const bytes = await fixturePhoto("shirt");
  for (const [photo, config] of [
    [bytes, {}],
    [Uint8Array.from([0x89, 0x50, 0x4e, 0x47]), { WARDROBE_EXTRACTION_FIXTURES: "1" }],
  ]) {
    const { run, files } = scenario(photo, config);
    const response = await run();
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "extraction_unavailable");
    assert.deepEqual([...files.keys()], [original]);
  }
});

function fakeLuna(output) {
  return {
    status: "completed",
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(output) }] }],
  };
}

function sampleOutput() {
  return {
    name: "Navy canvas bag",
    category: "accessory",
    garment_type: "Bag",
    color: "Navy",
    regions: [{
      outer: [{ x: 100, y: 100 }, { x: 900, y: 100 }, { x: 900, y: 900 }, { x: 100, y: 900 }],
      holes: [[{ x: 400, y: 400 }, { x: 600, y: 400 }, { x: 600, y: 600 }, { x: 400, y: 600 }]],
    }],
  };
}

function samplePhoto() {
  const data = new Uint8Array(24 * 24 * 4);
  for (let i = 0; i < data.length; i += 4) data.set([60, 82, 121, 255], i);
  return encode({ width: 24, height: 24, data });
}

test("uses the Luna High Fast vision API and turns returned regions into transparent pixels", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, flags) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(flags.headers.Authorization, "Bearer secret");
    const modelRequest = JSON.parse(flags.body);
    assert.equal(modelRequest.model, "gpt-6-luna");
    assert.deepEqual(modelRequest.reasoning, { effort: "high" });
    assert.equal(modelRequest.service_tier, "fast");
    assert.equal(modelRequest.store, false);
    assert.equal(modelRequest.text.format.strict, true);
    const image = modelRequest.input[0].content[1].image_url;
    assert.equal(decode(Buffer.from(image.split(",")[1], "base64")).width, 24);
    return Response.json(fakeLuna(sampleOutput()));
  });
  const { run, files } = scenario(samplePhoto(), { OPENAI_API_KEY: "secret" });
  const response = await run();
  assert.equal(response.status, 200);
  const { source, item } = await response.json();
  assert.equal(source, "luna");
  assert.equal(item.name, "Navy canvas bag");
  const png = decode(files.get(item.imageFileId).bytes);
  assert.deepEqual(pixel(png, [0, 0]), [0, 0, 0, 0]);
  assert.deepEqual(pixel(png, [5, 5]), [60, 82, 121, 255]);
  assert.deepEqual(pixel(png, [12, 12]), [0, 0, 0, 0]);
  assert.deepEqual([...files.keys()], [item.imageFileId]);
});

test("rejects malformed Luna coordinates and preserves original drafts", async (t) => {
  const output = sampleOutput();
  output.regions[0].outer[0].x = 1100;
  t.mock.method(globalThis, "fetch", async () => Response.json(fakeLuna(output)));
  const { run, files, db } = scenario(samplePhoto(), { OPENAI_API_KEY: "secret" });
  const response = await run();
  assert.equal(response.status, 502);
  assert.equal((await response.json()).code, "invalid_extraction");
  assert.deepEqual([...files.keys()], [original]);
  assert.equal(db.prepare("SELECT name FROM wardrobe_items").get().name, "Untitled garment");
});

test("concurrent runs keep a single consistent cutout", async (t) => {
  let arrived = 0;
  let release;
  const bothArrived = new Promise((resolve) => { release = resolve; });
  t.mock.method(globalThis, "fetch", async () => {
    arrived++;
    if (arrived === 2) release();
    await bothArrived;
    const output = sampleOutput();
    output.name += " " + Math.random();
    return Response.json(fakeLuna(output));
  });
  const { run, files } = scenario(samplePhoto(), { OPENAI_API_KEY: "secret" });
  const responses = await Promise.all([run(), run()]);
  const results = await Promise.all(responses.map((response) => response.json()));
  assert.deepEqual(responses.map((response) => response.status), [200, 200]);
  assert.deepEqual(results[0], results[1]);
  assert.deepEqual([...files.keys()], [results[0].item.imageFileId]);
});

test("unsupported image encodings stay available for manual review", async (t) => {
  const provider = t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected fetch"); });
  const webpHeader = Uint8Array.from("RIFF\0\0\0\0WEBP", (character) => character.charCodeAt(0));
  const { run, files } = scenario(webpHeader, { OPENAI_API_KEY: "secret" });
  assert.equal((await run()).status, 415);
  assert.equal(provider.mock.callCount(), 0);
  assert.deepEqual([...files.keys()], [original]);
});

test("a manual edit during extraction takes precedence", async (t) => {
  const scenarioState = scenario(samplePhoto(), { OPENAI_API_KEY: "secret" });
  t.mock.method(globalThis, "fetch", async () => {
    scenarioState.db.prepare("UPDATE wardrobe_items SET name = 'My bag' WHERE id = 1").run();
    return Response.json(fakeLuna(sampleOutput()));
  });
  const response = await scenarioState.run();
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "draft_changed");
  assert.equal(scenarioState.db.prepare("SELECT name FROM wardrobe_items").get().name, "My bag");
  assert.deepEqual([...scenarioState.files.keys()], [original]);
});

test("detached originals remain queued when object deletion fails", async (t) => {
  const { run, files, db, env } = scenario(await fixturePhoto("shirt"), { WARDROBE_EXTRACTION_FIXTURES: "1" });
  const remove = env.BUCKET.delete;
  let failOnce = true;
  env.BUCKET.delete = async (key) => {
    if (key === original && failOnce) {
      failOnce = false;
      throw new Error("Temporary object storage failure");
    }
    return remove(key);
  };
  t.mock.method(console, "error", () => {});
  const { item } = await (await run()).json();
  assert.equal(db.prepare("SELECT state FROM private_files WHERE file_id = ?").get(original).state, "deleting");
  assert.equal(files.has(original), true);
  await retryPrivateFileCleanup(env, { id: 9 });
  assert.deepEqual([...files.keys()], [item.imageFileId]);
  assert.equal(db.prepare("SELECT state FROM private_files WHERE file_id = ?").get(original), undefined);
});
