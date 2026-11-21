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

function setup(t, observed, fullBodyTryOn = true) {
  return {
    profilePhotoRef: async () => "profile",
    readImage: async ref => ref === "profile" ? portrait : jpeg,
    fetch: t.mock.fn(async url => {
      if (url.endsWith("/images/edits")) return Response.json({ data: [{ b64_json: "/9j/4A==" }] });
      return Response.json({
        status: "completed", output: [{ type: "message", role: "assistant", status: "completed",
          content: [{ type: "output_text", text: JSON.stringify({ visible_items: observed, full_body_try_on: fullBodyTryOn }) }] }],
      });
    }),
    storeImage: t.mock.fn(async () => "verified-photo"),
  };
}

for (const observed of [["item_1", "unlisted"], [], ["uncertain"], ["item_1", "item_1"]]) {
  test("rejects a rendered inventory of " + JSON.stringify(observed), async t => {
    const deps = setup(t, observed);
    const result = await generatePreview(env, [dress], deps);
    assert.deepEqual(result, { imageRef: null });
    assert.equal(deps.storeImage.mock.callCount(), 0);
  });
}

test("a correct inventory in a cropped photo or flat lay cannot become a completed look", async t => {
  const deps = setup(t, ["item_1"], false);
  assert.deepEqual(await generatePreview(env, [dress], deps), { imageRef: null });
  assert.equal(deps.storeImage.mock.callCount(), 0);
});

test("a missing base garment falls back to source photos without generating filler clothing", async t => {
  const deps = setup(t, []);
  assert.deepEqual(await generatePreview(env, [{ ...dress, category: "top" }], deps), { imageRef: null });
  assert.equal(deps.fetch.mock.callCount(), 0);
});

test("the selected catalog listing is rendered and verified against its own image", async t => {
  const deps = setup(t, ["item_2", "item_1"]);
  const result = await generatePreview(env, [dress], deps, [product]);
  assert.deepEqual(result, { imageRef: "verified-photo" });
  const [edit, audit] = deps.fetch.mock.calls.map(call => call.arguments);
  assert.ok(edit[0].endsWith("/images/edits"));
  const images = edit[1].body.getAll("image[]");
  assert.equal(images.length, 3);
  assert.deepEqual(Buffer.from(await images[0].arrayBuffer()), portraitBytes);
  assert.match(edit[1].body.get("prompt"), /only identity reference. Never substitute a model/);
  assert.deepEqual(new Uint8Array(await images[2].arrayBuffer()), listingBytes);
  const reference = JSON.parse(audit[1].body).input[0].content;
  assert.deepEqual(JSON.parse(reference[2].text), {
    reference: "item_2", source: "catalog", category: product.category, name: product.title,
  });
  assert.ok(!reference.some(part => part.image_url?.endsWith(portraitBytes.toString("base64"))));
  assert.equal(reference[3].image_url, "data:image/jpeg;base64," + Buffer.from(listingBytes).toString("base64"));
});

test("a try-on that omits the suggested piece cannot be saved", async t => {
  const deps = setup(t, ["item_1"]);
  const result = await generatePreview(env, [dress], deps, [product]);
  assert.deepEqual(result, { imageRef: null });
  assert.equal(deps.storeImage.mock.callCount(), 0);
});

test("a catalog bottom can complete a wardrobe top for a full-body try-on", async t => {
  const deps = setup(t, ["item_1", "item_2"]);
  const result = await generatePreview(env, [{ ...dress, category: "top" }], deps,
    [{ ...product, category: "business women pants", title: "Linen trousers" }]);
  assert.deepEqual(result, { imageRef: "verified-photo" });
});

