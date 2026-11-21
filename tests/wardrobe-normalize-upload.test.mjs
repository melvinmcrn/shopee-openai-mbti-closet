import assert from "node:assert/strict";
import test from "node:test";
import { normalizeUpload } from "../src/app/wardrobe/add/normalize-upload.mjs";

test("JPEG and PNG are preserved", async () => {
  for (const type of ["image/jpeg", "image/png"]) {
    const file = new File(["unchanged"], "wardrobe", { type });
    assert.equal(await normalizeUpload(file), file);
  }
});

test("phone captures become JPEGs for preview and upload, including untyped HEIF files and large Android JPEGs", async (t) => {
  const bitmap = { width: 3000, height: 4000, close() {} };
  const canvas = {
    getContext: () => ({ drawImage() {} }),
    toBlob: (resolve, type) => resolve(new Blob(["encoded"], { type })),
  };
  t.mock.method(globalThis, "createImageBitmap", async () => bitmap);
  t.mock.method(globalThis.document, "createElement", () => canvas);
  for (const file of [
    new File(["capture"], "IMG_1234.HEIC", { type: "image/heic" }),
    new File(["capture"], "IMG_1234.HEIF"),
    new File([new Uint8Array(9 * 1024 * 1024)], "IMG_1234.jpg", { type: "image/jpeg" }),
  ]) {
    const image = await normalizeUpload(file);
    assert.equal(image.type, "image/jpeg");
    assert.equal(image.name, "IMG_1234.jpg");
    assert.deepEqual([canvas.width, canvas.height], [768, 1024]);
    assert.ok(image.size < 8 * 1024 * 1024);
  }
});

test("a JPEG camera file without a MIME type is uploaded as a JPEG", async () => {
  const bytes = new Uint8Array([255, 216, 255, 217]);
  const image = await normalizeUpload(new File([bytes], "capture.JPG"));
  assert.equal(image.type, "image/jpeg");
  assert.deepEqual(new Uint8Array(await image.arrayBuffer()), bytes);
});

test("empty, unsupported and oversized camera selections are rejected", async () => {
  for (const file of [
    new File([], "empty.jpg", { type: "image/jpeg" }),
    new File(["movie"], "video.mp4", { type: "video/mp4" }),
    new File([new Uint8Array(33 * 1024 * 1024)], "large.heic", { type: "image/heic" }),
  ]) {
    await assert.rejects(normalizeUpload(file));
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
