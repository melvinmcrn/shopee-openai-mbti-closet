import assert from "node:assert/strict";
import test from "node:test";
import { handleApi } from "../src/app/api/_server/handle-api.mjs";

const origin = "https://closet.example";
const env = {
  APP_ORIGIN: origin,
  AUTH_SECRET: "local-test-only",
  GOOGLE_CLIENT_ID: "test",
  GOOGLE_CLIENT_SECRET: "test",
};

async function oauthReturnCookie(callbackUrl) {
  // Auth.js validates the callback and stores it for the next request in the OAuth flow.
  const url = new URL("/api/auth/csrf", origin);
  url.searchParams.set("callbackUrl", callbackUrl);
  const response = await handleApi(new Request(url), env);
  assert.equal(response.status, 200);
  const cookie = response.headers.getSetCookie().find(value => value.startsWith("__Secure-authjs.callback-url="));
  return decodeURIComponent(cookie.split(";")[0].slice("__Secure-authjs.callback-url=".length));
}

test("sign-in remembers local app pages, including unknown paths, through OAuth", async () => {
  for (const path of ["/planner#saved/42", "/wardrobe/confirm?batch=3%2C5",
    "/missing-app-route?q=2#saved", "/older/saved%20look?q=2#saved", "/retired.page",
    "/account?name=folder\\look#my\\profile", "/v2.1/looks/recent?tab=saved"]) {
    assert.equal(await oauthReturnCookie(path), origin + path);
    assert.equal(await oauthReturnCookie(origin + path), origin + path);
  }
});

test("sign-in falls back to the landing page for external links and non-page destinations", async () => {
  for (const path of ["https://elsewhere.example/closet", "//elsewhere.example/planner", "/api/auth/signout",
    "/%61pi/profile", "/auth/login", "/_next/static", "/offline", "/offline.html", "/index",
    "/sw.js", "/sample-wardrobe/missing", "/assets/logo", "/v2.1/retired.svg",
    "/a/%2e%2e/account", "/a/../planner", "/bad%2Fsegment", "/a\\planner", "/"]) {
    assert.equal(new URL(await oauthReturnCookie(path)).href, origin + "/");
  }
});
