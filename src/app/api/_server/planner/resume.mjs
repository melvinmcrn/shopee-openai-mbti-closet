import { profilePhotoRef } from "./preview-files.mjs";
import { getBrief } from "./brief.mjs";
import { snapshotSlots, verifyPreview } from "./saved.mjs";
import { readDraftOptions, readOption } from "./options.mjs";

export function changedDraft() {
  return Object.assign(new Error("This plan changed in another session. Reopen the planner to continue."), { status: 409 });
}

const active = "resume_stage IS NOT NULL AND resume_stage <> 'closed'";
const legacy = `resume_stage IS NULL AND NOT EXISTS (
  SELECT 1 FROM outfit_requests current_draft WHERE current_draft.user_id = outfit_requests.user_id
    AND current_draft.resume_stage IS NOT NULL AND current_draft.resume_stage <> 'closed')
  AND NOT EXISTS (SELECT 1 FROM generation_runs r JOIN outfit_options o ON o.run_id = r.id
    JOIN saved_looks s ON s.source_option_id = o.id WHERE r.request_id = outfit_requests.id)`;
const validId = value => typeof value === "string" && /^[1-9]\d{0,15}$/.test(value) && Number.isSafeInteger(Number(value));

export async function resumePlanner(db, accountId, briefId) {
  if (briefId !== undefined && !validId(briefId)) return null;
  // Existing wardrobe handoffs can reference a brief created before journey tracking.
  const row = await db.prepare(`
    SELECT CAST(id AS TEXT) AS id, resume_stage AS stage, resume_version AS version,
      CAST(resume_option_id AS TEXT) AS optionId, resume_after_run AS floor
    FROM outfit_requests WHERE user_id = ? AND ${briefId ? `id = ? AND
      (${active} OR (${legacy}))` : active}
  `).bind(accountId, ...(briefId ? [briefId] : [])).first();
  if (!row) return null;
  const [brief, defaults] = await Promise.all([
    getBrief(db, accountId, row.id),
    db.prepare("SELECT style FROM style_preferences WHERE user_id = ? ORDER BY style").bind(accountId).all(),
  ]);
  if (!brief) return null;
  brief.profileStyles = defaults.results.map(row => row.style);
  const stage = row.stage ?? "compare";
  if (stage === "photo") brief.hasSavedPhoto = Boolean(await profilePhotoRef(db, accountId));
  const draft = { brief, stage, optionId: row.optionId, version: row.version, looks: [] };
  if (stage === "style" || stage === "occasion" || stage === "photo") return draft;
  draft.looks = await readDraftOptions(db, accountId, row.id, row.floor);
  if (stage === "refine" && !draft.looks.some(look => look?.id === row.optionId)) {
    draft.stage = "compare";
    draft.optionId = null;
  }
  const run = await db.prepare(`
    SELECT status, created_at FROM generation_runs WHERE user_id = ? AND request_id = ? AND id > ?
    ORDER BY id DESC LIMIT 1
  `).bind(accountId, row.id, row.floor).first();
  // A reload while a provider is working should allow the original request to finish.
  const started = run?.created_at && Date.parse(run.created_at.replace(" ", "T") + "Z");
  return { ...draft, pending: run?.status === "running" && Date.now() - started < 240_000 };
}

export async function setDraftStage(db, accountId, input) {
  const { briefId, stage, version, optionId = null } = input;
  if (!validId(briefId) || !["occasion", "style", "photo", "compare", "refine", "closed"].includes(stage) ||
      (stage === "refine" && !validId(optionId))) throw new TypeError("Invalid planning step.");
  const next = crypto.randomUUID();
  const updated = await db.prepare(`
    UPDATE outfit_requests SET resume_stage = ?, resume_version = ?, resume_option_id = ?, resume_preview_file_id = ?
    WHERE user_id = ? AND id = ? AND resume_version IS ? AND (${active} OR (${legacy}))
      AND (CAST(? AS TEXT) IS NULL OR EXISTS (SELECT 1 FROM outfit_options o JOIN generation_runs r ON r.id = o.run_id
        WHERE o.id = ? AND r.user_id = outfit_requests.user_id AND r.request_id = outfit_requests.id
        AND r.id > outfit_requests.resume_after_run))
    RETURNING id
  `).bind(stage, next, stage === "refine" ? optionId : null, stage === "refine" ? input.previewRef ?? null : null, accountId, briefId, version ?? null,
    stage === "refine" ? String(optionId) : null, stage === "refine" ? optionId : null).first();
  if (!updated) throw changedDraft();
  return { version: next };
}

export async function restoreReview(db, accountId, input, garments) {
  const row = await db.prepare(`
    SELECT p.file_id AS file, p.selection
    FROM outfit_requests d
    JOIN planner_previews p ON p.option_id = d.resume_option_id AND p.user_id = d.user_id
      AND p.file_id = d.resume_preview_file_id
    WHERE d.user_id = ? AND d.id = ? AND d.resume_version = ?
      AND d.resume_stage = 'refine' AND d.resume_option_id = ?
  `).bind(accountId, input.briefId, input.version ?? null, input.optionId).first();
  if (!row) throw changedDraft();
  const option = await readOption(db, accountId, input.optionId);
  if (!option) throw changedDraft();
  const slots = Object.keys(option.slots).length ? snapshotSlots(option.slots, garments) : {};
  const listings = JSON.parse(row.selection)[5];
  if (!Array.isArray(listings)) throw changedDraft();
  const pin = await verifyPreview(db, accountId, option, slots, garments, {
    previewRef: row.file, catalogItemIds: listings.map(listing => listing[0]),
  });
  return { ...option, imageRef: pin.file, products: pin.products, useProfilePhoto: true,
    effectiveSlots: Object.fromEntries(Object.entries(pin.effective).map(([slot, item]) => [slot, String(item.id)])) };
}