test("both catalog basics can form an outfit and each listing photo is checked independently", async t => {
  const deps = setup(t, ["item_1", "item_2"]);
  deps.profilePhotoRef = async () => "profile";
  const result = await generatePreview(env, [], deps, [top, pants]);
  assert.deepEqual(result, { imageRef: "verified-photo" });
  const calls = deps.fetch.mock.calls.map(call => call.arguments);
  const images = calls.find(([url]) => url.endsWith("/images/edits"))[1].body.getAll("image[]");
  assert.equal(images.length, 3);
  assert.deepEqual(new Uint8Array(await images[1].arrayBuffer()), topBytes);
  assert.deepEqual(new Uint8Array(await images[2].arrayBuffer()), pantsBytes);
  const audit = JSON.parse(calls.find(([url]) => url.endsWith("/responses"))[1].body).input[0].content;
  assert.deepEqual([JSON.parse(audit[0].text).name, JSON.parse(audit[2].text).name], [top.title, pants.title]);
  assert.deepEqual([audit[1].image_url, audit[3].image_url],
    [topBytes, pantsBytes].map(bytes => "data:image/jpeg;base64," + Buffer.from(bytes).toString("base64")));
});

test("a multi-product look is withheld when any one of its real pieces is absent", async t => {
  const deps = setup(t, ["item_1", "item_3"]);
  const result = await generatePreview(env, [{ ...dress, category: "shoes" }], deps, [top, pants]);
  assert.deepEqual(result, { imageRef: null });
  assert.equal(deps.fetch.mock.callCount(), 2);
  assert.equal(deps.storeImage.mock.callCount(), 0);
});

test("a matched occasion garment uses its verified slot even when the listing search term is a style", async t => {
  const deps = setup(t, ["item_1", "item_2"]);
  const result = await generatePreview(env, [], deps, [
    { ...top, category: "linen blouses", catalogSlot: "top" },
    { ...pants, category: "tailored slacks", catalogSlot: "bottom" },
  ]);
  assert.deepEqual(result, { imageRef: "verified-photo" });
});

test("an unavailable or untrusted catalog image cannot be replaced by an invented reference", async t => {
  const deps = setup(t, ["item_1", "item_2"]);
  await assert.rejects(generatePreview(env, [dress], deps,
    [{ ...product, ocrImage: "../another-account.jpg" }]));
  assert.equal(deps.fetch.mock.callCount(), 0);
  assert.equal(deps.storeImage.mock.callCount(), 0);
});


test("a Shopee jacket layers over the shirt and jeans visible in the profile photo", async t => {
  const deps = setup(t, ["item_1", "base_top", "base_bottom", "base_shoes"]);
  const visible = { top: true, bottom: true, shoes: true, dress: false, outerwear: false };
  const jacket = { ...product, title: "Denim jacket", category: "men jacket" };
  const result = await generatePreview(env, [], deps, [jacket], { profile: visible, coverage: visible });
  assert.equal(result.imageRef, "verified-photo");
  const [edit, audit] = deps.fetch.mock.calls.map(call => call.arguments[1].body);
  assert.match(edit.get("prompt"), /Layer selected outerwear over a retained top/);
  assert.match(edit.get("prompt"), /Keep the worn top, bottom, shoes/);
  const [person, catalog] = edit.getAll("image[]");
  assert.deepEqual(await person.arrayBuffer(), await portrait.arrayBuffer());
  assert.deepEqual(new Uint8Array(await catalog.arrayBuffer()), listingBytes);
  const content = JSON.parse(audit).input[0].content;
  assert.match(content.find(part => part.text?.startsWith("Source outfit")).text, /base_bottom/);
});

test("composite references cannot approve a cropped try-on or an unlisted accessory", async t => {
  const coverage = { top: true, bottom: true, shoes: false, dress: false, outerwear: false };
  for (const [inventory, fullBody] of [[["base_top", "base_bottom"], false], [["base_top", "base_bottom", "unlisted"], true]]) {
    const deps = setup(t, inventory, fullBody);
    const result = await generatePreview(env, [], deps, [], { profile: coverage });
    assert.equal(result.imageRef, null);
    assert.equal(deps.storeImage.mock.callCount(), 0);
  }
});

test("missing or damaged portraits stop before cache access, CDN, or provider", async t => {
  const deps = setup(t, ["item_1", "item_2"]);
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
  const deps = setup(t, ["item_1", "item_2"]);
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
