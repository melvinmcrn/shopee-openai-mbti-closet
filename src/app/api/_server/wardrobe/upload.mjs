import { deletePrivateFile, writePrivateFile } from "../private-files.mjs";
import { extractDraft, extractDraftBatch } from "./extract.mjs";

export const maxImageBytes = 8 * 1024 * 1024;
const maxBatchCount = 20;
const maxBatchImageBytes = 3_950_000;
const maxFormBytes = maxImageBytes + 64 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A retry can arrive after review archived the first garment in an extracted group.
const findDraft = `
  SELECT CASE WHEN original.archived_at IS NULL THEN original.id ELSE COALESCE((
    SELECT MIN(id) FROM wardrobe_items
    WHERE user_id = original.user_id AND extraction_group_id = original.id AND archived_at IS NULL
  ), original.id) END AS id, original.image_file_id
  FROM wardrobe_items AS original WHERE original.user_id = ? AND original.draft_key = ?
`;

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function error(message, status) {
  return json({ error: message }, status);
}

async function finishDraft(env, userId, id) {
  let extraction;
  try {
    extraction = await extractDraft(env, userId, id);
  } catch (err) {
    console.warn("Wardrobe extraction could not finish after upload", err instanceof Error ? err.name : "UnknownError");
    return json({ id, extraction: { status: "manual", code: "extraction_unavailable" } });
  }
  const data = uploadResult(id, extraction);
  return json(data.body, data.status);
}

function uploadResult(id, { status, body }) {
  if (status === 200) return { status: 200, body: { id, extraction: { status: "ready", ...body } } };
  if (status === 404 || status === 409) return { status, body };
  return { status: 200, body: { id, extraction: { status: "manual", code: body.code, nextAction: body.nextAction } } };
}

