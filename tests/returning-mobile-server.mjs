import assert from "node:assert/strict";
import { encode } from "@auth/core/jwt";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { encode as encodePng } from "fast-png";
import jpeg from "jpeg-js";
import { handleApi } from "../src/app/api/_server/handle-api.mjs";

const output = resolve(process.argv[2] ?? "out");
const database = new DatabaseSync(":memory:");
const schema = new URL("../drizzle/", import.meta.url);
const portraitRef = accountId => `private/${accountId}/10000000-0000-4000-8000-00000000000${accountId}`;
database.exec(await readFile(new URL("0000_stylist.sql", schema), "utf8"));
database.exec(`
  INSERT INTO users (id, auth_provider, auth_subject) VALUES
    (1, 'google', 'fixture-returning-user'), (2, 'google', 'fixture-other-account'),
    (3, 'google', 'fixture-profile-only'), (4, 'google', 'fixture-empty-closet');
  INSERT INTO profiles (user_id, face_photo_file_id) VALUES
    (1, '${portraitRef(1)}'), (2, '${portraitRef(2)}'), (3, '${portraitRef(3)}'), (4, '${portraitRef(4)}');
  INSERT INTO wardrobe_items (id, user_id, name, category, color, image_file_id, confirmed_at, archived_at) VALUES
    (11, 1, 'Silk blouse', 'top', 'Cream', 'blouse', 'confirmed', NULL),
    (12, 1, 'Wool trousers', 'bottom', 'Navy', 'trousers', 'confirmed', NULL),
    (13, 1, 'Leather heels', 'shoes', 'Black', 'heels', 'confirmed', NULL),
    (14, 1, 'Walking flats', 'shoes', 'Black', 'flats', 'confirmed', NULL),
    (15, 1, 'Column dress', 'dress', 'Purple', 'dress', 'confirmed', NULL),
    (16, 1, 'Unconfirmed shirt', 'top', 'Blue', 'shirt', NULL, NULL),
    (17, 1, 'Archived coat', 'outerwear', 'Sand', 'coat', 'confirmed', 'archived'),
    (18, 2, 'Private scarf', 'accessory', 'Red', 'scarf', 'confirmed', NULL);
`);
for (const file of (await readdir(schema)).sort()) {
  if (file !== "0000_stylist.sql" && file.endsWith(".sql")) {
    database.exec(await readFile(new URL(file, schema), "utf8"));
  }
}

for (const id of [1, 2, 3, 4]) {
  database.prepare("INSERT INTO private_files (file_id,user_id,state) VALUES (?,?,'ready')").run(portraitRef(id), id);
}

