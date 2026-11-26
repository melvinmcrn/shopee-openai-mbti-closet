import { deletePrivateFile, retryPrivateFileCleanup, writePrivateFile } from "../private-files.mjs";
import { fileUrl } from "../wardrobe-files.mjs";
import { maxProfilePhotoBytes, profilePhotoType } from "../profile-photo-image.mjs";
import { readUploadForm } from "./upload.mjs";

const cacheHeaders = { "Cache-Control": "no-store" };
const editableFields = new Set([
  "heightCm", "weightKg", "styles", "facePhotoUrl", "setupCompletedAt", "complete", "setupStage",
]);

const createProfile = "INSERT INTO profiles (user_id) VALUES (?) ON CONFLICT (user_id) DO NOTHING";

function error(message, status) {
  return Response.json({ error: message }, { status, headers: cacheHeaders });
}

async function readProfile(db, userId, resume = false) {
  const row = await db.prepare(`
    SELECT p.height_cm, p.weight_kg, p.face_photo_file_id, p.setup_completed_at,
      ${resume ? `CASE
        WHEN p.setup_stage IN ('style', 'ready') THEN p.setup_stage
        WHEN EXISTS (SELECT 1 FROM wardrobe_items WHERE user_id = u.id AND archived_at IS NULL AND confirmed_at IS NULL) THEN 'confirm'
        WHEN p.setup_stage IN ('add', 'confirm') THEN p.setup_stage
        WHEN EXISTS (SELECT 1 FROM style_preferences WHERE user_id = u.id) THEN 'ready'
        WHEN EXISTS (SELECT 1 FROM wardrobe_items WHERE user_id = u.id AND archived_at IS NULL AND confirmed_at IS NOT NULL) THEN 'style'
        ELSE 'add' END AS setup_stage,` : ""}
      (SELECT json_group_array(style) FROM (
        SELECT style FROM style_preferences WHERE user_id = u.id ORDER BY style
      ) AS sorted_styles) AS styles
    FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = ?
  `).bind(userId).first();
  return Response.json({
    ...(resume && { setupStage: row?.setup_stage ?? "add" }),
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
  if (Object.hasOwn(patch, "setupStage") && !["add", "confirm", "style", "ready"].includes(patch.setupStage)) {
    return "Choose a supported setup stage.";
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
  if (patch.setupStage) {
    assignments.push("setup_stage = CASE WHEN setup_completed_at IS NULL THEN ? ELSE setup_stage END");
    values.push(patch.setupStage);
  }
  if (patch.complete) {
    assignments.push("setup_completed_at = COALESCE(setup_completed_at, ?)");
    values.push(new Date().toISOString());
  }
  if (patch.setupCompletedAt === null) assignments.push("setup_completed_at = NULL", "setup_stage = NULL");
  if (patch.facePhotoUrl === null) assignments.push("face_photo_file_id = NULL");

  const statements = [];
  if (assignments.length > 0) {
    statements.push(db.prepare(createProfile).bind(userId));
    statements.push(db.prepare(`UPDATE profiles SET ${assignments.join(", ")} WHERE user_id = ?`).bind(...values, userId));
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
        return await readProfile(db, userId, new URL(request.url).searchParams.get("resume") === "1");
      }
      if (method === "PATCH") {
        const patch = await request.json().catch(() => null);
        const validation = validatePatch(patch);
        if (validation) return error(validation, 400);
        await updateProfile(db, userId, patch);
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
