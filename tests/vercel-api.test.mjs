import assert from "node:assert/strict";
import test from "node:test";
import { createVercelHandler } from "../server/vercel-api.mjs";

const origin = "https://development.example";
const credentials = {
  APP_ORIGIN: origin,
  AUTH_SECRET: "local-test-only",
  GOOGLE_CLIENT_ID: "test",
  GOOGLE_CLIENT_SECRET: "test",
};

test("the Vercel API uses the shared account handler and keeps responses private", async () => {
  const handle = createVercelHandler(credentials, () => ({ DB: {}, BUCKET: {} }));
  const response = await handle(new Request(origin + "/api/account", {
    method: "POST",
    headers: { Origin: origin },
  }));
  assert.equal(response.status, 200);
  assert.equal(await response.json(), null);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
});

test("the Vercel API rejects unknown origins and never falls through to static assets", async () => {
  const handle = createVercelHandler(credentials, () => ({ DB: {}, BUCKET: {} }));
  const invalidOrigin = await handle(new Request(origin + "/api/account", {
    method: "POST",
    headers: { Origin: "https://other.example" },
  }));
  assert.equal(invalidOrigin.status, 403);
  assert.equal((await handle(new Request("https://other.example/api/auth/csrf"))).status, 400);
  assert.equal((await handle(new Request(origin + "/api/unknown"))).status, 404);
});

test("the Vercel API fails closed when no origin or storage is configured", async () => {
  assert.equal((await createVercelHandler({})(new Request(origin + "/api/auth/csrf"))).status, 503);
  const handle = createVercelHandler(credentials, () => { throw new Error("Missing storage"); });
  assert.equal((await handle(new Request(origin + "/api/auth/csrf"))).status, 503);
});
