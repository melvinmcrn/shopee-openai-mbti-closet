import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { servePrivateFile } from "../private-files.mjs";
import { profile } from "./profile.mjs";

const testOrigin = "https://wardrobe.example";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNwal7/HwAE8wJ0QEPG5gAAAABJRU5ErkJggg==", "base64");
const truncatedJpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0xd9);

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  for (const migration of ["0000_stylist.sql", "0001_private_files.sql", "0002_private_file_expiry.sql"]) {
    sqlite.exec(readFileSync(new URL(`../../../../../drizzle/${migration}`, import.meta.url), "utf8"));
  }
  sqlite.exec(`
    INSERT INTO users (id, auth_provider, auth_subject) VALUES (1, 'google', 'first'), (2, 'google', 'second');
  `);

  const DB = {
    failAttachment: false,
    prepare(sql) {
      return {
        bind(...args) {
          const statement = sqlite.prepare(sql);
          return {
            first: async () => statement.get(...args),
            all: async () => ({ results: statement.all(...args) }),
            async run() {
              if (DB.failAttachment && sql.includes("INSERT INTO profiles (user_id, face_photo_file_id)")) {
                throw new Error("Profile update failed.");
              }
              return statement.columns().length > 0
                ? { results: statement.all(...args) }
                : { meta: statement.run(...args) };
            },
          };
        },
      };
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (cause) {
        sqlite.exec("ROLLBACK");
        throw cause;
      }
    },
  };

  const files = new Map();
  const BUCKET = {
    failDelete: false,
    failPut: false,
    async put(key, body, { httpMetadata }) {
      files.set(key, { body, httpMetadata, size: body.byteLength, arrayBuffer: () => new Blob([body]).arrayBuffer() });
      if (this.failPut) throw new Error("Block acknowledgement failed.");
    },
    async get(key) {
      return files.get(key);
    },
    async delete(key) {
      if (this.failDelete) throw new Error("Storage is temporarily unavailable.");
      files.delete(key);
    },
  };
  const env = { DB, BUCKET };
  return {
    env,
    files,
    close: () => sqlite.close(),
    async send(path, init, userId = 1) {
      return profile(new Request(testOrigin + path, init), env, userId);
    },
    readImage(path, userId) {
      assert.ok(path.startsWith("/api/files/"));
      return servePrivateFile(new Request(testOrigin + path), env, { id: userId }, path.slice("/api/files/".length));
    },
  };
}

