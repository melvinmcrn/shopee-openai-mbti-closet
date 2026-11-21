import { deletePrivateFile, readPrivateFile, writePrivateFile } from "../private-files.mjs";
import { fileUrl } from "../wardrobe-files.mjs";
import { fixtures } from "./extraction-fixtures.mjs";
import { ExtractionImageError, normalizePhoto } from "./extraction-image.mjs";
import { LunaExtractionError, lunaBatchExtraction, lunaExtraction, lunaPrimaryExtraction } from "./extraction-luna.mjs";

const columns = "id, name, category, garment_type, color, image_file_id, confirmed_at, extraction_source, extraction_group_id";
const maxPhotoBytes = 8 * 1024 * 1024;
const unavailable = "Luna High Fast extraction is currently unavailable. You can review the photo manually.";

function outcome(body, status = 200) {
  return { body, status };
}

function failure(error, code, status) {
  return outcome({ error, code }, status);
}

function result(rows, itemId) {
  const items = rows.map((row) => ({
    id: row.id, name: row.name, category: row.category,
    garmentType: row.garment_type, color: row.color,
    imageFileId: row.image_file_id, imageUrl: fileUrl(row.image_file_id),
  }));
  const item = items.find((view) => view.id === itemId);
  return item ? outcome({ source: rows[0].extraction_source, item, items })
    : failure("Wardrobe item not found.", "item_not_found", 404);
}

