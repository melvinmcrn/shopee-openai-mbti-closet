import { generateLooks } from "./decision.mjs";
import { snapshotSlots } from "./saved.mjs";

export async function readOption(db, accountId, id) {
  const row = await db.prepare(`
    SELECT CAST(o.id AS TEXT) AS id, o.title AS occasion, o.explanation,
      (SELECT CAST(request_id AS TEXT) FROM generation_runs WHERE id=o.run_id AND user_id=o.user_id) AS briefId,
      (SELECT json_group_object(slot, CAST(item_id AS TEXT)) FROM outfit_option_items
       WHERE option_id = o.id AND user_id = o.user_id) AS slots
    FROM outfit_options o WHERE o.user_id = ? AND o.id = ?
  `).bind(accountId, id).first();
  return row && { ...row, slots: JSON.parse(row.slots) };
}

export async function generateOptions(env, accountId, brief, garments, prior, decide = generateLooks) {
  const db = env.DB;
  const run = await db.prepare(`
    INSERT INTO generation_runs (user_id,request_id,status,model) VALUES (?,?,'running','gpt-6-luna')
    RETURNING CAST(id AS TEXT) AS id
  `).bind(accountId, brief.id).first();
  try {
    const profile = garments.length === 0
      ? await db.prepare("SELECT face_photo_file_id AS ref FROM profiles WHERE user_id=?").bind(accountId).first()
      : null;
    const generation = profile?.ref
      ? { status: "ready", looks: [{ slots: {}, profileRef: profile.ref, explanation: "Style the outfit in your main photo." }] }
      : await decide(env, brief, garments, prior);
    if (generation.status !== "ready") {
      await db.prepare("UPDATE generation_runs SET status=?, error_code=? WHERE user_id=? AND id=?")
        .bind(generation.status === "insufficient" ? "completed" : "failed", generation.status, accountId, run.id).run();
      return generation;
    }
    const writes = [];
    for (const [i, look] of generation.looks.entries()) {
      const selected = profile?.ref ? {} : snapshotSlots(look.slots, garments);
      writes.push(db.prepare(`
        INSERT INTO outfit_options (user_id,run_id,position,title,explanation) VALUES (?,?,?,?,?)
      `).bind(accountId, run.id, i + 1, brief.occasion, look.explanation));
      for (const [slot, item] of Object.entries(selected)) {
        writes.push(db.prepare(`
          INSERT INTO outfit_option_items (user_id,option_id,slot,item_id,item_name,category_snapshot,color_snapshot,image_file_id_snapshot)
          VALUES (?,(SELECT id FROM outfit_options WHERE user_id=? AND run_id=? AND position=?),?,
            (SELECT id FROM wardrobe_items WHERE user_id=? AND id=? AND category=?
             AND confirmed_at IS NOT NULL AND archived_at IS NULL AND image_file_id=?),?,?,?,?)
        `).bind(accountId, accountId, run.id, i + 1, slot, accountId, item.id, slot, item.imageRef,
          item.name, item.category, item.color, item.imageRef));
      }
    }
    writes.push(db.prepare("UPDATE generation_runs SET status='completed' WHERE user_id=? AND id=?").bind(accountId,run.id));
    await db.batch(writes);
    const { results } = await db.prepare("SELECT CAST(id AS TEXT) AS id FROM outfit_options WHERE user_id=? AND run_id=? ORDER BY position")
      .bind(accountId, run.id).all();
    return { status: "ready", looks: generation.looks.map((look,i) => ({...look,id:results[i].id,occasion:brief.occasion})) };
  } catch (error) {
    await db.prepare("UPDATE generation_runs SET status='failed',error_code='generation_failed' WHERE user_id=? AND id=? AND status='running'")
      .bind(accountId,run.id).run();
    throw error;
  }
}
