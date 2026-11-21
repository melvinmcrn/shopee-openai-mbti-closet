import { enhancementSelection, readSavedProducts } from "./catalog-product.mjs";
import { previewSelection } from "./preview-files.mjs";

const slotNames = new Set(["top", "bottom", "dress", "shoes", "outerwear", "accessory", "other"]);

function numericId(value) {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

export function snapshotSlots(slots, garments) {
  if (!slots || typeof slots !== "object" || Array.isArray(slots)) {
    throw new TypeError("A look must provide its garment slots");
  }

  const garmentsById = new Map(garments.map((garment) => [garment.id, garment]));
  const snapshot = {};
  for (const [slot, garmentId] of Object.entries(slots)) {
    if (!slotNames.has(slot)) {
      throw new TypeError("A look contains an unknown garment slot");
    }
    if (garmentId === null) continue;

    const id = numericId(garmentId);
    const garment = id === null ? null : garmentsById.get(garmentId);
    if (!garment || garment.category !== slot) {
      throw new TypeError("A look contains an ineligible garment");
    }

    snapshot[slot] = {
      id,
      name: garment.name,
      category: garment.category,
      color: garment.color ?? null,
      imageRef: garment.imageRef ?? null,
    };
  }

  if (!Object.keys(snapshot).length || (snapshot.dress && (snapshot.top || snapshot.bottom))) {
    throw new TypeError("A look needs at least one garment, and a dress cannot be combined with a top or bottom");
  }
  return snapshot;
}

function selectSlots(table, lookKey, lookId) {
  return `(
    SELECT json_group_object(item.slot, json_object(
      'id', CAST(item.item_id AS TEXT),
      'name', item.item_name,
      'category', COALESCE(item.category_snapshot, garment.category),
      'color', CASE WHEN item.category_snapshot IS NULL THEN garment.color ELSE item.color_snapshot END,
      'imageRef', CASE WHEN item.category_snapshot IS NULL THEN garment.image_file_id ELSE item.image_file_id_snapshot END
    ))
    FROM ${table} AS item
    JOIN wardrobe_items AS garment ON garment.user_id = item.user_id AND garment.id = item.item_id
    WHERE item.user_id = look.user_id AND item.${lookKey} = ${lookId}
  )`;
}

async function readLooks(db, accountId, id) {
  const { results } = await db.prepare(`
    SELECT look.id, look.source_option_id, look.use_profile_photo, profile.face_photo_file_id AS profile_ref,
      (SELECT json_group_object(preview.selection, preview.file_id) FROM planner_previews AS preview
       WHERE preview.user_id = look.user_id AND preview.option_id = look.source_option_id) AS previews, look.name AS occasion, option.explanation,
      strftime('%Y-%m-%dT%H:%M:%fZ', look.saved_at) AS created_at,
      ${selectSlots("saved_look_items", "saved_look_id", "look.id")} AS slots,
      ${selectSlots("outfit_option_items", "option_id", "look.source_option_id")} AS original_slots
    FROM saved_looks AS look
    LEFT JOIN profiles profile ON profile.user_id = look.user_id
    JOIN outfit_options AS option ON option.user_id = look.user_id AND option.id = look.source_option_id
    JOIN generation_runs AS run ON run.user_id = look.user_id AND run.id = option.run_id
    JOIN outfit_requests AS request ON request.user_id = look.user_id AND request.id = run.request_id
    WHERE look.user_id = ? ${id === undefined ? "" : "AND look.id = ?"}
    ORDER BY created_at DESC, look.id DESC
  `).bind(...(id === undefined ? [accountId] : [accountId, id])).all();

  if (!results.length) return [];
  const selections = results.map(row => JSON.parse(row.slots));
  const products = await readSavedProducts(db, accountId, Object.fromEntries(
    results.map((row, i) => [row.id, enhancementSelection(selections[i])])
  ));
  return results.map((row, i) => {
    const slots = selections[i];
    const enhancements = products.get(String(row.id)) ?? [];
    const personal = row.use_profile_photo == null ? Boolean(row.profile_ref) : row.use_profile_photo === 1;
    const originalSlots = JSON.parse(row.original_slots);
    const previews = JSON.parse(row.previews);
    const selection = previewSelection(slots, personal, enhancements, row.profile_ref);
    return {
      id: String(row.id),
      optionId: String(row.source_option_id),
      useProfilePhoto: personal,
      previewRef: previews[selection] ?? null,
      enhancements,
      enhancement: enhancements[0] ?? null,
      occasion: row.occasion,
      slots,
      originalSlots,
      explanation: row.explanation ?? "",
      createdAt: row.created_at,
    };
  });
}

export async function saveLook(db, accountId, sourceOption, slots, garments, useProfilePhoto = false) {
  const optionId = numericId(sourceOption?.id);
  if (optionId === null) {
    throw new TypeError("A saved look must have a generated option");
  }

  const snapshot = snapshotSlots(slots, garments);
  const [insert] = await db.batch([
    db.prepare(`
      INSERT INTO saved_looks (user_id, source_option_id, name, saved_at, use_profile_photo)
      VALUES (?1, ?2, (SELECT title FROM outfit_options WHERE user_id = ?1 AND id = ?2), ?3, ?4)
      RETURNING id
    `).bind(accountId, optionId, new Date().toISOString(), useProfilePhoto ? 1 : 0),
    db.prepare(`
      WITH new_look AS MATERIALIZED (SELECT last_insert_rowid() AS id)
      INSERT INTO saved_look_items
        (user_id, saved_look_id, slot, item_id, item_name, category_snapshot, color_snapshot, image_file_id_snapshot)
      SELECT ?1, new_look.id, slot.key,
        json_extract(slot.value, '$.id'),
        json_extract(slot.value, '$.name'),
        json_extract(slot.value, '$.category'),
        json_extract(slot.value, '$.color'),
        json_extract(slot.value, '$.imageRef')
      FROM new_look CROSS JOIN json_each(?2) AS slot
    `).bind(accountId, JSON.stringify(snapshot)),
  ]);

  return getLook(db, accountId, String(insert.results[0].id));
}

export function listLooks(db, accountId) {
  return readLooks(db, accountId);
}

export async function getLook(db, accountId, id) {
  const savedId = numericId(id);
  if (savedId === null) return null;
  const [look] = await readLooks(db, accountId, savedId);
  return look ?? null;
}
