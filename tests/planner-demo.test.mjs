import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { dispatchPlanner } from "../worker/planner/api.mjs";

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
  for (const filename of readdirSync(directory).sort()) {
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
