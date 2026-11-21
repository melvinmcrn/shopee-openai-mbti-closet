import { deletePrivateFile, readPrivateFile, writePrivateFile } from "../private-files.mjs";
import { fileUrl } from "../wardrobe-files.mjs";
import { fixtures } from "./extraction-fixtures.mjs";
import { ExtractionImageError, normalizePhoto } from "./extraction-image.mjs";
import { LunaExtractionError, lunaBatchExtraction, lunaExtraction } from "./extraction-luna.mjs";

const columns = "id, name, category, garment_type, color, image_file_id, confirmed_at, extraction_source";
const maxPhotoBytes = 8 * 1024 * 1024;
const unavailable = "Luna High Fast extraction is currently unavailable. You can review the photo manually.";

function outcome(body, status = 200) {
  return { body, status };
}

function failure(error, code, status) {
  return outcome({ error, code }, status);
}

function result(row) {
  return outcome({
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
  const { body, status } = await extractDraft(env, userId, itemId);
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function prepareDraft(env, userId, itemId, dimension) {
  if (!Number.isSafeInteger(itemId) || itemId < 1) return failure("Wardrobe item not found.", "item_not_found", 404);
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

  try {
    const bytes = new Uint8Array(await photoFile.arrayBuffer());
    const fixture = fixturesEnabled ? await fixtureFor(bytes) : null;
    if (!fixture && !apiKey) return failure(unavailable, "extraction_unavailable", 503);
    if (fixture) {
      return { draft, fixture };
    }
    const normalize = env.normalizeWardrobePhoto ?? normalizePhoto;
    return { draft, photo: await normalize(bytes, dimension), apiKey };
  } catch (error) {
    if (error instanceof ExtractionImageError) return failure(error.message, "unsupported_photo", error.status);
    throw error;
  }
}

function lunaFailure(error) {
  if (error instanceof LunaExtractionError) return failure(error.message, error.code, error.status);
  console.warn("Wardrobe extraction failed after draft upload");
  return failure(unavailable, "extraction_unavailable", 503);
}

function persistFixture(env, userId, { draft, fixture }) {
  const png = Uint8Array.from(atob(fixture.pngBase64), (char) => char.charCodeAt(0));
  return persistExtraction(env, userId, draft, fixture, png, "fixture");
}

export async function extractDraft(env, userId, itemId) {
  const pending = await prepareDraft(env, userId, itemId);
  if (!pending.draft) return pending;
  if (pending.fixture) return persistFixture(env, userId, pending);

  try {
    const data = await lunaExtraction(pending.photo, pending.apiKey);
    return await persistExtraction(env, userId, pending.draft, data, data.png, "luna");
  } catch (error) {
    if (error instanceof LunaExtractionError) return lunaFailure(error);
    throw error;
  }
}

export async function extractDraftBatch(env, userId, ids) {
  if (ids.length > 20) throw new RangeError("Too many wardrobe drafts");
  if (ids.length === 1) {
    try {
      return [await extractDraft(env, userId, ids[0])];
    } catch (error) {
      return [lunaFailure(error)];
    }
  }
  const outcomes = new Array(ids.length);
  const pending = [];
  for (const [index, id] of ids.entries()) {
    try {
      const item = await prepareDraft(env, userId, id, 640);
      if (!item.draft) outcomes[index] = item;
      else if (item.fixture) outcomes[index] = await persistFixture(env, userId, item);
      else pending.push({ index, ...item });
    } catch (error) {
      outcomes[index] = lunaFailure(error);
    }
  }
  if (!pending.length) return outcomes;

  let results;
  try {
    const apiKey = pending[0].apiKey;
    results = pending.length === 1
      ? [await lunaExtraction(pending[0].photo, apiKey)]
      : await lunaBatchExtraction(pending.map(({ photo }) => photo), apiKey);
  } catch (error) {
    const failed = lunaFailure(error);
    for (const { index } of pending) outcomes[index] = failed;
    return outcomes;
  }

  for (let offset = 0; offset < pending.length; offset += 4) {
    await Promise.all(pending.slice(offset, offset + 4).map(async ({ index, draft }, i) => {
      const data = results[offset + i];
      if (!data) {
        outcomes[index] = failure("No valid cutout was returned for this garment.", "invalid_extraction", 502);
        return;
      }
      try {
        outcomes[index] = await persistExtraction(env, userId, draft, data, data.png, "luna");
      } catch (error) {
        outcomes[index] = lunaFailure(error);
      }
    }));
  }
  return outcomes;
}

async function persistExtraction(env, userId, draft, extracted, png, source) {
  const itemId = draft.id;
  const account = { id: userId };
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