export function imageType(image) {
  const matches = (offset, signature) =>
    signature.every((byte, index) => image[offset + index] === byte);

  if (matches(0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (matches(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (matches(0, [0x52, 0x49, 0x46, 0x46]) && matches(8, [0x57, 0x45, 0x42, 0x50])) {
    return "image/webp";
  }
  return null;
}

export async function readUploadForm(request) {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(contentType) || !request.body) {
    return { error: "Choose a photo to upload.", status: 400 };
  }

  let form;
  let tooLarge = Number(request.headers.get("Content-Length")) > maxFormBytes;
  if (!tooLarge) {
    let received = 0;
    const body = request.body.pipeThrough(new TransformStream({
      transform(chunk, controller) {
        received += chunk.byteLength;
        if (received > maxFormBytes) {
          tooLarge = true;
          controller.error(new RangeError("Upload exceeds size limit"));
          return;
        }
        controller.enqueue(chunk);
      },
    }));
    try {
      form = await new Response(body, { headers: { "Content-Type": contentType } }).formData();
    } catch {
      if (!tooLarge) return { error: "The photo upload could not be read.", status: 400 };
    }
  }
  if (tooLarge) return { error: "Choose a photo that is 8 MB or smaller.", status: 413 };
  return { form };
}

function draftKey(value) {
  return typeof value === "string" && uuid.test(value) ? value.toLowerCase() : null;
}

export async function upload(request, env, userId) {
  const parsed = await readUploadForm(request);
  if (!parsed.form) return error(parsed.error, parsed.status);
  const { form } = parsed;
  if (form.has("batch")) return uploadBatch(form, env, userId);

  const key = draftKey(form.get("draftKey"));
  if (!key || form.getAll("draftKey").length !== 1) {
    return error("The upload is missing a valid draft key.", 400);
  }

  const images = form.getAll("image");
  const files = [...form.values()].filter((value) => value instanceof Blob);
  if (images.length > 1 || images.length !== files.length) return error("Choose one photo to upload.", 400);

  const draft = await storeDraft(env, userId, key, images[0]);
  return draft.id ? finishDraft(env, userId, draft.id) : error(draft.error, draft.status);
}

async function uploadBatch(form, env, userId) {
  let entries;
  try {
    const value = form.get("batch");
    if (typeof value !== "string" || value.length > 2048 || form.getAll("batch").length !== 1) {
      return error("The batch is missing valid draft keys.", 400);
    }
    entries = JSON.parse(value);
  } catch {
    return error("The batch is missing valid draft keys.", 400);
  }
  if (!Array.isArray(entries) || !entries.length || entries.length > maxBatchCount) {
    return error("Choose between 1 and 20 photos in each upload.", 400);
  }
  const keys = entries.map(draftKey);
  if (keys.some((key) => !key) || new Set(keys).size !== keys.length) {
    return error("The batch must use distinct valid draft keys.", 400);
  }
  const imageFields = new Set(entries.map((key) => "image:" + key));
  let total = 0;
  for (const [field, value] of form) {
    if (field === "batch") continue;
    if (!imageFields.delete(field) || !(value instanceof Blob)) {
      return error("Choose at most one photo for each draft.", 400);
    }
    total += value.size;
    if (total > maxBatchImageBytes) return error("This selection is too large. Choose smaller photos or fewer files.", 413);
  }

  const drafts = [];
  for (let offset = 0; offset < keys.length; offset += 4) {
    const group = await Promise.all(keys.slice(offset, offset + 4).map(async (key, index) => {
      try {
        return await storeDraft(env, userId, key, form.get("image:" + entries[offset + index]) ?? undefined);
      } catch {
        console.warn("Wardrobe batch draft could not be stored");
        return { error: "The photo could not be saved. Try again.", status: 503 };
      }
    }));
    drafts.push(...group);
  }
  const ready = drafts.filter((draft) => draft.id);
  const results = await extractDraftBatch(env, userId, ready.map(({ id }) => id));
  let index = 0;
  return json({ items: drafts.map((draft, slot) => {
    const key = entries[slot];
    if (!draft.id) return { draftKey: key, ...draft };
    const value = uploadResult(draft.id, results[index++]);
    if (value.status !== 200) return { draftKey: key, ...value.body, status: value.status };
    return { draftKey: key, ...value.body };
  }) });
}

async function storeDraft(env, userId, key, image) {
  if (image === undefined) {
    const existing = await env.DB.prepare(findDraft).bind(userId, key).first();
    return existing ? { id: existing.id } : { error: "Wardrobe draft not found.", status: 404 };
  }
  if (!(image instanceof Blob) || image.size === 0) return { error: "Choose one photo to upload.", status: 400 };
  if (image.size > maxImageBytes) return { error: "Choose a photo that is 8 MB or smaller.", status: 413 };

  const bytes = new Uint8Array(await image.arrayBuffer());
  const type = imageType(bytes);
  if (!type) return { error: "Choose a JPEG, PNG, or WebP photo.", status: 415 };

  const existing = await env.DB.prepare(findDraft).bind(userId, key).first();
  if (existing) return { id: existing.id };

  const account = { id: userId };
  const fileId = await writePrivateFile(env, account, bytes, type);
  let attached = false;
  let id;
  try {
    const [, draftResult] = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO wardrobe_items (user_id, name, category, image_file_id, draft_key)
         VALUES (?, 'Untitled garment', 'other', ?, ?)
         ON CONFLICT (user_id, draft_key) DO NOTHING`,
      ).bind(userId, fileId, key),
      env.DB.prepare(findDraft).bind(userId, key),
    ]);
    const draft = draftResult.results[0];
    if (!draft) throw new Error("Wardrobe draft could not be saved");
    attached = draft.image_file_id === fileId;
    id = draft.id;
  } finally {
    if (!attached) {
      try {
        // Storage checks live references before deleting, including after an uncertain D1 write.
        await deletePrivateFile(env, account, fileId);
      } catch {
        console.warn("Wardrobe upload cleanup is pending");
      }
    }
  }
  return { id };
}
