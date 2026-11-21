import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { crc32, deflateSync } from "node:zlib";
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
  const migrations = new URL("../../../../../drizzle/", import.meta.url);
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

function fakeLuna(output, png = sampleCutout()) {
  return {
    status: "completed",
    output: [
      { type: "reasoning", summary: [] },
      { type: "image_generation_call", status: "completed", result: Buffer.from(png).toString("base64") },
      { type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(output) }] },
    ],
  };
}

function sampleOutput() {
  return {
    garment_found: true,
    name: "Navy canvas bag",
    category: "accessory",
    garment_type: "Bag",
    color: "Navy",
  };
}

function samplePhoto() {
  const data = new Uint8Array(24 * 24 * 4);
  for (let i = 0; i < data.length; i += 4) data.set([60, 82, 121, 255], i);
  return encode({ width: 24, height: 24, data });
}

function sampleCutout() {
  const data = new Uint8Array(12 * 12 * 4);
  for (let y = 2; y < 10; y++) {
    for (let x = 2; x < 10; x++) data.set([12, 31, 56, 255], (y * 12 + x) * 4);
  }
  data.fill(0, (6 * 12 + 6) * 4, (6 * 12 + 7) * 4);
  return encode({ width: 12, height: 12, data });
}

test("one Luna High Fast response supplies editable metadata and the exact private cutout PNG", async (t) => {
  const cutout = sampleCutout();
  const provider = t.mock.method(globalThis, "fetch", async (url, flags) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(flags.method, "POST");
    assert.equal(flags.redirect, "manual");
    assert.equal(flags.headers.Authorization, "Bearer secret");
    const modelRequest = JSON.parse(flags.body);
    assert.equal(modelRequest.model, "gpt-6-luna");
    assert.deepEqual(modelRequest.reasoning, { effort: "high" });
    assert.equal(modelRequest.service_tier, "fast");
    assert.equal(modelRequest.store, false);
    assert.equal(modelRequest.text.format.strict, true);
    assert.deepEqual(modelRequest.text.format.schema.required, ["garment_found", "name", "category", "garment_type", "color"]);
    assert.equal(modelRequest.max_tool_calls, 1);
    assert.deepEqual(modelRequest.tools, [{
      type: "image_generation",
      model: "gpt-image-2.5-flare",
      action: "edit",
      background: "transparent",
      output_format: "png",
      size: "1024x1024",
      quality: "medium",
    }]);
    const inputImages = modelRequest.input.flatMap(({ content }) => content.filter(({ type }) => type === "input_image"));
    assert.equal(inputImages.length, 1);
    const image = decode(Buffer.from(inputImages[0].image_url.split(",")[1], "base64"));
    assert.equal(image.width, 24);
    assert.deepEqual(pixel(image, [5, 5]), [60, 82, 121, 255]);
    return Response.json(fakeLuna(sampleOutput(), cutout));
  });
  const { run, files, db } = scenario(samplePhoto(), { OPENAI_API_KEY: "secret" });
  const response = await run();
  assert.equal(response.status, 200);
  const { source, item } = await response.json();
  assert.equal(source, "luna");
  assert.equal(item.name, "Navy canvas bag");
  assert.equal(item.category, "accessory");
  assert.equal(item.garmentType, "Bag");
  assert.equal(item.color, "Navy");
  assert.match(item.imageFileId, /^private\/9\/[0-9a-f-]{36}$/);
  assert.equal(item.imageUrl, fileUrl(item.imageFileId));
  assert.equal(db.prepare("SELECT confirmed_at FROM wardrobe_items").get().confirmed_at, null);
  assert.deepEqual([...files.keys()], [item.imageFileId]);
  assert.equal(files.get(item.imageFileId).type, "image/png");
  assert.deepEqual(files.get(item.imageFileId).bytes, cutout);
  const png = decode(cutout);
  assert.deepEqual(pixel(png, [0, 0]), [0, 0, 0, 0]);
  assert.deepEqual(pixel(png, [5, 5]), [12, 31, 56, 255]);
  assert.deepEqual(pixel(png, [6, 6]), [0, 0, 0, 0]);
  assert.deepEqual(await (await run()).json(), { source, item });
  assert.equal((await run(10)).status, 404);
  assert.equal(provider.mock.callCount(), 1);
});

