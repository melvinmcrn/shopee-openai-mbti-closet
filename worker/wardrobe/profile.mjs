import { deleteFile, fileUrl, putFile } from "../wardrobe-files.mjs";
import { imageType, maxImageBytes, readUploadForm } from "./upload.mjs";

const cacheHeaders = { "Cache-Control": "no-store" };
const editableFields = new Set([
  "heightCm", "weightKg", "styles", "facePhotoUrl", "setupCompletedAt", "complete",
]);

const createProfile = "INSERT INTO profiles (user_id) VALUES (?) ON CONFLICT (user_id) DO NOTHING";
const retirePhoto = `
  INSERT INTO profile_photo_cleanup (user_id, file_key, available_at)
  SELECT user_id, face_photo_file_id, unixepoch()
  FROM profiles WHERE user_id = ? AND face_photo_file_id IS NOT NULL
`;

function error(message, status) {
  return Response.json({ error: message }, { status, headers: cacheHeaders });
}

async function readProfile(db, userId) {
  const row = await db.prepare(`
    SELECT p.height_cm, p.weight_kg, p.face_photo_file_id, p.setup_completed_at,
      (SELECT json_group_array(style) FROM (
        SELECT style FROM style_preferences WHERE user_id = u.id ORDER BY style
      )) AS styles
    FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = ?
  `).bind(userId).first();
  return Response.json({
    heightCm: row?.height_cm ?? null,
    weightKg: row?.weight_kg ?? null,
    styles: row?.styles ? JSON.parse(row.styles) : [],
    facePhotoUrl: row?.face_photo_file_id ? fileUrl(row.face_photo_file_id) : null,
    setupCompletedAt: row?.setup_completed_at ?? null,
  }, { headers: cacheHeaders });
}

function validatePatch(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return "Send a JSON object with the profile fields to update.";
  }
  if (Object.keys(patch).some((key) => !editableFields.has(key))) {
    return "The request contains an unknown profile field.";
  }
  for (const field of ["heightCm", "weightKg"]) {
    if (Object.hasOwn(patch, field) && patch[field] !== null &&
        (!Number.isFinite(patch[field]) || patch[field] <= 0)) {
      return field + " must be a positive number or null.";
    }
  }
  if (patch.styles != null && (!Array.isArray(patch.styles) ||
      patch.styles.some((style) => typeof style !== "string" || !style.trim()))) {
    return "Styles must be an array of nonempty strings or null.";
  }
  if (patch.facePhotoUrl != null) return "Upload your photo through /api/profile/photo.";
  if (patch.setupCompletedAt != null || (Object.hasOwn(patch, "setupCompletedAt") && patch.complete)) {
    return "Send complete: true to mark setup complete.";
  }
  if (Object.hasOwn(patch, "complete") && typeof patch.complete !== "boolean") {
    return "Complete must be a boolean.";
  }
  return null;
}

async function updateProfile(db, userId, patch) {
  const assignments = [];
  const values = [];
  for (const [field, column] of [["heightCm", "height_cm"], ["weightKg", "weight_kg"]]) {
    if (Object.hasOwn(patch, field)) {
      assignments.push(column + " = ?");
      values.push(patch[field]);
    }
  }
  if (patch.complete) {
    assignments.push("setup_completed_at = COALESCE(setup_completed_at, ?)");
    values.push(new Date().toISOString());
  }
  if (patch.setupCompletedAt === null) assignments.push("setup_completed_at = NULL");
  if (patch.facePhotoUrl === null) assignments.push("face_photo_file_id = NULL");

  const statements = [];
  if (assignments.length > 0) {
    statements.push(db.prepare(createProfile).bind(userId));
    // Retire the current key and clear the reference in the same transaction.
    if (patch.facePhotoUrl === null) statements.push(db.prepare(retirePhoto + " ON CONFLICT (user_id, file_key) DO NOTHING").bind(userId));
    statements.push(db.prepare(`UPDATE profiles SET ${assignments.join(", ")} WHERE user_id = ?`)
      .bind(...values, userId));
  }
  if (Object.hasOwn(patch, "styles")) {
    const styles = [...new Set(patch.styles?.map((style) => style.trim()))];
    statements.push(db.prepare("DELETE FROM style_preferences WHERE user_id = ?").bind(userId));
    if (styles.length > 0) {
      statements.push(db.prepare(`
        INSERT INTO style_preferences (user_id, style) SELECT ?, value FROM json_each(?)
      `).bind(userId, JSON.stringify(styles)));
    }
  }
  if (statements.length > 0) await db.batch(statements);
}

