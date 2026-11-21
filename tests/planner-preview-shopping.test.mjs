import { readSampleImage } from "../src/app/api/_server/read-sample-image.mjs";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { dispatchPlanner } from "../src/app/api/_server/planner/api.mjs";
import { wardrobeApi } from "../src/app/api/_server/wardrobe-api.mjs";
import { userData } from "../src/app/api/_server/user-data.mjs";

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

async function startPlanner(t, preview, optionSlots = original, shoppingFetch, searchTerm = "evening layer") {
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
      generateOccasionLook: async () => null,
      generateLooks: async () => ({
        status: "ready",
        looks: [{ slots: optionSlots, explanation: "The dress works for dinner." }],
      }),
      preview,
      shoppingFetch: (url, request) => {
        const { questions: [question], input } = JSON.parse(request.body);
        if (question.name === "catalog_search") {
          const gap = input[1].content[0].data.missingGarment;
          const term = gap ? question.choices.find(({ value }) => value !== "none")
            : question.choices.find(({ description }) => description === searchTerm);
          return decision(shoppingFetch && term ? term.value : "none", { name: question.name });
        }
        return shoppingFetch(url, request);
      },
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

test("deleting a garment confirms exactly the saved looks containing its final slot", async (t) => {
  const { dispatch, optionId, database } = await startPlanner(t);
  const env = { DB: d1Binding(database) };
  function change(id, method, body, user = accountId) {
    return wardrobeApi(new Request(`https://example.test/api/wardrobe/items/${id}`, {
      method, body: JSON.stringify(body),
    }), env, user);
  }
  const save = (slots) => dispatch("save", { optionId, slots });
  const look = await save(refined);
  const unrelated = await save({ dress: dress.id });
  const affected = [{ id: Number(look.id), title: look.occasion }];
  const prompt = async (response) => {
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { code: "saved_looks_affected", savedLooks: affected });
  };

  assert.equal((await change(flats.id, "DELETE", undefined, 2)).status, 404);
  assert.equal((await change(flats.id, "DELETE", { savedLookIds: ["1"] })).status, 400);
  assert.equal((await change(heels.id, "DELETE")).status, 204);
  assert.equal((await dispatch("detail", { id: look.id })).originalSlots.shoes.id, heels.id);
  await prompt(await change(flats.id, "DELETE"));
  await prompt(await wardrobeApi(new Request(`https://example.test/api/wardrobe/items/${flats.id}`, {
    method: "DELETE", body: "",
  }), env, accountId));
  const confirmation = { savedLookIds: affected.map(({ id }) => id) };
  const later = await save(refined);
  affected.push({ id: Number(later.id), title: later.occasion });
  await prompt(await change(flats.id, "DELETE", confirmation));
  await prompt(await change(flats.id, "DELETE", { savedLookIds: [Number(look.id), Number(unrelated.id)] }));
  assert.equal((await dispatch("list")).length, 3);
  assert.ok((await dispatch("wardrobe")).some(({ id }) => id === flats.id));
  const confirmed = { savedLookIds: affected.map(({ id }) => id).reverse() };

  // If a dependent delete fails, the item and both looks must remain.
  database.exec("CREATE TRIGGER deny_delete BEFORE DELETE ON saved_looks BEGIN SELECT RAISE(ABORT, 'busy'); END");
  await assert.rejects(change(flats.id, "DELETE", confirmed), /busy/);
  assert.ok((await dispatch("wardrobe")).some(({ id }) => id === flats.id));
  assert.equal((await dispatch("list")).length, 3);
  database.exec("DROP TRIGGER deny_delete");
  const wear = await dispatch("wearAdd", { lookId: look.id, date: "2026-11-21" });
  assert.equal((await change(flats.id, "DELETE", confirmed)).status, 204);
  assert.equal((await change(flats.id, "DELETE", confirmed)).status, 204);
  assert.deepEqual((await dispatch("list")).map(({ id }) => id), [unrelated.id]);
  assert.ok(!(await dispatch("wardrobe")).some(({ id }) => id === flats.id));
  await assert.rejects(dispatch("wearGet", { id: wear.id }), { status: 404 });
  await assert.rejects(save(refined), /ineligible garment/);
  assert.equal((await change(dress.id, "PATCH", { archive: true })).status, 204);
  assert.equal((await dispatch("detail", { id: unrelated.id })).slots.dress.id, dress.id);
});

