import assert from "node:assert/strict";
import { test } from "node:test";
import { createSupabaseBucket } from "../server/supabase-bucket.mjs";
import { createClient } from "@supabase/supabase-js";

const bucketName = "closet-private";
const fileId = "private/1/bfd12671-89ca-4edf-bef9-b14bcf31f945";
const bytes = new Uint8Array([0, 1, 255]);
const fakeAuthKey = "test-only-storage-key";

function fixture(handle) {
  const supabase = createClient("https://storage.example.test", fakeAuthKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: async (input, init) => {
        const request = new Request(input, init);
        assert.equal(request.headers.get("apikey"), fakeAuthKey);
        assert.doesNotMatch(new URL(request.url).pathname, /\/public\//);
        return handle(request);
      },
    },
  });
  return createSupabaseBucket(supabase, bucketName);
}

test("private file upload, metadata lookup, download and deletion preserve the Worker contract", async () => {
  const requests = [];
  const bucket = fixture(async (request) => {
    const path = new URL(request.url).pathname;
    requests.push([request.method, path]);
    if (request.method === "POST") {
      assert.equal(request.headers.get("content-type"), "image/png");
      assert.equal(request.headers.get("x-upsert"), "false");
      assert.equal(request.headers.get("cache-control"), "max-age=0");
      assert.deepEqual(new Uint8Array(await request.arrayBuffer()), bytes);
      return Response.json({ Key: bucketName + "/" + fileId, Id: "object-id" });
    }
    if (request.method === "DELETE") {
      assert.deepEqual((await request.json()).prefixes, [fileId]);
      return Response.json([{ name: fileId }]);
    }
    if (path.includes("/info/")) {
      return Response.json({ content_type: "image/png", size: bytes.byteLength, etag: '"abc"' });
    }
    return new Response(bytes, { headers: { "Content-Type": "image/png" } });
  });

  await bucket.put(fileId, bytes, { httpMetadata: { contentType: "image/png" } });
  const metadata = await bucket.head(fileId);
  assert.equal(metadata.size, 3);
  assert.equal(metadata.httpMetadata.contentType, "image/png");
  assert.equal(metadata.httpEtag, '"abc"');
  assert.equal(metadata.body, undefined);
  const object = await bucket.get(fileId);
  assert.equal(object.size, 3);
  assert.equal(object.httpMetadata.contentType, "image/png");
  assert.deepEqual(new Uint8Array(await new Response(object.body).arrayBuffer()), bytes);
  assert.deepEqual(new Uint8Array(await object.arrayBuffer()), bytes);
  await bucket.delete(fileId);
  assert.deepEqual(requests, [
    ["POST", "/storage/v1/object/" + bucketName + "/" + fileId],
    ["GET", "/storage/v1/object/info/" + bucketName + "/" + fileId],
    ["GET", "/storage/v1/object/" + bucketName + "/" + fileId],
    ["DELETE", "/storage/v1/object/" + bucketName],
  ]);
});

test("a missing object reads as null and can be deleted idempotently", async () => {
  const bucket = fixture(() => Response.json({ code: "NoSuchKey", message: "Object not found" }, { status: 404 }));
  assert.equal(await bucket.head(fileId), null);
  assert.equal(await bucket.get(fileId), null);
  await bucket.delete(fileId);
});

test("a missing bucket or unauthenticated request is a storage failure", async () => {
  for (const [status, code, message] of [
    [404, "NoSuchBucket", "Bucket not found"],
    [400, undefined, "Bucket not found"],
    [401, "InvalidJWT", "Invalid JWT"],
    [503, undefined, "Unavailable"],
  ]) {
    const bucket = fixture(() => Response.json({ code, message }, { status }));
    await assert.rejects(bucket.head(fileId), /Supabase Storage metadata request failed/);
    await assert.rejects(bucket.get(fileId), /Supabase Storage download failed/);
    await assert.rejects(bucket.delete(fileId), /Supabase Storage deletion failed/);
  }
});
