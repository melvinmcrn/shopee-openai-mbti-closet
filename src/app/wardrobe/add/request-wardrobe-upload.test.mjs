import assert from "node:assert/strict";
import test from "node:test";
import { requestWardrobeUpload, requestWardrobeUploadBatch } from "./request-wardrobe-upload.mjs";

class FakeXHR extends EventTarget {
  upload = new EventTarget();
  static requests = [];
  status = 200;
  response = null;
  open(method, url) {
    this.method = method;
    this.url = url;
    FakeXHR.requests.push(this);
  }
  send(body) {
    this.body = body;
  }
  abort() {
    this.dispatchEvent(new Event("abort"));
  }
  progress(loaded, total) {
    this.upload.dispatchEvent(Object.assign(new Event("progress"), {
      loaded, total, lengthComputable: total > 0,
    }));
  }
}

test("one multipart POST sends every selected photo and switches from byte progress to indeterminate analysis", async (t) => {
  t.mock.property(globalThis, "XMLHttpRequest", FakeXHR);
  FakeXHR.requests.length = 0;
  const progress = [];
  const entries = Array.from({ length: 20 }, (_, index) => ({
    draftKey: `draft-${index}`,
    image: new File(["image"], "my-very-long-photo-name.png", { type: "image/png" }),
  }));
  const result = requestWardrobeUploadBatch(entries, (event) => progress.push(event));
  assert.equal(FakeXHR.requests.length, 1);
  const [xhr] = FakeXHR.requests;
  assert.equal(xhr.url, "/api/wardrobe/upload");
  assert.equal(xhr.method, "POST");
  assert.deepEqual(JSON.parse(xhr.body.get("batch")), entries.map(({ draftKey }) => draftKey));
  assert.equal([...xhr.body].length, 21);
  for (const { draftKey } of entries) {
    const file = xhr.body.get(`image:${draftKey}`);
    assert.equal(file.name, `${draftKey}.png`);
    assert.equal(await file.text(), "image");
  }
  xhr.progress(0, 0);
  xhr.progress(25, 100);
  xhr.progress(100, 100);
  xhr.upload.dispatchEvent(new Event("load"));
  xhr.response = { items: entries.map(({ draftKey }) => ({ draftKey, id: 1, extraction: { status: "manual" } })) };
  xhr.dispatchEvent(new Event("load"));
  assert.deepEqual(progress, [
    { phase: "uploading" },
    { phase: "uploading", percent: 25 },
    { phase: "uploading", percent: 100 },
    { phase: "processing" },
  ]);
  assert.deepEqual(await result, { status: 200, body: xhr.response });
});

test("a retry may send only known keys and can be canceled or time out", async (t) => {
  t.mock.property(globalThis, "XMLHttpRequest", FakeXHR);
  FakeXHR.requests.length = 0;
  const entries = [{ draftKey: "already-saved" }];
  const controller = new AbortController();
  const aborted = requestWardrobeUploadBatch(entries, () => {}, controller.signal);
  assert.deepEqual([...FakeXHR.requests[0].body], [["batch", '["already-saved"]']]);
  controller.abort();
  await assert.rejects(aborted, /aborted/);
  const timeout = requestWardrobeUploadBatch(entries, () => {});
  FakeXHR.requests[1].dispatchEvent(new Event("timeout"));
  await assert.rejects(timeout, /timed out/);
});

test("legacy single-photo helper still posts the original multipart format", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => ({ ok: true }));
  const image = new File(["image"], "photo.png", { type: "image/png" });
  assert.deepEqual(await requestWardrobeUpload("key", image), { ok: true });
  const [[url, init]] = fetch.mock.calls.map(({ arguments: args }) => args);
  assert.equal(url, "/api/wardrobe/upload");
  assert.equal(init.method, "POST");
  assert.equal(init.body.get("draftKey"), "key");
  assert.equal(init.body.get("image"), image);
});

// Node lacks XHR; restore the stub after each test through mock.property.
globalThis.XMLHttpRequest = class {};
