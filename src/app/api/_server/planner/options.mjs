import { generateLooks } from "./decision.mjs";
import { generateOccasionLook } from "./occasion-look.mjs";
import { snapshotSlots } from "./saved.mjs";

const optionFields = `o.*, CAST(o.id AS TEXT) AS optionId, CAST(r.request_id AS TEXT) AS briefId,
  (SELECT json_group_object(slot, CAST(item_id AS TEXT)) FROM outfit_option_items
   WHERE option_id = o.id AND user_id = o.user_id) AS slots`;
const optionRows = "outfit_options o JOIN generation_runs r ON r.id = o.run_id AND r.user_id = o.user_id";

function optionView(row) {
  // Older options have no look_kind marker.
  return {
    id: row.optionId, occasion: row.title, explanation: row.explanation, briefId: row.briefId,
    slots: JSON.parse(row.slots), ...(row.look_kind === "occasion" ? { kind: "occasion" } : {}),
  };
}

export async function readOption(db, accountId, id) {
  const row = await db.prepare(`SELECT ${optionFields} FROM ${optionRows} WHERE o.user_id = ? AND o.id = ?`)
    .bind(accountId, id).first();
  return row && optionView(row);
}

export async function readDraftOptions(db, accountId, briefId, floor) {
  const { results } = await db.prepare(`
    SELECT ${optionFields} FROM ${optionRows}
    WHERE r.user_id = ? AND r.request_id = ? AND r.id > ? AND r.status = 'completed'
      AND NOT EXISTS (SELECT 1 FROM outfit_option_items s JOIN wardrobe_items w ON w.id = s.item_id
        WHERE s.option_id = o.id AND (w.archived_at IS NOT NULL OR w.confirmed_at IS NULL
          OR w.image_file_id <> s.image_file_id_snapshot OR w.category <> s.category_snapshot))
    ORDER BY r.id, o.position
  `).bind(accountId, briefId, floor).all();
  return results.map(optionView);
}

async function storeOptions(db, accountId, runId, occasion, garments, looks, offset = 0) {
  if (!looks.length) return [];
  const writes = [];
  const inserts = [];
  for (const [i, look] of looks.entries()) {
    const position = offset + i + 1;
    const proposed = look.kind === "occasion";
    const selected = (proposed || look.profileRef) && !Object.keys(look.slots).length ? {} : snapshotSlots(look.slots, garments);
    inserts.push(writes.length);
    writes.push(db.prepare(`
      INSERT INTO outfit_options (user_id,run_id,position,title,explanation${proposed ? ",look_kind" : ""})
      VALUES (?,?,?,?,?${proposed ? ",'occasion'" : ""}) RETURNING CAST(id AS TEXT) AS id
    `).bind(accountId, runId, position, occasion, look.explanation));
    for (const [slot, item] of Object.entries(selected)) {
      writes.push(db.prepare(`
        INSERT INTO outfit_option_items (user_id,option_id,slot,item_id,item_name,category_snapshot,color_snapshot,image_file_id_snapshot)
        VALUES (?,(SELECT id FROM outfit_options WHERE user_id=? AND run_id=? AND position=?),?,
          (SELECT id FROM wardrobe_items WHERE user_id=? AND id=? AND category=?
           AND confirmed_at IS NOT NULL AND archived_at IS NULL AND image_file_id=?),?,?,?,?)
      `).bind(accountId, accountId, runId, position, slot, accountId, item.id, slot, item.imageRef,
        item.name, item.category, item.color, item.imageRef));
    }
    for (const [slot, listing] of Object.entries(look.catalogSlots ?? {})) {
      const { id, searchGroup = null, searchTerm = null } = typeof listing === "string" ? { id: listing } : listing;
      writes.push(db.prepare(`
        INSERT INTO outfit_option_catalog_items (user_id, option_id, slot, item_id, search_group, search_term)
        VALUES (?, (SELECT id FROM outfit_options WHERE user_id=? AND run_id=? AND position=?), ?,
          (SELECT product.item_id FROM clothes_catalog product JOIN clothes_image_database original ON original.item_id=product.item_id
           WHERE product.item_id=? AND product.search_group=COALESCE(?, original.search_group)
           AND product.search_term=COALESCE(?, original.search_term) AND trim(product.ocr_image) <> ''), ?, ?)
      `).bind(accountId, accountId, runId, position, slot, id, searchGroup, searchTerm, searchGroup, searchTerm));
    }
  }
  const results = await db.batch(writes);
  return looks.map((look, i) => ({
    id: results[inserts[i]].results[0].id, occasion, explanation: look.explanation, slots: look.slots,
    ...(look.kind ? { kind: look.kind } : {}), ...(look.profileRef ? { profileRef: look.profileRef } : {}),
  }));
}

export async function generateOptions(env, accountId, brief, garments, prior = [], decide = generateLooks, design = generateOccasionLook) {
  const db = env.DB;
  const run = await db.prepare(`
    INSERT INTO generation_runs (user_id,request_id,status,model) VALUES (?,?,'running','gpt-6-luna')
    RETURNING CAST(id AS TEXT) AS id
  `).bind(accountId, brief.id).first();
  try {
    const previous = Array.isArray(prior) ? prior : [];
    const profile = garments.length === 0
      ? await db.prepare("SELECT face_photo_file_id AS ref FROM profiles WHERE user_id=?").bind(accountId).first()
      : null;
    const wardrobeOptions = () => {
      if (!profile?.ref) return decide(env, brief, garments, previous.filter(look => look?.kind !== "occasion"));
      if (previous.some(look => look?.profileRef === profile.ref)) return { status: "insufficient" };
      return { status: "ready", looks: [{ slots: {}, profileRef: profile.ref, explanation: "Check the catalog for pieces that fit your plans." }] };
    };
    const [generation, occasionLook] = await Promise.all([
      wardrobeOptions(),
      previous.some(look => look?.kind === "occasion") ? null : design(env, brief, garments).catch(() => null),
    ]);
    const looks = await storeOptions(db, accountId, run.id, brief.occasion, garments, generation.looks ?? []);
    if (occasionLook) {
      try {
        // Independent transaction: a product or garment may retire while the model is choosing it.
        const extras = await storeOptions(db, accountId, run.id, brief.occasion, garments,
          [{ ...occasionLook, kind: "occasion" }], looks.length);
        looks.push(...extras);
      } catch (error) {
        // Ignore unavailable inventory or an older schema while keeping any wardrobe options usable.
        if (!/constraint|no such table|no column named|does not exist/i.test(error.message)) throw error;
      }
    }
    if (!looks.length) {
      await db.prepare("UPDATE generation_runs SET status=?, error_code=? WHERE user_id=? AND id=?")
        .bind(generation.status === "insufficient" ? "completed" : "failed", generation.status, accountId, run.id).run();
      return generation;
    }
    await db.prepare("UPDATE generation_runs SET status='completed' WHERE user_id=? AND id=?").bind(accountId, run.id).run();
    return { status: "ready", looks };
  } catch (error) {
    await db.prepare("UPDATE generation_runs SET status='failed',error_code='generation_failed' WHERE user_id=? AND id=? AND status='running'")
      .bind(accountId,run.id).run();
    throw error;
  }
}