async function existingResult(env, userId, row) {
  if (row.extraction_group_id == null) return result([row], row.id);
  const group = await env.DB.prepare(`
    SELECT ${columns} FROM wardrobe_items
    WHERE user_id = ? AND extraction_group_id = ? AND archived_at IS NULL
    ORDER BY id
  `).bind(userId, row.extraction_group_id).all();
  return result(group.results, row.id);
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
  const extractor = new URL(request.url).searchParams.get("mode") === "primary" ? lunaPrimaryExtraction : lunaExtraction;
  const { body, status } = await extractDraft(env, userId, itemId, extractor);
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function prepareDraft(env, userId, itemId, dimension) {
  if (!Number.isSafeInteger(itemId) || itemId < 1) return failure("Wardrobe item not found.", "item_not_found", 404);
  const draft = await loadItem(env, userId, itemId);
  if (!draft) return failure("Wardrobe item not found.", "item_not_found", 404);

  if (draft.extraction_source) return existingResult(env, userId, draft);
  if (draft.confirmed_at) return failure("This wardrobe item is already confirmed.", "draft_changed", 409);

  const fixturesEnabled = env.WARDROBE_EXTRACTION_FIXTURES === "1";
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey && !fixturesEnabled) return failure(unavailable, "extraction_unavailable", 503);

  const account = { id: userId };
  const photoFile = await readPrivateFile(env, account, draft.image_file_id);
  if (!photoFile) {
    // A parallel request may have already replaced the original.
    const current = await loadItem(env, userId, itemId);
    return current?.extraction_source ? existingResult(env, userId, current)
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

function lunaFailure(error, primaryAttempt = false) {
  if (error instanceof LunaExtractionError) {
    const result = failure(error.message, error.code, error.status);
    if (primaryAttempt) {
      result.body.nextAction = "manual_review";
    } else if (["image_missing", "image_alpha", "image_layout", "batch_png_layout"].includes(error.stage)) {
      result.body.nextAction = "extract_primary";
    } else if (["final_message_refused", "provider_filtered"].includes(error.stage)) {
      result.body.nextAction = "manual_review";
    }
    return result;
  }
  console.warn("Wardrobe extraction failed after draft upload");
  return failure(unavailable, "extraction_unavailable", 503);
}

function persistFixture(env, userId, { draft, fixture }) {
  const png = Uint8Array.from(atob(fixture.pngBase64), (char) => char.charCodeAt(0));
  return persistExtraction(env, userId, draft, [{ ...fixture, png }], "fixture");
}

export async function extractDraft(env, userId, itemId, extractor = lunaExtraction) {
  const pending = await prepareDraft(env, userId, itemId);
  if (!pending.draft) return pending;
  if (pending.fixture) return persistFixture(env, userId, pending);

  try {
    const garments = await extractor(pending.photo, pending.apiKey, itemId);
    return await persistExtraction(env, userId, pending.draft, garments, "luna");
  } catch (error) {
    if (error instanceof LunaExtractionError) return lunaFailure(error, extractor === lunaPrimaryExtraction);
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
      ? [await lunaExtraction(pending[0].photo, apiKey, pending[0].draft.id)]
      : await lunaBatchExtraction(pending.map(({ photo }) => photo), apiKey, pending.map(({ draft }) => draft.id));
  } catch (error) {
    const failed = lunaFailure(error);
    for (const { index } of pending) outcomes[index] = failed;
    return outcomes;
  }

  for (let offset = 0; offset < pending.length; offset += 4) {
    await Promise.all(pending.slice(offset, offset + 4).map(async ({ index, draft }, i) => {
      try {
        const garments = results[offset + i];
        outcomes[index] = garments instanceof LunaExtractionError ? lunaFailure(garments)
          : await persistExtraction(env, userId, draft, garments, "luna");
      } catch (error) {
        outcomes[index] = lunaFailure(error);
      }
    }));
  }
  return outcomes;
}

async function persistExtraction(env, userId, draft, garments, source) {
  if (!garments) return failure("No valid cutout was returned for this photo.", "invalid_extraction", 502);
  if (!garments.length) {
    return failure("No garment could be isolated. Try a clearer photo or review it manually.", "garment_not_found", 422);
  }

  const account = { id: userId };
  const keys = [];
  let saved;
  let saveError;
  try {
    for (const { png } of garments) {
      keys.push(await writePrivateFile(env, account, png, "image/png"));
    }

    const [first, ...siblings] = garments;
    const update = env.DB.prepare(`
      UPDATE wardrobe_items SET name = ?, category = ?, garment_type = ?, color = ?, image_file_id = ?,
                                extraction_source = ?, extraction_group_id = ?
      WHERE user_id = ? AND id = ? AND confirmed_at IS NULL AND archived_at IS NULL
        AND extraction_source IS NULL
        AND image_file_id = ? AND name IS ? AND category IS ? AND garment_type IS ? AND color IS ?
      RETURNING ${columns}
    `).bind(
      first.name, first.category, first.garment_type, first.color, keys[0], source, siblings.length ? draft.id : null,
      userId, draft.id, draft.image_file_id, draft.name, draft.category, draft.garment_type, draft.color,
    );
    // Only the request that attached its unique first file may insert siblings.
    // The update and inserts commit together on both D1 and PostgreSQL.
    const inserts = siblings.map((garment, index) => env.DB.prepare(`
      INSERT INTO wardrobe_items (user_id, name, category, garment_type, color, image_file_id, extraction_source, extraction_group_id)
      SELECT user_id, ?, ?, ?, ?, ?, extraction_source, id
      FROM wardrobe_items WHERE user_id = ? AND id = ? AND image_file_id = ?
      RETURNING ${columns}
    `).bind(garment.name, garment.category, garment.garment_type, garment.color, keys[index + 1], userId, draft.id, keys[0]));
    const committed = await env.DB.batch([update, ...inserts]);
    saved = committed.flatMap(({ results }) => results);
  } catch (error) {
    saveError = error;
  }

  if (saved?.length) {
    await removeUnusedFile(env, account, draft.image_file_id);
    return result(saved, draft.id);
  }

  // The private-file registry protects attached files even when the commit acknowledgement was lost.
  await Promise.all(keys.map((key) => removeUnusedFile(env, account, key)));
  const current = await loadItem(env, userId, draft.id);
  if (current?.extraction_source) {
    await removeUnusedFile(env, account, draft.image_file_id);
    return existingResult(env, userId, current);
  }
  if (saveError) throw saveError;
  return failure("This wardrobe draft changed during extraction.", "draft_changed", 409);
}
