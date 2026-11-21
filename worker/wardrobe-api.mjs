import { privateImage } from "./wardrobe-files.mjs";
import { profile } from "./wardrobe/profile.mjs";
import { upload } from "./wardrobe/upload.mjs";
import { sample } from "./wardrobe/sample.mjs";
import { items } from "./wardrobe/items.mjs";
import { extract } from "./wardrobe/extract.mjs";

export function wardrobeApi(request, env, userId) {
  const path = new URL(request.url).pathname;
  const method = request.method;
  if (path === "/api/profile" || path === "/api/profile/photo") return profile(request, env, userId);
  if (path.startsWith("/api/files/") && method === "GET") return privateImage(request, env, userId);
  if (path === "/api/wardrobe/upload" && method === "POST") return upload(request, env, userId);
  if (path === "/api/wardrobe/sample" && method === "POST") return sample(request, env, userId);
  const item = /^\/api\/wardrobe\/items(?:\/(\d+)(\/extract)?)?$/.exec(path);
  if (item && !item[2]) return items(request, env, userId, item[1]);
  if (item && method === "POST") return extract(request, env, userId, Number(item[1]));
  return Response.json({ error: "Unknown wardrobe route." }, { status: 404 });
}
