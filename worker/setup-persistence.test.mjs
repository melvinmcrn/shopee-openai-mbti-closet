import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { encode } from "@auth/core/jwt";
import worker from "./index.mjs";

const siteOrigin = "https://mbti-closet.stonyimpala.chatgpt.site";
const sessionCookie = "__Secure-authjs.session-token";
const authSecret = "local-integration-test-secret";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNwal7/HwAE8wJ0QEPG5gAAAABJRU5ErkJggg==", "base64");
const emptyProfile = { heightCm: null, weightKg: null, styles: [], facePhotoUrl: null, setupCompletedAt: null };

function setup(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const migrations = new URL("../drizzle/", import.meta.url);
  for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(new URL(file, migrations), "utf8"));
  }

  const DB = {
    prepare(sql) {
      return {
        bind(...parameters) {
          const statement = sqlite.prepare(sql);
          const select = () => ({ results: statement.all(...parameters) });
          const execute = () => statement.columns().length > 0
            ? select()
            : { results: [], meta: statement.run(...parameters) };
          return {
            first: async () => statement.get(...parameters) ?? null,
            all: async () => select(),
            run: async () => execute(),
            execute,
          };
        },
      };
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((statement) => statement.execute());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };

  const objects = new Map();
  const BUCKET = {
    async put(key, bytes, { httpMetadata }) {
      objects.set(key, { image: new Blob([bytes]), httpMetadata });
    },
    async head(key) {
      const object = objects.get(key);
      return object ? { size: object.image.size, httpMetadata: object.httpMetadata } : null;
    },
    async get(key) {
      const object = objects.get(key);
      if (!object) return null;
      return {
        ...await this.head(key),
        body: object.image.stream(),
        arrayBuffer: () => object.image.arrayBuffer(),
      };
    },
    async delete(key) {
      objects.delete(key);
    },
  };

  const assetDirectory = new URL("../public/sample-wardrobe/", import.meta.url);
  globalThis.SITE_ASSETS = Object.fromEntries(readdirSync(assetDirectory).map((name) => [
    `/sample-wardrobe/${name}`,
    ["image/webp", readFileSync(new URL(name, assetDirectory)).toString("base64")],
  ]));
  t.after(() => { delete globalThis.SITE_ASSETS; });

  const env = {
    DB,
    BUCKET,
    AUTH_SECRET: authSecret,
    GOOGLE_CLIENT_ID: "unused-test-client",
    GOOGLE_CLIENT_SECRET: "unused-test-client-secret",
  };
  return {
    env,
    async signIn(googleSubject, email) {
      // Reproduce the account row established by the Google callback before issuing a JWT.
      await DB.prepare(`
        INSERT INTO users (auth_provider, auth_subject, email) VALUES ('google', ?, ?)
        ON CONFLICT (auth_provider, auth_subject) DO UPDATE SET email = excluded.email
      `).bind(googleSubject, email).run();
      return cookieFor({ googleSubject, email });
    },
  };
}

async function cookieFor(token) {
  const jwt = await encode({ token, secret: authSecret, salt: sessionCookie });
  return `${sessionCookie}=${jwt}`;
}

function client(env, cookie) {
  return (path, { method = "GET", json, form, origin = siteOrigin } = {}) => {
    const headers = new Headers();
    if (cookie) headers.set("Cookie", cookie);
    if (method !== "GET" && method !== "HEAD" && origin !== null) headers.set("Origin", origin);
    if (json !== undefined) headers.set("Content-Type", "application/json");
    return worker.fetch(new Request(siteOrigin + path, {
      method,
      headers,
      body: form ?? JSON.stringify(json),
    }), env);
  };
}

async function jsonSuccess(response) {
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  return response.json();
}

