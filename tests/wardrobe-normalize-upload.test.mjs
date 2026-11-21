import assert from "node:assert/strict";
import test from "node:test";
import { normalizeUpload } from "../src/app/wardrobe/add/normalize-upload.mjs";

test("JPEG and PNG are preserved", async () => {
  for (const type of ["image/jpeg", "image/png"]) {
    const file = new File(["unchanged"], "wardrobe", { type });
    assert.equal(await normalizeUpload(file), file);
  }
});

test("WebP becomes a capped PNG using the browser's canvas and releases the bitmap", async (t) => {
  const bitmap = { width: 2048, height: 1024, close: () => { bitmap.closed = true; } };
  const file = new File(["WebP"], "wardrobe.WEBP", { type: "image/webp" });
  const canvas = { getContext(type) {
    assert.equal(type, "2d");
    return { drawImage(source, ...rect) { assert.equal(source, bitmap); assert.deepEqual(rect, [0, 0, 1024, 512]); } };
  }, toBlob(resolve, type) { assert.equal(type, "image/png"); resolve(new Blob(["png"], { type })); } };
  t.mock.method(globalThis, "createImageBitmap", async () => bitmap);
  t.mock.method(globalThis.document, "createElement", () => canvas);
  const image = await normalizeUpload(file);
  assert.equal(image.type, "image/png");
  assert.equal(image.name, "wardrobe.png");
  assert.equal(canvas.width, 1024);
  assert.equal(canvas.height, 512);
  assert.equal(bitmap.closed, true);
});

test("unavailable canvas fails explicitly and releases the bitmap", async (t) => {
  const bitmap = { width: 8, height: 8, close: () => { bitmap.closed = true; } };
  t.mock.method(globalThis, "createImageBitmap", async () => bitmap);
  t.mock.method(globalThis.document, "createElement", () => ({ getContext: () => null }));
  await assert.rejects(normalizeUpload(new File(["WebP"], "wardrobe.webp", { type: "image/webp" })), /Image conversion unavailable/);
  assert.equal(bitmap.closed, true);
});

// Node lacks the browser objects; test the exact conversion code with minimal mocks.
globalThis.createImageBitmap = async () => { throw new Error("No bitmap mock"); };
globalThis.document = { createElement() { throw new Error("No canvas mock"); } };
