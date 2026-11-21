import { getToken } from "@auth/core/jwt";

export async function resolveAccount(request, env) {
  const token = await getToken({
    req: request,
    secureCookie: true,
    secret: env.AUTH_SECRET,
  });
  if (typeof token?.googleSubject !== "string" || !token.googleSubject) return null;
  return env.DB.prepare(`
    INSERT INTO users (auth_provider, auth_subject, email) VALUES ('google', ?, ?)
    ON CONFLICT (auth_provider, auth_subject) DO UPDATE SET email = excluded.email
    RETURNING id
  `).bind(token.googleSubject, token.email ?? null).first();
}
