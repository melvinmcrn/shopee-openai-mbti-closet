import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { generateOccasionLook } from "../src/app/api/_server/planner/occasion-look.mjs";

const brief = { occasion: "Gallery opening", timing: "Evening", location: "Indoors",
  formality: "Smart casual", comfort: "Standing", preferences: ["top", "bottom"] };
const pieces = [
  { category: "top", description: "A navy ribbed sweater" },
  { category: "bottom", description: "Straight black trousers" },
  { category: "accessory", description: "A silver cuff bracelet" },
];
const garment = (id, category, name, changes = {}) => ({
  id, category, name, color: "", imageRef: `photo-${id}`, accountId: "1", confirmed: true, active: true, ...changes,
});
const listing = (id, term, name, changes = {}) => ({
  item_id: id, shop_id: "17", search_term: term, name,
  url: `https://shopee.co.th/product/17/${id}`, image_url: "https://down-th.img.susercontent.com/file/abc", ...changes,
});

function environment(rows = []) {
  const queries = [];
  const DB = { prepare(sql) {
    return { bind(...terms) {
      queries.push({ sql, terms });
      return { all: async () => ({ results: rows.filter(row => terms.includes(row.search_term)) }) };
    } };
  } };
  return { DB, OPENAI_API_KEY: "test-key", queries };
}

function provider(sketch, choose, priority = "polished") {
  const calls = [];
  async function request(url, init) {
    const body = JSON.parse(init.body);
    calls.push({ url, body, signal: init.signal });
    if (url.endsWith("/responses")) return Response.json({
      status: "completed", output: [{ role: "assistant", type: "message", status: "completed",
        content: [{ type: "output_text", text: JSON.stringify({ pieces: sketch, priority }) }] }],
    });
    assert.ok(url.endsWith("/decisions"));
    const { source, groups } = body.input[1].content[0].data;
    const answers = body.questions.map(question => {
      assert.ok(question.choices.some(c => c.value === "none"));
      const group = groups.find(group => group.question === question.name);
      return { name: question.name, type: "choice", choice: choose(group, source, groups) };
    });
    return Response.json({ answers: answers.reverse() });
  }
  return { calls, request };
}

test("designs only from the brief, then resolves owned matches before querying exact listings", async () => {
  const env = environment([
    listing("91", "women sweater", "Another navy sweater"),
    listing("92", "women pants", "Straight black trousers"),
    listing("93", "women watch", "Gold watch"),
    listing("94", "women pants", "Bad redirect", { url: "https://shopee.co.th/search?keyword=pants" }),
    listing("95", "women pants", "Mismatched SKU", { url: "https://shopee.co.th/product/17/92" }),
  ]);
  const wardrobe = [
    garment("2", "top", "Navy ribbed sweater"), garment("3", "bottom", "Yellow shorts"),
    garment("4", "bottom", "Retired trousers", { active: false }),
    garment("5", "accessory", "Pending bracelet", { confirmed: false }),
  ];
  const ai = provider(pieces, group => group.candidates.find(c => ["Navy ribbed sweater", "Straight black trousers"].includes(c.name))?.value ?? "none");
  const result = await generateOccasionLook(env, { ...brief, id: "private-brief-id", priorLook: "SECRET" }, wardrobe, ai.request);
  const sketch = ai.calls[0].body;
  assert.equal(sketch.text.format.name, "occasion_outfit");
  assert.deepEqual(JSON.parse(sketch.input[0].content[0].text), brief);
  assert.doesNotMatch(JSON.stringify(sketch), /Navy ribbed sweater|private-brief-id|SECRET|Retired trousers/i);
  assert.equal(ai.calls.every(call => call.signal instanceof AbortSignal), true);
  const [owned, catalog] = ai.calls.slice(1).map(call => call.body.input[1].content[0].data);
  assert.deepEqual([owned.source, catalog.source], ["wardrobe", "catalog"]);
  assert.doesNotMatch(JSON.stringify(owned), /Pending bracelet|Retired trousers|photo-/);
  assert.doesNotMatch(JSON.stringify(catalog), /Bad redirect|Mismatched SKU|Another navy sweater/);
  assert.equal(catalog.groups.find(group => group.category === "bottom").desired, pieces[1].description);
  assert.deepEqual(result.slots, { top: "2" });
  assert.deepEqual(result.catalogSlots, { bottom: "92" });
  assert.match(result.explanation, /polished/i);
  assert.doesNotMatch(result.explanation, /bracelet/i);
});

test("searches every page of a large wardrobe before suggesting a purchase", async () => {
  const env = environment([listing("91", "women dress", "Catalog dress")]);
  const wardrobe = Array.from({ length: 650 }, (_, i) => garment(String(i), "dress", `Dress ${i}`));
  const ai = provider([{ category: "dress", description: "A navy column dress" }],
    group => group.candidates.find(c => c.name === "Dress 649")?.value ?? "none");
  const result = await generateOccasionLook(env, brief, wardrobe, ai.request);
  assert.deepEqual(result.slots, { dress: "649" });
  assert.deepEqual(result.catalogSlots, {});
  assert.equal(env.queries.length, 0);
  assert.ok(ai.calls.length > 2);
  for (const { body } of ai.calls.slice(1)) {
    assert.ok(body.questions.length <= 8);
    assert.ok(body.questions.every(q => q.choices.length <= 32));
    assert.ok(Buffer.byteLength(JSON.stringify(body)) < 256 * 1024);
  }
});

