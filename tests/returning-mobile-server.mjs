import assert from "node:assert/strict";
import { encode } from "@auth/core/jwt";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { encode as encodePng } from "fast-png";
import jpeg from "jpeg-js";
import { readSampleImage } from "../src/app/api/_server/read-sample-image.mjs";
import { handleApi } from "../src/app/api/_server/handle-api.mjs";

const output = resolve(process.argv[2] ?? "out");
const database = new DatabaseSync(":memory:");
const schema = new URL("../drizzle/", import.meta.url);
database.exec(await readFile(new URL("0000_stylist.sql", schema), "utf8"));
database.exec(`
  INSERT INTO users (id, auth_provider, auth_subject) VALUES
    (1, 'google', 'fixture-returning-user'), (2, 'google', 'fixture-other-account');
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
const photos = new Map(["blouse", "trousers", "heels", "flats", "dress"].map(id => [
  id, { body: image, httpMetadata: { contentType: "image/png" } },
]));
const env = {
  readSampleImage,
  DB: db,
  BUCKET: {
    get: async id => {
      const photo = photos.get(id);
      return photo && {
        ...photo, size: photo.body.byteLength,
        arrayBuffer: () => new Blob([photo.body]).arrayBuffer(),
      };
    },
    put: async (id, body, { httpMetadata }) => { photos.set(id, { body: Buffer.from(body), httpMetadata }); },
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
for (const name of ["first-session", "returning-session", "rating-session", "other-account"]) {
  sessions.set(name, await encode({
    secret: env.AUTH_SECRET,
    salt: cookieName,
    token: {
      googleSubject: name === "other-account" ? "fixture-other-account" : "fixture-returning-user",
    },
  }));
}

// Keep candidate construction, Decisions parsing and ranking in the production code.
let enhancementRequests = 0;
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
  if (url === "https://api.openai.com/v1/images/edits") {
    return Response.json({ data: [{ b64_json: tryOnJpeg }] });
  }
  if (url === "https://api.openai.com/v1/responses") {
    if (JSON.parse(options.body).text?.format?.name === "wardrobe_extraction") return outfitExtractionFixture();
    return Response.json({
      status: "completed",
      output: [{ type: "image_generation_call", status: "completed", result: tryOnJpeg }],
    });
  }
  assert.equal(url, "https://api.openai.com/v1/decisions");
  const { input, questions } = JSON.parse(options.body);
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
