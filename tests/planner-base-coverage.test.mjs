import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readBaseCoverage } from "../src/app/api/_server/planner/base-coverage.mjs";

const faceOnly = { top: false, bottom: false, dress: false, outerwear: false, shoes: false };
const outfit = { ...faceOnly, top: true, bottom: true };

function fixture(t) {
  const sql = new DatabaseSync(":memory:");
  t.after(() => sql.close());
  sql.exec(`
    CREATE TABLE private_files (file_id TEXT PRIMARY KEY, user_id INTEGER, state TEXT);
    CREATE TABLE private_file_references (file_id TEXT, user_id INTEGER);
    INSERT INTO private_files VALUES ('first', 1, 'ready'), ('second', 1, 'ready');
    INSERT INTO private_file_references VALUES ('first', 1), ('second', 1), ('legacy', 1);
  `);
  sql.exec(readFileSync(new URL("../drizzle/0113_photo_coverage.sql", import.meta.url), "utf8"));
  const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const get = t.mock.fn(async () => ({
    httpMetadata: { contentType: "application/octet-stream" }, arrayBuffer: () => png.buffer,
  }));
  const env = {
    DB: { prepare: query => ({ bind: (...params) => ({ first: () => sql.prepare(query).get(...params) }) }) },
    BUCKET: { get }, OPENAI_API_KEY: "fixture",
  };
  return { env, sql, get };
}

function reply(coverage) {
  return Response.json({
    status: "completed", output: [{
      type: "message", role: "assistant", status: "completed",
      content: [{ type: "output_text", text: JSON.stringify(coverage) }],
    }],
  });
}

test("empty reference needs no provider, storage, or database", async () => {
  assert.deepEqual(await readBaseCoverage({}, 1, null), faceOnly);
});

test("photo coverage is deduplicated, cached per attached file, and owner scoped", async t => {
  const { env, sql, get } = fixture(t);
  const fetch = t.mock.fn(async (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    const body = JSON.parse(init.body);
    assert.equal(body.store, false);
    assert.equal(body.text.format.strict, true);
    assert.match(body.input[0].content[0].image_url, /^data:image\/png;base64,/);
    return reply(outfit);
  });
  const read = (id, ref) => readBaseCoverage(env, id, ref, { fetch });
  assert.deepEqual(await Promise.all([read(1, "first"), read(1, "first")]), [outfit, outfit]);
  assert.deepEqual(await read(1, "first"), outfit);
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(get.mock.callCount(), 1);

  await assert.rejects(read(2, "first"), /unavailable/);
  sql.exec("DELETE FROM private_file_references WHERE file_id='first'");
  await assert.rejects(read(1, "first"), /unavailable/);
  assert.equal(get.mock.callCount(), 1);
  assert.deepEqual(await readBaseCoverage(env, 1, "second", { fetch: async () => reply(faceOnly) }), faceOnly);
  assert.deepEqual(await read(1, "legacy"), outfit);
  assert.equal(get.mock.callCount(), 3);
});

test("partial provider results, refusals and errors remain retryable", async t => {
  const { env, sql } = fixture(t);
  const read = fetch => readBaseCoverage(env, 1, "first", { fetch });
  await assert.rejects(read(async () => new Response(null, { status: 503 })), /temporarily unavailable/);
  await assert.rejects(read(async () => reply({ ...faceOnly, top: "true" })), /could not be identified/);
  await assert.rejects(read(async () => Response.json({
    status: "completed", output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "refusal" }] }],
  })), /interrupted/);
  assert.equal(sql.prepare("SELECT base_coverage FROM private_files WHERE file_id='first'").get().base_coverage, null);
  assert.deepEqual(await read(async () => reply(outfit)), outfit);
});
