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
  const makeSession = (user = accountId, key = "mock-provider-key") => {
    const env = { DB: d1Binding(database), OPENAI_API_KEY: key };
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
      status: "completed",
      output: [{ type: "image_generation_call", status: "completed", result: png.toString("base64") }],
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
  const [, request] = preview.fetch.mock.calls[0].arguments;
  const images = JSON.parse(request.body).input[0].content
    .filter(({ type }) => type === "input_image")
    .map(({ image_url }) => image_url);
  assert.deepEqual(images.sort(), [dress.imageRef, flats.imageRef]
    .map((reference) => "data:image/png;base64," + files.get(reference).toString("base64")).sort());
  assert.equal(preview.storeImage.mock.callCount(), 1);
  const [stored] = preview.storeImage.mock.calls[0].arguments;
  assert.deepEqual(Buffer.from(await stored.arrayBuffer()), png);
});

test("a dress-only option previews and saves without adding shoes", async (t) => {
  const slots = { dress: dress.id };
  const preview = {
    readImage: t.mock.fn(async () => new Blob(["dress"], { type: "image/png" })),
    fetch: async () => Response.json({
      status: "completed",
      output: [{ type: "image_generation_call", status: "completed", result: "iVBORw0KGgo=" }],
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
    answers: [{ name: "shopee_accessory", type: "choice", choice, ...extra }],
  });
}

test("Decisions selects a local Shopee search from the final outfit and the owner can hide it", async (t) => {
  // The old occasion rule selected earrings. A different choice proves the model
  // controls the selection without controlling the rendered title or URL.
  const shoppingFetch = t.mock.fn(async () => decision("clutch", {
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
  assert.equal(request.redirect, "error");
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
  assert.ok(payload.questions[0].choices.some(({ value }) => value === "clutch"));
  const [suggestion] = initial;
  assert.deepEqual(initial, [{
    id: suggestion.id,
    title: "Black clutch bag",
    url: "https://shopee.sg/search?keyword=black+clutch+bag",
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

test("existing suggestions and a saved accessory do not send a Decisions request", async (t) => {
  const shoppingFetch = t.mock.fn();
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
  assert.deepEqual(await dispatch("shopping", { lookId: accessorizedId }), []);
  assert.equal(shoppingFetch.mock.callCount(), 0);
});

test("an unavailable, refused, or invalid decision leaves no fallback row and can be retried", async (t) => {
  const responses = [
    new Response("provider unavailable", { status: 503 }),
    new Response("invalid JSON"),
    decision("https://example.invalid/injected"),
    decision("studs", { name: "wrong_question" }),
    decision(undefined, { type: "refusal" }),
    decision("studs"),
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
  assert.equal(suggestion.title, "Simple stud earrings");
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
