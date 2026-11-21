import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { privateImage } from "../wardrobe-files.mjs";
import { profile } from "./profile.mjs";

const testOrigin = "https://wardrobe.example";
const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0xd9);

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  for (const migration of ["0000_stylist.sql", "0003_profile_photo_cleanup.sql"]) {
    sqlite.exec(readFileSync(new URL(`../../drizzle/${migration}`, import.meta.url), "utf8"));
  }
  sqlite.exec(`
    INSERT INTO users (id, auth_provider, auth_subject) VALUES (1, 'google', 'first'), (2, 'google', 'second');
  `);

  const DB = {
    prepare(sql) {
      return {
        bind(...args) {
          const statement = sqlite.prepare(sql);
          return {
            first: async () => statement.get(...args),
            all: async () => ({ results: statement.all(...args) }),
            run: async () => ({ meta: statement.run(...args) }),
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
      files.set(key, { body, httpMetadata });
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
  };
}

async function update(api, patch, userId) {
  return api.send("/api/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }, userId);
}

function upload(api, bytes = jpeg) {
  const form = new FormData();
  form.set("image", new Blob([bytes], { type: "image/jpeg" }), "face.jpg");
  return api.send("/api/profile/photo", { method: "PUT", body: form });
}

test("profile supports partial updates, optional completion, and private accounts", async (t) => {
  const api = fixture();
  t.after(api.close);

  const initial = { heightCm: null, weightKg: null, styles: [], facePhotoUrl: null, setupCompletedAt: null };
  assert.deepEqual(await (await api.send("/api/profile")).json(), initial);
  const response = await update(api, { complete: true });
  assert.equal(response.status, 200);
  const { setupCompletedAt } = await response.json();
  assert.ok(Number.isFinite(Date.parse(setupCompletedAt)));

  const updated = await update(api, { heightCm: 160.5, weightKg: 55, styles: [" casual ", "minimal", "casual"] });
  assert.deepEqual(await updated.json(), { ...initial, setupCompletedAt, heightCm: 160.5, weightKg: 55, styles: ["casual", "minimal"] });
  assert.equal((await update(api, { heightCm: 0, weightKg: null })).status, 400);
  assert.equal((await update(api, { facePhotoUrl: "https://example.com/fake" })).status, 400);
  assert.equal((await update(api, { styles: [42] })).status, 400);
  const cleared = await update(api, { weightKg: null, styles: null, complete: true });
  assert.deepEqual(await cleared.json(), { ...initial, setupCompletedAt, heightCm: 160.5 });
  assert.deepEqual(await (await api.send("/api/profile", {}, 2)).json(), initial);
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
  const imageRequest = new Request(testOrigin + firstUrl);
  assert.equal((await privateImage(imageRequest, api.env, 1)).status, 200);
  assert.equal((await privateImage(imageRequest, api.env, 2)).status, 404);

  api.env.BUCKET.failPut = true;
  assert.equal((await upload(api)).status, 503);
  assert.equal(api.files.size, 1);
  assert.equal((await (await api.send("/api/profile")).json()).facePhotoUrl, firstUrl);
  api.env.BUCKET.failPut = false;

  const replaced = await upload(api);
  assert.equal(replaced.status, 200);
  const newUrl = (await replaced.json()).facePhotoUrl;
  assert.notEqual(newUrl, firstUrl);
  assert.equal(api.files.size, 1);
  assert.equal((await privateImage(imageRequest, api.env, 1)).status, 404);

  api.env.BUCKET.failDelete = true;
  const stopped = await api.send("/api/profile/photo", { method: "DELETE" });
  assert.equal(stopped.status, 503);
  assert.equal((await privateImage(new Request(testOrigin + newUrl), api.env, 1)).status, 404);
  assert.equal(api.files.size, 1);
  api.env.BUCKET.failDelete = false;

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
