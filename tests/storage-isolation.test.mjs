import { encode } from "@auth/core/jwt";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";

const origin = "https://mbti-closet.stonyimpala.chatgpt.site";
const secret = "test-only-auth-secret";
const sessionCookie = "__Secure-authjs.session-token";
const email = "shared@example.test";
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/WQAAAAASUVORK5CYII=";
const timestamp = "2026-01-01 00:00:00";

async function syntheticSession(subject, sub, sessionEmail = email) {
  const token = await encode({
    secret,
    salt: sessionCookie,
    token: { googleSubject: subject, sub, email: sessionEmail },
  });
  return sessionCookie + "=" + token;
}

async function localWorker(t) {
  const directory = new URL("../drizzle/", import.meta.url);
  const names = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  const migrations = await Promise.all(names.map((name) => readFile(new URL(name, directory), "utf8")));
  const { outputFiles: [bundle] } = await build({
    entryPoints: [fileURLToPath(new URL("./storage-isolation-worker.mjs", import.meta.url))],
    platform: "browser",
    format: "esm",
    bundle: true,
    write: false,
    define: { SITE_ASSETS: "{}", TEST_MIGRATIONS: JSON.stringify(migrations) },
  });
  const emulator = new Miniflare({
    modules: [{ type: "ESModule", path: "isolation-worker.mjs", contents: bundle.text }],
    compatibilityDate: "2025-06-01",
    bindings: {
      AUTH_SECRET: secret,
      GOOGLE_CLIENT_ID: "synthetic-client",
      GOOGLE_CLIENT_SECRET: "synthetic-secret",
    },
    d1Databases: ["DB"],
    r2Buckets: ["BUCKET"],
  });
  t.after(() => emulator.dispose());
  return emulator;
}