const db = {
  prepare(sql) {
    const statement = database.prepare(sql);
    return {
      bind(...values) {
        const parameters = /\?\d/u.test(sql)
          ? [Object.fromEntries(values.map((value, index) => [String(index + 1), value]))]
          : values;
        return {
          first: async () => statement.get(...parameters) ?? null,
          all: async () => ({ results: statement.all(...parameters) }),
          run: async () => statement.run(...parameters),
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

const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/f6kAAAAASUVORK5CYII=",
  "base64",
);
const tryOnJpeg = jpeg.encode({ width: 1, height: 1, data: Buffer.from([255, 255, 255, 255]) }).data.toString("base64");
function listingJpeg(photoKey) {
  const color = createHash("sha256").update(photoKey).digest().subarray(0, 3);
  return jpeg.encode({ width: 1, height: 1, data: Buffer.from([...color, 255]) }).data;
}
const enhancedTryOn = jpeg.encode({ width: 1, height: 1, data: Buffer.from([255, 0, 0, 255]) }).data.toString("base64");
const photos = new Map(["blouse", "trousers", "heels", "flats", "dress", "scarf"].map(id => [
  id, { body: image, httpMetadata: { contentType: "image/png" } },
]));
const face = jpeg.encode({ data: Buffer.from([120, 140, 160, 255]), width: 1, height: 1 }).data;
for (const id of [1, 2, 3, 4]) photos.set(portraitRef(id), { body: face, httpMetadata: { contentType: "image/jpeg" } });
const env = {
  DB: db,
  BUCKET: {
    head: async id => photos.has(id) ? { size: photos.get(id).body.byteLength } : null,
    get: async id => {
      if (id.startsWith("clothes_image_database/")) {
        const row = database.prepare("SELECT 1 FROM clothes_listing_details WHERE ocr_image=?").get(id);
        if (!row) return null;
        const photo = new Blob([listingJpeg(id)], { type: "image/jpeg" });
        return { size: photo.size, httpMetadata: { contentType: photo.type }, arrayBuffer: () => photo.arrayBuffer() };
      }
      const file = photos.get(id);
      return file && {
        ...file, size: file.body.byteLength,
        arrayBuffer: () => new Blob([file.body]).arrayBuffer(),
      };
    },
    put: async (id, body, options) => { photos.set(id, { body: Buffer.from(body), ...options }); },
    delete: async id => { photos.delete(id); },
  },
  AUTH_SECRET: crypto.randomUUID(),
  GOOGLE_CLIENT_ID: "fixture-google-client",
  GOOGLE_CLIENT_SECRET: "fixture-google-secret",
  OPENAI_API_KEY: "fixture-key",
};
const origin = "https://mbti-closet.stonyimpala.chatgpt.site";
const cookieName = "__Secure-authjs.session-token";
const sessions = new Map();
for (const name of ["first-session", "returning-session", "rating-session", "other-account", "profile-only", "empty-closet"]) {
  sessions.set(name, await encode({
    secret: env.AUTH_SECRET,
    salt: cookieName,
    token: {
      googleSubject: ["profile-only", "other-account", "empty-closet"].includes(name) ? "fixture-" + name : "fixture-returning-user",
    },
  }));
}

// Keep candidate construction, Decisions parsing and ranking in the production code.
let enhancementRequests = 0;
let providerCalls = 0;
function outfitExtractionFixture() {
  const garments = [
    { name: "Striped shirt", category: "top", garment_type: "Shirt", color: "Blue" },
    { name: "Straight jeans", category: "bottom", garment_type: "Jeans", color: "Indigo" },
    { name: "White sneakers", category: "shoes", garment_type: "Sneakers", color: "White" },
  ];
  const size = 1024;
  const data = new Uint8Array(size * size * 4);
  for (const [index, rgb] of [[60, 100, 160], [36, 46, 84], [250, 250, 250]].entries()) {
    const left = (index % 2) * 512 + 144;
    const top = Math.floor(index / 2) * 512 + 144;
    for (let y = top; y < top + 224; y++) {
      for (let x = left; x < left + 224; x++) data.set([...rgb, 255], (y * size + x) * 4);
    }
  }
  const result = Buffer.from(encodePng({ width: size, height: size, data })).toString("base64");
  return Response.json({ status: "completed", output: [
    { type: "image_generation_call", status: "completed", result },
    { type: "message", role: "assistant", status: "completed", content: [
      { type: "output_text", text: JSON.stringify({ garments }) },
    ] },
  ] });
}

async function decisionsFixture(url, options) {
  if (String(url).startsWith("https://api.openai.com/")) providerCalls++;
  if (url === "https://api.openai.com/v1/images/edits") {
    assert.equal(options.body.get("output_format"), "jpeg");
    const prompt = options.body.get("prompt");
    const references = options.body.getAll("image[]");
    assert.deepEqual(Buffer.from(await references[0].arrayBuffer()), Buffer.from(face));
    const labels = [...prompt.matchAll(/^Image (\d+): (\{.*\})$/gmu)].map(([, index, json]) => ({
      index: Number(index) - 1, ...JSON.parse(json),
    }));
    assert.equal(labels.length, references.length - 1);
    const listings = labels.filter(piece => piece.source === "catalog");
    for (const { index, selectedItem, category } of listings) {
      const product = database.prepare("SELECT ocr_image FROM clothes_catalog WHERE name=? AND search_term=?").get(selectedItem, category);
      assert.ok(product);
      assert.deepEqual(Buffer.from(await references[index].arrayBuffer()), listingJpeg(product.ocr_image));
    }
    if (prompt.includes("Private scarf")) assert.equal(listings.length, 3);
    return Response.json({ data: [{ b64_json: listings.length ? enhancedTryOn : tryOnJpeg }] });
  }
  if (url === "https://api.openai.com/v1/responses") {
    const { input, text } = JSON.parse(options.body);
    if (text?.format?.name === "wardrobe_extraction") return outfitExtractionFixture();
    if (text?.format?.name === "occasion_outfit") {
      const brief = JSON.parse(input[0].content[0].text);
      const pieces = brief.occasion === "Charity gala" ? [
        { category: "top", description: "An elegant cream top for an evening gala" },
        { category: "bottom", description: "Dressy full-length trousers for the evening gala" },
      ] : [];
      return Response.json({ status: "completed", output: [{ type: "message", role: "assistant", status: "completed",
        content: [{ type: "output_text", text: JSON.stringify({ priority: "polished", pieces }) }] }] });
    }
    if (text?.format?.name === "visible_clothing") {
      assert.equal(input[0].content[0].image_url, "data:image/jpeg;base64," + Buffer.from(face).toString("base64"));
      const coverage = { top: false, bottom: false, dress: false, outerwear: false, shoes: false };
      return Response.json({ status: "completed", output: [{ type: "message", role: "assistant", status: "completed",
        content: [{ type: "output_text", text: JSON.stringify(coverage) }] }] });
    }
    const pieces = input[0].content.filter(part => part.type === "input_text" && part.text.startsWith("{"))
      .map(part => JSON.parse(part.text));
    for (const [i, part] of input[0].content.entries()) {
      if (part.type !== "input_text" || !part.text.startsWith("{")) continue;
      const piece = JSON.parse(part.text);
      if (piece.source !== "catalog") continue;
      const product = database.prepare("SELECT ocr_image FROM clothes_catalog WHERE name=? AND search_term=?").get(piece.name, piece.category);
      assert.ok(product);
      assert.equal(input[0].content[i + 1].image_url, "data:image/jpeg;base64," + listingJpeg(product.ocr_image).toString("base64"));
    }
    const visible_items = pieces.map(piece => piece.reference);
    if (pieces.some(piece => piece.name === "Column dress")) visible_items.push("unlisted");
    return Response.json({ status: "completed", output: [{ type: "message", role: "assistant", status: "completed",
      content: [{ type: "output_text", text: JSON.stringify({ full_body_try_on: true, visible_items }) }] }] });
  }
  assert.equal(url, "https://api.openai.com/v1/decisions");
  const { input, questions } = JSON.parse(options.body);
  const match = input[1].content[0].data;
  if (match.groups) {
    const answers = match.groups.map(({ question, category, candidates }) => {
      const term = category === "top" ? "women sweater" : "women pants";
      const pick = match.source === "wardrobe"
        ? candidates.find(candidate => candidate.name === "Silk blouse")
        : candidates.find(candidate => candidate.searchTerm === term);
      return { name: question, type: "choice", choice: pick?.value ?? "none" };
    });
    return Response.json({ answers });
  }
  if (questions.length === 1 && questions[0].name === "catalog_search") {
    const question = questions[0];
    const missing = input[1].content[0].data.missingGarment;
    const term = ({ top: "women sweater", pants: "women pants", bottom: "women pants", shoes: "women shoes", outerwear: "men jacket" })[missing] ?? "women necklace";
    const value = question.choices.find(choice => choice.description.endsWith(" / " + term)).value;
    return Response.json({ answers: [{ name: question.name, type: "choice", choice: value }] });
  }
  if (questions.length === 1 && questions[0].name === "shopee_product") {
    const { outfit } = input[1].content[0].data;
    if (outfit.some(item => item.category === "dress")) {
      return Response.json({ answers: [{ name: "shopee_product", type: "choice", choice: "none" }] });
    }
    if (outfit.some(item => item.name === "Walking flats") && enhancementRequests++ === 0) {
      return new Response(null, { status: 503 });
    }
    return Response.json({ answers: [{ name: "shopee_product", type: "choice", choice: questions[0].choices[0].value }] });
  }
  const brief = input.find(({ role }) => role === "user").content[0].data.brief;
  assert.deepEqual(brief.preferences, []);
  return Response.json({
    answers: questions.map((question) => {
      const slots = JSON.parse(question.instructions.match(/\{[^{}]+\}/u)[0]);
      const unsuitable = slots.shoes === "13" ? 0.8 : slots.dress ? 0.2 : 0.1;
      return {
        name: question.name,
        type: "choice",
        choice: unsuitable === 0.8 ? "unsuitable" : "formality",
        probabilities: [
          { value: "formality", probability: 1 - unsuitable },
          { value: "unsuitable", probability: unsuitable },
        ],
      };
    }),
  });
}
globalThis.fetch = decisionsFixture;

const types = new Map([
  [".css", "text/css"], [".html", "text/html"], [".js", "text/javascript"], [".png", "image/png"],
  [".svg", "image/svg+xml"], [".txt", "text/plain"], [".webmanifest", "application/manifest+json"],
]);
function reply(response, status, data, type = "application/json") {
  response.writeHead(status, { "Content-Type": type });
  response.end(type === "application/json" ? JSON.stringify(data) : data);
}

const server = createServer(async (request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  try {
    if (request.method === "POST" && path === "/__fixture/evict-preview") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const { ref } = JSON.parse(Buffer.concat(chunks).toString());
      const result = database.prepare("DELETE FROM planner_previews WHERE file_id = ?").run(ref);
      return reply(response, 200, { changes: result.changes });
    }
    if (path === "/__fixture/provider-calls") return reply(response, 200, providerCalls);
    if (path.startsWith("/api/")) {
      const headers = new Headers(request.headers);
      const session = /(?:^|;\s*)planner-fixture=([^;]+)/u.exec(headers.get("Cookie") ?? "")?.[1];
      const token = sessions.get(session);
      headers.delete("Cookie");
      if (token) headers.set("Cookie", cookieName + "=" + token);
      if (headers.get("Origin") === "http://" + request.headers.host) headers.set("Origin", origin);

      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const result = await handleApi(new Request(new URL(request.url, origin), {
        method: request.method, headers, body,
      }), env);
      response.writeHead(result.status, Object.fromEntries(result.headers));
      return response.end(Buffer.from(await result.arrayBuffer()));
    }

    const route = path.replace(/\/$/u, "");
    const page = !route ? "/index.html" : extname(route) ? route : route + ".html";
    const file = resolve(output, "." + page);
    if (!file.startsWith(output + sep)) return reply(response, 404, "Not found", "text/plain");
    return reply(response, 200, await readFile(file), types.get(extname(file)) ?? "application/octet-stream");
  } catch (error) {
    const status = error.status ?? (error.code === "ENOENT" ? 404 : 500);
    if (status === 500) console.error(error);
    return reply(response, status, { message: error.message });
  }
});
server.listen(0, "127.0.0.1", () => {
  process.stdout.write(`http://127.0.0.1:${server.address().port}\n`);
});
