import { isOwnedPrivateFileId } from "../private-files.mjs";
import { approvedPreviewProducts, enhancementSelection, readOptionProducts, readSavedCatalog } from "./catalog-product.mjs";
import { getGarments } from "./garments.mjs";
import { combineBaseCoverage, effectiveWardrobeSlots } from "./wardrobe-completion.mjs";
import { currentInventoryVersion, previewSelection, profilePhotoRef } from "./preview-files.mjs";

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

// The look in each outer query is already scoped to the signed-in account.
const wearOnDate = `(SELECT CAST(wear.id AS TEXT) FROM wear_feedback AS wear
  WHERE wear.saved_look_id = look.id AND substr(wear.worn_at, 1, 10) = ?
  ORDER BY wear.id DESC LIMIT 1)`;

export async function recentLook(db, accountId, date) {
  const row = await db.prepare(`
    SELECT CAST(look.id AS TEXT) AS id, look.name AS occasion, ${wearOnDate} AS wear_id
    FROM saved_looks AS look WHERE look.user_id = ?
    ORDER BY strftime('%Y-%m-%dT%H:%M:%fZ', look.saved_at) DESC, look.id DESC LIMIT 1
  `).bind(date, accountId).first();
  return row && { id: row.id, occasion: row.occasion, wear: row.wear_id ? { id: row.wear_id, date } : null };
}

