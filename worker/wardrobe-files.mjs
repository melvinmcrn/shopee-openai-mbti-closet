function ownerKey(userId, key) {
  if (!Number.isSafeInteger(userId) || userId < 1 ||
      typeof key !== "string" || !key.startsWith(`users/${userId}/`) ||
      key.split("/").some(part => !part || part === "." || part === "..")) {
    throw new Error("Invalid private file reference");
  }
  return key;
}

export function putFile(env, userId, key, bytes, type) {
  return env.BUCKET.put(ownerKey(userId, key), bytes, { httpMetadata: { contentType: type } });
}

export function getFile(env, userId, key) {
  return env.BUCKET.get(ownerKey(userId, key));
}

export function deleteFile(env, userId, key) {
  return env.BUCKET.delete(ownerKey(userId, key));
}

export function fileUrl(key) {
  return "/api/files/" + encodeURIComponent(key);
}

export async function privateImage(request, env, userId) {
  let key;
  try { key = decodeURIComponent(new URL(request.url).pathname.slice("/api/files/".length)); }
  catch { return new Response(null, { status: 404 }); }
  const missing = () => new Response(null, { status: 404 });
  if (typeof key !== "string" || !key.startsWith(`users/${userId}/`)) return missing();
  const owned = await env.DB.prepare(`
    SELECT 1 FROM wardrobe_items WHERE user_id = ? AND image_file_id = ?
    UNION ALL SELECT 1 FROM profiles WHERE user_id = ? AND face_photo_file_id = ? LIMIT 1
  `).bind(userId, key, userId, key).first();
  if (!owned) return missing();
  const object = await getFile(env, userId, key);
  if (!object) return missing();
  return new Response(object.body, {
    headers: { "Content-Type": object.httpMetadata?.contentType || "application/octet-stream" },
  });
}
