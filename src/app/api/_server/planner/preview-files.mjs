import { readPrivateFile, writePrivateFile, deletePrivateFile, isOwnedPrivateFileId } from "../private-files.mjs";

export const currentInventoryVersion = "photo-v6";

function garmentReferences(slots) {
  return Object.entries(slots).sort(([a], [b]) => a.localeCompare(b))
    .map(([slot, item]) => [slot, String(item.id), item.imageRef, item.name]);
}

export function previewSelection(slots, personal, products = [], profileRef = null, effectiveSlots = slots,
  version = currentInventoryVersion, identityOnly = false) {
  // The original saved-photo reader passed the inventory version in argument five.
  if (typeof effectiveSlots === "string") {
    version = effectiveSlots;
    effectiveSlots = slots;
  }
  const items = Array.isArray(products) ? products : products ? [products] : [];
  const original = garmentReferences(slots);
  const header = [version, personal, personal ? profileRef : null, original];
  const legacyInventory = version === "inventory-v3" || version === "inventory-v4";
  const listings = items.map(product => {
    const fields = [String(product.id), product.imageUrl, product.title, product.category];
    return legacyInventory ? fields : [...fields, product.searchGroup, product.searchTerm, product.ocrImage];
  }).sort(([a], [b]) => a.localeCompare(b));
  if (legacyInventory) return JSON.stringify([...header, listings]);
  const composite = [...header, garmentReferences(effectiveSlots), listings];
  // A changed portrait may supply only the person's likeness in a revised saved look.
  if (version === currentInventoryVersion && identityOnly) composite.push(true);
  return JSON.stringify(composite);
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

export async function readPreviewImage(env, accountId, ref) {
  const file = await readPrivateFile(env, { id: accountId }, ref);
  if (!file) return null;
  return new Blob([await file.arrayBuffer()], { type: file.httpMetadata?.contentType });
}

export function previewFiles(env, accountId, optionId, slots, personal, products, profileRef, effectiveSlots = slots, identityOnly = false) {
  const account = { id: accountId };
  const selection = previewSelection(slots, personal, products, profileRef, effectiveSlots, currentInventoryVersion, identityOnly);
  return {
    async cachedImage(pinnedFile) {
      if (pinnedFile) return await readPrivateFile(env, account, pinnedFile, { headOnly: true }) ? pinnedFile : null;
      const row = await env.DB.prepare("SELECT file_id FROM planner_previews WHERE user_id=? AND option_id=? AND selection=?")
        .bind(accountId, optionId, selection).first();
      if (!row?.file_id) return null;
      return await readPrivateFile(env, account, row.file_id, { headOnly: true }) ? row.file_id : null;
    },
    readImage: ref => readPreviewImage(env, accountId, ref),
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