test("neither saved-look writer can reuse an ID from an old deletion confirmation", async (t) => {
  const { dispatch, optionId, database } = await startPlanner(t);
  const DB = d1Binding(database);
  const remove = (item, id) => wardrobeApi(new Request(`https://example.test/api/wardrobe/items/${item.id}`, {
    method: "DELETE", body: JSON.stringify({ savedLookIds: [Number(id)] }),
  }), { DB }, accountId);
  const originalLook = await dispatch("save", { optionId, slots: refined });
  assert.equal((await remove(dress, originalLook.id)).status, 204);
  const replacement = await userData(DB, accountId).saveLook({
    sourceOptionId: Number(optionId), name: "Replacement", slots: [{ slot: "shoes", itemId: Number(flats.id) }],
  });
  assert.ok(replacement.id > Number(originalLook.id));
  assert.deepEqual(replacement.slots.map(({ itemId }) => itemId), [Number(flats.id)]);
  await assert.rejects(dispatch("detail", { id: originalLook.id }), { status: 404 });
  const stale = await remove(flats, originalLook.id);
  assert.equal(stale.status, 409);
  assert.deepEqual((await stale.json()).savedLooks, [{ id: replacement.id, title: replacement.name }]);
  assert.equal((await remove(flats, replacement.id)).status, 204);
  const newest = await dispatch("save", { optionId, slots: { accessory: necklace.id } });
  assert.ok(Number(newest.id) > replacement.id);
  assert.equal(newest.slots.accessory.id, necklace.id);
});

test("the saved-look identity migration preserves existing IDs and rolls back with a failed save", (t) => {
  const database = new DatabaseSync(":memory:");
  t.after(() => database.close());
  database.exec("CREATE TABLE saved_looks (id INTEGER PRIMARY KEY); INSERT INTO saved_looks VALUES (17), (63)");
  database.exec(readFileSync(new URL("../drizzle/0112_saved_look_identity.sql", import.meta.url), "utf8"));
  const next = () => database.prepare("SELECT id FROM next_saved_look_id").get().id;
  assert.deepEqual(database.prepare("SELECT id FROM saved_looks ORDER BY id").all().map(row => row.id), [17, 63]);
  database.exec("DELETE FROM saved_looks WHERE id = 63");
  assert.throws(() => database.exec("INSERT INTO saved_looks DEFAULT VALUES"), /cannot be reused/);
  assert.equal(next(), 64);
  database.exec("BEGIN; INSERT INTO saved_looks SELECT id FROM next_saved_look_id");
  assert.equal(next(), 65);
  database.exec("ROLLBACK");
  assert.equal(next(), 64);
  database.exec("INSERT INTO saved_looks SELECT id FROM next_saved_look_id; DELETE FROM saved_looks");
  assert.equal(next(), 65);
});

function previewReply(url, options) {
  if (url.startsWith("https://down-th.img.susercontent.com/file/")) {
    return new Response(Uint8Array.from([255, 216, 255, 224]), { headers: { "Content-Type": "image/jpeg" } });
  }
  if (url.endsWith("/images/edits")) return Response.json({ data: [{ b64_json: "/9j/4A==" }] });
  const { input } = JSON.parse(options.body);
  const visible_items = input[0].content.filter(part => part.type === "input_text" && part.text.startsWith("{"))
    .map(part => JSON.parse(part.text).reference);
  return Response.json({ status: "completed", output: [{ type: "message", role: "assistant", status: "completed",
    content: [{ type: "output_text", text: JSON.stringify({ visible_items }) }] }] });
}

