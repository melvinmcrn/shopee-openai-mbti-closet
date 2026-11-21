import assert from "node:assert/strict";
import test from "node:test";
import { crc32 } from "node:zlib";
import { decode, encode } from "fast-png";
import { lunaBatchExtraction, lunaExtraction } from "./extraction-luna.mjs";

const photo = { width: 1, height: 1, data: Uint8Array.of(9, 15, 26, 255) };
const shirt = { name: "Red tee", category: "top", garment_type: "T-shirt", color: "Red" };
const jeans = { name: "Blue jeans", category: "bottom", garment_type: "Jeans", color: "Blue" };
const shoes = { name: "Green trainers", category: "shoes", garment_type: "Trainers", color: "Green" };
const red = [210, 15, 20, 255];
const blue = [10, 40, 220, 255];
const green = [20, 190, 40, 255];

function cutoutSheet(width, height, patches) {
  const data = new Uint8Array(width * height * 4);
  for (const [left, top, color] of patches) {
    for (let y = top; y < top + 64; y++) {
      for (let x = left; x < left + 64; x++) data.set(color, (y * width + x) * 4);
    }
  }
  return encode({ width, height, data });
}

function provider(t, metadata, image) {
  const output = [{
    type: "message", role: "assistant", status: "completed",
    content: [{ type: "output_text", text: JSON.stringify(metadata) }],
  }];
  if (image) output.unshift({
    type: "image_generation_call", status: "completed", result: Buffer.from(image).toString("base64"),
  });
  return t.mock.method(globalThis, "fetch", async () => Response.json({ status: "completed", output }));
}

function checkGarment({ png, ...fields }, expectedFields, expectedColor, patches = 1) {
  assert.deepEqual(fields, expectedFields);
  const { data } = decode(png);
  let visible = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    visible++;
    assert.deepEqual(Array.from(data.subarray(i, i + 4)), expectedColor);
  }
  assert.equal(visible, patches * 64 * 64);
  assert.ok(visible < data.length / 4);
}

test("isolates shirt, jeans and both shoes into three distinct cutouts from one outfit", async (t) => {
  const call = provider(t, { garments: [shirt, jeans, shoes] }, cutoutSheet(1024, 1024, [
    [200, 200, red], [710, 205, blue], [130, 685, green], [300, 695, green],
  ]));
  const garments = await lunaExtraction(photo, "test");
  assert.equal(garments.length, 3);
  checkGarment(garments[0], shirt, red);
  checkGarment(garments[1], jeans, blue);
  checkGarment(garments[2], shoes, green, 2);
  assert.equal(call.mock.callCount(), 1);
});

test("a batch groups individual cutouts by source even when metadata slots arrive out of order", async (t) => {
  const call = provider(t, { slots: [
    { slot: 2, garments: [shoes] }, { slot: 1, garments: [shirt, jeans] },
  ] }, cutoutSheet(1216, 608, [[120, 260, red], [440, 250, blue], [870, 260, green]]));
  const [first, second] = await lunaBatchExtraction([photo, photo], "test");
  assert.equal(first.length, 2);
  assert.equal(second.length, 1);
  checkGarment(first[0], shirt, red);
  checkGarment(first[1], jeans, blue);
  checkGarment(second[0], shoes, green);
  assert.equal(call.mock.callCount(), 1);
});

test("an outfit with a missing cutout does not silently return only the successful items", async (t) => {
  provider(t, { slots: [
    { slot: 1, garments: [shirt, jeans] }, { slot: 2, garments: [shoes] },
  ] }, cutoutSheet(1216, 608, [[120, 260, red], [870, 260, green]]));
  const [incomplete, complete] = await lunaBatchExtraction([photo, photo], "test");
  assert.equal(incomplete.stage, "image_layout");
  checkGarment(complete[0], shoes, green);
});

