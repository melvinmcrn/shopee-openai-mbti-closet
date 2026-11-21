import { readPrivateFile, writePrivateFile, deletePrivateFile } from "../private-files.mjs";

function garmentReferences(slots) {
  return Object.entries(slots).sort(([a], [b]) => a.localeCompare(b))
    .map(([slot, item]) => [slot, String(item.id), item.imageRef, item.name]);
}

export function previewSelection(slots, personal, products = [], profileRef = null, effectiveSlots = slots) {
  const listings = (Array.isArray(products) ? products : products ? [products] : [])
    .map(p => [String(p.id), p.imageUrl, p.title, p.category, p.searchGroup, p.searchTerm, p.ocrImage])
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(["photo-v4", personal, personal ? profileRef : null,
    garmentReferences(slots), garmentReferences(effectiveSlots), listings]);
}

export async function profilePhotoRef(db, accountId) {
  const row = await db.prepare("SELECT face_photo_file_id AS ref FROM profiles WHERE user_id=?").bind(accountId).first();
  return row?.ref ?? null;
}

export function previewFiles(env, accountId, optionId, slots, personal, products, profileRef, effectiveSlots = slots) {
  const account = { id: accountId };
  const selection = previewSelection(slots, personal, products, profileRef, effectiveSlots);
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
        await env.DB.prepare(`
          INSERT INTO planner_previews(user_id,option_id,selection,file_id) VALUES (?,?,?,?)
          ON CONFLICT(user_id,option_id,selection) DO UPDATE SET file_id=excluded.file_id
        `).bind(accountId, optionId, selection, ref).run();
      } catch (error) {
        await deletePrivateFile(env,account,ref);
        throw error;
      }
      return ref;
    },
  };
}
