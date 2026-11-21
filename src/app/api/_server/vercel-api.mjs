import { handleApi } from "./handle-api.mjs";
import { readSampleImage } from "./read-sample-image.mjs";
import { normalizeWardrobePhoto } from "../../../../server/normalize-wardrobe-photo.mjs";

function privateResponse(body, status) {
  return new Response(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function configuredOrigin(value) {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    if (url.protocol === "https:" || (url.protocol === "http:" && url.hostname === "localhost")) {
      return url.origin;
    }
  } catch {
    // Missing or invalid deployment configuration.
  }
  return null;
}

export function createVercelHandler(config, getStorage) {
  const origin = configuredOrigin(config.APP_ORIGIN);
  return async (request, context) => {
    const head = request.method === "HEAD";
    if (!origin) return privateResponse(head ? null : "API is unavailable", 503);
    if (new URL(request.url).origin !== origin) {
      return privateResponse(head ? null : "Unexpected host", 400);
    }
    if (!["GET", "HEAD"].includes(request.method) && request.headers.get("Origin") !== origin) {
      return privateResponse("Forbidden", 403);
    }
    try {
      const { DB, BUCKET } = getStorage();
      const response = await handleApi(request, {
        APP_ORIGIN: origin,
        AUTH_SECRET: config.AUTH_SECRET,
        GOOGLE_CLIENT_ID: config.GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET: config.GOOGLE_CLIENT_SECRET,
        OPENAI_API_KEY: config.OPENAI_API_KEY,
        WARDROBE_EXTRACTION_FIXTURES: config.WARDROBE_EXTRACTION_FIXTURES,
        readSampleImage,
        normalizeWardrobePhoto,
        DB,
        BUCKET,
      }, context);
      const result = new Response(response.body, response);
      result.headers.set("Cache-Control", "private, no-store");
      return result;
    } catch (error) {
      console.error("Vercel API failed", error instanceof Error ? error.name : "UnknownError");
      return privateResponse(head ? null : "API is unavailable", 503);
    }
  };
}
