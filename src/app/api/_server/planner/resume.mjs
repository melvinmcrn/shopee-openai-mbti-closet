import { getBrief } from "./brief.mjs";
import { readDraftOptions } from "./options.mjs";

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
  const brief = await getBrief(db, accountId, row.id);
  const stage = row.stage ?? "compare";
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
    UPDATE outfit_requests SET resume_stage = ?, resume_version = ?, resume_option_id = ?
    WHERE user_id = ? AND id = ? AND resume_version IS ? AND (${active} OR (${legacy}))
      AND (CAST(? AS TEXT) IS NULL OR EXISTS (SELECT 1 FROM outfit_options o JOIN generation_runs r ON r.id = o.run_id
        WHERE o.id = ? AND r.user_id = outfit_requests.user_id AND r.request_id = outfit_requests.id
        AND r.id > outfit_requests.resume_after_run))
    RETURNING id
  `).bind(stage, next, stage === "refine" ? optionId : null, accountId, briefId, version ?? null,
    stage === "refine" ? String(optionId) : null, stage === "refine" ? optionId : null).first();
  if (!updated) throw changedDraft();
  return { version: next };
}
