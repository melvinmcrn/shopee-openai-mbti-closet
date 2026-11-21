import { Auth } from "@auth/core";
import Google from "@auth/core/providers/google";

const origin = "https://mbti-closet.stonyimpala.chatgpt.site";
const authPath = "/api/auth";
const accountPath = "/api/account";

function auth(request, env) {
  return Auth(request, {
    basePath: authPath,
    // The Worker rejects unexpected origins before calling Auth.js.
    trustHost: true,
    useSecureCookies: true,
    secret: env.AUTH_SECRET,
    session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
    providers: [
      Google({
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        checks: ["pkce", "state", "nonce"],
        authorization: { params: { scope: "openid email profile" } },
      }),
    ],
    callbacks: {
      redirect: ({ baseUrl }) => baseUrl,
    },
    // Provider errors may include sensitive request details.
    logger: {
      error: (error) => console.error("Authentication failed", error.name),
      warn: (code) => console.warn("Authentication warning", code),
    },
  });
}

function privateResponse(response) {
  // Keep multiple Auth.js Set-Cookie headers attached to the response.
  const result = new Response(response.body, response);
  result.headers.set("Cache-Control", "no-store");
  result.headers.set("Referrer-Policy", "same-origin");
  result.headers.set("X-Content-Type-Options", "nosniff");
  result.headers.set("X-Frame-Options", "DENY");
  return result;
}

function serveAsset(request, pathname) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  const file = pathname === "/" ? "/index.html" : pathname;
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
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    if (!pathname.startsWith(authPath + "/") && pathname !== authPath && pathname !== accountPath) {
      return serveAsset(request, pathname);
    }
    if (url.origin !== origin) {
      return privateResponse(new Response("Unexpected host", { status: 400 }));
    }
    if (request.method === "POST" && request.headers.get("Origin") !== origin) {
      return privateResponse(new Response("Forbidden", { status: 403 }));
    }
    if (!env.AUTH_SECRET || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
      return privateResponse(new Response("Sign-in is unavailable", { status: 503 }));
    }
    if (pathname === accountPath) {
      if (request.method !== "POST") {
        return privateResponse(new Response(null, { status: 405, headers: { Allow: "POST" } }));
      }
      // Expose only the session endpoint through a non-cacheable same-origin POST.
      const sessionRequest = new Request(origin + authPath + "/session", {
        headers: { Cookie: request.headers.get("Cookie") ?? "" },
      });
      return privateResponse(await auth(sessionRequest, env));
    }
    if (pathname === authPath + "/session") {
      return privateResponse(new Response(null, { status: 404 }));
    }
    return privateResponse(await auth(request, env));
  },
};
