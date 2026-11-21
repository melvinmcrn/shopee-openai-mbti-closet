import { Auth } from "@auth/core";
import Google from "@auth/core/providers/google";
import { retryPrivateFileCleanup, servePrivateFile } from "./private-files.mjs";

const origin = "https://mbti-closet.stonyimpala.chatgpt.site";
const authPath = "/api/auth";
const accountPath = "/api/account";
const filesPath = "/api/files";

function validSubject(subject) {
  return typeof subject === "string" && subject.length > 0;
}

function auth(request, env, readSubject = () => {}) {
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
      async jwt({ token, account, profile }) {
        if (account) {
          const subject = profile?.sub;
          if (account.provider !== "google" || !validSubject(subject) || account.providerAccountId !== subject) {
            return null;
          }
          await env.DB.prepare(
            `INSERT INTO users (auth_provider, auth_subject, email) VALUES ('google', ?, ?)
             ON CONFLICT (auth_provider, auth_subject) DO UPDATE SET email = excluded.email`,
          ).bind(subject, token.email ?? null).run();
          token.googleSubject = subject;
        }
        // Older sessions carry an Auth.js-generated identifier rather than Google's subject.
        return validSubject(token.googleSubject) ? token : null;
      },
      session({ session, token }) {
        readSubject(token.googleSubject);
        return session;
      },
    },
    // Provider errors may include sensitive request details.
    logger: {
      error: (error) => console.error("Authentication failed", error.name),
      warn: (code) => console.warn("Authentication warning", code),
    },
  });
}

function authConfigured(env) {
  return Boolean(env.AUTH_SECRET && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

async function readAccountSession(request, env) {
  let subject;
  const sessionRequest = new Request(origin + authPath + "/session", {
    headers: { Cookie: request.headers.get("Cookie") ?? "" },
  });
  const response = await auth(sessionRequest, env, (value) => {
    subject = value;
  });
  const account = response.ok && validSubject(subject)
    ? await env.DB.prepare("SELECT id FROM users WHERE auth_provider = 'google' AND auth_subject = ?").bind(subject).first()
    : null;
  return { account, response };
}

export async function resolveAccount(request, env) {
  if (!authConfigured(env)) return null;
  const { account } = await readAccountSession(request, env);
  return account;
}

async function serveAccount(request, env, ctx) {
  const { account, response } = await readAccountSession(request, env);
  if (!response.ok) return response;
  const session = await response.json();
  if (!session || !account) return Response.json(null, response);
  ctx?.waitUntil(retryPrivateFileCleanup(env, account).catch((error) => {
    console.error("Private file cleanup failed", error.name);
  }));
  return Response.json({ ...session, user: { ...session.user, id: account.id } }, response);
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
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;
    const authRoute = pathname === authPath || pathname.startsWith(authPath + "/");
    const fileRoute = pathname === filesPath || pathname.startsWith(filesPath + "/");
    if (!authRoute && !fileRoute && pathname !== accountPath) {
      return serveAsset(request, pathname);
    }
    if (url.origin !== origin) {
      return privateResponse(new Response("Unexpected host", { status: 400 }));
    }
    if (request.method === "POST" && request.headers.get("Origin") !== origin) {
      return privateResponse(new Response("Forbidden", { status: 403 }));
    }
    const allowedMethods = fileRoute ? ["GET", "HEAD"] : authRoute ? ["GET", "POST"] : ["POST"];
    if (!allowedMethods.includes(request.method)) {
      return privateResponse(new Response(null, { status: 405, headers: { Allow: allowedMethods.join(", ") } }));
    }
    if (fileRoute) {
      const requestOrigin = request.headers.get("Origin");
      const fetchSite = request.headers.get("Sec-Fetch-Site");
      if ((requestOrigin && requestOrigin !== origin) || (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none")) {
        return privateResponse(new Response(null, { status: 403 }));
      }
    }
    const authAction = authRoute && pathname.slice(authPath.length).split("/").find(Boolean);
    if (authAction === "session") {
      return privateResponse(new Response(null, { status: 404 }));
    }
    if (!authConfigured(env)) {
      return privateResponse(new Response(request.method === "HEAD" ? null : "Sign-in is unavailable", { status: 503 }));
    }
    if (authRoute) return privateResponse(await auth(request, env));
    try {
      if (!fileRoute) return privateResponse(await serveAccount(request, env, ctx));
      const account = await resolveAccount(request, env);
      if (!account) return privateResponse(new Response(null, { status: 401 }));
      const fileId = pathname.slice(filesPath.length + 1);
      if (!fileId || fileId.includes("/")) return privateResponse(new Response(null, { status: 404 }));
      return privateResponse(await servePrivateFile(request, env, account, fileId));
    } catch (error) {
      console.error("Private endpoint failed", error.name);
      return privateResponse(new Response(null, { status: 503 }));
    }
  },
};
