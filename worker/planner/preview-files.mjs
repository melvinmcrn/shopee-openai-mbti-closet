import { readPrivateFile, writePrivateFile, deletePrivateFile } from "../private-files.mjs";

export function previewFiles(env, accountId, optionId) {
  const account = {id: accountId};
  return {
    async profilePhotoRef() {
      const row = await env.DB.prepare("SELECT face_photo_file_id AS ref FROM profiles WHERE user_id=?").bind(accountId).first();
      return row?.ref;
    },
    async readImage(ref) {
      const file = await readPrivateFile(env, account, ref);
      if (!file) throw new Error("Image unavailable");
      return new Blob([await file.arrayBuffer()], {type:file.httpMetadata?.contentType});
    },
    async storeImage(blob) {
      const ref = await writePrivateFile(env, account, await blob.arrayBuffer(), blob.type);
      try {
        const attached = await env.DB.prepare("UPDATE outfit_options SET preview_file_id=? WHERE user_id=? AND id=? RETURNING id")
          .bind(ref, accountId, optionId).first();
        if (!attached) throw new Error("Option unavailable");
      } catch (error) {
        await deletePrivateFile(env,account,ref);
        throw error;
      }
      return ref;
    },
  };
}
