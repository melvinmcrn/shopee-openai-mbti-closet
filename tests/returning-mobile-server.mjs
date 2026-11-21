import assert from "node:assert/strict";
import { encode } from "@auth/core/jwt";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
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
const env = {
  DB: db,
  BUCKET: {
    get: async () => ({ body: image, size: image.length, httpMetadata: { contentType: "image/png" } }),
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
let shoppingRequests = 0;
async function decisionsFixture(url, options) {
  assert.equal(url, "https://api.openai.com/v1/decisions");
  const { input, questions } = JSON.parse(options.body);
  if (questions.length === 1 && questions[0].name === "shopee_accessory") {
    if (shoppingRequests++ === 0) return new Response(null, { status: 503 });
    return Response.json({ answers: [{ name: "shopee_accessory", type: "choice", choice: "clutch" }] });
  }
  const brief = input.find(({ role }) => role === "user").content[0].data.brief;
  assert.deepEqual(brief.preferences, []);
  return Response.json({
    answers: questions.map((question) => {
      const slots = JSON.parse(question.instructions.match(/\{[^{}]+\}/u)[0]);
      const unsuitable = slots.shoes === "14" ? 0.8 : slots.dress ? 0.2 : 0.1;
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
    if (path === "/api/planner" || path.startsWith("/api/files/")) {
      const headers = new Headers(request.headers);
      const session = /(?:^|;\s*)planner-fixture=([^;]+)/u.exec(headers.get("Cookie") ?? "")?.[1];
      const token = sessions.get(session);
      headers.delete("Cookie");
      if (token) headers.set("Cookie", cookieName + "=" + token);
      if (headers.get("Origin") === "http://" + request.headers.host) headers.set("Origin", origin);

      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const result = await handleApi(new Request(new URL(path, origin), {
        method: request.method, headers, body,
      }), env);
      response.writeHead(result.status, Object.fromEntries(result.headers));
      return response.end(Buffer.from(await result.arrayBuffer()));
    }

    const page = path === "/" ? "/index.html" : /^\/planner\/?$/u.test(path) ? "/planner.html" : path;
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