test("rejects an incomplete base, unoffered IDs and out-of-slot choices", async () => {
  const env = environment([listing("11", "women sweater", "Navy ribbed sweater"), listing("12", "women pants", "Yellow shorts")]);
  for (const answer of ["none", "invented", "other slot"]) {
    const ai = provider(pieces, (group, source, groups) => {
      if (group.category !== "bottom") return group.candidates[0].value;
      return answer === "other slot" ? groups.find(g => g.category === "top").candidates[0].value : answer;
    });
    assert.equal(await generateOccasionLook(env, brief, [], ai.request), null);
  }
  const refused = provider(pieces, () => "none");
  assert.equal(await generateOccasionLook(env, brief, [], refused.request), null);
});

test("rejects conflicting and incomplete designs before searching", async () => {
  for (const sketch of [[], [pieces[2]], [pieces[0], pieces[1], pieces[1]],
    [...pieces, { category: "dress", description: "A navy column dress" }]]) {
    const env = environment();
    const ai = provider(sketch, () => "none");
    assert.equal(await generateOccasionLook(env, brief, [], ai.request), null);
    assert.equal(ai.calls.length, 1);
    assert.equal(env.queries.length, 0);
  }
});

test("can assemble a complete catalog-only look and omit an unavailable accessory", async () => {
  const env = environment([
    listing("20", "women sweater", "Navy ribbed sweater"),
    listing("21", "business women pants", "Straight black trousers"),
    listing("22", "women earrings", "Pearl studs"),
  ]);
  const ai = provider(pieces, group => group.category === "accessory" ? "none" : group.candidates[0].value, "tonal");
  const result = await generateOccasionLook(env, brief, [], ai.request);
  assert.deepEqual(result.slots, {});
  assert.deepEqual(result.catalogSlots, { top: "20", bottom: "21" });
  assert.match(result.explanation, /palette|tones|color/i);
  assert.doesNotMatch(result.explanation, /bracelet|earrings|studs/i);
  assert.equal(ai.calls.length, 2);
});

test("rejects a free-text stylist rationale that could mention an ungrounded accessory", async () => {
  const env = environment();
  const ai = provider(pieces, group => group.candidates[0].value, "Your ruby bracelet ties it all together.");
  const closet = [garment("1", "top", "Navy sweater"), garment("2", "bottom", "Straight black trousers")];
  assert.equal(await generateOccasionLook(env, brief, closet, ai.request), null);
  assert.equal(ai.calls.length, 1);
});

test("only offers trusted listings from the imported catalog, including previously unowned categories", async t => {
  const database = new DatabaseSync(":memory:");
  t.after(() => database.close());
  const migrations = new URL("../drizzle/", import.meta.url);
  for (const file of readdirSync(migrations).filter(file => file.endsWith(".sql")).sort()) {
    database.exec(readFileSync(new URL(file, migrations), "utf8"));
  }
  const DB = { prepare: sql => ({ bind: (...values) => ({ all: async () => ({ results: database.prepare(sql).all(...values) }) }) }) };
  const selected = database.prepare("SELECT name, item_id FROM clothes_catalog WHERE search_term = ? LIMIT 1");
  const jacket = selected.get("men jacket");
  const sneakers = selected.get("sneaker");
  const names = [jacket.name, sneakers.name].map(name => name.replace(/\s+/gu, " ").trim());
  const design = [{ category: "dress", description: "A navy column dress" }, { category: "outerwear", description: "A casual jacket" },
    { category: "shoes", description: "A pair of low sneakers" }];
  const ai = provider(design, (group, source) => source === "wardrobe" ? group.candidates[0].value :
    group.candidates.find(candidate => names.some(name => name.startsWith(candidate.name)))?.value ?? "none");
  const result = await generateOccasionLook({ DB, OPENAI_API_KEY: "test" }, brief, [garment("31", "dress", design[0].description)], ai.request);
  assert.deepEqual(result.slots, { dress: "31" });
  assert.deepEqual(result.catalogSlots, { outerwear: jacket.item_id, shoes: sneakers.item_id });
});

test("an unavailable provider or a mixed-owner wardrobe yields no catalog purchases", async () => {
  const env = environment();
  assert.equal(await generateOccasionLook(env, brief, [], async () => Response.json({}, { status: 503 })), null);
  const ai = provider(pieces, group => group.candidates[0].value);
  assert.equal(await generateOccasionLook(env, brief, [
    garment("1", "top", "Sweater"), garment("2", "bottom", "Trousers", { accountId: "other" }),
  ], ai.request), null);
  assert.equal(env.queries.length, 0);
});
