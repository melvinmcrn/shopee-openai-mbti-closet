import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { dispatchPlanner } from "../src/app/api/_server/planner/api.mjs";

async function withDatabase(path, callback) {
  const database = new DatabaseSync(path);
  try {
    return await callback(database);
  } finally {
    database.close();
  }
}

function d1Binding(database) {
  const batchStatements = new WeakMap();
  return {
    prepare(sql) {
      const statement = database.prepare(sql);
      return {
        bind(...params) {
          if (/\?\d/.test(sql)) params = [Object.fromEntries(params.map((value, i) => [String(i + 1), value]))];
          const run = () => {
            return { success: true, results: statement.all(...params).map(row => ({...row})) };
          };
          const boundStatement = {
            async first() {
              const row = statement.get(...params);
              return row ? { ...row } : null;
            },
            async all() {
              return { results: statement.all(...params).map((row) => ({ ...row })) };
            },
            async run() {
              return run();
            },
          };
          batchStatements.set(boundStatement, run);
          return boundStatement;
        },
      };
    },
    async batch(statements) {
      database.exec("BEGIN");
      try {
        const results = statements.map((statement) => batchStatements.get(statement)());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function migrate(database) {
  const directory = new URL("../drizzle/", import.meta.url);
  for (const filename of readdirSync(directory).filter(name => name.endsWith(".sql")).sort()) {
    database.exec(readFileSync(new URL(filename, directory), "utf8"));
  }
}

const blouse = { id: "9", name: "Silk blouse", category: "top", color: "Cream", imageRef: "wardrobe/blouse.jpg" };
const trousers = { id: "10", name: "Wool trousers", category: "bottom", color: "Navy", imageRef: "wardrobe/trousers.jpg" };
const heels = { id: "11", name: "Leather heels", category: "shoes", color: "Black", imageRef: "wardrobe/heels.jpg" };
const flats = { id: "12", name: "Walking flats", category: "shoes", color: "Black", imageRef: "wardrobe/flats.jpg" };
const garments = [blouse, trousers, heels, flats];

const originalSlots = { top: blouse.id, bottom: trousers.id, shoes: heels.id };
const refinedSlots = { ...originalSlots, shoes: flats.id };
const explanation = "The silk blouse and wool trousers fit the dinner dress code.";

test("generation adds one occasion option and keeps its sourced pieces through saving and reopening", async t => {
  await withDatabase(":memory:", async database => {
    migrate(database);
    database.exec("INSERT INTO users (id,auth_provider,auth_subject) VALUES (1,'google','owner')");
    database.prepare("INSERT INTO private_files(file_id,user_id,state) VALUES (?,1,'ready')").run(blouse.imageRef);
    database.prepare(`INSERT INTO wardrobe_items(id,user_id,name,category,color,image_file_id,confirmed_at)
      VALUES (?,1,?,?,?,?,CURRENT_TIMESTAMP)`).run(blouse.id, blouse.name, blouse.category, blouse.color, blouse.imageRef);
    const pick = database.prepare("SELECT item_id, url FROM clothes_catalog WHERE search_term='women pants' LIMIT 1").get();
    const env = { DB: d1Binding(database) };
    database.prepare(`INSERT INTO clothes_listing_details (item_id, search_group, search_term, image_url, ocr_image, is_mall)
      VALUES (?, 'occasion-variant', 'women pants', 'https://down-th.img.susercontent.com/file/variant', 'variant.jpg', 0)`).run(pick.item_id);
    const planned = { slots: { top: blouse.id },
      catalogSlots: { bottom: { id: pick.item_id, searchGroup: "occasion-variant", searchTerm: "women pants" } },
      explanation: "Styled for a gallery opening." };
    const dependencies = {
      generateLooks: async () => ({ status: "ready", looks: [{ slots: { top: blouse.id }, explanation: "Closet option" }] }),
      generateOccasionLook: t.mock.fn(async () => planned),
    };
    const dispatch = (action, input) => dispatchPlanner(env, 1, action, input, dependencies);
    const brief = await dispatch("saveBrief", { occasion: "Evening gallery opening" });
    const result = await dispatch("generate", { briefId: brief.id });
    assert.equal(result.looks.length, 2);
    const [regular, extra] = result.looks;
    assert.equal(regular.explanation, "Closet option");
    assert.equal(extra.kind, "occasion");
    assert.deepEqual(extra.slots, { top: blouse.id });
    assert.equal((await dispatch("option", { id: extra.id })).kind, "occasion");
    const [product] = await dispatch("enhancements", { optionId: extra.id, slots: extra.slots });
    assert.equal(product.id, pick.item_id);
    assert.equal(product.ocrImage, "variant.jpg");
    assert.equal(product.url, new URL(pick.url).href);
    const saved = await dispatch("save", { optionId: extra.id, slots: extra.slots });
    assert.deepEqual(saved.enhancements.map(item => item.id), [pick.item_id]);
    const more = await dispatch("generate", { briefId: brief.id, priorLooks: result.looks });
    assert.ok(more.looks.every(look => look.kind !== "occasion"));
    assert.equal(dependencies.generateOccasionLook.mock.callCount(), 1);

    // If the listing disappears before the writes, the ordinary option still succeeds.
    planned.catalogSlots = { bottom: "retired-listing" };
    const stale = await dispatch("generate", { briefId: brief.id });
    assert.deepEqual(stale.looks.map(look => look.explanation), ["Closet option"]);
  });
});

test("an empty closet gets the best weak catalog matches and requires a portrait only for the try-on", async t => {
  await withDatabase(":memory:", async database => {
    migrate(database);
    database.exec("INSERT INTO users (id,auth_provider,auth_subject) VALUES (1,'google','owner')");
    const listing = database.prepare("SELECT item_id FROM clothes_catalog WHERE search_term=? ORDER BY item_id DESC LIMIT 1");
    const catalogSlots = { top: listing.get("women tank top").item_id, bottom: listing.get("women pants").item_id };
    const rename = database.prepare("UPDATE clothes_image_database SET name=? WHERE item_id=?");
    for (const [slot, id] of Object.entries(catalogSlots)) rename.run(`Closest available ${slot}`, id);
    const pieces = [
      { category: "top", description: "A breezy linen shirt" },
      { category: "bottom", description: "Lightweight linen trousers" },
    ];
    t.mock.method(globalThis, "fetch", async (url, init) => {
      if (url.endsWith("/responses")) return Response.json({
        status: "completed", output: [{ role: "assistant", type: "message", status: "completed",
          content: [{ type: "output_text", text: JSON.stringify({ pieces, priority: "understated" }) }] }],
      });
      assert.ok(url.endsWith("/decisions"));
      const { groups } = JSON.parse(init.body).input[1].content[0].data;
      return Response.json({ answers: groups.map(({ question, category, candidates }) => {
        const probabilities = candidates.map(({ value, name }) => ({
          value, probability: name === `Closest available ${category}` ? 0.01 : 0.0001,
        }));
        const total = probabilities.reduce((sum, entry) => sum + entry.probability, 0);
        probabilities.push({ value: "none", probability: 1 - total });
        return { name: question, type: "choice", choice: "none", probabilities };
      }) });
    });
    const env = { DB: d1Binding(database), OPENAI_API_KEY: "test-key" };
    const dispatch = (action, input) => dispatchPlanner(env, 1, action, input);
    const brief = await dispatch("saveBrief", { occasion: "Summer lunch" });
    const result = await dispatch("generate", { briefId: brief.id });
    assert.equal(result.status, "ready");
    assert.equal(result.looks.length, 1);
    const [look] = result.looks;
    assert.equal(look.kind, "occasion");
    const products = await dispatch("enhancements", { optionId: look.id, slots: look.slots });
    assert.deepEqual(Object.fromEntries(products.map(product => [product.catalogSlot, product.id])), catalogSlots);
    const catalogItemIds = Object.values(catalogSlots);
    await assert.rejects(dispatch("preview", { optionId: look.id, catalogItemIds }), { code: "profile_photo_required" });
    const saved = await dispatch("save", { optionId: look.id, slots: {} });
    assert.deepEqual(saved.slots, {});
    assert.deepEqual(saved.enhancements.map(item => item.id).sort(), [...catalogItemIds].sort());
  });
});

test("a shoe swap survives a reopened planner session and stays private to its account", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "planner-demo-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const databasePath = join(directory, "planner.sqlite");
  const accountId = 1;
  const otherAccountId = 2;
  const briefInput = {
    occasion: "Anniversary dinner",
    timing: "Saturday evening",
    location: "Downtown restaurant",
    formality: "Smart casual",
    comfort: "Comfortable for the walk home",
    preferences: ["shoes"],
  };

  const { optionId, saved } = await withDatabase(databasePath, async (database) => {
    migrate(database);
    database.exec("INSERT INTO users (id,auth_provider,auth_subject) VALUES (1,'google','owner'),(2,'google','other')");
    for (const item of garments) {
      database.prepare("INSERT INTO private_files(file_id,user_id,state) VALUES (?,1,'ready')").run(item.imageRef);
      database.prepare(`INSERT INTO wardrobe_items(id,user_id,name,category,color,image_file_id,confirmed_at)
        VALUES (?,1,?,?,?,?,CURRENT_TIMESTAMP)`).run(item.id,item.name,item.category,item.color,item.imageRef);
    }
    const dependencies = {
      getGarments: async () => structuredClone(garments),
      generateLooks: t.mock.fn(async () => ({
        status: "ready",
        looks: [{ slots: { ...originalSlots }, explanation }],
      })),
    };
    const env = { DB: d1Binding(database) };
    const dispatch = (action, input) => dispatchPlanner(env, accountId, action, input, dependencies);

    const brief = await dispatch("saveBrief", briefInput);
    assert.equal(typeof brief.id, "string");
    assert.deepEqual(brief, { id: brief.id, ...briefInput });

    const generated = await dispatch("generate", { briefId: brief.id });
    assert.equal(generated.status, "ready");
    assert.equal(generated.looks.length, 1);
    const [option] = generated.looks;
    assert.equal(typeof option.id, "string");
    assert.equal(option.explanation, explanation);
    assert.deepEqual(option.slots, originalSlots);
    const optionId = option.id;
    assert.equal(dependencies.generateLooks.mock.callCount(), 1);
    assert.deepEqual(dependencies.generateLooks.mock.calls[0].arguments[1], brief);

    const saved = await dispatch("save", { optionId, slots: refinedSlots });
    assert.equal(typeof saved.id, "string");
    assert.equal(saved.optionId, optionId);
    assert.equal(saved.occasion, briefInput.occasion);
    assert.equal(saved.explanation, explanation);
    assert.deepEqual(saved.slots, { top: blouse, bottom: trousers, shoes: flats });
    assert.deepEqual(saved.originalSlots, { top: blouse, bottom: trousers, shoes: heels });
    assert.deepEqual(await dispatch("list", {}), [saved]);
    return { optionId, saved };
  });

  await withDatabase(databasePath, async (database) => {
    const newSession = { DB: d1Binding(database) };
    const dependencies = {
      getGarments: async () => [],
      generateLooks: t.mock.fn(async () => assert.fail("Reading saved data must not generate a new look")),
    };
    const dispatch = (account, action, input) => dispatchPlanner(newSession, account, action, input, dependencies);

    const original = await dispatch(accountId, "option", { id: optionId });
    assert.equal(original.id, optionId);
    assert.deepEqual(original.slots, originalSlots);
    assert.deepEqual(await dispatch(accountId, "list", {}), [saved]);
    assert.deepEqual(await dispatch(accountId, "detail", { id: saved.id }), saved);
    assert.deepEqual(await dispatch(otherAccountId, "list", {}), []);
    await assert.rejects(dispatch(otherAccountId, "detail", { id: saved.id }), { status: 404 });
    await assert.rejects(dispatch(otherAccountId, "option", { id: optionId }), { status: 404 });
    assert.equal(dependencies.generateLooks.mock.callCount(), 0);
  });
});
