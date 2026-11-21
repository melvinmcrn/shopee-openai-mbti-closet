import { readPrivateFile, writePrivateFile, deletePrivateFile } from "../private-files.mjs";

export function previewSelection(slots, useProfilePhoto, version = useProfilePhoto ? "photo-v3" : "photo-v2") {
  const entries = Object.entries(slots).filter(([, id]) => id != null).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(version ? [version, useProfilePhoto, entries] : [useProfilePhoto, entries]);
}

export async function profilePhotoRef(db, accountId) {
  const row = await db.prepare("SELECT face_photo_file_id AS ref FROM profiles WHERE user_id=?").bind(accountId).first();
  return row?.ref ?? null;
}

export function previewFiles(env, accountId, optionId, slots, useProfilePhoto) {
  const account = { id: accountId };
  const selection = previewSelection(slots, useProfilePhoto);
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
