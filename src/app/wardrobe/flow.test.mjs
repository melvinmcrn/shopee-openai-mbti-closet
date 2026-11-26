import assert from "node:assert/strict";
import test from "node:test";
import { wardrobeDestination, wardrobeHref, wardrobeOrigin } from "./flow.mjs";

const completedAt = "2026-05-04T09:00:00.000Z";

test("an outfit brief survives the trip from planner through a batch review", () => {
  const add = new URL(wardrobeHref("/wardrobe/add", { from: "planner", brief: "834" }), "https://closet.test");
  const origin = wardrobeOrigin(add.searchParams);
  const confirm = new URL(wardrobeHref("/wardrobe/confirm", origin, new URLSearchParams("batch=13,47&manual=47")), add);
  assert.equal(confirm.searchParams.get("batch"), "13,47");
  assert.equal(confirm.searchParams.get("manual"), "47");
  assert.equal(wardrobeDestination(wardrobeOrigin(confirm.searchParams), completedAt).href, "/planner?brief=834#compare");
});

test("returning wardrobe users return to their entry point, including old or bookmarked links", () => {
  for (const [search, href] of [
    ["from=planner", "/planner"],
    ["from=closet", "/closet"],
    ["from=onboarding", "/closet"],
    ["", "/closet"],
    ["from=https://example.org", "/closet"],
    ["from=planner&brief=abc", "/planner"],
    ["from=closet&brief=16", "/closet"],
  ]) {
    const origin = wardrobeOrigin(new URLSearchParams(search));
    assert.equal(wardrobeDestination(origin, completedAt).href, href, search);
  }
});

test("initial onboarding can continue to style only after setup status is known", () => {
  for (const search of ["", "from=onboarding"]) {
    const origin = wardrobeOrigin(new URLSearchParams(search));
    assert.equal(wardrobeDestination(origin, undefined), null);
    assert.equal(wardrobeDestination(origin, null).href, "/profile/style");
  }
});
