import { readSampleImage } from "../src/app/api/_server/read-sample-image.mjs";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { dispatchPlanner } from "../src/app/api/_server/planner/api.mjs";

const accountId = 1;
const dress = { id: "9", name: "Column dress", category: "dress", color: "midnight blue", imageRef: "dress.png" };
const heels = { id: "10", name: "Leather heels", category: "shoes", color: "red", imageRef: "heels.png" };
const flats = { id: "11", name: "Walking flats", category: "shoes", color: "silver", imageRef: "flats.png" };
const necklace = { id: "12", name: "Silver necklace", category: "accessory", color: "silver", imageRef: "necklace.png" };
const garments = [dress, heels, flats, necklace];
const original = { dress: dress.id, shoes: heels.id };
const refined = { dress: dress.id, shoes: flats.id };

function d1Binding(database) {
  return {
    prepare(sql) {
      const statement = database.prepare(sql);
      return {
        bind(...params) {
          const bindings = /\?\d/.test(sql)
            ? [Object.fromEntries(params.map((value, index) => [String(index + 1), value]))]
            : params;
          return {
            async first() { return statement.get(...bindings) ?? null; },
            async all() { return { results: statement.all(...bindings) }; },
            async run() { return statement.run(...bindings); },
          };
        },
      };
    },
    async batch(statements) {
      database.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.all());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

async function startPlanner(t, preview, optionSlots = original, shoppingFetch) {
  const database = new DatabaseSync(":memory:");
  t.after(() => database.close());
  const migrations = new URL("../drizzle/", import.meta.url);
  database.exec(readFileSync(new URL("0000_stylist.sql", migrations), "utf8"));
  database.exec(`
    INSERT INTO users (id, auth_provider, auth_subject)
    VALUES (1, 'google', 'planner-test'), (2, 'google', 'other-account');
    INSERT INTO profiles (user_id, face_photo_file_id) VALUES (1, 'profile.png');
  `);
  const addGarment = database.prepare(`
    INSERT INTO wardrobe_items (id, user_id, name, category, color, image_file_id, confirmed_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);
  for (const garment of garments) {
    addGarment.run(Number(garment.id), accountId, garment.name, garment.category, garment.color, garment.imageRef);
  }
  for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql") && name !== "0000_stylist.sql").sort()) {
    database.exec(readFileSync(new URL(file, migrations), "utf8"));
  }
  if (shoppingFetch) {
    database.exec(`
      INSERT INTO clothes_image_database (item_id, shop_id, search_group, search_term, name, url, image_url, price, currency)
      VALUES ('123', '1', 'unisex', 'evening layer', 'Linen jacket', 'https://shopee.co.th/product/1/123',
        'https://down-th.img.susercontent.com/file/jacket', 350, 'THB');
      INSERT INTO clothes_listing_details (item_id, search_group, search_term, image_url, ocr_image, is_mall)
      VALUES ('123', 'unisex', 'evening layer', 'https://down-th.img.susercontent.com/file/jacket', 'jacket.jpg', 0)
    `);
  }
  const makeSession = (user = accountId, key = "mock-provider-key") => {
    const env = { readSampleImage, DB: d1Binding(database), OPENAI_API_KEY: key };
    const dependencies = {
      generateLooks: async () => ({
        status: "ready",
        looks: [{ slots: optionSlots, explanation: "The dress works for dinner." }],
      }),
      preview,
      shoppingFetch,
    };
    return (action, input) => dispatchPlanner(env, user, action, input, dependencies);
  };
  const dispatch = makeSession();
  const brief = await dispatch("saveBrief", {
    occasion: "Anniversary dinner",
    timing: "",
    location: "",
    formality: "",
    comfort: "",
    preferences: [],
  });
  const { looks: [option] } = await dispatch("generate", { briefId: brief.id });
  return { dispatch, makeSession, optionId: option.id, database };
}

test("preview sends the final shoe's bytes without reading a profile photo by default", async (t) => {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAAECAIAAADETxJQAAAAGElEQVR4nGPcN20LAwMDAwMDEwMMYGMBAE4CAhAM6GwxAAAAAElFTkSuQmCC", "base64");
  const jpeg = Buffer.from([255, 216, 255, 224]);
  const files = new Map([
    [dress.imageRef, Buffer.concat([png, Buffer.from([1])])],
    [heels.imageRef, Buffer.concat([png, Buffer.from([2])])],
    [flats.imageRef, Buffer.concat([png, Buffer.from([3])])],
    ["profile.png", Buffer.concat([png, Buffer.from([4])])],
  ]);
  const preview = {
    readImage: t.mock.fn(async (reference) => new Blob([files.get(reference)], { type: "image/png" })),
    profilePhotoRef: t.mock.fn(async () => "profile.png"),
    fetch: t.mock.fn(async () => Response.json({
      data: [{ b64_json: jpeg.toString("base64") }],
    })),
    storeImage: t.mock.fn(async () => "preview.png"),
  };
  const { dispatch, optionId } = await startPlanner(t, preview);

  const result = await dispatch("preview", { optionId, slots: refined });
  assert.deepEqual(result, { imageRef: "preview.png" });

  const refs = preview.readImage.mock.calls.map(({ arguments: [reference] }) => reference);
  assert.deepEqual([...refs].sort(), [dress.imageRef, flats.imageRef].sort());
  assert.equal(preview.profilePhotoRef.mock.callCount(), 0);
  assert.equal(preview.fetch.mock.callCount(), 1);
  const [endpoint, request] = preview.fetch.mock.calls[0].arguments;
  assert.equal(endpoint, "https://api.openai.com/v1/images/edits");
  assert.equal(request.body.get("output_format"), "jpeg");
  const images = await Promise.all(request.body.getAll("image[]").map(async file => Buffer.from(await file.arrayBuffer())));
  assert.deepEqual(images, [await readSampleImage("studio-model"), files.get(dress.imageRef), files.get(flats.imageRef)]);
  assert.equal(preview.storeImage.mock.callCount(), 1);
  const [stored] = preview.storeImage.mock.calls[0].arguments;
  assert.equal(stored.type, "image/jpeg");
  assert.deepEqual(Buffer.from(await stored.arrayBuffer()), jpeg);
});

test("saved looks keep the matching try-on mode and pick up a render that finishes after saving", async t => {
  const { dispatch, optionId, database, makeSession } = await startPlanner(t);
  const save = useProfilePhoto => dispatch("save", { optionId, slots: refined, useProfilePhoto });
  const studio = await save(false);
  const personal = await save(true);
  assert.equal(personal.previewRef, null);

  function insertPreview(file, mode, slots, version) {
    const entries = Object.entries(slots).sort(([a], [b]) => a.localeCompare(b));
    const key = JSON.stringify(version ? [version, mode, entries] : [mode, entries]);
    database.prepare("INSERT INTO private_files(file_id,user_id,state) VALUES (?,1,'ready')").run(file);
    database.prepare("INSERT INTO planner_previews VALUES (1,?,?,?)").run(optionId, key, file);
  }
  insertPreview("wrong-outfit", false, original, "photo-v2");
  insertPreview("personal-photo", true, refined, "photo-v2");
  assert.equal((await dispatch("detail", { id: studio.id })).previewRef, null);
  insertPreview("studio-photo", false, refined, "photo-v2");
  const looks = await dispatch("list", {});
  assert.equal(looks.find(look => look.id === personal.id).previewRef, "personal-photo");
  assert.equal(looks.find(look => look.id === studio.id).previewRef, "studio-photo");
  assert.deepEqual(await dispatch("savedPreview", { id: personal.id }), { imageRef: "personal-photo" });
  await assert.rejects(makeSession(2)("savedPreview", { id: personal.id }));

  const older = await dispatch("save", { optionId, slots: { dress: dress.id } });
  database.prepare("UPDATE saved_looks SET use_profile_photo=NULL WHERE id=?").run(older.id);
  insertPreview("older-photo", true, { dress: dress.id }, null);
  assert.equal((await dispatch("detail", { id: older.id })).previewRef, "older-photo");
});

test("a dress-only option previews and saves without adding shoes", async (t) => {
  const slots = { dress: dress.id };
  const preview = {
    readImage: t.mock.fn(async () => new Blob(["dress"], { type: "image/png" })),
    fetch: async () => Response.json({
      data: [{ b64_json: "/9j/4A==" }],
    }),
    storeImage: async () => "dress-preview.png",
  };
  const { dispatch, optionId, makeSession } = await startPlanner(t, preview, slots);
  assert.deepEqual(await dispatch("preview", { optionId, slots }), { imageRef: "dress-preview.png" });
  assert.deepEqual(preview.readImage.mock.calls.map(call => call.arguments[0]), [dress.imageRef]);
  const saved = await dispatch("save", { optionId, slots });
  const reopened = await makeSession()("detail", { id: saved.id });
  assert.deepEqual(Object.keys(reopened.slots), ["dress"]);
  assert.equal(reopened.slots.dress.id, dress.id);
});

test("an image provider failure still allows the refined outfit to be saved", async (t) => {
  const preview = {
    readImage: async () => new Blob(["image fixture"], { type: "image/png" }),
    fetch: t.mock.fn(async () => new Response("provider unavailable", { status: 503 })),
    storeImage: t.mock.fn(),
  };
  const { dispatch, optionId } = await startPlanner(t, preview);

  await assert.rejects(dispatch("preview", { optionId, slots: refined, useProfilePhoto: false }));
  assert.equal(preview.fetch.mock.callCount(), 1);
  assert.equal(preview.storeImage.mock.callCount(), 0);

  const saved = await dispatch("save", { optionId, slots: refined });
  assert.equal(saved.slots.shoes.id, flats.id);
  assert.equal(saved.originalSlots.shoes.id, heels.id);
  assert.deepEqual(await dispatch("detail", { id: saved.id }), saved);
});

function decision(choice, extra = {}) {
  return Response.json({
    answers: [{ name: "shopee_product", type: "choice", choice, ...extra }],
  });
}

test("Decisions selects a Shopee catalog product from the final outfit and the owner can hide it", async (t) => {
  const shoppingFetch = t.mock.fn(async () => decision("item_123", {
    title: "Invented product", url: "https://example.invalid/listing/123", price: 99,
  }));
  const { dispatch, makeSession, optionId } = await startPlanner(t, undefined, original, shoppingFetch);
  const saved = await dispatch("save", { optionId, slots: refined });
  const lookId = saved.id;
  await assert.rejects(makeSession(2)("shopping", { lookId }), { status: 404 });
  assert.equal(shoppingFetch.mock.callCount(), 0);
  const initial = await dispatch("shopping", { lookId });
  assert.equal(shoppingFetch.mock.callCount(), 1);
  const [url, request] = shoppingFetch.mock.calls[0].arguments;
  assert.equal(url, "https://api.openai.com/v1/decisions");
  assert.equal(request.headers.authorization, "Bearer mock-provider-key");
  assert.equal(request.redirect, "manual");
  const payload = JSON.parse(request.body);
  assert.equal(payload.model, "gpt-6-luna");
  const evidence = payload.input[1].content[0].data;
  assert.equal(evidence.occasion, "Anniversary dinner");
  assert.deepEqual(evidence.outfit.sort((a, b) => a.slot.localeCompare(b.slot)), [
    { slot: "dress", category: "dress", name: "Column dress", color: "midnight blue" },
    { slot: "shoes", category: "shoes", name: "Walking flats", color: "silver" },
  ]);
  assert.equal(payload.questions.length, 1);
  assert.equal(payload.questions[0].type, "choice");
  assert.ok(payload.questions[0].choices.some(({ value }) => value === "item_123"));
  const [suggestion] = initial;
  assert.deepEqual(initial, [{
    id: suggestion.id,
    title: "Linen jacket",
    url: "https://shopee.co.th/product/1/123",
    imageUrl: "https://down-th.img.susercontent.com/file/jacket",
    price: 350, currency: "THB",
    sponsored: false,
  }]);

  await assert.rejects(makeSession(2)("hide", { lookId, id: suggestion.id }), { status: 404 });
  assert.deepEqual(await makeSession()("shopping", { lookId }), initial);
  assert.deepEqual(await dispatch("hide", { lookId, id: suggestion.id }), { hidden: true });
  const reopened = makeSession();
  assert.deepEqual(await reopened("detail", { id: lookId }), saved);
  assert.deepEqual(await reopened("shopping", { lookId }), []);
  assert.equal(shoppingFetch.mock.callCount(), 1);
});

test("existing suggestions are reused and accessorized looks can get a clothing recommendation", async (t) => {
  const shoppingFetch = t.mock.fn(async () => decision("item_123"));
  const { dispatch, optionId, database } = await startPlanner(t, undefined, original, shoppingFetch);
  const { id: lookId } = await dispatch("save", { optionId, slots: refined });
  database.prepare(`
    INSERT INTO shopping_suggestions (saved_look_id, product_name, merchant, product_url, is_sponsored)
    VALUES (?, 'Original suggestion', 'Shopee', 'https://shopee.sg/legacy-url', 1)
  `).run(Number(lookId));
  assert.deepEqual(await dispatch("shopping", { lookId }), [{
    id: "1", title: "Original suggestion", url: "https://shopee.sg/legacy-url", sponsored: true,
  }]);
  const { id: accessorizedId } = await dispatch("save", {
    optionId, slots: { ...refined, accessory: necklace.id },
  });
  assert.equal((await dispatch("shopping", { lookId: accessorizedId }))[0].title, "Linen jacket");
  assert.equal(shoppingFetch.mock.callCount(), 1);
});

test("an unavailable, refused, or invalid decision leaves no fallback row and can be retried", async (t) => {
  const responses = [
    new Response("provider unavailable", { status: 503 }),
    new Response("invalid JSON"),
    decision("https://example.invalid/injected"),
    decision("item_123", { name: "wrong_question" }),
    decision(undefined, { type: "refusal" }),
    decision("item_123"),
  ];
  const shoppingFetch = t.mock.fn(async () => responses.shift());
  const { dispatch, makeSession, optionId, database } = await startPlanner(t, undefined, original, shoppingFetch);
  const { id: lookId } = await dispatch("save", { optionId, slots: refined });
  const expectedError = { status: 503, message: "Shopping suggestions are temporarily unavailable. Please try again." };
  await assert.rejects(makeSession(accountId, "")("shopping", { lookId }), expectedError);
  assert.equal(shoppingFetch.mock.callCount(), 0);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assert.rejects(dispatch("shopping", { lookId }), expectedError);
    assert.equal(database.prepare("SELECT count(*) AS count FROM shopping_suggestions").get().count, 0);
  }
  const [suggestion] = await dispatch("shopping", { lookId });
  assert.equal(suggestion.title, "Linen jacket");
  assert.equal(shoppingFetch.mock.callCount(), 6);
});

test("Decisions can explicitly opt out for a single-item outfit without creating a suggestion", async (t) => {
  const shoppingFetch = t.mock.fn(async () => decision("none"));
  const slots = { dress: dress.id };
  const { dispatch, optionId, database } = await startPlanner(t, undefined, slots, shoppingFetch);
  const { id: lookId } = await dispatch("save", { optionId, slots });
  assert.deepEqual(await dispatch("shopping", { lookId }), []);
  assert.equal(database.prepare("SELECT count(*) AS count FROM shopping_suggestions").get().count, 0);
  assert.equal(shoppingFetch.mock.callCount(), 1);
});

test("a catalog item replaces a generic search and stays unique across concurrent requests", async (t) => {
  const shoppingFetch = async () => decision("item_123");
  const { dispatch, optionId, database } = await startPlanner(t, undefined, original, shoppingFetch);
  const { id: lookId } = await dispatch("save", { optionId, slots: refined });
  database.prepare(`
    INSERT INTO shopping_suggestions (saved_look_id, product_name, merchant, product_url)
    VALUES (?, 'Black clutch bag', 'Shopee', 'https://shopee.sg/search?keyword=black+clutch+bag')
  `).run(Number(lookId));
  const [first, second] = await Promise.all([dispatch("shopping", { lookId }), dispatch("shopping", { lookId })]);
  assert.equal(first.length, 1);
  assert.equal(first[0].title, "Linen jacket");
  assert.deepEqual(first, second);
});

test("an empty catalog or an exact match in the owner's closet skips the provider", async (t) => {
  const shoppingFetch = t.mock.fn();
  const { dispatch, optionId, database } = await startPlanner(t, undefined, original, shoppingFetch);
  const { id: lookId } = await dispatch("save", { optionId, slots: refined });
  database.exec("DELETE FROM clothes_image_database WHERE item_id <> '123'");
  database.exec("UPDATE wardrobe_items SET name = 'LINEN JACKET' WHERE id = 12");
  assert.deepEqual(await dispatch("shopping", { lookId }), []);
  database.exec("DELETE FROM clothes_image_database");
  assert.deepEqual(await dispatch("shopping", { lookId }), []);
  assert.equal(shoppingFetch.mock.callCount(), 0);
});

test("planning evaluates enhancements before saving, remembers complete looks and reassesses swaps", async (t) => {
  const shoppingFetch = t.mock.fn(async (_url, request) => {
    const { outfit } = JSON.parse(request.body).input[1].content[0].data;
    return decision(outfit.some(item => item.name === "Walking flats") ? "item_123" : "none");
  });
  const { dispatch, makeSession, optionId } = await startPlanner(t, undefined, original, shoppingFetch);
  await assert.rejects(makeSession(2)("enhancement", { optionId, slots: original }), { status: 404 });
  assert.equal(await dispatch("enhancement", { optionId, slots: original }), null);
  const complete = await dispatch("save", { optionId, slots: original });
  assert.deepEqual(await dispatch("shopping", { lookId: complete.id }), []);
  const enhanced = await dispatch("enhancement", { optionId, slots: refined });
  assert.equal(enhanced.title, "Linen jacket");
  assert.equal(enhanced.url, "https://shopee.co.th/product/1/123");
  const saved = await dispatch("save", { optionId, slots: refined });
  assert.equal((await dispatch("shopping", { lookId: saved.id }))[0].url, enhanced.url);
  assert.equal(shoppingFetch.mock.callCount(), 2);
});
