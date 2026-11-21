import { deletePrivateFile, retryPrivateFileCleanup, writePrivateFile } from "../private-files.mjs";
import { fileUrl } from "../wardrobe-files.mjs";
import { maxProfilePhotoBytes, profilePhotoType } from "../profile-photo-image.mjs";
import { readUploadForm } from "./upload.mjs";

const cacheHeaders = { "Cache-Control": "no-store" };
const editableFields = new Set([
  "heightCm", "weightKg", "styles", "facePhotoUrl", "setupCompletedAt", "complete",
]);

const createProfile = "INSERT INTO profiles (user_id) VALUES (?) ON CONFLICT (user_id) DO NOTHING";

function error(message, status, code) {
  return Response.json({ error: message, ...(code ? { code } : {}) }, { status, headers: cacheHeaders });
}

async function readProfile(db, userId) {
  const row = await db.prepare(`
    SELECT p.height_cm, p.weight_kg, p.face_photo_file_id, p.setup_completed_at,
      (SELECT json_group_array(style) FROM (
        SELECT style FROM style_preferences WHERE user_id = u.id ORDER BY style
      ) AS sorted_styles) AS styles
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
  if (patch.complete && patch.facePhotoUrl === null) {
    return "Setup cannot be completed while removing the profile photo.";
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
    // Check the owned, saved photo in the same write that completes onboarding.
    // Users who already completed setup can still manage or remove their photo.
    const completionGuard = patch.complete ? `
      AND (setup_completed_at IS NOT NULL OR EXISTS (
        SELECT 1 FROM private_files
        WHERE file_id = profiles.face_photo_file_id AND user_id = profiles.user_id AND state = 'ready'
      ))
      RETURNING setup_completed_at
    ` : "";
    statements.push(db.prepare(`UPDATE profiles SET ${assignments.join(", ")} WHERE user_id = ? ${completionGuard}`)
      .bind(...values, userId));
  }
  if (Object.hasOwn(patch, "styles")) {
    const styles = [...new Set(patch.styles?.map((style) => style.trim()))];
    const completed = "EXISTS (SELECT 1 FROM profiles WHERE user_id = ? AND setup_completed_at IS NOT NULL)";
    const completeValues = patch.complete ? [userId] : [];
    statements.push(db.prepare(`
      DELETE FROM style_preferences WHERE user_id = ? ${patch.complete ? `AND ${completed}` : ""}
    `).bind(userId, ...completeValues));
    if (styles.length > 0) {
      statements.push(db.prepare(`
        INSERT INTO style_preferences (user_id, style) SELECT ?, value FROM json_each(?)
        ${patch.complete ? `WHERE ${completed}` : ""}
      `).bind(userId, JSON.stringify(styles), ...completeValues));
    }
  }
  const results = statements.length > 0 ? await db.batch(statements) : [];
  return !patch.complete || Boolean(results[1]?.results?.[0]?.setup_completed_at);
}

async function retryPhotoCleanup(env, account) {
  try {
    await retryPrivateFileCleanup(env, account);
    return true;
  } catch {
    return false;
  }
}

async function uploadPhoto(request, env, account) {
  const parsed = await readUploadForm(request);
  if (!parsed.form) return error(parsed.error, parsed.status);
  const image = parsed.form.get("image");
  if (!(image instanceof Blob) || !image.size || parsed.form.getAll("image").length !== 1 ||
      [...parsed.form.values()].filter(value => value instanceof Blob).length !== 1) {
    return error("Select a photo to upload.", 400);
  }
  if (image.size > maxProfilePhotoBytes) return error("The photo must be 8 MB or smaller.", 413);

  const type = await profilePhotoType(image);
  if (!type) return error("Upload a valid JPEG, PNG, or WebP photo.", 415);

  const bytes = new Uint8Array(await image.arrayBuffer());
  const db = env.DB;
  const fileId = await writePrivateFile(env, account, bytes, type);
  try {
    // The reference trigger queues the previous file when this was its final reference.
    await db.prepare(`
      INSERT INTO profiles (user_id, face_photo_file_id) VALUES (?, ?)
      ON CONFLICT (user_id) DO UPDATE SET face_photo_file_id = excluded.face_photo_file_id
    `).bind(account.id, fileId).run();
  } catch (cause) {
    // If the database committed despite an error, the storage helper preserves the reference.
    await deletePrivateFile(env, account, fileId).catch(() => {});
    throw cause;
  }
  await retryPhotoCleanup(env, account);
  return readProfile(db, account.id);
}

export async function profile(request, env, userId) {
  const { pathname } = new URL(request.url);
  const { method } = request;
  const db = env.DB;
  const account = { id: userId };
  try {
    if (pathname === "/api/profile") {
      if (method === "GET") {
        await retryPhotoCleanup(env, account);
        return await readProfile(db, userId);
      }
      if (method === "PATCH") {
        const patch = await request.json().catch(() => null);
        const validation = validatePatch(patch);
        if (validation) return error(validation, 400);
        if (!(await updateProfile(db, userId, patch))) {
          return error("Add a profile photo before completing setup.", 409, "profile_photo_required");
        }
        if (!(await retryPhotoCleanup(env, account)) && patch.facePhotoUrl === null) {
          return error("The photo is hidden. Try again to finish removing it from storage.", 503);
        }
        return await readProfile(db, userId);
      }
      return new Response(null, { status: 405, headers: { ...cacheHeaders, Allow: "GET, PATCH" } });
    }
    if (pathname === "/api/profile/photo") {
      if (method === "PUT") return await uploadPhoto(request, env, account);
      if (method === "DELETE") {
        await updateProfile(db, userId, { facePhotoUrl: null });
        if (!(await retryPhotoCleanup(env, account))) {
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
