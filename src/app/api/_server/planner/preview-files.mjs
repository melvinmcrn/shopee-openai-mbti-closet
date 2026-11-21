import { readPrivateFile, writePrivateFile, deletePrivateFile, isOwnedPrivateFileId } from "../private-files.mjs";

export function previewSelection(slots, profileRef) {
  const entries = Object.entries(slots).filter(([, id]) => id != null).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(["required-profile-v1", profileRef, entries]);
}

export function previewFiles(env, accountId, optionId, slots) {
  const account = { id: accountId };
  return {
    async cachedImage(profileRef) {
      const selection = previewSelection(slots, profileRef);
      const row = await env.DB.prepare("SELECT file_id FROM planner_previews WHERE user_id=? AND option_id=? AND selection=?")
        .bind(accountId, optionId, selection).first();
      if (!row?.file_id) return null;
      const file = await readPrivateFile(env, account, row.file_id, { headOnly: true });
      return file ? row.file_id : null;
    },
    async profilePhotoRef() {
      const row = await env.DB.prepare(`
        SELECT profile.face_photo_file_id AS ref
        FROM profiles AS profile
        JOIN private_files AS photo ON photo.file_id = profile.face_photo_file_id
          AND photo.user_id = profile.user_id AND photo.state = 'ready'
        WHERE profile.user_id = ?
      `).bind(accountId).first();
      return isOwnedPrivateFileId(account, row?.ref) ? row.ref : null;
    },
    async readImage(ref) {
      const file = await readPrivateFile(env, account, ref);
      if (!file) throw new Error("Image unavailable");
      return new Blob([await file.arrayBuffer()], {type:file.httpMetadata?.contentType});
    },
    async storeImage(blob, profileRef) {
      const selection = previewSelection(slots, profileRef);
      const ref = await writePrivateFile(env, account, await blob.arrayBuffer(), blob.type);
      try {
        await env.DB.prepare(`
          INSERT INTO planner_previews(user_id,option_id,selection,file_id) VALUES (?,?,?,?)
          ON CONFLICT(user_id,option_id,selection) DO UPDATE SET file_id=excluded.file_id
        `).bind(accountId, optionId, selection, ref).run();
      } catch (error) {
        await deletePrivateFile(env, account, ref).catch(() => {});
        throw error;
      }
      return ref;
    },
  };
}