test("explicit studio mode sends the final shoe and never reads the profile photo", async (t) => {
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
    fetch: t.mock.fn(previewReply),
    storeImage: t.mock.fn(async () => "preview.png"),
  };
  const { dispatch, optionId } = await startPlanner(t, preview);

  const result = await dispatch("preview", { optionId, slots: refined, useProfilePhoto: false });
  assert.deepEqual(result, { imageRef: "preview.png" });

  const refs = preview.readImage.mock.calls.map(({ arguments: [reference] }) => reference);
  assert.deepEqual([...refs].sort(), [dress.imageRef, flats.imageRef].sort());
  assert.equal(preview.profilePhotoRef.mock.callCount(), 0);
  assert.equal(preview.fetch.mock.callCount(), 2);
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

test("a profile photo and a jacket alone cannot supply a complete outfit", async t => {
  const jacket = { id: "13", category: "outerwear", name: "Denim jacket", imageRef: "jacket.png" };
  const preview = {
    profilePhotoRef: async () => "headshot.png",
    readImage: t.mock.fn(async ref => new Blob([ref], { type: "image/png" })),
    fetch: t.mock.fn(previewReply),
    storeImage: async () => "full-body.jpg",
  };
  const { dispatch, optionId, database } = await startPlanner(t, preview);
  database.prepare("INSERT INTO private_files (file_id, user_id, state) VALUES (?, ?, 'ready')").run(jacket.imageRef, accountId);
  database.prepare(`INSERT INTO wardrobe_items (id, user_id, name, category, image_file_id, confirmed_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`).run(jacket.id, accountId, jacket.name, jacket.category, jacket.imageRef);
  const result = await dispatch("preview", { optionId, slots: { outerwear: jacket.id }, useProfilePhoto: true });
  assert.equal(result.imageRef, null);
  assert.equal(preview.fetch.mock.callCount(), 0);
});

test("saved looks keep the matching try-on mode and pick up a render that finishes after saving", async t => {
  const { dispatch, optionId, database, makeSession } = await startPlanner(t);
  const save = useProfilePhoto => dispatch("save", { optionId, slots: refined, useProfilePhoto });
  const studio = await save(false);
  const personal = await save(true);
  assert.equal(personal.previewRef, null);

  const { previewSelection } = await import("../src/app/api/_server/planner/preview-files.mjs");
  function insertPreview(file, mode, slots, legacyVersion) {
    const entries = Object.entries(slots).sort(([a], [b]) => a.localeCompare(b));
    const items = Object.fromEntries(entries.map(([slot, id]) => [slot, garments.find(garment => garment.id === id)]));
    const key = legacyVersion === undefined ? previewSelection(items, mode, [], mode ? "profile.png" : null)
      : JSON.stringify(legacyVersion ? [legacyVersion, mode, entries] : [mode, entries]);
    database.prepare("INSERT INTO private_files(file_id,user_id,state) VALUES (?,1,'ready')").run(file);
    database.prepare("INSERT INTO planner_previews VALUES (1,?,?,?)").run(optionId, key, file);
  }
  insertPreview("wrong-outfit", false, original);
  insertPreview("personal-photo", true, refined);
  assert.equal((await dispatch("detail", { id: studio.id })).previewRef, null);
  insertPreview("studio-photo", false, refined);
  const looks = await dispatch("list", {});
  assert.equal(looks.find(look => look.id === personal.id).previewRef, "personal-photo");
  assert.equal(looks.find(look => look.id === studio.id).previewRef, "studio-photo");
  database.exec("UPDATE profiles SET face_photo_file_id=NULL WHERE user_id=1");
  assert.deepEqual(await dispatch("savedPreview", { id: personal.id }), { imageRef: "studio-photo" });
  assert.equal((await dispatch("detail", { id: personal.id })).useProfilePhoto, false);
  await assert.rejects(makeSession(2)("savedPreview", { id: personal.id }));

  const older = await dispatch("save", { optionId, slots: { dress: dress.id } });
  database.prepare("UPDATE saved_looks SET use_profile_photo=NULL WHERE id=?").run(older.id);
  insertPreview("older-photo", true, { dress: dress.id }, null);
  insertPreview("unchecked-photo", false, { dress: dress.id }, "photo-v2");
  assert.equal((await dispatch("detail", { id: older.id })).previewRef, null);
});

test("a dress-only option previews and saves without adding shoes", async (t) => {
  const slots = { dress: dress.id };
  const preview = {
    readImage: t.mock.fn(async () => new Blob(["dress"], { type: "image/png" })),
    fetch: previewReply,
    storeImage: async () => "dress-preview.png",
  };
  const { dispatch, optionId, makeSession, database } = await startPlanner(t, preview, slots);
  database.exec("UPDATE profiles SET face_photo_file_id=NULL WHERE user_id=1");
  await assert.rejects(dispatch("preview", { optionId, slots, useProfilePhoto: true }), { status: 400 });
  assert.deepEqual(await dispatch("preview", { optionId, slots }), { imageRef: "dress-preview.png" });
  assert.deepEqual(preview.readImage.mock.calls.map(call => call.arguments[0]), [dress.imageRef]);
  const saved = await dispatch("save", { optionId, slots });
  const reopened = await makeSession()("detail", { id: saved.id });
  assert.deepEqual(Object.keys(reopened.slots), ["dress"]);
  assert.equal(reopened.slots.dress.id, dress.id);
  assert.equal(reopened.useProfilePhoto, false);
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
    id: suggestion.id, catalogItemId: "123", category: "evening layer",
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

test("unlisted legacy suggestions are replaced and saved links are resolved from the catalog", async (t) => {
  const shoppingFetch = t.mock.fn(async () => decision("item_123"));
  const { dispatch, optionId, database } = await startPlanner(t, undefined, original, shoppingFetch);
  const { id: lookId } = await dispatch("save", {
    optionId, slots: { ...refined, accessory: necklace.id },
  });
  database.prepare(`
    INSERT INTO shopping_suggestions (saved_look_id, product_name, merchant, product_url, is_sponsored)
    VALUES (?, 'Unlisted item', 'Shopee', 'https://shopee.sg/legacy-url', 1)
  `).run(Number(lookId));
  const [item] = await dispatch("shopping", { lookId });
  assert.equal(item.title, "Linen jacket");
  database.prepare(`
    UPDATE shopping_suggestions SET product_name = 'Stale snapshot', product_url = 'https://shopee.co.th/search'
    WHERE catalog_item_id = '123'
  `).run();
  assert.deepEqual(await dispatch("shopping", { lookId }), [item]);
});

test("an unavailable, refused, or invalid decision leaves no fallback row and can be retried", async (t) => {
  const responses = [
    new Response("provider unavailable", { status: 503 }),
    new Response("invalid JSON"),
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
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await assert.rejects(dispatch("shopping", { lookId }), expectedError);
    assert.equal(database.prepare("SELECT count(*) AS count FROM shopping_suggestions").get().count, 0);
  }
  const [suggestion] = await dispatch("shopping", { lookId });
  assert.equal(suggestion.title, "Linen jacket");
  assert.equal(shoppingFetch.mock.callCount(), 5);
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


test("catalog search shows all matches for the desired term and cannot substitute from another term", async (t) => {
  let choices;
  const productFetch = async (_, request) => {
    choices = JSON.parse(request.body).questions[0].choices;
    return decision("item_123");
  };
  const { dispatch, optionId, database } = await startPlanner(t, undefined, original, productFetch, "women necklace");
  const { id: lookId } = await dispatch("save", { optionId, slots: refined });
  assert.deepEqual(await dispatch("shopping", { lookId }), []);
  const expectedIds = database.prepare(
    "SELECT DISTINCT item_id FROM clothes_catalog WHERE search_term = 'women necklace'"
  ).all().map(row => `item_${row.item_id}`);
  assert.deepEqual(new Set(choices.map(({ value }) => value)), new Set([...expectedIds, "none"]));
});

test("a stale or mismatched catalog purchase URL cannot be shown on a plan or saved look", async (t) => {
  const { dispatch, optionId, database } = await startPlanner(t, undefined, original, async () => decision("item_123"));
  assert.equal((await dispatch("enhancement", { optionId, slots: refined })).title, "Linen jacket");
  const { id: lookId } = await dispatch("save", { optionId, slots: refined });
  assert.equal((await dispatch("shopping", { lookId }))[0].title, "Linen jacket");
  database.exec("UPDATE clothes_image_database SET url = 'https://shopee.co.th/product/1/999' WHERE item_id = '123'");
  assert.equal(await dispatch("enhancement", { optionId, slots: refined }), null);
  assert.deepEqual(await dispatch("shopping", { lookId }), []);
});

test("a missing search term returns no suggestion and never falls back to another listing", async (t) => {
  const productFetch = t.mock.fn();
  const { dispatch, optionId } = await startPlanner(t, undefined, original, productFetch, "not a catalog term");
  assert.equal(await dispatch("enhancement", { optionId, slots: original }), null);
  assert.equal(productFetch.mock.callCount(), 0);
});

test("removing a product from the searchable catalog retires its cached and saved recommendation", async (t) => {
  const { dispatch, optionId, database } = await startPlanner(t, undefined, original, async () => decision("item_123"));
  const { id: lookId } = await dispatch("save", { optionId, slots: refined });
  assert.equal((await dispatch("shopping", { lookId }))[0].title, "Linen jacket");
  database.exec("DELETE FROM clothes_listing_details WHERE item_id = '123'");
  assert.equal(await dispatch("enhancement", { optionId, slots: refined }), null);
  assert.deepEqual(await dispatch("shopping", { lookId }), []);
});

test("enhanced preview keys track the product image and hide immediately switches to the wardrobe-only preview", async t => {
  const { dispatch, optionId, database } = await startPlanner(t, undefined, original, async () => decision("item_123"));
  const product = await dispatch("enhancement", { optionId, slots: refined });
  const { id } = await dispatch("save", { optionId, slots: refined, useProfilePhoto: false });
  assert.equal((await dispatch("detail", { id })).enhancements[0].id, product.id);
  assert.equal((await dispatch("list", {}))[0].enhancements[0].id, product.id);
  assert.equal((await dispatch("preview", { optionId, slots: refined, catalogItemIds: ["unknown"] })).imageRef, null);
  const { previewSelection } = await import("../src/app/api/_server/planner/preview-files.mjs");
  const slots = (await dispatch("detail", { id })).slots;
  for (const [ref, products] of [["with-jacket", [product]], ["closet-only", []]]) {
    database.prepare("INSERT INTO private_files(file_id,user_id,state) VALUES (?,1,'ready')").run(ref);
    database.prepare("INSERT INTO planner_previews VALUES (1,?,?,?)").run(optionId, previewSelection(slots, false, products), ref);
  }
  assert.equal((await dispatch("savedPreview", { id, catalogItemIds: [product.id] })).imageRef, "with-jacket");
  database.exec("UPDATE clothes_image_database SET image_url = 'https://down-th.img.susercontent.com/file/replacement' WHERE item_id = '123'");
  assert.equal((await dispatch("detail", { id })).previewRef, null);
  database.exec("UPDATE clothes_image_database SET image_url = 'https://down-th.img.susercontent.com/file/jacket' WHERE item_id = '123'");
  const [suggestion] = await dispatch("shopping", { lookId: id });
  assert.equal(suggestion.catalogItemId, product.id);
  await dispatch("hide", { lookId: id, id: suggestion.id });
  assert.deepEqual((await dispatch("savedPreview", { id, catalogItemIds: [product.id] })).imageRef, null);
  const [look] = await dispatch("list", {});
  assert.deepEqual(look.enhancements, []);
  assert.equal(look.previewRef, "closet-only");
});

function chooseFirstListing(_endpoint, request) {
  const { questions } = JSON.parse(request.body);
  return Response.json({
    answers: questions.map(({ name, choices }) => ({
      name, type: "choice", choice: choices.find(({ value }) => value.startsWith("item_")).value,
    })),
  });
}

test("missing tops and pants produce two real catalog listings that persist and hide individually", async t => {
  const slots = { shoes: flats.id };
  const { dispatch, makeSession, optionId, database } = await startPlanner(t, undefined, slots, chooseFirstListing);
  database.exec("UPDATE wardrobe_items SET archived_at = CURRENT_TIMESTAMP WHERE category = 'dress'");

  const products = await dispatch("enhancements", { optionId, slots });
  assert.equal(products.length, 2);
  const listings = products.map(product => {
    const row = database.prepare("SELECT name, url FROM clothes_image_database WHERE item_id=?").get(product.id);
    assert.equal(product.title, row.name);
    assert.equal(product.url, new URL(row.url).href);
    return database.prepare("SELECT search_term FROM clothes_catalog WHERE item_id=?").all(product.id)
      .map(({ search_term }) => search_term);
  });
  assert.ok(listings.some(terms => terms.some(term => / (shirt|sweater|tank top)$/.test(term))));
  assert.ok(listings.some(terms => terms.some(term => term.endsWith(" pants"))));
  assert.deepEqual(await dispatch("enhancement", { optionId, slots }), products[0]);

  const { id: lookId } = await dispatch("save", { optionId, slots });
  const [saved, concurrent] = await Promise.all([dispatch("shopping", { lookId }), dispatch("shopping", { lookId })]);
  assert.deepEqual(concurrent, saved);
  assert.deepEqual(saved.map(suggestion => suggestion.url).sort(), products.map(product => new URL(product.url).href).sort());
  // Adding an owned piece removes its gap from the saved view without discarding history.
  database.exec("UPDATE wardrobe_items SET category='top' WHERE id=12");
  assert.deepEqual(await dispatch("shopping", { lookId }), saved.filter(row => row.wardrobeGap === "bottom"));
  database.exec("UPDATE wardrobe_items SET category='accessory' WHERE id=12");
  await dispatch("hide", { lookId, id: saved[0].id });
  assert.deepEqual(await makeSession()("shopping", { lookId }), [saved[1]]);
});

test("an unselected owned top covers its category when suggesting pants", async t => {
  const slots = { shoes: flats.id };
  const shoppingFetch = t.mock.fn(chooseFirstListing);
  const { dispatch, optionId, database } = await startPlanner(t, undefined, slots, shoppingFetch);
  database.exec("UPDATE wardrobe_items SET category='top', name='Cotton blouse' WHERE id=12");
  database.exec("UPDATE wardrobe_items SET archived_at=CURRENT_TIMESTAMP WHERE category='dress'");
  const products = await dispatch("enhancements", { optionId, slots });
  assert.equal(products.length, 1);
  assert.ok(database.prepare("SELECT 1 FROM clothes_catalog WHERE item_id=? AND search_term LIKE '% pants'").get(products[0].id));
  for (const call of shoppingFetch.mock.calls) {
    for (const question of JSON.parse(call.arguments[1].body).questions) {
      for (const choice of question.choices.filter(choice => choice.value.startsWith("item_"))) {
        assert.ok(database.prepare("SELECT 1 FROM clothes_catalog WHERE item_id=? AND search_term LIKE '% pants'")
          .get(choice.value.slice(5)), "every candidate should have a pants listing");
      }
    }
  }
});

test("a profile-only option can offer both missing categories from an empty closet", async t => {
  const { database, dispatch } = await startPlanner(t, undefined, original, chooseFirstListing);
  database.exec("UPDATE wardrobe_items SET archived_at=CURRENT_TIMESTAMP");
  const brief = await dispatch("saveBrief", {
    occasion: "Weekend brunch", timing: "", location: "", formality: "", comfort: "", preferences: [],
  });
  const { looks: [look] } = await dispatch("generate", { briefId: brief.id });
  assert.deepEqual(look.slots, {});
  assert.ok(look.profileRef);
  const products = await dispatch("enhancements", { optionId: look.id, slots: look.slots });
  assert.equal(products.length, 2);
  assert.equal(new Set(products.map(product => product.id)).size, 2);
});

test("the account photo can model approved catalog basics with an empty wardrobe", async t => {
  const preview = {
    readImage: t.mock.fn(async ref => new Blob([ref], { type: "image/jpeg" })),
    fetch: t.mock.fn(previewReply),
    storeImage: async () => "profile-look.jpg",
  };
  const { dispatch, database } = await startPlanner(t, preview, original, chooseFirstListing);
  database.exec("UPDATE wardrobe_items SET archived_at=CURRENT_TIMESTAMP");
  const brief = await dispatch("saveBrief", { occasion: "Lunch", preferences: [] });
  const { looks: [look] } = await dispatch("generate", { briefId: brief.id });
  assert.deepEqual(look.slots, {});
  assert.deepEqual(await dispatch("preview", { optionId: look.id, slots: {}, catalogItemIds: [] }), { imageRef: null });
  assert.equal(preview.fetch.mock.callCount(), 0);
  const products = await dispatch("enhancements", { optionId: look.id, slots: {} });
  const catalogItemIds = products.map(product => product.id);
  assert.equal(catalogItemIds.length, 2);
  assert.deepEqual(await dispatch("preview", { optionId: look.id, slots: {}, catalogItemIds }), { imageRef: "profile-look.jpg" });
  const fetchedUrls = preview.fetch.mock.calls.map(call => call.arguments[0]);
  for (const product of products) assert.ok(fetchedUrls.includes(product.imageUrl));
  const edit = preview.fetch.mock.calls.find(call => call.arguments[0].endsWith("/images/edits"));
  const [person, ...items] = edit.arguments[1].body.getAll("image[]");
  assert.equal(await person.text(), "profile.png");
  assert.equal(items.length, 2);
});

test("automatic saves retain the resolved mode; legacy regeneration uses the account photo", async t => {
  const preview = {
    readImage: t.mock.fn(async ref => new Blob([ref], { type: "image/jpeg" })),
    fetch: previewReply,
    storeImage: async () => "legacy-personal.jpg",
  };
  const { dispatch, optionId, database } = await startPlanner(t, preview);
  const saved = await dispatch("save", { optionId, slots: refined });
  assert.equal(saved.useProfilePhoto, true);
  const mode = database.prepare("SELECT use_profile_photo AS mode FROM saved_looks WHERE id=?");
  assert.equal(mode.get(saved.id).mode, 1);
  database.prepare("UPDATE saved_looks SET use_profile_photo=NULL WHERE id=?").run(saved.id);
  assert.deepEqual(await dispatch("savedPreview", { id: saved.id }), { imageRef: "legacy-personal.jpg" });
  assert.ok(preview.readImage.mock.calls.some(call => call.arguments[0] === "profile.png"));
});

test("a saved personal look switches to studio only after rendering succeeds if its profile photo was removed", async t => {
  const preview = {
    readImage: t.mock.fn(async ref => new Blob([ref], { type: "image/jpeg" })),
    fetch: t.mock.fn(previewReply),
    storeImage: t.mock.fn(async () => "replacement-studio.jpg"),
  };
  const { dispatch, optionId, database } = await startPlanner(t, preview);
  const saved = await dispatch("save", { optionId, slots: refined, useProfilePhoto: true });
  database.exec("UPDATE profiles SET face_photo_file_id=NULL WHERE user_id=1");
  preview.storeImage.mock.mockImplementationOnce(async () => { throw new Error("storage unavailable"); });
  const mode = database.prepare("SELECT use_profile_photo AS mode FROM saved_looks WHERE id=?");
  await assert.rejects(dispatch("savedPreview", { id: saved.id }));
  assert.equal(mode.get(saved.id).mode, 1);
  assert.deepEqual(await dispatch("savedPreview", { id: saved.id }), { imageRef: "replacement-studio.jpg" });
  assert.equal(mode.get(saved.id).mode, 0);
  const edit = preview.fetch.mock.calls.findLast(call => call.arguments[0].endsWith("/images/edits"));
  const body = edit.arguments[1].body;
  const [first] = body.getAll("image[]");
  assert.deepEqual(Buffer.from(await first.arrayBuffer()), await readSampleImage("studio-model"));
});

test("occasion looks keep their exact catalog choices across preview, save, individual hide and listing retirement", async t => {
  const shoppingFetch = t.mock.fn(() => { throw new Error("An occasion look must not reselect products"); });
  const preview = {
    fetch: t.mock.fn(previewReply),
    readImage: async ref => new Blob([ref], { type: "image/jpeg" }),
    storeImage: async () => "occasion-preview.jpg",
  };
  const { dispatch, makeSession, optionId, database } = await startPlanner(t, preview, original, shoppingFetch);
  const runId = database.prepare("SELECT run_id FROM outfit_options WHERE id=?").get(optionId).run_id;
  const option = database.prepare(`INSERT INTO outfit_options (user_id,run_id,position,title,look_kind)
    VALUES (1,?,10,'Beach day','occasion') RETURNING CAST(id AS TEXT) AS id`).get(runId);
  const pick = database.prepare("INSERT INTO outfit_option_catalog_items (user_id,option_id,slot,item_id) VALUES (1,?,?,?)");
  for (const [slot, term] of [["top", "men shirt"], ["bottom", "men pants"], ["accessory", "women necklace"]]) {
    const row = database.prepare("SELECT item_id FROM clothes_image_database WHERE search_term=? ORDER BY item_id LIMIT 1").get(term);
    pick.run(option.id, slot, row.item_id);
  }
  const products = await dispatch("enhancements", { optionId: option.id, slots: {} });
  assert.deepEqual(products.map(product => product.catalogSlot).sort(), ["accessory", "bottom", "top"]);
  assert.equal(new Set(products.map(product => product.id)).size, 3);
  for (const product of products) {
    const { url } = database.prepare("SELECT url FROM clothes_image_database WHERE item_id=?").get(product.id);
    assert.equal(product.url, new URL(url).href);
  }
  const catalogItemIds = products.map(product => product.id);
  assert.deepEqual(await dispatch("preview", { optionId: option.id, catalogItemIds: catalogItemIds.slice(1) }), { imageRef: null });
  assert.equal(preview.fetch.mock.callCount(), 0);
  assert.deepEqual(await dispatch("preview", { optionId: option.id, catalogItemIds }), { imageRef: "occasion-preview.jpg" });
  for (const product of products) assert.ok(preview.fetch.mock.calls.some(call => call.arguments[0] === product.imageUrl));
  const saved = await dispatch("save", { optionId: option.id, slots: {} });
  assert.equal(saved.kind, "occasion");
  assert.deepEqual(saved.enhancements, products);
  assert.deepEqual(saved.slots, {});
  assert.deepEqual((await dispatch("list", {})).find(look => look.id === saved.id), saved);
  const otherSave = await dispatch("save", { optionId: option.id, slots: {} });
  const suggestions = await dispatch("shopping", { lookId: saved.id });
  const accessory = suggestions.find(item => item.catalogSlot === "accessory");
  const bottom = suggestions.find(item => item.catalogSlot === "bottom");
  assert.deepEqual(suggestions.map(item => item.catalogItemId), products.map(product => product.id));
  await assert.rejects(makeSession(2)("hide", { lookId: saved.id, id: accessory.id }), { status: 404 });
  await assert.rejects(dispatch("hide", { lookId: saved.id, id: "not-selected" }), { status: 404 });
  await Promise.all([1, 2].map(() => dispatch("hide", { lookId: saved.id, id: accessory.id })));
  assert.deepEqual((await dispatch("detail", { id: saved.id })).enhancements, products.filter(item => item.id !== accessory.catalogItemId));
  assert.deepEqual((await dispatch("detail", { id: otherSave.id })).enhancements, products);
  database.prepare("UPDATE clothes_image_database SET url='https://shopee.co.th/product/1/999' WHERE item_id=?").run(bottom.catalogItemId);
  assert.deepEqual((await dispatch("shopping", { lookId: saved.id })).map(item => item.catalogSlot), ["top"]);
  assert.deepEqual((await dispatch("enhancements", { optionId: option.id })).map(p => p.catalogSlot).sort(), ["accessory", "top"]);
  assert.equal(shoppingFetch.mock.callCount(), 0);
});

test("a wardrobe-only occasion look and an unavailable catalog-only look never receive extra suggestions", async t => {
  const shoppingFetch = t.mock.fn(() => { throw new Error("Do not search for substitutions"); });
  const { dispatch, optionId, database } = await startPlanner(t, undefined, original, shoppingFetch);
  database.prepare("UPDATE outfit_options SET look_kind='occasion' WHERE id=?").run(optionId);
  assert.deepEqual(await dispatch("enhancements", { optionId }), []);
  const saved = await dispatch("save", { optionId, slots: original });
  assert.deepEqual(await dispatch("shopping", { lookId: saved.id }), []);
  assert.equal(saved.kind, "occasion");
  const runId = database.prepare("SELECT run_id FROM outfit_options WHERE id=?").get(optionId).run_id;
  const empty = database.prepare(`INSERT INTO outfit_options (user_id,run_id,position,title,look_kind)
    VALUES (1,?,11,'Beach day','occasion') RETURNING CAST(id AS TEXT) AS id`).get(runId);
  await assert.rejects(dispatch("save", { optionId: empty.id, slots: {} }));
  assert.equal(shoppingFetch.mock.callCount(), 0);
});