test("Google account, wardrobe, outfit, and photo isolation in workerd", { timeout: 20_000 }, async (t) => {
  const emulator = await localWorker(t);

  function request(path, { cookie, method = "GET", body, headers } = {}) {
    const requestHeaders = new Headers(headers);
    if (cookie) requestHeaders.set("Cookie", cookie);
    if (method === "POST" && !requestHeaders.has("Origin")) requestHeaders.set("Origin", origin);
    if (body !== undefined) requestHeaders.set("Content-Type", "application/json");
    return emulator.dispatchFetch(origin + path, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async function json(response, status = 200) {
    const body = await response.text();
    assert.equal(response.status, status, body);
    return JSON.parse(body);
  }

  async function fixture(operation, cookie, args, status) {
    return json(await request("/_test/" + operation, {
      method: "POST", cookie, body: { args },
    }), status);
  }

  function account(cookie, headers) {
    return request("/api/account", { method: "POST", cookie, headers });
  }

  const [alice, aliceNewSession, bob, unknown, legacy] = await Promise.all([
    syntheticSession("alice-google-subject", "session-a"),
    syntheticSession("alice-google-subject", "session-a-new", "new-email@example.test"),
    syntheticSession("bob-google-subject", "session-b"),
    syntheticSession("unregistered-google-subject", "session-other"),
    syntheticSession(undefined, "alice-google-subject"),
  ]);
  await fixture("seed", undefined, [["alice-google-subject", email], ["bob-google-subject", email]]);

  await t.test("account resolution uses the verified subject across sessions", async () => {
    const first = await account(alice);
    assert.match(first.headers.get("Cache-Control"), /no-store/);
    const { user: a } = await json(first);
    const { user: aNew } = await json(await account(aliceNewSession));
    const { user: b } = await json(await account(bob));
    assert.ok(Number.isSafeInteger(a.id));
    assert.equal(aNew.id, a.id);
    assert.equal(b.email, a.email);
    assert.notEqual(b.id, a.id);
    assert.ok(!Object.hasOwn(a, "googleSubject"));
    for (const cookie of [undefined, unknown, legacy]) {
      assert.equal(await json(await account(cookie)), null);
    }
    assert.equal((await account(alice, { Origin: "https://elsewhere.example.test" })).status, 403);
  });

  function dataFor(cookie) {
    return (method, ...args) => fixture("data", cookie, [method, ...args]);
  }

  const a = dataFor(alice);
  const aNew = dataFor(aliceNewSession);
  const b = dataFor(bob);
  const alicePhoto = await fixture("write-file", alice, [png, "image/png"]);
  const bobPhoto = await fixture("write-file", bob, [png, "image/png"]);
  const aliceGarmentPhoto = await fixture("write-file", alice, [png, "image/png"]);
  const filePath = (id) => "/api/files/" + encodeURIComponent(id);

  await t.test("photos are readable through private GET and HEAD only for their owner", async () => {
    await a("saveProfile", { heightCm: 170, facePhotoFileId: alicePhoto, styles: ["Casual"] });
    await b("saveProfile", { heightCm: 180, facePhotoFileId: bobPhoto, styles: ["Formal"] });
    assert.equal((await aNew("getProfile")).facePhotoFileId, alicePhoto);
    assert.equal((await b("getProfile")).facePhotoFileId, bobPhoto);

    for (const [owner, other, photo] of [[aliceNewSession, bob, alicePhoto], [bob, alice, bobPhoto]]) {
      for (const method of ["GET", "HEAD"]) {
        const options = { method };
        const allowed = await request(filePath(photo), { ...options, cookie: owner });
        assert.equal(allowed.status, 200);
        assert.match(allowed.headers.get("Cache-Control"), /no-store/);
        assert.equal(allowed.headers.get("Cross-Origin-Resource-Policy"), "same-origin");
        assert.equal(allowed.headers.get("X-Content-Type-Options"), "nosniff");
        assert.equal(allowed.headers.get("Content-Type"), "image/png");
        assert.equal(Number(allowed.headers.get("Content-Length")), Buffer.from(png, "base64").byteLength);
        const body = Buffer.from(await allowed.arrayBuffer());
        assert.deepEqual(body, method === "HEAD" ? Buffer.alloc(0) : Buffer.from(png, "base64"));

        const foreign = await request(filePath(photo), { ...options, cookie: other });
        assert.equal(foreign.status, 404);
        assert.match(foreign.headers.get("Cache-Control"), /no-store/);
        assert.equal(await foreign.text(), "");
        const signedOut = await request(filePath(photo), options);
        assert.equal(signedOut.status, 401);
        assert.equal(await signedOut.text(), "");
      }
      assert.equal((await request(filePath(photo), {
        cookie: owner, headers: { "Sec-Fetch-Site": "cross-site" },
      })).status, 403);
    }

    const invalid = await fixture("data", bob, ["saveProfile", { facePhotoFileId: alicePhoto }], 409);
    assert.match(invalid.message, /Private file is unavailable/);
    assert.equal((await b("getProfile")).facePhotoFileId, bobPhoto);
    assert.equal(await fixture("data", undefined, ["getProfile"], 401), null);
    assert.equal((await request(filePath(aliceGarmentPhoto), { cookie: alice })).status, 404);
  });

  function garment(data, name, category, imageFileId) {
    return data("createWardrobeItem", { name, category, imageFileId, confirmedAt: timestamp });
  }

  await t.test("cross-account IDs cannot read or change wardrobe and outfit records", async () => {
    const sneakers = await garment(a, "White low-top sneakers", "shoes", aliceGarmentPhoto);
    const loafers = await garment(a, "Black penny loafers", "shoes", aliceGarmentPhoto);
    const trousers = await garment(a, "Black trousers", "bottom", aliceGarmentPhoto);
    const runningShoes = await garment(b, "Green running shoes", "shoes", bobPhoto);

    assert.deepEqual((await aNew("listWardrobeItems")).map(({ id }) => id), [sneakers.id, loafers.id, trousers.id]);
    assert.deepEqual((await b("listWardrobeItems")).map(({ id }) => id), [runningShoes.id]);
    assert.equal(await b("getWardrobeItem", sneakers.id), null);
    assert.equal(await b("updateWardrobeItem", sneakers.id, { name: "Changed by Bob" }), null);
    assert.equal(await b("archiveWardrobeItem", sneakers.id), null);
    assert.deepEqual(await b("getActiveWardrobeItems", [sneakers.id, runningShoes.id]), [runningShoes]);

    const requestA = await a("createOutfitRequest", {
      occasion: "Dinner", comfortChoices: ["Relaxed"], clothingChoices: [{ category: "shoes", garmentType: "sneakers" }],
    });
    const requestB = await b("createOutfitRequest", { occasion: "Wedding" });
    assert.equal(await b("getOutfitRequest", requestA.id), null);
    assert.deepEqual(await aNew("getOutfitRequest", requestA.id), requestA);
    assert.equal(await b("createGenerationRun", { requestId: requestA.id }), null);
    const runA = await a("createGenerationRun", { requestId: requestA.id, status: "completed" });
    const runB = await b("createGenerationRun", { requestId: requestB.id });

    assert.equal(await b("getGenerationRun", runA.id), null);
    assert.equal(await b("updateGenerationRun", runA.id, { status: "failed" }), null);
    assert.equal((await a("getGenerationRun", runA.id)).status, "completed");

    const initialSlots = [{ slot: "shoes", itemId: sneakers.id }, { slot: "bottom", itemId: trousers.id }];
    const option = await a("createOutfitOption", {
      runId: runA.id, position: 1, title: "Dinner look", previewFileId: aliceGarmentPhoto, slots: initialSlots,
    });
    assert.ok(option);
    assert.equal(await b("getOutfitOption", option.id), null);
    assert.deepEqual(await b("listOutfitOptions", runA.id), []);
    assert.equal(await b("updateOutfitOptionPreview", option.id, bobPhoto), null);
    assert.equal(await b("createOutfitOption", {
      runId: runB.id, position: 1, title: "Invalid foreign slot", slots: initialSlots,
    }), null);
    assert.deepEqual(await b("listOutfitOptions", runB.id), []);

    const adjustedSlots = [{ slot: "shoes", itemId: loafers.id }, { slot: "bottom", itemId: trousers.id }];
    assert.equal(await b("saveLook", { sourceOptionId: option.id, name: "Foreign option", slots: [
      { slot: "shoes", itemId: runningShoes.id },
    ] }), null);
    assert.equal(await a("saveLook", { sourceOptionId: option.id, name: "Foreign swap", slots: [
      { slot: "shoes", itemId: runningShoes.id },
    ] }), null);

    const look = await aNew("saveLook", { sourceOptionId: option.id, name: "Final look", slots: adjustedSlots });
    assert.equal(look.sourceOptionId, option.id);
    assert.deepEqual(look.slots, [
      { slot: "bottom", itemId: trousers.id, itemName: trousers.name },
      { slot: "shoes", itemId: loafers.id, itemName: loafers.name },
    ]);
    assert.deepEqual(await a("getOutfitOption", option.id), option);
    assert.equal(option.slots.find(({ slot }) => slot === "shoes").itemId, sneakers.id);

    await a("updateWardrobeItem", loafers.id, { name: "Renamed loafers" });
    await a("archiveWardrobeItem", loafers.id);
    assert.deepEqual(await a("getSavedLook", look.id), look);
    assert.deepEqual(await a("getOutfitOption", option.id), option);
    assert.equal(await b("getSavedLook", look.id), null);
    assert.deepEqual(await b("listSavedLooks"), []);

    assert.equal(await b("addWearFeedback", look.id, { rating: 1 }), null);
    await a("addWearFeedback", look.id, { rating: 5 });
    assert.equal((await aNew("listWearFeedback", look.id))[0].rating, 5);
    assert.deepEqual(await b("listWearFeedback", look.id), []);

    const offer = { productName: "Shoes", productUrl: "https://shop.example.test/shoes" };
    assert.equal(await b("addShoppingSuggestion", look.id, offer), null);
    const suggestion = await a("addShoppingSuggestion", look.id, offer);
    assert.equal(await b("hideShoppingSuggestion", suggestion.id), null);
    assert.deepEqual(await b("listShoppingSuggestions", look.id), []);
    assert.deepEqual(await aNew("listShoppingSuggestions", look.id), [suggestion]);
  });

  function fileState(cookie, id) {
    return fixture("file-state", cookie, [id]);
  }

  async function waitForFileDeletion(cookie, id) {
    let state;
    for (let attempt = 0; attempt < 40; attempt++) {
      state = await fileState(cookie, id);
      if (state.state === null) break;
      await delay(25);
    }
    assert.deepEqual(state, { state: null, inBucket: false });
  }

  await t.test("file deletion respects ownership and references and cleans up D1 and R2", async () => {
    assert.equal(await fixture("delete-file", bob, [alicePhoto]), false);
    assert.equal(await fixture("delete-file", alice, [alicePhoto]), false);
    assert.deepEqual(await fileState(alice, alicePhoto), { state: "ready", inBucket: true });

    const orphan = await fixture("write-file", alice, [png, "image/png"]);
    assert.equal(await fixture("delete-file", bob, [orphan]), false);
    assert.equal(await fixture("delete-file", alice, [orphan]), true);
    assert.deepEqual(await fileState(alice, orphan), { state: null, inBucket: false });
    assert.equal(await fixture("delete-file", alice, [orphan]), false);

    await a("saveProfile", { heightCm: 170, styles: ["Casual"] });
    assert.deepEqual(await fileState(alice, alicePhoto), { state: "deleting", inBucket: true });
    assert.equal((await request(filePath(alicePhoto), { cookie: alice })).status, 404);

    await json(await account(bob));
    assert.deepEqual(await fileState(alice, alicePhoto), { state: "deleting", inBucket: true });
    await json(await account(aliceNewSession));

    await waitForFileDeletion(alice, alicePhoto);
    assert.equal((await request(filePath(aliceGarmentPhoto), { cookie: alice })).status, 200);
    assert.equal((await request(filePath(bobPhoto), { cookie: bob })).status, 200);
  });

  await t.test("expired uploads are cleaned up only if unattached and owned by the active account", async () => {
    const expired = await fixture("write-file", alice, [png, "image/png"]);
    const recent = await fixture("write-file", alice, [png, "image/png"]);
    assert.equal(await fixture("age-file", alice, [expired]), true);
    assert.equal(await fixture("age-file", alice, [aliceGarmentPhoto]), true);

    await json(await account(bob));
    assert.deepEqual(await fileState(alice, expired), { state: "ready", inBucket: true });
    await json(await account(alice));
    await waitForFileDeletion(alice, expired);
    assert.deepEqual(await fileState(alice, aliceGarmentPhoto), { state: "ready", inBucket: true });
    assert.deepEqual(await fileState(alice, recent), { state: "ready", inBucket: true });
  });
});
