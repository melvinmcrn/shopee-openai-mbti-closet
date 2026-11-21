import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { encode } from "fast-png";
import { requestWardrobeUpload } from "../../../wardrobe/add/request-wardrobe-upload.mjs";
import { wardrobeApi } from "../wardrobe-api.mjs";

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
            garment_found: true, name: "Test shirt", category: "top", garment_type: "Shirt", color: "Black",
          }),
        }],
      },
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
