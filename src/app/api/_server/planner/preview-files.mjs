import { readPrivateFile, writePrivateFile, deletePrivateFile } from "../private-files.mjs";

export const currentInventoryVersion = "inventory-v4";

export function previewSelection(slots, personal, products = [], profileRef = null, version = currentInventoryVersion) {
  const entries = Object.entries(slots).sort(([a], [b]) => a.localeCompare(b))
    .map(([slot, item]) => [slot, String(item.id), item.imageRef, item.name]);
  const listings = (Array.isArray(products) ? products : products ? [products] : [])
    .map(p => [p.id, p.imageUrl, p.title, p.category])
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify([version, personal, personal ? profileRef : null, entries, listings]);
}

export async function profilePhotoRef(db, accountId) {
  const row = await db.prepare("SELECT face_photo_file_id AS ref FROM profiles WHERE user_id=?").bind(accountId).first();
  return row?.ref ?? null;
}

export function previewFiles(env, accountId, optionId, slots, personal, products, profileRef) {
  const account = { id: accountId };
  const selection = previewSelection(slots, personal, products, profileRef);
  return {
    async cachedImage() {
      const row = await env.DB.prepare("SELECT file_id FROM planner_previews WHERE user_id=? AND option_id=? AND selection=?")
        .bind(accountId, optionId, selection).first();
      return row?.file_id;
    },
    async readImage(ref) {
      const file = await readPrivateFile(env, account, ref);
      if (!file) throw new Error("Image unavailable");
      return new Blob([await file.arrayBuffer()], {type:file.httpMetadata?.contentType});
    },
    async storeImage(blob) {
      const ref = await writePrivateFile(env, account, await blob.arrayBuffer(), blob.type);
      try {
        const saved = await env.DB.prepare(`
          INSERT INTO planner_previews(user_id,option_id,selection,file_id) VALUES (?,?,?,?)
          ON CONFLICT(user_id,option_id,selection) DO UPDATE SET file_id=planner_previews.file_id
          RETURNING file_id
        `).bind(accountId, optionId, selection, ref).first();
        if (saved.file_id !== ref) {
          // A simultaneous render already won. Return the common verified file
          // even if cleanup of the unused upload needs to be retried later.
          await deletePrivateFile(env, account, ref).catch(() => console.warn("Unused preview cleanup is pending"));
        }
        return saved.file_id;
      } catch (error) {
        await deletePrivateFile(env,account,ref);
        throw error;
      }
    },
  };
}