test("accepts phased commentary, reasoning and split text in the final assistant message", async (t) => {
  const full = fakeLuna(sampleOutput());
  const final = full.output[2];
  const json = final.content[0].text;
  final.phase = "final_answer";
  final.content = [
    { type: "output_text", text: json.slice(0, 21) },
    { type: "output_text", text: json.slice(21) },
  ];
  full.output.unshift({
    type: "message", role: "assistant", status: "completed", phase: "commentary",
    content: [{ type: "output_text", text: "I’ll isolate the bag." }],
  });
  full.output.push({ ...full.output[0], phase: null });
  const provider = t.mock.method(globalThis, "fetch", async () => Response.json(full));
  const { run, files } = scenario(samplePhoto(), { OPENAI_API_KEY: "secret" });
  const response = await run();
  assert.equal(response.status, 200);
  const { item } = await response.json();
  assert.equal(item.name, "Navy canvas bag");
  assert.deepEqual(files.get(item.imageFileId).bytes, sampleCutout());
  assert.equal(provider.mock.callCount(), 1);
});

test("accepts the last unlabelled assistant message when the API omits phases", async (t) => {
  const full = fakeLuna(sampleOutput());
  full.output.unshift({
    type: "message", role: "assistant", status: "completed",
    content: [{ type: "output_text", text: "I’ll isolate the bag." }],
  });
  const provider = t.mock.method(globalThis, "fetch", async () => Response.json(full));
  const { run } = scenario(samplePhoto(), { OPENAI_API_KEY: "secret" });
  assert.equal((await run()).status, 200);
  assert.equal(provider.mock.callCount(), 1);
});

function pngChunk(type, body) {
  const chunk = Buffer.alloc(12 + body.length);
  const content = Buffer.concat([Buffer.from(type), Buffer.from(body)]);
  chunk.writeUInt32BE(body.length);
  content.copy(chunk, 4);
  chunk.writeUInt32BE(crc32(content), chunk.length - 4);
  return chunk;
}

function palettePng({ transparency = [0], firstRow = 0x40, extraChunks = [] } = {}) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2);
  header.writeUInt32BE(2, 4);
  header[8] = 1; // Two one-bit indices per row plus row padding.
  header[9] = 3;
  return Buffer.concat([
    sampleCutout().subarray(0, 8),
    pngChunk("IHDR", header),
    pngChunk("PLTE", [255, 255, 255, 12, 31, 56]),
    ...(transparency ? [pngChunk("tRNS", transparency)] : []),
    ...extraChunks,
    pngChunk("IDAT", deflateSync(Uint8Array.of(0, firstRow, 0, 0x80))),
    pngChunk("IEND", []),
  ]);
}

function keyedRgbPng() {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2);
  header.writeUInt32BE(2, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    sampleCutout().subarray(0, 8),
    pngChunk("IHDR", header),
    pngChunk("tRNS", [0, 255, 0, 255, 0, 255]),
    pngChunk("IDAT", deflateSync(Uint8Array.of(0, 255, 255, 255, 12, 31, 56, 0, 12, 31, 56, 255, 255, 255))),
    pngChunk("IEND", []),
  ]);
}

for (const [format, cutout] of [
  ["indexed PNG with a transparent palette entry", palettePng()],
  ["RGB PNG with a transparent color key", keyedRgbPng()],
]) {
  test("stores the exact " + format + " returned by the provider", async (t) => {
    t.mock.method(globalThis, "fetch", async () => Response.json(fakeLuna(sampleOutput(), cutout)));
    const { run, files } = scenario(samplePhoto(), { OPENAI_API_KEY: "secret" });
    const response = await run();
    assert.equal(response.status, 200);
    const { item } = await response.json();
    assert.deepEqual(Buffer.from(files.get(item.imageFileId).bytes), cutout);
  });
}

test("logs one allowlisted stage, HTTP status and request ID without provider content or secrets", async (t) => {
  const full = fakeLuna(sampleOutput());
  const final = full.output[2];
  final.phase = "final_answer";
  final.content = [{ type: "refusal", refusal: "Private provider content" }];
  full.output.unshift({
    ...fakeLuna(sampleOutput()).output[2], phase: "commentary",
  });
  t.mock.method(globalThis, "fetch", async () => Response.json(full, {
    headers: { "x-request-id": "req_TEST123456" },
  }));
  const logger = t.mock.method(console, "warn", () => {});
  const { run, files } = scenario(samplePhoto(), { OPENAI_API_KEY: "secret" });
  const response = await run();
  assert.equal(response.status, 502);
  assert.equal((await response.json()).code, "invalid_extraction");
  assert.deepEqual([...files.keys()], [original]);
  assert.equal(logger.mock.callCount(), 1);
  assert.deepEqual(logger.mock.calls[0].arguments, [
    "Wardrobe extraction upstream",
    { stage: "final_message_refused", status: 200, requestId: "req_TEST123456" },
  ]);
});

