import assert from "node:assert/strict";
import test from "node:test";
import { sourceLabel } from "../src/app/planner/look-sources.mjs";

const headshot = { original: [], profile: [] };

test("comparison counts an owned jacket when the try-on must supply the base outfit", () => {
  assert.equal(sourceLabel({ outerwear: "jacket" }, headshot, 0), "1 owned piece");
});

test("a dress or both separates can supply the whole outfit from closet sources", () => {
  assert.equal(sourceLabel({ dress: "dress" }, headshot, 0), "All from your closet");
  assert.equal(sourceLabel({ top: "tee", other: "photo" }, { original: ["bottom"], profile: [] }, 0), "All from your closet");
});

test("the source label distinguishes retained profile clothes, Shopee pieces, and pending details", () => {
  assert.equal(sourceLabel({ top: "tee" }, { original: [], profile: ["bottom"] }, 0), "1 owned piece · Clothes from your profile photo");
  assert.equal(sourceLabel({ top: "tee", bottom: "jeans" }, headshot, 1), "2 owned pieces · 1 Shopee item");
  assert.equal(sourceLabel({}, headshot, 2), "2 Shopee items");
  assert.equal(sourceLabel({ dress: "dress" }), "1 owned piece");
  assert.equal(sourceLabel({}, headshot, 0), "Try-on basics");
});
