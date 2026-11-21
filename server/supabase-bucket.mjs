const binaryContentType = "application/octet-stream";

function objectIsMissing(error) {
  const code = error.code ?? error.statusCode;
  if (code === "NoSuchKey") return true;

  // Older Storage responses use a numeric code with an object-specific message.
  const legacyStatus = Number(error.statusCode ?? error.status);
  return (legacyStatus === 400 || legacyStatus === 404)
    && /^object not found[.]?$/i.test(error.message);
}

function unwrap({ data, error }, operation, allowMissing = false) {
  if (!error) return data;
  if (allowMissing && objectIsMissing(error)) return null;
  throw new Error(`Supabase Storage ${operation} failed`, { cause: error });
}

export function createSupabaseBucket(supabase, bucketName) {
  const bucket = supabase.storage.from(bucketName);

  return {
    async put(key, body, { httpMetadata } = {}) {
      unwrap(await bucket.upload(key, body, {
        contentType: httpMetadata?.contentType ?? binaryContentType,
        cacheControl: "0",
        upsert: false,
      }), "upload");
    },

    async head(key) {
      const data = unwrap(await bucket.info(key), "metadata request", true);
      if (data === null) return null;

      const size = data.size ?? data.metadata?.size;
      if (!Number.isSafeInteger(size) || size < 0) {
        throw new Error("Supabase Storage returned an invalid file size");
      }
      return {
        size,
        httpMetadata: { contentType: data.contentType ?? data.metadata?.mimetype ?? binaryContentType },
        httpEtag: data.etag ?? data.metadata?.eTag,
      };
    },

    async get(key) {
      const data = unwrap(await bucket.download(key), "download", true);
      if (data === null) return null;

      return {
        size: data.size,
        httpMetadata: { contentType: data.type || binaryContentType },
        body: data.stream(),
        arrayBuffer: () => data.arrayBuffer(),
      };
    },

    async delete(key) {
      unwrap(await bucket.remove([key]), "deletion", true);
    },
  };
}