async function readLooks(db, accountId, id, knownCoverage, wearDate) {
  // The optional photo mode is absent before migration 0109; the mapping treats it as null.
  const { results } = await db.prepare(`
    SELECT look.*, photo.file_id AS profile_ref, ${wearDate ? wearOnDate + " AS wear_id," : ""}
      (SELECT json_group_object(preview.selection, preview.file_id) FROM planner_previews AS preview
       WHERE preview.user_id = look.user_id AND preview.option_id = look.source_option_id) AS previews, look.name AS occasion, option.explanation,
      strftime('%Y-%m-%dT%H:%M:%fZ', look.saved_at) AS created_at,
      ${selectSlots("saved_look_items", "saved_look_id", "look.id")} AS slots,
      ${selectSlots("outfit_option_items", "option_id", "look.source_option_id")} AS original_slots
    FROM saved_looks AS look
    LEFT JOIN profiles profile ON profile.user_id = look.user_id
    LEFT JOIN private_files photo ON photo.file_id = profile.face_photo_file_id
      AND photo.user_id = look.user_id AND photo.state = 'ready'
    JOIN outfit_options AS option ON option.user_id = look.user_id AND option.id = look.source_option_id
    JOIN generation_runs AS run ON run.user_id = look.user_id AND run.id = option.run_id
    JOIN outfit_requests AS request ON request.user_id = look.user_id AND request.id = run.request_id
    WHERE look.user_id = ? ${id === undefined ? "" : "AND look.id = ?"}
    ORDER BY created_at DESC, look.id DESC
  `).bind(...(wearDate ? [wearDate] : []), accountId, ...(id === undefined ? [] : [id])).all();

  if (!results.length) return [];
  const selections = results.map(row => JSON.parse(row.slots));
  const usesProfile = row => isOwnedPrivateFileId({ id: accountId }, row.profile_ref);
  const photoRefs = new Set();
  for (const [index, row] of results.entries()) {
    if (usesProfile(row) && row.profile_ref) photoRefs.add(row.profile_ref);
    if (selections[index].other?.imageRef) photoRefs.add(selections[index].other.imageRef);
  }
  // Reading file.* keeps old databases with no base_coverage column readable.
  const coverageByRef = new Map();
  if (photoRefs.size) {
    const { results: files } = await db.prepare(`
      SELECT file.* FROM private_files AS file
      WHERE file.user_id = ? AND file.state = 'ready'
        AND file.file_id IN (SELECT value FROM json_each(?))
    `).bind(accountId, JSON.stringify([...photoRefs])).all();
    for (const file of files) {
      if (file.base_coverage) coverageByRef.set(file.file_id, JSON.parse(file.base_coverage));
    }
  }
  const coverageByLook = Object.fromEntries(results.map((row, i) => [row.id, combineBaseCoverage(
    usesProfile(row) ? coverageByRef.get(row.profile_ref) : null,
    coverageByRef.get(selections[i].other?.imageRef)
  )]));
  if (knownCoverage !== undefined) coverageByLook[id] = knownCoverage;
  const [{ products, occasion }, wardrobe] = await Promise.all([
    readSavedCatalog(db, accountId, Object.fromEntries(
      results.map((row, i) => [row.id, enhancementSelection(selections[i])])
    ), results.filter(row => row.pinned_preview_file_id).map(row => String(row.id)), coverageByLook),
    Object.values(coverageByLook).some(Boolean) ? getGarments({ DB: db }, accountId) : [],
  ]);
  return results.map((row, i) => {
    const slots = selections[i];
    const enhancements = products.get(String(row.id)) ?? [];
    const personal = usesProfile(row);
    const originalSlots = JSON.parse(row.original_slots);
    const pinned = row.pinned_preview_file_id;
    const previews = JSON.parse(row.previews);
    const frozen = pinned || occasion.has(String(row.id));
    const coverage = coverageByLook[row.id];
    const effective = frozen ? slots : effectiveWardrobeSlots(slots, wardrobe, coverage);
    const evidence = pinned ? JSON.parse(row.pinned_preview_selection) : null;
    const retainProfileClothes = !evidence || evidence[2] === row.profile_ref;
    const identityOnly = personal && !retainProfileClothes;
    const selection = previewSelection(slots, personal, enhancements, row.profile_ref, effective, currentInventoryVersion, identityOnly);
    let previewRef = personal ? previews[selection] ?? null : null;
    if (pinned && personal && evidence[0] === currentInventoryVersion && evidence[2] === row.profile_ref) {
      const [version, , originalProfile, requested] = evidence;
      const explicit = Object.fromEntries(requested.map(([slot]) => [slot, slots[slot]]));
      if (previewSelection(explicit, personal, enhancements, originalProfile, slots, version) === row.pinned_preview_selection) {
        previewRef = pinned;
      }
    }
    return {
      id: String(row.id),
      optionId: String(row.source_option_id),
      ...(occasion.has(String(row.id)) ? { kind: "occasion" } : {}),
      useProfilePhoto: personal,
      ...(pinned ? { hasPinnedPreview: true, retainProfileClothes } : {}),
      previewRef,
      enhancements,
      enhancement: enhancements[0] ?? null,
      ...(wearDate && { wear: row.wear_id ? { id: row.wear_id, date: wearDate } : null }),
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

export async function verifyPreview(db, accountId, option, slots, garments, rendered) {
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
  const [version, personal, profileRef, , effectiveRefs, listings] = recorded;
  if (version !== currentInventoryVersion || personal !== true || !profileRef || profileRef !== await profilePhotoRef(db, accountId) ||
      !Array.isArray(effectiveRefs) || !Array.isArray(listings)) throw stalePreview();
  let effective;
  try {
    effective = effectiveRefs.length ? snapshotSlots(Object.fromEntries(effectiveRefs.map(([slot, id]) => [slot, id])), garments) : {};
  } catch {
    throw stalePreview();
  }
  const approved = await approvedPreviewProducts(db, accountId, option, slots, catalogItemIds);
  const products = catalogItemIds.map(id => {
    const listing = listings.find(([itemId]) => itemId === id);
    return approved.find(p => p.id === id && listing && p.searchGroup === listing[4] && p.searchTerm === listing[5] &&
      p.ocrImage === listing[6] && p.imageUrl === listing[1]);
  });
  if (products.some(product => !product) || row.selection !== previewSelection(slots, personal, products, profileRef, effective)) {
    throw stalePreview();
  }
  return { file: previewRef, selection: row.selection, products, effective };
}

export async function saveLook(db, accountId, sourceOption, slots, garments, rendered) {
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
  const pin = rendered ? await verifyPreview(db, accountId, sourceOption, snapshot, garments, rendered) : null;
  if (catalogOnly && !pin) {
    const products = await readOptionProducts(db, accountId, optionId);
    const base = new Set(products.map(product => product.catalogSlot ?? product.wardrobeGap));
    if (!base.has("dress") && !(base.has("top") && base.has("bottom"))) {
      throw new TypeError("The catalog pieces for this outfit are unavailable.");
    }
  }
  // The version and selected file must still match inside the atomic save batch.
  // A stale claim yields NULL for the required owner and rolls back every write.
  const guardedOwner = rendered?.draftVersion != null ? `(SELECT d.user_id FROM outfit_requests d
    JOIN generation_runs r ON r.request_id = d.id JOIN outfit_options o ON o.run_id = r.id
    WHERE d.user_id = ?1 AND o.id = ?2 AND d.resume_stage = 'refine'
      AND d.resume_option_id = o.id AND d.resume_version = ?6 AND d.resume_preview_file_id = ?4)` : "?1";
  const writes = [
    db.prepare(`
      INSERT INTO saved_looks (id, user_id, source_option_id, name, saved_at${pin ? ", pinned_preview_file_id, pinned_preview_selection" : ""})
      VALUES ((SELECT id FROM next_saved_look_id), ${guardedOwner}, ?2,
        (SELECT title FROM outfit_options WHERE user_id = ?1 AND id = ?2), ?3${pin ? ", ?4, ?5" : ""})
      RETURNING id
    `).bind(accountId, optionId, new Date().toISOString(),
      ...(pin ? [pin.file, pin.selection] : []), ...(rendered?.draftVersion != null ? [rendered.draftVersion] : [])),
  ];
  if (pin?.products.length) {
    // The D1 catalog table is WITHOUT ROWID so this insert preserves the saved
    // look's ID for the wardrobe snapshot in the same atomic batch.
    const values = pin.products.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
    writes.push(db.prepare(`
      WITH desired(item_id, catalog_slot, wardrobe_gap, title, image_url, search_group, search_term, ocr_image) AS (VALUES ${values}),
           new_look AS MATERIALIZED (SELECT last_insert_rowid() AS id)
      INSERT INTO saved_look_catalog_items (saved_look_id, item_id, catalog_slot, wardrobe_gap, search_group, search_term)
      SELECT new_look.id,
        (SELECT product.item_id FROM clothes_catalog product WHERE product.item_id = desired.item_id
          AND product.name = desired.title AND product.image_url = desired.image_url
          AND product.search_term = desired.search_term AND product.search_group = desired.search_group
          AND product.ocr_image = desired.ocr_image),
        desired.catalog_slot, desired.wardrobe_gap, desired.search_group, desired.search_term FROM desired CROSS JOIN new_look
    `).bind(...pin.products.flatMap(product => [product.id, product.catalogSlot ?? null, product.wardrobeGap ?? null,
      product.title, product.imageUrl, product.searchGroup, product.searchTerm, product.ocrImage])));
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
    `).bind(accountId, JSON.stringify(pin?.effective ?? snapshot)),
  );
  try {
    writes.push(db.prepare(`
      UPDATE outfit_requests SET resume_stage = 'closed', resume_option_id = NULL, resume_preview_file_id = NULL, resume_version = NULL
      WHERE user_id = ? AND id = (SELECT r.request_id FROM generation_runs r JOIN outfit_options o ON o.run_id = r.id WHERE o.id = ?)
        AND resume_stage IS NOT NULL AND resume_stage <> 'closed'
        AND resume_after_run < (SELECT run_id FROM outfit_options WHERE id = ? AND user_id = ?)
        ${rendered?.draftVersion ? "AND resume_version = ?" : ""}
    `).bind(accountId, sourceOption.id, sourceOption.id, accountId, ...(rendered?.draftVersion ? [rendered.draftVersion] : [])));
    const [insert] = await db.batch(writes);
    return getLook(db, accountId, String(insert.results[0].id));
  } catch (error) {
    if (rendered?.draftVersion != null && /saved_looks\.user_id|null value in column "user_id" of relation "saved_looks"/i.test(error.message)) throw stalePreview();
    if (pin && /selected try-on has changed|Private file is unavailable|Selected garment changed|saved_look_catalog_items\.item_id|null value in column "item_id" of relation "saved_look_catalog_items"/i.test(error.message)) throw stalePreview();
    throw error;
  }
}

export function listLooks(db, accountId, wearDate) {
  return readLooks(db, accountId, undefined, undefined, wearDate);
}

export async function getLook(db, accountId, id, knownCoverage) {
  const savedId = numericId(id);
  if (savedId === null) return null;
  const [look] = await readLooks(db, accountId, savedId, knownCoverage);
  return look ?? null;
}
