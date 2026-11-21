import { handleApi } from "../src/app/api/_server/handle-api.mjs";

function serveAsset(request, pathname) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  const route = pathname.replace(/\/$/, "");
  const file = !route ? "/index.html" : Object.hasOwn(SITE_ASSETS, route + ".html") ? route + ".html" : pathname;
  const asset = Object.hasOwn(SITE_ASSETS, file) ? SITE_ASSETS[file] : undefined;
  const [type, data] = asset ?? SITE_ASSETS["/404.html"];
  return new Response(request.method === "HEAD" ? null : Uint8Array.from(atob(data), (byte) => byte.charCodeAt(0)), {
    status: asset ? 200 : 404,
    headers: {
      "Content-Type": type,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": file.startsWith("/_next/static/") && asset
        ? "private, max-age=31536000, immutable"
        : "no-cache",
    },
  });
}

export default {
  fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      return handleApi(request, {
        ...env,
        readSampleImage(slug) {
          const [, encoded] = SITE_ASSETS[`/sample-wardrobe/${slug}.webp`];
          return Uint8Array.from(atob(encoded), (byte) => byte.charCodeAt(0));
        },
      }, ctx);
    }
    return serveAsset(request, pathname === "/planner/" || pathname === "/planner" ? "/planner.html" : pathname);
  },
};
