import { approvedPreviewProducts, enhancementSelection, readOptionProducts, readSavedCatalog, searchableProduct } from "./catalog-product.mjs";
import { currentInventoryVersion, previewSelection } from "./preview-files.mjs";

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
  // The optional photo mode is absent before migration 0109; the mapping treats it as null.
  const { results } = await db.prepare(`
    SELECT look.*, profile.face_photo_file_id AS profile_ref,
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
  const { products, occasion } = await readSavedCatalog(db, accountId, Object.fromEntries(
    results.map((row, i) => [row.id, enhancementSelection(selections[i])])
  ), results.filter(row => row.pinned_preview_file_id).map(row => String(row.id)));
  return results.map((row, i) => {
    const slots = selections[i];
    const enhancements = products.get(String(row.id)) ?? [];
    const personal = row.use_profile_photo == null ? Boolean(row.profile_ref) : row.use_profile_photo === 1;
    const originalSlots = JSON.parse(row.original_slots);
    const pinned = row.pinned_preview_file_id;
    const previews = JSON.parse(row.previews);
    const renderMode = pinned ? personal && Boolean(row.profile_ref) : personal;
    const selection = previewSelection(slots, renderMode, enhancements, row.profile_ref);
    let previewRef = previews[selection] ?? null;
    if (pinned) {
      const [version, , originalProfile] = JSON.parse(row.pinned_preview_selection);
      if (previewSelection(slots, personal, enhancements, originalProfile, version) === row.pinned_preview_selection) {
        previewRef = pinned;
      }
    } else if (!previewRef) {
      const legacy = previewSelection(slots, personal, enhancements, row.profile_ref, "inventory-v3");
      previewRef = previews[legacy] ?? null;
    }
    return {
      id: String(row.id),
      optionId: String(row.source_option_id),
      ...(occasion.has(String(row.id)) ? { kind: "occasion" } : {}),
      useProfilePhoto: personal,
      ...(pinned ? { hasPinnedPreview: true } : {}),
      previewRef,
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

function stalePreview() {
  return Object.assign(new Error("This try-on no longer matches the selected items. Reopen the outfit and try again."), { status: 409 });
}

async function verifyPreview(db, accountId, option, slots, rendered) {
  const { previewRef, catalogItemIds } = rendered;
  if (typeof previewRef !== "string" || !previewRef || !Array.isArray(catalogItemIds) ||
      catalogItemIds.some(id => typeof id !== "string") || new Set(catalogItemIds).size !== catalogItemIds.length) {
    throw Object.assign(new TypeError("A finished try-on and its selected catalog items are required."), { status: 400 });
  }
  const row = await db.prepare(`
    SELECT p.selection FROM planner_previews p
    JOIN private_files f ON f.file_id = p.file_id AND f.user_id = p.user_id AND f.state = 'ready'
    WHERE p.user_id = ? AND p.option_id = ? AND p.file_id = ?
  `).bind(accountId, option.id, previewRef).first();
  if (!row) throw stalePreview();
  let recorded;
  try { recorded = JSON.parse(row.selection); } catch { throw stalePreview(); }
  if (!Array.isArray(recorded)) throw stalePreview();
  const [version, personal, profileRef] = recorded;
  if (version !== currentInventoryVersion || typeof personal !== "boolean" || (personal && !profileRef)) throw stalePreview();
  const approved = await approvedPreviewProducts(db, accountId, option, slots);
  const products = catalogItemIds.map(id => approved.find(product => product.id === id));
  if (products.some(product => !product) || row.selection !== previewSelection(slots, personal, products, profileRef)) {
    throw stalePreview();
  }
  return { file: previewRef, selection: row.selection, personal, products };
}

export async function saveLook(db, accountId, sourceOption, slots, garments, useProfilePhoto = false, rendered) {
  const optionId = numericId(sourceOption?.id);
  if (optionId === null) throw new TypeError("A saved look must have a generated option");

  const catalogOnly = (rendered || sourceOption.kind === "occasion") && Object.keys(sourceOption.slots).length === 0 &&
    slots && typeof slots === "object" && !Array.isArray(slots) && Object.keys(slots).length === 0;
  let snapshot;
  try {
    snapshot = catalogOnly ? {} : snapshotSlots(slots, garments);
  } catch (error) {
    if (rendered && error instanceof TypeError) throw stalePreview();
    throw error;
  }
  const pin = rendered ? await verifyPreview(db, accountId, sourceOption, snapshot, rendered) : null;
  if (catalogOnly) {
    const products = pin?.products ?? await readOptionProducts(db, accountId, optionId);
    const base = new Set(products.map(product => product.catalogSlot ?? product.wardrobeGap));
    if (!base.has("dress") && !(base.has("top") && base.has("bottom"))) {
      throw new TypeError("The catalog pieces for this outfit are unavailable.");
    }
  }
  const writes = [
    db.prepare(`
      INSERT INTO saved_looks (id, user_id, source_option_id, name, saved_at, use_profile_photo${pin ? ", pinned_preview_file_id, pinned_preview_selection" : ""})
      VALUES ((SELECT id FROM next_saved_look_id), ?1, ?2,
        (SELECT title FROM outfit_options WHERE user_id = ?1 AND id = ?2), ?3, ?4${pin ? ", ?5, ?6" : ""})
      RETURNING id
    `).bind(accountId, optionId, new Date().toISOString(), (pin?.personal ?? useProfilePhoto) ? 1 : 0,
      ...(pin ? [pin.file, pin.selection] : [])),
  ];
  if (pin?.products.length) {
    // The D1 catalog table is WITHOUT ROWID so this insert preserves the saved
    // look's ID for the wardrobe snapshot in the same atomic batch.
    const values = pin.products.map(() => "(?, ?, ?, ?, ?, ?)").join(", ");
    writes.push(db.prepare(`
      WITH desired(item_id, catalog_slot, wardrobe_gap, title, image_url, category) AS (VALUES ${values}),
           new_look AS MATERIALIZED (SELECT last_insert_rowid() AS id)
      INSERT INTO saved_look_catalog_items (saved_look_id, item_id, catalog_slot, wardrobe_gap)
      SELECT new_look.id,
        (SELECT product.item_id FROM clothes_image_database product WHERE product.item_id = desired.item_id
          AND product.name = desired.title AND product.image_url = desired.image_url
          AND product.search_term = desired.category AND ${searchableProduct}),
        desired.catalog_slot, desired.wardrobe_gap FROM desired CROSS JOIN new_look
    `).bind(...pin.products.flatMap(product => [product.id, product.catalogSlot ?? null, product.wardrobeGap ?? null,
      product.title, product.imageUrl, product.category])));
  }
  writes.push(
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
  );
  try {
    const [insert] = await db.batch(writes);
    return getLook(db, accountId, String(insert.results[0].id));
  } catch (error) {
    if (pin && /selected try-on has changed|Private file is unavailable|Selected garment changed|saved_look_catalog_items\.item_id|null value in column "item_id" of relation "saved_look_catalog_items"/i.test(error.message)) throw stalePreview();
    throw error;
  }
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
