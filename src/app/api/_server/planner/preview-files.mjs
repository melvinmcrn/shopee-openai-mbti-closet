import { readPrivateFile, writePrivateFile, deletePrivateFile, isOwnedPrivateFileId } from "../private-files.mjs";

export function previewSelection(slots, products, profileRef) {
  const entries = Object.entries(slots).sort(([a], [b]) => a.localeCompare(b))
    .map(([slot, item]) => [slot, String(item.id), item.imageRef, item.name]);
  const listings = (Array.isArray(products) ? products : products ? [products] : [])
    .map(p => [p.id, p.imageUrl, p.title, p.category])
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(["inventory-required-profile-v1", profileRef, entries, listings]);
}

export async function profilePhotoRef(db, accountId) {
  const row = await db.prepare(`
    SELECT profile.face_photo_file_id AS ref FROM profiles AS profile
    JOIN private_files AS photo ON photo.file_id = profile.face_photo_file_id
      AND photo.user_id = profile.user_id AND photo.state = 'ready'
    WHERE profile.user_id = ?
  `).bind(accountId).first();
  return isOwnedPrivateFileId({ id: accountId }, row?.ref) ? row.ref : null;
}

export function previewFiles(env, accountId, optionId, slots, products, profileRef) {
  const account = { id: accountId };
  const selection = previewSelection(slots, products, profileRef);
  return {
    async cachedImage() {
      const row = await env.DB.prepare("SELECT file_id FROM planner_previews WHERE user_id=? AND option_id=? AND selection=?")
        .bind(accountId, optionId, selection).first();
      if (!row?.file_id) return null;
      return await readPrivateFile(env, account, row.file_id, { headOnly: true }) ? row.file_id : null;
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