async function retryPhotoCleanup(env, userId) {
  try {
    const { results } = await env.DB.prepare(`
      SELECT file_key FROM profile_photo_cleanup
      WHERE user_id = ? AND available_at <= unixepoch()
      ORDER BY available_at LIMIT 20
    `).bind(userId).all();
    const outcomes = await Promise.allSettled(results.map(async ({ file_key }) => {
      await deleteFile(env, userId, file_key);
      await env.DB.prepare("DELETE FROM profile_photo_cleanup WHERE user_id = ? AND file_key = ?")
        .bind(userId, file_key).run();
    }));
    return results.length < 20 && outcomes.every(({ status }) => status === "fulfilled");
  } catch {
    return false;
  }
}

async function uploadPhoto(request, env, userId) {
  const parsed = await readUploadForm(request);
  if (!parsed.form) return error(parsed.error, parsed.status);
  const image = parsed.form.get("image");
  if (!image || typeof image === "string" || !image.size ||
      [...parsed.form.values()].filter(value => value instanceof Blob).length !== 1) {
    return error("Select a photo to upload.", 400);
  }
  if (image.size > maxImageBytes) return error("The photo must be 8 MB or smaller.", 413);

  const bytes = new Uint8Array(await image.arrayBuffer());
  const type = imageType(bytes);
  if (!type) return error("Upload a JPEG, PNG, or WebP photo.", 415);

  const db = env.DB;
  const key = `users/${userId}/profile/${crypto.randomUUID()}`;
  // A staged file remains eligible for cleanup if uploading or committing is interrupted.
  await db.prepare(`
    INSERT INTO profile_photo_cleanup (user_id, file_key, available_at)
    VALUES (?, ?, unixepoch() + 3600)
  `).bind(userId, key).run();
  try {
    await putFile(env, userId, key, bytes, type);
    const [, staged] = await db.batch([
      db.prepare(createProfile).bind(userId),
      db.prepare(`
        UPDATE profile_photo_cleanup SET available_at = -1
        WHERE user_id = ? AND file_key = ? AND available_at > unixepoch()
      `).bind(userId, key),
      db.prepare(`${retirePhoto}
        AND EXISTS (
          SELECT 1 FROM profile_photo_cleanup
          WHERE user_id = ? AND file_key = ? AND available_at = -1
        )
        ON CONFLICT (user_id, file_key) DO NOTHING
      `).bind(userId, userId, key),
      db.prepare(`
        UPDATE profiles SET face_photo_file_id = ?
        WHERE user_id = ? AND EXISTS (
          SELECT 1 FROM profile_photo_cleanup
          WHERE user_id = ? AND file_key = ? AND available_at = -1
        )
      `).bind(key, userId, userId, key),
      db.prepare(`
        DELETE FROM profile_photo_cleanup WHERE user_id = ? AND file_key = ? AND available_at = -1
      `).bind(userId, key),
    ]);
    if (staged.meta.changes === 0) {
      // A timed-out upload may finish writing after its staged object was already cleaned up.
      await db.prepare(`
        INSERT INTO profile_photo_cleanup (user_id, file_key, available_at)
        VALUES (?, ?, unixepoch()) ON CONFLICT (user_id, file_key) DO NOTHING
      `).bind(userId, key).run();
      throw new Error("Photo upload timed out.");
    }
  } catch (cause) {
    // If the database committed despite an error, the staged row is already gone.
    await db.prepare(`
      UPDATE profile_photo_cleanup SET available_at = unixepoch()
      WHERE user_id = ? AND file_key = ?
    `).bind(userId, key).run().catch(() => {});
    await retryPhotoCleanup(env, userId);
    throw cause;
  }
  await retryPhotoCleanup(env, userId);
  return readProfile(db, userId);
}

export async function profile(request, env, userId) {
  const { pathname } = new URL(request.url);
  const { method } = request;
  const db = env.DB;
  try {
    if (pathname === "/api/profile") {
      if (method === "GET") {
        await retryPhotoCleanup(env, userId);
        return await readProfile(db, userId);
      }
      if (method === "PATCH") {
        const patch = await request.json().catch(() => null);
        const validation = validatePatch(patch);
        if (validation) return error(validation, 400);
        await updateProfile(db, userId, patch);
        if (!(await retryPhotoCleanup(env, userId)) && patch.facePhotoUrl === null) {
          return error("The photo is hidden. Try again to finish removing it from storage.", 503);
        }
        return await readProfile(db, userId);
      }
      return new Response(null, { status: 405, headers: { ...cacheHeaders, Allow: "GET, PATCH" } });
    }
    if (pathname === "/api/profile/photo") {
      if (method === "PUT") return await uploadPhoto(request, env, userId);
      if (method === "DELETE") {
        await updateProfile(db, userId, { facePhotoUrl: null });
        if (!(await retryPhotoCleanup(env, userId))) {
          return error("The photo is hidden. Try again to finish removing it from storage.", 503);
        }
        return await readProfile(db, userId);
      }
      return new Response(null, { status: 405, headers: { ...cacheHeaders, Allow: "PUT, DELETE" } });
    }
    return error("Profile route not found.", 404);
  } catch {
    return error("Your profile is temporarily unavailable. Try again.", 503);
  }
}
