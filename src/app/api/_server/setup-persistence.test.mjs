import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { encode } from "@auth/core/jwt";
import { encode as encodePng } from "fast-png";
import { userData } from "./user-data.mjs";
import { handleApi } from "./handle-api.mjs";

const siteOrigin = "https://mbti-closet.stonyimpala.chatgpt.site";
const sessionCookie = "__Secure-authjs.session-token";
const authSecret = "local-integration-test-secret";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNwal7/HwAE8wJ0QEPG5gAAAABJRU5ErkJggg==", "base64");
const emptyProfile = { heightCm: null, weightKg: null, styles: [], facePhotoUrl: null, setupCompletedAt: null };

function setup(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const migrations = new URL("../../../../drizzle/", import.meta.url);
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
    return handleApi(new Request(siteOrigin + path, {
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

test("the closet can count pending drafts when it has no confirmed items", async (t) => {
  const { env, signIn } = setup(t);
  const owner = client(env, await signIn("closet-owner", "owner@example.com"));
  const other = client(env, await signIn("other-owner", "other@example.com"));
  const { user } = await jsonSuccess(await owner("/api/account", { method: "POST" }));
  await env.DB.prepare("INSERT INTO private_files (file_id, user_id, state) VALUES ('photo', ?, 'ready')")
    .bind(user.id).run();
  const insert = env.DB.prepare(`
    INSERT INTO wardrobe_items (user_id, name, category, archived_at, image_file_id) VALUES (?, ?, 'top', ?, 'photo')
  `);
  await insert.bind(user.id, "Pending shirt", null).run();
  await insert.bind(user.id, "Archived draft", "archived").run();
  const path = "/api/wardrobe/items?includeDraftCount=1";
  assert.deepEqual(await jsonSuccess(await owner(path)), { items: [], draftCount: 1 });
  assert.deepEqual(await jsonSuccess(await other(path)), { items: [], draftCount: 0 });
});

test("setup saves three pieces and styles without a photo, then persists a later photo across Google sessions", async (t) => {
  const { env, signIn } = setup(t);
  const firstCookie = await signIn("google-owner", "before@example.com");
  const owner = client(env, firstCookie);
  const account = { method: "POST" };
  const originalSession = await jsonSuccess(await owner("/api/account", account));
  assert.ok(Number.isSafeInteger(originalSession.user.id));
  assert.deepEqual(await jsonSuccess(await owner("/api/profile")), emptyProfile);

  const retiredSampleRoute = await owner("/api/wardrobe/sample", { method: "POST" });
  assert.equal(retiredSampleRoute.status, 404);
  assert.deepEqual(await jsonSuccess(await owner("/api/wardrobe/items")), { items: [] });

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

  const shoes = [];
  const shoePhotos = [];
  for (const [name, garmentType, color, value] of [
    ["My white sneakers", "Sneakers", "White", 240],
    ["My black loafers", "Loafers", "Black", 15],
  ]) {
    const bytes = encodePng({
      width: 1, height: 1, channels: 4, data: Uint8Array.of(value, value, value, 255),
    });
    shoePhotos.push(bytes);
    const form = new FormData();
    form.set("draftKey", crypto.randomUUID());
    form.set("image", new Blob([bytes], { type: "image/png" }), "shoes.png");
    const { id } = await jsonSuccess(await owner("/api/wardrobe/upload", { method: "POST", form }));
    const { item } = await jsonSuccess(await owner(`/api/wardrobe/items/${id}`, {
      method: "PATCH",
      json: { name, category: "shoes", garmentType, color, confirm: true },
    }));
    assert.equal(item.name, name);
    assert.equal(item.garmentType, garmentType);
    shoes.push(item);
  }
  assert.notEqual(shoes[0].id, shoes[1].id);
  assert.notEqual(shoes[0].imageUrl, shoes[1].imageUrl);

  // Model an item already added by the retired feature. Removing its route
  // must not hide the item, its private image, or looks that reference it.
  await env.DB.prepare("UPDATE wardrobe_items SET sample_slug = ? WHERE user_id = ? AND id = ?")
    .bind("black-penny-loafers", originalSession.user.id, shoes[1].id).run();
  const confirmed = [top, ...shoes];

  const styles = ["Casual", "Minimalist"];
  const setStyles = { method: "PATCH", json: { styles } };
  assert.equal((await owner("/api/profile", { ...setStyles, origin: null })).status, 403);
  assert.equal((await owner("/api/profile", { ...setStyles, origin: "https://elsewhere.example" })).status, 403);
  assert.deepEqual(await jsonSuccess(await owner("/api/profile")), emptyProfile);
  assert.deepEqual(await jsonSuccess(await owner("/api/profile", setStyles)), { ...emptyProfile, styles });
  const completeSetup = { method: "PATCH", json: { complete: true } };
  const withoutPhoto = await jsonSuccess(await owner("/api/profile", completeSetup));
  assert.ok(Number.isFinite(Date.parse(withoutPhoto.setupCompletedAt)));
  assert.deepEqual(withoutPhoto, { ...emptyProfile, styles, setupCompletedAt: withoutPhoto.setupCompletedAt });

  const photoForm = new FormData();
  photoForm.set("image", new Blob([png], { type: "image/png" }), "profile.png");
  const { facePhotoUrl } = await jsonSuccess(await owner("/api/profile/photo", { method: "PUT", form: photoForm }));
  assert.ok(facePhotoUrl.startsWith("/api/files/"));
  const completed = await jsonSuccess(await owner("/api/profile", completeSetup));
  assert.equal(completed.setupCompletedAt, withoutPhoto.setupCompletedAt);
  assert.deepEqual(completed, { ...emptyProfile, styles, facePhotoUrl, setupCompletedAt: completed.setupCompletedAt });

  const records = userData(env.DB, originalSession.user.id);
  const occasion = await records.createOutfitRequest({ occasion: "Dinner" });
  const run = await records.createGenerationRun({ requestId: occasion.id, status: "completed" });
  const option = await records.createOutfitOption({
    runId: run.id, position: 1, title: "Dinner", slots: [
      { slot: "top", itemId: top.id }, { slot: "shoes", itemId: shoes[0].id },
    ],
  });
  const saved = await records.saveLook({
    sourceOptionId: option.id, name: "Dinner in loafers", slots: [
      { slot: "top", itemId: top.id }, { slot: "shoes", itemId: shoes[1].id },
    ],
  });

  // Sign in again after changing email. The Google subject is the stable identity.
  const secondCookie = await signIn("google-owner", "after@example.com");
  assert.notEqual(secondCookie, firstCookie);
  const returningOwner = client(env, secondCookie);
  const returningSession = await jsonSuccess(await returningOwner("/api/account", account));
  assert.equal(returningSession.user.id, originalSession.user.id);
  assert.deepEqual(await jsonSuccess(await returningOwner("/api/profile")), completed);
  const { items: active } = await jsonSuccess(await returningOwner("/api/wardrobe/items"));
  assert.deepEqual(active, confirmed.toSorted((left, right) => right.id - left.id));
  const reloaded = userData(env.DB, returningSession.user.id);
  const savedShoe = (await reloaded.getSavedLook(saved.id)).slots.find(({ slot }) => slot === "shoes");
  const originalShoe = (await reloaded.getOutfitOption(option.id)).slots.find(({ slot }) => slot === "shoes");
  assert.equal(savedShoe.itemId, shoes[1].id);
  assert.equal(originalShoe.itemId, shoes[0].id);
  assert.equal((await reloaded.getWardrobeItem(savedShoe.itemId)).imageFileId, shoes[1].imageFileId);
  const topImage = await returningOwner(top.imageUrl);
  assert.equal(topImage.status, 200);
  assert.equal(topImage.headers.get("Content-Type"), "image/png");
  assert.deepEqual(Buffer.from(await topImage.arrayBuffer()), png);
  const topImageHead = await returningOwner(top.imageUrl, { method: "HEAD" });
  assert.equal(topImageHead.status, 200);
  assert.equal(topImageHead.headers.get("Content-Length"), String(png.byteLength));
  assert.equal(topImageHead.body, null);

  for (const [index, { imageUrl }] of shoes.entries()) {
    const image = await returningOwner(imageUrl);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get("Content-Type"), "image/png");
    assert.equal(image.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(new Uint8Array(await image.arrayBuffer()), shoePhotos[index]);
  }

  const otherOwner = client(env, await signIn("different-google-owner", "after@example.com"));
  const otherSession = await jsonSuccess(await otherOwner("/api/account", account));
  assert.notEqual(otherSession.user.id, returningSession.user.id);
  assert.deepEqual(await jsonSuccess(await otherOwner("/api/profile")), emptyProfile);
  assert.deepEqual(await jsonSuccess(await otherOwner("/api/wardrobe/items")), { items: [] });
  assert.equal((await otherOwner(shoes[0].imageUrl)).status, 404);
  assert.equal((await otherOwner(facePhotoUrl)).status, 404);
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

test("incomplete setup resumes saved drafts, style and ready in another session", async t => {
  const { env, signIn } = setup(t);
  const owner = client(env, await signIn("resume-owner", "owner@example.com"));
  const resume = async () => (await jsonSuccess(await owner("/api/profile?resume=1"))).setupStage;
  assert.equal(await resume(), "add");
  const form = new FormData();
  form.set("draftKey", crypto.randomUUID());
  form.set("image", new Blob([png], { type: "image/png" }), "top.png");
  await jsonSuccess(await owner("/api/wardrobe/upload", { method: "POST", form }));
  assert.equal(await resume(), "confirm");
  await jsonSuccess(await owner("/api/profile", { method: "PATCH", json: { setupStage: "style" } }));
  assert.equal(await resume(), "style");
  await jsonSuccess(await owner("/api/profile", { method: "PATCH", json: { styles: [], setupStage: "ready" } }));
  const next = client(env, await signIn("resume-owner", "new@example.com"));
  assert.equal((await jsonSuccess(await next("/api/profile?resume=1"))).setupStage, "ready");
  const other = client(env, await signIn("resume-other", "other@example.com"));
  assert.equal((await jsonSuccess(await other("/api/profile?resume=1"))).setupStage, "add");
});
