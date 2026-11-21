import { deleteFile, putFile } from "../wardrobe-files.mjs";

export const maxImageBytes = 8 * 1024 * 1024;
const maxFormBytes = maxImageBytes + 64 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const findDraft = "SELECT id, image_file_id FROM wardrobe_items WHERE user_id = ? AND draft_key = ?";

function error(message, status) {
  return Response.json({ error: message }, { status });
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

export async function upload(request, env, userId) {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(contentType) || !request.body) {
    return error("Choose a photo to upload.", 400);
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
      if (!tooLarge) return error("The photo upload could not be read.", 400);
    }
  }
  if (tooLarge) return error("Choose a photo that is 8 MB or smaller.", 413);

  const draftKey = form.get("draftKey");
  if (typeof draftKey !== "string" || !uuid.test(draftKey) || form.getAll("draftKey").length !== 1) {
    return error("The upload is missing a valid draft key.", 400);
  }

  const image = form.get("image");
  if (!(image instanceof Blob) || image.size === 0 || form.getAll("image").length !== 1) {
    return error("Choose one photo to upload.", 400);
  }
  if (image.size > maxImageBytes) return error("Choose a photo that is 8 MB or smaller.", 413);

  const bytes = new Uint8Array(await image.arrayBuffer());
  const type = imageType(bytes);
  if (!type) return error("Choose a JPEG, PNG, or WebP photo.", 415);

  const key = draftKey.toLowerCase();
  const existing = await env.DB.prepare(findDraft).bind(userId, key).first();
  if (existing) return Response.json({ id: existing.id });

  // Content-bound storage prevents concurrent requests from replacing the winning photo.
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const digest = Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const fileKey = `users/${userId}/wardrobe/${key}/${digest}`;
  await putFile(env, userId, fileKey, bytes, type);

  const [, result] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO wardrobe_items (user_id, name, category, image_file_id, draft_key)
       VALUES (?, 'Untitled garment', 'other', ?, ?)
       ON CONFLICT (user_id, draft_key) DO NOTHING`,
    ).bind(userId, fileKey, key),
    env.DB.prepare(findDraft).bind(userId, key),
  ]);
  const draft = result.results[0];
  if (draft.image_file_id !== fileKey) {
    try {
      await deleteFile(env, userId, fileKey);
    } catch (cleanupError) {
      console.error("Unable to remove unused wardrobe upload", cleanupError.name);
    }
  }
  return Response.json({ id: draft.id });
}
