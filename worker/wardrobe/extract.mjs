import { deletePrivateFile, readPrivateFile, writePrivateFile } from "../private-files.mjs";
import { fileUrl } from "../wardrobe-files.mjs";
import { fixtures } from "./extraction-fixtures.mjs";
import { ExtractionImageError, normalizePhoto } from "./extraction-image.mjs";
import { LunaExtractionError, lunaExtraction } from "./extraction-luna.mjs";

const columns = "id, name, category, garment_type, color, image_file_id, confirmed_at, extraction_source";
const maxPhotoBytes = 8 * 1024 * 1024;
const unavailable = "Luna High Fast extraction is currently unavailable. You can review the photo manually.";

function response(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function failure(error, code, status) {
  return response({ error, code }, status);
}

function result(row) {
  return response({
    source: row.extraction_source,
    item: {
      id: row.id,
      name: row.name,
      category: row.category,
      garmentType: row.garment_type,
      color: row.color,
      imageFileId: row.image_file_id,
      imageUrl: fileUrl(row.image_file_id),
    },
  });
}

function loadItem(env, userId, itemId) {
  return env.DB.prepare(`
    SELECT ${columns} FROM wardrobe_items
    WHERE user_id = ? AND id = ? AND archived_at IS NULL
  `).bind(userId, itemId).first();
}

async function removeUnusedFile(env, account, key) {
  try {
    await deletePrivateFile(env, account, key);
  } catch (error) {
    console.error("Wardrobe extraction file cleanup failed", error.name);
  }
}

async function fixtureFor(bytes) {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const digest = Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return fixtures.find((fixture) => fixture.digest === digest);
}

export async function extract(request, env, userId, id) {
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  const itemId = /^[1-9]\d*$/.test(id) ? Number(id) : NaN;
  if (!Number.isSafeInteger(itemId)) return failure("Wardrobe item not found.", "item_not_found", 404);
  const draft = await loadItem(env, userId, itemId);
  if (!draft) return failure("Wardrobe item not found.", "item_not_found", 404);

  if (draft.extraction_source) return result(draft);
  if (draft.confirmed_at) return failure("This wardrobe item is already confirmed.", "draft_changed", 409);

  const fixturesEnabled = env.WARDROBE_EXTRACTION_FIXTURES === "1";
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey && !fixturesEnabled) return failure(unavailable, "extraction_unavailable", 503);

  const account = { id: userId };
  const photoFile = await readPrivateFile(env, account, draft.image_file_id);
  if (!photoFile) {
    // A parallel request may have already replaced the original.
    const current = await loadItem(env, userId, itemId);
    return current?.extraction_source ? result(current)
      : failure("The wardrobe photo could not be found.", "photo_not_found", 404);
  }
  if (photoFile.size > maxPhotoBytes) {
    return failure("Choose a photo that is 8 MB or smaller for extraction.", "unsupported_photo", 413);
  }

  let extracted;
  let png;
  let source;
  try {
    const bytes = new Uint8Array(await photoFile.arrayBuffer());
    const fixture = fixturesEnabled ? await fixtureFor(bytes) : null;
    if (!fixture && !apiKey) return failure(unavailable, "extraction_unavailable", 503);
    if (fixture) {
      extracted = fixture;
      source = "fixture";
      png = Uint8Array.from(atob(fixture.pngBase64), (char) => char.charCodeAt(0));
    } else {
      extracted = await lunaExtraction(await normalizePhoto(bytes), apiKey);
      source = "luna";
      png = extracted.png;
    }
  } catch (error) {
    if (error instanceof LunaExtractionError) return failure(error.message, error.code, error.status);
    if (error instanceof ExtractionImageError) return failure(error.message, "unsupported_photo", error.status);
    throw error;
  }

  // Each run writes a separate object so parallel model responses cannot overwrite the winner.
  const key = await writePrivateFile(env, account, png, "image/png");
  let updated;
  try {
    updated = await env.DB.prepare(`
      UPDATE wardrobe_items SET name = ?, category = ?, garment_type = ?, color = ?, image_file_id = ?, extraction_source = ?
      WHERE user_id = ? AND id = ? AND confirmed_at IS NULL AND archived_at IS NULL
        AND extraction_source IS NULL
        AND image_file_id = ? AND name IS ? AND category IS ? AND garment_type IS ? AND color IS ?
      RETURNING ${columns}
    `).bind(
      extracted.name, extracted.category, extracted.garment_type, extracted.color, key, source,
      userId, itemId, draft.image_file_id, draft.name, draft.category, draft.garment_type, draft.color,
    ).first();
  } catch (error) {
    // A committed reference prevents cleanup even if D1 lost the response.
    await removeUnusedFile(env, account, key);
    const current = await loadItem(env, userId, itemId);
    if (current?.extraction_source) return result(current);
    throw error;
  }

  if (!updated) {
    await removeUnusedFile(env, account, key);
    const current = await loadItem(env, userId, itemId);
    return current?.extraction_source ? result(current)
      : failure("This wardrobe draft changed during extraction.", "draft_changed", 409);
  }

  await removeUnusedFile(env, account, draft.image_file_id);
  return result(updated);
}
