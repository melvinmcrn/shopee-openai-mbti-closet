import assert from "node:assert/strict";
import test from "node:test";
import { readCatalogPhoto, readWorkerCatalogFallback } from "../src/app/api/_server/catalog-photo.mjs";
import { readLocalCatalogPhoto } from "../server/local-catalog-photo.mjs";
import { createSupabaseBucket } from "../server/supabase-bucket.mjs";
import { createClient } from "@supabase/supabase-js";

const key = "clothes_image_database/b6326a099e743eebc194.jpg";
const name = key.split("/")[1];
const jpeg = Uint8Array.of(255, 216, 255, 224);
const testClient = handle => createClient("https://storage.example.test", "test-only-key", {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: (input, init) => handle(new Request(input, init)) },
});

test("reads only the selected catalog photo using authenticated Supabase Storage", async () => {
  const paths = [];
  const client = testClient(request => {
    assert.equal(request.headers.get("apikey"), "test-only-key");
    paths.push(new URL(request.url).pathname);
    return new Response(jpeg, {headers: {"content-type": "application/octet-stream"}});
  });
  const env = { BUCKET: createSupabaseBucket(client, "closet-private") };
  for (const ref of [key, name]) {
    const image = await readCatalogPhoto(env, ref);
    assert.equal(image.type, "image/jpeg");
    assert.deepEqual(new Uint8Array(await image.arrayBuffer()), jpeg);
  }
  for (const ref of [null, "", "../photo.jpg", "private/1/file.jpg", "clothes_image_database/%2e%2e/photo.jpg",
    "https://example.test/photo.jpg", "nested/file.jpg", name + "\n"]) {
    assert.equal(await readCatalogPhoto(env, ref), null);
  }
  assert.deepEqual(paths, Array(2).fill("/storage/v1/object/closet-private/" + key));
});

test("a missing bucket object can use the exact checked-in catalog image during local testing", async () => {
  const env = { BUCKET: { get: async () => null }, readCatalogFallback: readLocalCatalogPhoto };
  const image = await readCatalogPhoto(env, name);
  assert.equal(image.type, "image/jpeg");
  assert.ok(image.size > 1000);
  assert.equal(await readCatalogPhoto(env, "missing.jpg"), null);
  assert.equal(await readCatalogPhoto({ BUCKET: {get: async () => new Response("wrong type")} }, name), null);
});

test("hosted Worker fallback accepts only the catalog listing's own URL and rejects redirects", async () => {
  const imageUrl = "https://down-th.img.susercontent.com/file/catalog-image_123";
  let storedUrl = imageUrl;
  const env = { DB: { prepare(sql) {
    assert.match(sql, /item_id=\? AND ocr_image=\?/);
    return {bind(id, filename) { return {first: async () => id === "123" && filename === key ? { image_url: storedUrl } : null}; }};
  } } };
  const seen = [];
  const read = async (url, init) => {
    assert.equal(init.redirect, "manual");
    seen.push(url);
    return new Response(jpeg);
  };
  assert.deepEqual(new Uint8Array(await readWorkerCatalogFallback(env, key, "123", read)), jpeg);
  assert.equal(await readWorkerCatalogFallback(env, key, "999", read), null);
  assert.equal(await readWorkerCatalogFallback(env, key, "123", async () => Response.redirect(imageUrl)), null);
  storedUrl = "https://arbitrary.example/file/photo.jpg";
  assert.equal(await readWorkerCatalogFallback(env, key, "123", read), null);
  storedUrl = imageUrl;
  const tooLarge = new Uint8Array(5 * 1024 * 1024 + 1);
  assert.equal(await readWorkerCatalogFallback(env, key, "123", async () => new Response(tooLarge)), null);
  assert.deepEqual(seen, [imageUrl]);
});

test("the local Worker reads checked-in catalog assets through the private binding", async () => {
  const env = { CATALOG_ASSETS: { fetch(url) { assert.equal(url, "https://catalog.local/" + name); return new Response(jpeg); } } };
  assert.deepEqual(new Uint8Array(await readWorkerCatalogFallback(env, key)), jpeg);
});