test("an empty photo returns zero garments without requiring an image", async (t) => {
  provider(t, { garments: [] });
  assert.deepEqual(await lunaExtraction(photo, "test"), []);
});

test("an all-empty batch returns an empty list for each source without an image", async (t) => {
  provider(t, { slots: [{ slot: 2, garments: [] }, { slot: 1, garments: [] }] });
  assert.deepEqual(await lunaBatchExtraction([photo, photo], "test"), [[], []]);
});

test("a batch of one returns the photo's garment list in the same outer array", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, { body }) => {
    const { schema } = JSON.parse(body).text.format;
    const photo = { garments: [] };
    const metadata = schema.properties.slots ? { slots: [{ slot: 1, ...photo }] } : photo;
    return Response.json({ status: "completed", output: [{
      type: "message", role: "assistant", status: "completed",
      content: [{ type: "output_text", text: JSON.stringify(metadata) }],
    }] });
  });
  assert.deepEqual(await lunaBatchExtraction([photo], "test"), [[]]);
});

for (const [reason, patches] of [
  ["a cutout in an unused cell", [[200, 200, red], [710, 205, blue], [130, 685, green], [700, 690, green]]],
  ["a cutout crossing into the next item", [[475, 200, red], [710, 205, blue], [130, 685, green]]],
  ["the same pixel cutout repeated as another item", [[200, 200, red], [710, 205, red], [130, 685, green]]],
]) {
  test("rejects an outfit sheet with " + reason, async (t) => {
    provider(t, { garments: [shirt, jeans, shoes] }, cutoutSheet(1024, 1024, patches));
    t.mock.method(console, "warn", () => {});
    await assert.rejects(lunaExtraction(photo, "test"), { code: "invalid_extraction" });
  });
}

test("rejects malformed garment metadata only for the affected photo in a valid sheet", async (t) => {
  provider(t, { slots: [
    { slot: 1, garments: [{ ...shirt, category: "invalid" }] }, { slot: 2, garments: [shoes] },
  ] }, cutoutSheet(1216, 608, [[120, 260, red], [870, 260, green]]));
  const [invalid, good] = await lunaBatchExtraction([photo, photo], "test");
  assert.equal(invalid, null);
  checkGarment(good[0], shoes, green);
});

test("splits indexed transparent outfit sheets without losing palette colors or alpha", async (t) => {
  const data = new Uint8Array(1024 * 1024);
  for (let y = 400; y < 464; y++) {
    data.fill(1, y * 1024 + 220, y * 1024 + 284);
    data.fill(2, y * 1024 + 720, y * 1024 + 784);
  }
  const png = encode({ width: 1024, height: 1024, channels: 1, data, palette: [[0, 0, 0, 0], red, blue] });
  provider(t, { garments: [shirt, jeans] }, png);
  const garments = await lunaExtraction(photo, "test");
  checkGarment(garments[0], shirt, red);
  checkGarment(garments[1], jeans, blue);
});

test("splits RGB outfit sheets with a transparent color key", async (t) => {
  const data = new Uint8Array(1024 * 1024 * 3);
  for (let y = 400; y < 464; y++) {
    for (let x = 220; x < 284; x++) {
      data.set(red.slice(0, 3), (y * 1024 + x) * 3);
      data.set(blue.slice(0, 3), (y * 1024 + x + 500) * 3);
    }
  }
  const rgb = encode({ width: 1024, height: 1024, channels: 3, data });
  const key = Buffer.alloc(18);
  key.writeUInt32BE(6);
  key.write("tRNS", 4);
  key.writeUInt32BE(crc32(key.subarray(4, 14)), 14);
  const png = Buffer.concat([rgb.subarray(0, 33), key, rgb.subarray(33)]);
  provider(t, { garments: [shirt, jeans] }, png);
  const garments = await lunaExtraction(photo, "test");
  checkGarment(garments[0], shirt, red);
  checkGarment(garments[1], jeans, blue);
});
