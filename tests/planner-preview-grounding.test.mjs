import assert from "node:assert/strict";
import test from "node:test";
import { generatePreview } from "../src/app/api/_server/planner/preview.mjs";

const jpeg = new Blob([Uint8Array.of(255, 216, 255, 224)], { type: "image/jpeg" });
const dress = { id: 18, name: "Blue midi dress", category: "dress", imageRef: "owned-dress" };
const portraitBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNwal7/HwAE8wJ0QEPG5gAAAABJRU5ErkJggg==", "base64");
const portrait = new Blob([portraitBytes], { type: "image/png" });
const env = { OPENAI_API_KEY: "test" };

const product = {
  id: "84", title: "Silver pendant necklace", category: "women necklace",
  imageUrl: "https://down-th.img.susercontent.com/file/pendant", ocrImage: "pendant.jpg",
};
const listingBytes = Uint8Array.of(255, 216, 255, 225, 42);
const top = { ...product, id: "85", title: "Linen tank", category: "women tank top",
  ocrImage: "tank.jpg", imageUrl: "https://down-th.img.susercontent.com/file/tank" };
const pants = { ...product, id: "86", title: "Linen trousers", category: "business women pants",
  ocrImage: "trousers.jpg", imageUrl: "https://down-th.img.susercontent.com/file/trousers" };
const topBytes = Uint8Array.of(255, 216, 255, 225, 43);
const pantsBytes = Uint8Array.of(255, 216, 255, 225, 44);

