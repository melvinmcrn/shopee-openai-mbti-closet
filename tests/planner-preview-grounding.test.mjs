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

function setup(t) {
  return {
    profilePhotoRef: async () => "profile",
    readImage: async ref => ref === "profile" ? portrait : jpeg,
    fetch: t.mock.fn(async url => {
      assert.equal(url, "https://api.openai.com/v1/images/edits");
      return Response.json({ data: [{ b64_json: "/9j/4A==" }] });
    }),
    storeImage: t.mock.fn(async () => "verified-photo"),
  };
}

test("an incomplete outfit is rendered with a prompt to fill missing clothing", async t => {
  const deps = setup(t);
  assert.deepEqual(await generatePreview(env, [{ ...dress, category: "top" }], deps), { imageRef: "verified-photo" });
  assert.equal(deps.fetch.mock.callCount(), 1);
  const { body } = deps.fetch.mock.calls[0].arguments[1];
  assert.match(body.get("prompt"), /fill missing clothing with simple neutral basics/);
  assert.equal(body.getAll("image[]").length, 2);
});

test("the selected catalog listing is rendered with its own image", async t => {
  const deps = setup(t);
  const result = await generatePreview(env, [dress], deps, [product]);
  assert.deepEqual(result, { imageRef: "verified-photo" });
  assert.equal(deps.fetch.mock.callCount(), 1);
  const { body } = deps.fetch.mock.calls[0].arguments[1];
  const images = body.getAll("image[]");
  assert.equal(images.length, 3);
  assert.deepEqual(Buffer.from(await images[0].arrayBuffer()), portraitBytes);
  assert.match(body.get("prompt"), /only identity reference. Never substitute a model/);
  assert.ok(body.get("prompt").includes(JSON.stringify({
    source: "catalog", category: product.category, selectedItem: product.title,
  })));
  assert.deepEqual(new Uint8Array(await images[2].arrayBuffer()), listingBytes);
});

test("a catalog bottom can complete a wardrobe top for a full-body try-on", async t => {
  const deps = setup(t);
  const result = await generatePreview(env, [{ ...dress, category: "top" }], deps,
    [{ ...product, category: "business women pants", title: "Linen trousers" }]);
  assert.deepEqual(result, { imageRef: "verified-photo" });
});

test("both catalog basics can form an outfit and each listing supplies its own photo", async t => {
  const deps = setup(t);
  const result = await generatePreview(env, [], deps, [top, pants]);
  assert.deepEqual(result, { imageRef: "verified-photo" });
  const { body } = deps.fetch.mock.calls[0].arguments[1];
  const images = body.getAll("image[]");
  assert.equal(images.length, 3);
  assert.deepEqual(new Uint8Array(await images[1].arrayBuffer()), topBytes);
  assert.deepEqual(new Uint8Array(await images[2].arrayBuffer()), pantsBytes);
  assert.match(body.get("prompt"), /Image 2: .*Linen tank/);
  assert.match(body.get("prompt"), /Image 3: .*Linen trousers/);
});

test("a malformed render cannot be saved as a preview", async t => {
  const deps = setup(t);
  deps.fetch = async () => Response.json({ data: [{ b64_json: "aGVsbG8=" }] });
  await assert.rejects(generatePreview(env, [dress], deps, [top, pants]));
  assert.equal(deps.storeImage.mock.callCount(), 0);
});

test("a matched occasion garment uses its verified slot even when the listing search term is a style", async t => {
  const deps = setup(t);
  const result = await generatePreview(env, [], deps, [
    { ...top, category: "linen blouses", catalogSlot: "top" },
    { ...pants, category: "tailored slacks", catalogSlot: "bottom" },
  ]);
  assert.deepEqual(result, { imageRef: "verified-photo" });
});

test("an unavailable or untrusted catalog image cannot be replaced by an invented reference", async t => {
  const deps = setup(t);
  await assert.rejects(generatePreview(env, [dress], deps,
    [{ ...product, ocrImage: "../another-account.jpg" }]));
  assert.equal(deps.fetch.mock.callCount(), 0);
  assert.equal(deps.storeImage.mock.callCount(), 0);
});


test("a Shopee jacket layers over the shirt and jeans visible in the profile photo", async t => {
  const deps = setup(t);
  const visible = { top: true, bottom: true, shoes: true, dress: false, outerwear: false };
  const jacket = { ...product, title: "Denim jacket", category: "men jacket" };
  const result = await generatePreview(env, [], deps, [jacket], { profile: visible, coverage: visible });
  assert.equal(result.imageRef, "verified-photo");
  const edit = deps.fetch.mock.calls[0].arguments[1].body;
  assert.match(edit.get("prompt"), /Layer selected outerwear over a retained top/);
  assert.match(edit.get("prompt"), /Keep the worn top, bottom, shoes/);
  const [person, catalog] = edit.getAll("image[]");
  assert.deepEqual(await person.arrayBuffer(), await portrait.arrayBuffer());
  assert.deepEqual(new Uint8Array(await catalog.arrayBuffer()), listingBytes);
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