test("omits nonconforming request IDs and upstream error details from logs", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json(
    { internal: "private upstream error details" },
    { status: 400, headers: { "x-request-id": "arbitrary sensitive header value" } },
  ));
  const logger = t.mock.method(console, "warn", () => {});
  const { run, files } = scenario(samplePhoto(), { OPENAI_API_KEY: "secret" });
  const response = await run();
  assert.equal(response.status, 502);
  assert.equal((await response.json()).code, "extraction_failed");
  assert.deepEqual([...files.keys()], [original]);
  assert.deepEqual(logger.mock.calls.map((call) => call.arguments), [
    ["Wardrobe extraction upstream", { stage: "provider_http", status: 400 }],
  ]);
});

const withEditedImage = (properties) => {
  const full = fakeLuna(sampleOutput());
  Object.assign(full.output[1], properties);
  return full;
};

for (const [caseName, responseBody] of [
  ["incomplete response", () => ({ ...fakeLuna(sampleOutput()), status: "incomplete" })],
  ["incomplete image", () => withEditedImage({ status: "generating" })],
  ["missing image", () => ({ status: "completed", output: [fakeLuna(sampleOutput()).output[2]] })],
  ["duplicate image", () => {
    const full = fakeLuna(sampleOutput());
    full.output.push(full.output[1]);
    return full;
  }],
  ["image only", () => ({ status: "completed", output: [fakeLuna(sampleOutput()).output[1]] })],
  ["opaque PNG", () => fakeLuna(sampleOutput(), samplePhoto())],
  ["opaque indexed PNG", () => fakeLuna(sampleOutput(), palettePng({ transparency: null }))],
  ["indexed PNG with all entries transparent", () => fakeLuna(sampleOutput(), palettePng({ transparency: [0, 0] }))],
  ["PNG with excessive chunks", () => fakeLuna(sampleOutput(), palettePng({
    extraChunks: Array.from({ length: 4096 }, () => pngChunk("tEXt", [65, 0, 66])),
  }))],
  ["commentary only", () => {
    const full = fakeLuna(sampleOutput());
    full.output[2].phase = "commentary";
    return full;
  }],
  ["empty alpha PNG", () => fakeLuna(sampleOutput(), encode({ width: 12, height: 12, data: new Uint8Array(12 * 12 * 4) }))],
  ["corrupt PNG", () => fakeLuna(sampleOutput(), sampleCutout().subarray(0, 55))],
  ["malformed base64", () => withEditedImage({ result: "not a base64 PNG" })],
  ["oversized image dimensions", () => fakeLuna(sampleOutput(), encode({ width: 1537, height: 1, data: new Uint8Array(1537 * 4) }))],
  ["untrusted extra metadata", () => fakeLuna({ ...sampleOutput(), regions: [] })],
  ["invalid category", () => fakeLuna({ ...sampleOutput(), category: "not a category" })],
  ["empty name", () => fakeLuna({ ...sampleOutput(), name: " " })],
]) {
  test("rejects " + caseName + " and preserves the original draft", async (t) => {
    const logger = t.mock.method(console, "warn", () => {});
    const provider = t.mock.method(globalThis, "fetch", async () => Response.json(responseBody()));
    const { run, files, db } = scenario(samplePhoto(), { OPENAI_API_KEY: "secret" });
    const response = await run();
    assert.equal(response.status, 502);
    assert.equal((await response.json()).code, "invalid_extraction");
    assert.deepEqual([...files.keys()], [original]);
    const row = db.prepare("SELECT name, extraction_source, image_file_id FROM wardrobe_items").get();
    assert.equal(row.name, "Untitled garment");
    assert.equal(row.extraction_source, null);
    assert.equal(row.image_file_id, original);
    assert.equal(provider.mock.callCount(), 1);
    assert.equal(logger.mock.callCount(), 1);
    if (["opaque PNG", "opaque indexed PNG", "empty alpha PNG"].includes(caseName)) {
      assert.deepEqual(logger.mock.calls[0].arguments[1], { stage: "image_alpha", status: 200 });
    }
  });
}

test("reports no garment without inventing metadata or saving a cutout", async (t) => {
  const noGarment = { garment_found: false, name: null, category: null, garment_type: null, color: null };
  const full = fakeLuna(noGarment);
  full.output.splice(1, 1);
  const provider = t.mock.method(globalThis, "fetch", async () => Response.json(full));
  const { run, files } = scenario(samplePhoto(), { OPENAI_API_KEY: "secret" });
  const response = await run();
  assert.equal(response.status, 422);
  assert.equal((await response.json()).code, "garment_not_found");
  assert.deepEqual([...files.keys()], [original]);
  assert.equal(provider.mock.callCount(), 1);
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