test("setup saves three confirmed pieces and optional styles by Google account across sessions", async (t) => {
  const { env, signIn } = setup(t);
  const firstCookie = await signIn("google-owner", "before@example.com");
  const owner = client(env, firstCookie);
  const account = { method: "POST" };
  const originalSession = await jsonSuccess(await owner("/api/account", account));
  assert.ok(Number.isSafeInteger(originalSession.user.id));
  assert.deepEqual(await jsonSuccess(await owner("/api/profile")), emptyProfile);

  const { items: samples } = await jsonSuccess(await owner("/api/wardrobe/sample", { method: "POST" }));
  assert.deepEqual(await jsonSuccess(await owner("/api/wardrobe/items")), { items: [] });
  const shoes = samples.filter(({ category }) => category === "shoes");
  assert.equal(shoes.length, 2);
  assert.notEqual(shoes[0].id, shoes[1].id);
  assert.notEqual(shoes[0].imageUrl, shoes[1].imageUrl);

  const form = new FormData();
  form.set("draftKey", crypto.randomUUID());
  form.set("image", new Blob([png], { type: "image/png" }), "top.png");
  const { id: topId } = await jsonSuccess(await owner("/api/wardrobe/upload", { method: "POST", form }));
  assert.equal((await jsonSuccess(await owner("/api/wardrobe/upload", { method: "POST", form }))).id, topId);
  const { item: top } = await jsonSuccess(await owner(`/api/wardrobe/items/${topId}`, {
    method: "PATCH",
    json: { name: "My uploaded top", category: "top", confirm: true },
  }));
  assert.equal(top.id, topId);
  assert.equal(top.name, "My uploaded top");
  assert.equal(top.category, "top");

  const confirmed = [top];
  for (const piece of shoes) {
    const name = `My ${piece.name.toLowerCase()}`;
    const { item } = await jsonSuccess(await owner(`/api/wardrobe/items/${piece.id}`, {
      method: "PATCH",
      json: { name, confirm: true },
    }));
    assert.deepEqual(item, { ...piece, name });
    confirmed.push(item);
  }

  const styles = ["Casual", "Minimalist"];
  const setStyles = { method: "PATCH", json: { styles } };
  assert.equal((await owner("/api/profile", { ...setStyles, origin: null })).status, 403);
  assert.equal((await owner("/api/profile", { ...setStyles, origin: "https://elsewhere.example" })).status, 403);
  assert.deepEqual(await jsonSuccess(await owner("/api/profile")), emptyProfile);
  assert.deepEqual(await jsonSuccess(await owner("/api/profile", setStyles)), { ...emptyProfile, styles });
  const completed = await jsonSuccess(await owner("/api/profile", {
    method: "PATCH",
    json: { complete: true },
  }));
  assert.ok(Number.isFinite(Date.parse(completed.setupCompletedAt)));
  assert.deepEqual(completed, { ...emptyProfile, styles, setupCompletedAt: completed.setupCompletedAt });

  // Sign in again after changing email. The Google subject is the stable identity.
  const secondCookie = await signIn("google-owner", "after@example.com");
  assert.notEqual(secondCookie, firstCookie);
  const returningOwner = client(env, secondCookie);
  const returningSession = await jsonSuccess(await returningOwner("/api/account", account));
  assert.equal(returningSession.user.id, originalSession.user.id);
  assert.deepEqual(await jsonSuccess(await returningOwner("/api/profile")), completed);
  const { items: active } = await jsonSuccess(await returningOwner("/api/wardrobe/items"));
  assert.deepEqual(active, confirmed.toSorted((left, right) => right.id - left.id));
  const topImage = await returningOwner(top.imageUrl);
  assert.equal(topImage.status, 200);
  assert.equal(topImage.headers.get("Content-Type"), "image/png");
  assert.deepEqual(Buffer.from(await topImage.arrayBuffer()), png);
  const topImageHead = await returningOwner(top.imageUrl, { method: "HEAD" });
  assert.equal(topImageHead.status, 200);
  assert.equal(topImageHead.headers.get("Content-Length"), String(png.byteLength));
  assert.equal(topImageHead.body, null);

  const shoeImages = [];
  for (const { imageUrl } of shoes) {
    const image = await returningOwner(imageUrl);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get("Content-Type"), "image/webp");
    assert.equal(image.headers.get("Cache-Control"), "no-store");
    const bytes = Buffer.from(await image.arrayBuffer());
    assert.equal(bytes.toString("ascii", 8, 12), "WEBP");
    shoeImages.push(bytes);
  }
  assert.notDeepEqual(shoeImages[0], shoeImages[1]);

  const otherOwner = client(env, await signIn("different-google-owner", "after@example.com"));
  const otherSession = await jsonSuccess(await otherOwner("/api/account", account));
  assert.notEqual(otherSession.user.id, returningSession.user.id);
  assert.deepEqual(await jsonSuccess(await otherOwner("/api/profile")), emptyProfile);
  assert.deepEqual(await jsonSuccess(await otherOwner("/api/wardrobe/items")), { items: [] });
  assert.equal((await otherOwner(shoes[0].imageUrl)).status, 404);
  assert.equal((await otherOwner(`/api/wardrobe/items/${top.id}`, {
    method: "PATCH",
    json: { name: "Another account's item" },
  })).status, 404);

  const unregistered = client(env, await cookieFor({ googleSubject: "unregistered-google-owner" }));
  assert.equal(await jsonSuccess(await unregistered("/api/account", account)), null);
  assert.equal((await unregistered("/api/profile")).status, 401);

  const signedOut = client(env);
  for (const path of ["/api/profile", "/api/wardrobe/items", shoes[0].imageUrl]) {
    assert.equal((await signedOut(path)).status, 401);
  }
  assert.equal((await signedOut("/api/profile", setStyles)).status, 401);
});
