import assert from "node:assert/strict";
import test from "node:test";
import { allocateImageBudgets, maxBatchImageBytes, prepareWardrobeBatch } from "./prepare-batch.mjs";

const file = (bytes, name = "shirt.jpg", type = "image/jpeg") => new File([new Uint8Array(bytes)], name, { type });

test("rebalances the budget without shrinking photos that already fit", () => {
  assert.deepEqual(allocateImageBudgets([100, 10, 100, 0], 111), [50, 10, 51, 0]);
});

test("rejects an oversized selection without silently dropping any photos", async () => {
  await assert.rejects(prepareWardrobeBatch(Array.from({ length: 21 }, (_, index) => ({
    draftKey: String(index), id: null, file: file(1),
  }))), /between 1 and 20/);
});

test("compresses an oversized batch once, preserves all keys and omits image for saved drafts", async (t) => {
  let closed = 0;
  const bitmap = { width: 3000, height: 2000, close: () => closed++ };
  t.mock.method(globalThis, "createImageBitmap", async () => bitmap);
  t.mock.method(globalThis.document, "createElement", () => ({
    getContext: () => ({ fillRect() {}, drawImage() {} }),
    toBlob(resolve, type, quality) {
      assert.equal(type, "image/jpeg");
      assert.equal(quality, 0.87);
      assert.equal(this.width, 1024);
      assert.equal(this.height, 683);
      resolve(new Blob([new Uint8Array(190_000)], { type }));
    },
  }));
  const input = Array.from({ length: 19 }, (_, index) => ({
    draftKey: String(index), id: null, file: file(400_000),
  })).concat({ draftKey: "saved", id: 42, file: file(1) });
  const output = await prepareWardrobeBatch(input);
  assert.equal(output.length, input.length);
  assert.deepEqual(output.map(({ draftKey }) => draftKey), input.map(({ draftKey }) => draftKey));
  assert.equal(output.at(-1).image, undefined);
  assert.equal(closed, 19);
  assert.ok(output.reduce((sum, { image }) => sum + (image?.size ?? 0), 0) <= maxBatchImageBytes);
});

test("a failed local decode rejects the entire batch with the offending file identified", async (t) => {
  t.mock.method(globalThis, "createImageBitmap", async () => { throw new Error("not an image"); });
  const input = [
    { draftKey: "ok", id: null, file: file(1) },
    { draftKey: "bad", id: null, file: file(1, "broken.webp", "image/webp") },
  ];
  await assert.rejects(prepareWardrobeBatch(input), /broken\.webp.*No photos were sent/);
});

globalThis.createImageBitmap = async () => { throw new Error("No bitmap mock"); };
globalThis.document = { createElement() { throw new Error("No canvas mock"); } };
