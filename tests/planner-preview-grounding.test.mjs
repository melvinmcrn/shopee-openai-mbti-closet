import assert from "node:assert/strict";
import test from "node:test";
import { generatePreview } from "../src/app/api/_server/planner/preview.mjs";

const jpeg = new Blob([Uint8Array.of(255, 216, 255, 224)], { type: "image/jpeg" });
const dress = { id: 18, name: "Blue midi dress", category: "dress", imageRef: "owned-dress" };
const env = { OPENAI_API_KEY: "test", readSampleImage: async () => new Uint8Array([1]) };

const product = {
  id: "84", title: "Silver pendant necklace", category: "women necklace",
  imageUrl: "https://down-th.img.susercontent.com/file/pendant",
};
const listingBytes = Uint8Array.of(255, 216, 255, 225, 42);

function setup(t, observed) {
  return {
    readImage: async () => jpeg,
    fetch: t.mock.fn(async url => {
      if (url === product.imageUrl) return new Response(listingBytes);
      if (url.endsWith("/images/edits")) return Response.json({ data: [{ b64_json: "/9j/4A==" }] });
      return Response.json({
        status: "completed", output: [{ type: "message", role: "assistant", status: "completed",
          content: [{ type: "output_text", text: JSON.stringify({ visible_items: observed }) }] }],
      });
    }),
    storeImage: t.mock.fn(async () => "verified-photo"),
  };
}

for (const observed of [["item_1", "unlisted"], [], ["uncertain"], ["item_1", "item_1"]]) {
  test("rejects a rendered inventory of " + JSON.stringify(observed), async t => {
    const deps = setup(t, observed);
    const result = await generatePreview(env, 1, [dress], false, deps);
    assert.deepEqual(result, { imageRef: null });
    assert.equal(deps.storeImage.mock.callCount(), 0);
  });
}

test("a missing base garment falls back to source photos without generating filler clothing", async t => {
  const deps = setup(t, []);
  assert.deepEqual(await generatePreview(env, 1, [{ ...dress, category: "top" }], false, deps), { imageRef: null });
  assert.equal(deps.fetch.mock.callCount(), 0);
});

test("the selected catalog listing is rendered and verified against its own image", async t => {
  const deps = setup(t, ["item_2", "item_1"]);
  const result = await generatePreview(env, 1, [dress], false, deps, product);
  assert.deepEqual(result, { imageRef: "verified-photo" });
  const [cdn, edit, audit] = deps.fetch.mock.calls.map(call => call.arguments);
  assert.equal(cdn[0], product.imageUrl);
  assert.equal(cdn[1].redirect, "error");
  assert.equal(new Headers(cdn[1].headers).has("authorization"), false);
  const images = edit[1].body.getAll("image[]");
  assert.equal(images.length, 3);
  assert.deepEqual(new Uint8Array(await images[2].arrayBuffer()), listingBytes);
  const reference = JSON.parse(audit[1].body).input[0].content;
  assert.deepEqual(JSON.parse(reference[2].text), {
    reference: "item_2", source: "catalog", category: product.category, name: product.title,
  });
  assert.equal(reference[3].image_url, "data:image/jpeg;base64," + Buffer.from(listingBytes).toString("base64"));
});

test("a try-on that omits the suggested piece cannot be saved", async t => {
  const deps = setup(t, ["item_1"]);
  const result = await generatePreview(env, 1, [dress], false, deps, product);
  assert.deepEqual(result, { imageRef: null });
  assert.equal(deps.storeImage.mock.callCount(), 0);
});

test("a catalog bottom can complete a wardrobe top for a full-body try-on", async t => {
  const deps = setup(t, ["item_1", "item_2"]);
  const result = await generatePreview(env, 1, [{ ...dress, category: "top" }], false, deps,
    { ...product, category: "business women pants", title: "Linen trousers" });
  assert.deepEqual(result, { imageRef: "verified-photo" });
});

test("an unavailable or untrusted catalog image cannot be replaced by an invented reference", async t => {
  const deps = setup(t, ["item_1", "item_2"]);
  await assert.rejects(generatePreview(env, 1, [dress], false, deps,
    { ...product, imageUrl: "https://example.invalid/listing" }));
  assert.equal(deps.fetch.mock.callCount(), 0);
  assert.equal(deps.storeImage.mock.callCount(), 0);
});