const catalogImages = new Map([[product.ocrImage, listingBytes], [top.ocrImage, topBytes], [pants.ocrImage, pantsBytes]]);
env.BUCKET = { get: async key => {
  const bytes = catalogImages.get(key.replace(/^clothes_image_database\//, ""));
  return bytes ? new Blob([bytes]) : null;
} };

function setup(t, reply = () => Response.json({ data: [{ b64_json: "/9j/4A==" }] })) {
  return {
    profilePhotoRef: async () => "profile",
    readImage: async ref => ref === "profile" ? portrait : jpeg,
    fetch: t.mock.fn(async url => {
      assert.equal(url, "https://api.openai.com/v1/images/edits");
      return reply();
    }),
    storeImage: t.mock.fn(async () => "rendered-photo"),
  };
}

async function render(t, garments, products = [], base = {}) {
  const deps = setup(t);
  assert.deepEqual(await generatePreview(env, garments, deps, products, base), { imageRef: "rendered-photo" });
  assert.equal(deps.fetch.mock.callCount(), 1);
  assert.equal(deps.storeImage.mock.callCount(), 1);
  const form = deps.fetch.mock.calls[0].arguments[1].body;
  const images = form.getAll("image[]");
  assert.deepEqual(Buffer.from(await images[0].arrayBuffer()), portraitBytes);
  assert.match(form.get("prompt"), /only identity reference. Never substitute a model/);
  assert.match(form.get("prompt"), /Use every selected wardrobe piece and Shopee product exactly once/);
  return { images, prompt: form.get("prompt") };
}

for (const [name, reply] of [
  ["provider failure", () => new Response(null, { status: 503 })],
  ["missing image", () => Response.json({ data: [] })],
  ["empty image", () => Response.json({ data: [{ b64_json: "" }] })],
  ["invalid base64", () => Response.json({ data: [{ b64_json: "!" }] })],
  ["non-JPEG output", () => Response.json({ data: [{ b64_json: "aGVsbG8=" }] })],
]) {
  test("rejects " + name + " without storing or retrying", async t => {
    const deps = setup(t, reply);
    await assert.rejects(generatePreview(env, [dress], deps), /could not be generated/);
    assert.equal(deps.fetch.mock.callCount(), 1);
    assert.equal(deps.storeImage.mock.callCount(), 0);
  });
}

test("incomplete outfits render with neutral basics and exact selected references", async t => {
  const { images, prompt } = await render(t, [{ ...dress, category: "top" }]);
  assert.equal(images.length, 2);
  assert.match(prompt, /fill missing clothing with simple neutral basics/);
  assert.match(prompt, /Reproduce no incidental accessories/);
  assert.match(prompt, /Show bare feet/);
});

test("retained top and jacket are described in the render prompt", async t => {
  const { images, prompt } = await render(t, [{ ...dress, category: "outerwear", name: "Denim jacket" }], [],
    { profile: { top: true, bottom: false, dress: false, outerwear: false, shoes: false } });
  assert.equal(images.length, 2);
  assert.match(prompt, /Keep the worn top/);
  assert.match(prompt, /Layer selected outerwear over a retained top/);
});

test("the selected catalog listing uses its exact reference image", async t => {
  const { images, prompt } = await render(t, [dress], [product]);
  assert.equal(images.length, 3);
  assert.deepEqual(new Uint8Array(await images[2].arrayBuffer()), listingBytes);
  assert.ok(prompt.includes(JSON.stringify({ source: "catalog", category: product.category, selectedItem: product.title })));
});

test("a catalog bottom can complete a wardrobe top", async t => {
  const { images } = await render(t, [{ ...dress, category: "top" }], [pants]);
  assert.equal(images.length, 3);
  assert.deepEqual(new Uint8Array(await images[2].arrayBuffer()), pantsBytes);
});

test("both catalog basics use independent listing references", async t => {
  const { images, prompt } = await render(t, [], [top, pants]);
  assert.equal(images.length, 3);
  assert.deepEqual(new Uint8Array(await images[1].arrayBuffer()), topBytes);
  assert.deepEqual(new Uint8Array(await images[2].arrayBuffer()), pantsBytes);
  assert.match(prompt, /Image 2: .*Linen tank/);
  assert.match(prompt, /Image 3: .*Linen trousers/);
});

test("a missing selected reference prevents rendering a multi-product look", async t => {
  const deps = setup(t);
  await assert.rejects(generatePreview(env, [], deps, [top, { ...pants, ocrImage: "missing.jpg" }]));
  assert.equal(deps.fetch.mock.callCount(), 0);
  assert.equal(deps.storeImage.mock.callCount(), 0);
});

test("a matched occasion garment uses its exact reference with a style search term", async t => {
  const { images } = await render(t, [], [{ ...top, category: "linen blouses", catalogSlot: "top" },
    { ...pants, category: "tailored slacks", catalogSlot: "bottom" }]);
  assert.deepEqual(new Uint8Array(await images[1].arrayBuffer()), topBytes);
  assert.deepEqual(new Uint8Array(await images[2].arrayBuffer()), pantsBytes);
});

test("an untrusted catalog image cannot be replaced by an invented reference", async t => {
  const deps = setup(t);
  await assert.rejects(generatePreview(env, [dress], deps, [{ ...product, ocrImage: "../another-account.jpg" }]));
  assert.equal(deps.fetch.mock.callCount(), 0);
  assert.equal(deps.storeImage.mock.callCount(), 0);
});

test("a Shopee jacket layers over visible profile clothing", async t => {
  const visible = { top: true, bottom: true, shoes: true, dress: false, outerwear: false };
  const { images, prompt } = await render(t, [], [{ ...product, title: "Denim jacket", category: "men jacket" }], { profile: visible });
  assert.match(prompt, /Keep the worn top, bottom, shoes/);
  assert.match(prompt, /Layer selected outerwear over a retained top/);
  assert.equal(images.length, 2);
  assert.deepEqual(new Uint8Array(await images[1].arrayBuffer()), listingBytes);
});

test("missing or damaged portraits stop before cache access, CDN, or provider", async t => {
  const deps = setup(t);
  deps.cachedImage = t.mock.fn(async () => "old.jpg");
  deps.profilePhotoRef = async () => null;
  await assert.rejects(generatePreview(env, [dress], deps, [product]), { code: "profile_photo_required" });
  deps.profilePhotoRef = async () => "profile";
  deps.readImage = async () => jpeg;
  await assert.rejects(generatePreview(env, [dress], deps, [product]), { code: "profile_photo_required" });
  assert.equal(deps.cachedImage.mock.callCount(), 0);
  assert.equal(deps.fetch.mock.callCount(), 0);
});

test("changing the portrait while the provider runs suppresses the old render", async t => {
  const deps = setup(t);
  let ref = "profile";
  deps.profilePhotoRef = async () => ref;
  const mock = deps.fetch;
  deps.fetch = async (...args) => {
    const response = await mock(...args);
    if (args[0].endsWith("/images/edits")) ref = "replacement";
    return response;
  };
  await assert.rejects(generatePreview(env, [dress], deps, [product]), { code: "profile_photo_changed" });
  assert.equal(deps.storeImage.mock.callCount(), 0);
});