async function update(api, patch, userId) {
  return api.send("/api/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }, userId);
}

function upload(api, bytes = png, userId = 1) {
  const form = new FormData();
  form.set("image", new Blob([bytes], { type: "image/png" }), "face.png");
  return api.send("/api/profile/photo", { method: "PUT", body: form }, userId);
}

test("new setup can complete without a photo or measurements", async (t) => {
  const api = fixture();
  t.after(api.close);

  const initial = { heightCm: null, weightKg: null, styles: [], facePhotoUrl: null, setupCompletedAt: null };
  assert.deepEqual(await (await api.send("/api/profile")).json(), initial);
  assert.equal((await upload(api, png, 2)).status, 200);
  assert.equal((await upload(api, truncatedJpeg)).status, 415);
  assert.equal((await upload(api, png.subarray(0, -12))).status, 415);
  const response = await update(api, { complete: true });
  assert.equal(response.status, 200);
  const { setupCompletedAt } = await response.json();
  assert.ok(Number.isFinite(Date.parse(setupCompletedAt)));
  const completed = { ...initial, setupCompletedAt };
  assert.deepEqual(await (await api.send("/api/profile")).json(), completed);

  const updated = await update(api, { heightCm: 160.5, weightKg: 55, styles: [" casual ", "minimal", "casual"] });
  assert.deepEqual(await updated.json(), { ...completed, heightCm: 160.5, weightKg: 55, styles: ["casual", "minimal"] });
  assert.equal((await update(api, { heightCm: 0, weightKg: null })).status, 400);
  assert.equal((await update(api, { facePhotoUrl: "https://example.com/fake" })).status, 400);
  assert.equal((await update(api, { styles: [42] })).status, 400);
  const cleared = await update(api, { weightKg: null, styles: ["moody"], complete: true });
  assert.deepEqual(await cleared.json(), { ...completed, styles: ["moody"], heightCm: 160.5 });
  const other = await (await api.send("/api/profile", {}, 2)).json();
  assert.ok(other.facePhotoUrl);
  assert.deepEqual(other, { ...initial, facePhotoUrl: other.facePhotoUrl });
});

test("completing after removing a photo works and preserves a returning account’s completion date", async (t) => {
  const api = fixture();
  t.after(api.close);
  assert.equal((await upload(api)).status, 200);
  const removed = await update(api, { complete: true, facePhotoUrl: null });
  assert.equal(removed.status, 200);
  assert.equal((await removed.json()).facePhotoUrl, null);
  assert.equal(api.files.size, 0);

  const legacyDate = "2026-11-21T00:00:00.000Z";
  await api.env.DB.prepare("INSERT INTO profiles (user_id, setup_completed_at) VALUES (?, ?)").bind(2, legacyDate).run();
  const returning = await update(api, { complete: true }, 2);
  assert.equal(returning.status, 200);
  assert.equal((await returning.json()).setupCompletedAt, legacyDate);
});

test("photo uploads replace old bytes and revocation is immediate even when cleanup needs a retry", async (t) => {
  const api = fixture();
  t.after(api.close);
  assert.equal((await upload(api, Uint8Array.of(1, 2, 3))).status, 415);
  assert.equal(api.files.size, 0);

  const first = await upload(api);
  assert.equal(first.status, 200);
  const firstUrl = (await first.json()).facePhotoUrl;
  assert.ok(firstUrl);
  assert.equal((await api.readImage(firstUrl, 1)).status, 200);
  assert.equal((await api.readImage(firstUrl, 2)).status, 404);

  api.env.BUCKET.failPut = true;
  assert.equal((await upload(api)).status, 503);
  assert.equal(api.files.size, 1);
  assert.equal((await (await api.send("/api/profile")).json()).facePhotoUrl, firstUrl);
  api.env.BUCKET.failPut = false;

  api.env.DB.failAttachment = true;
  assert.equal((await upload(api)).status, 503);
  assert.equal(api.files.size, 1);
  assert.equal((await (await api.send("/api/profile")).json()).facePhotoUrl, firstUrl);
  api.env.DB.failAttachment = false;

  const replaced = await upload(api);
  assert.equal(replaced.status, 200);
  const newUrl = (await replaced.json()).facePhotoUrl;
  assert.notEqual(newUrl, firstUrl);
  assert.equal(api.files.size, 1);
  assert.equal((await api.readImage(firstUrl, 1)).status, 404);

  api.env.BUCKET.failDelete = true;
  const stopped = await api.send("/api/profile/photo", { method: "DELETE" });
  assert.equal(stopped.status, 503);
  assert.equal((await api.readImage(newUrl, 1)).status, 404);
  assert.equal(api.files.size, 1);
  api.env.BUCKET.failDelete = false;
  assert.equal((await api.send("/api/profile", {}, 2)).status, 200);
  assert.equal(api.files.size, 1);

  const cleared = await api.send("/api/profile/photo", { method: "DELETE" });
  assert.equal(cleared.status, 200);
  assert.equal((await cleared.json()).facePhotoUrl, null);
  assert.equal(api.files.size, 0);

  assert.equal((await upload(api)).status, 200);
  const clearedByPatch = await update(api, { facePhotoUrl: null });
  assert.equal(clearedByPatch.status, 200);
  assert.equal((await clearedByPatch.json()).facePhotoUrl, null);
  assert.equal(api.files.size, 0);
});
