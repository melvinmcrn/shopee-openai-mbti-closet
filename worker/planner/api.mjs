import { saveBrief, getBrief } from "./brief.mjs";
import { generateLooks } from "./decision.mjs";
import { saveLook, listLooks, getLook } from "./saved.mjs";

export class PlannerError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function found(value) {
  if (!value) throw new PlannerError(404, "This item could not be found.");
  return value;
}

export async function getGarments(env, accountId) {
  const { results } = await env.DB.prepare(`
    SELECT id, name, category, color, image_file_id AS imageRef FROM wardrobe_items
    WHERE user_id = ? AND confirmed_at IS NOT NULL AND archived_at IS NULL
    AND category IN ('top','bottom','shoes','dress','outerwear','accessory')
    ORDER BY id
  `).bind(accountId).all();
  return results.map(row => ({ ...row, id: String(row.id), accountId: String(accountId),
    color: row.color ?? "", imageRef: row.imageRef ?? "", active: true, confirmed: true }));
}

async function option(db, accountId, id) {
  const row = await db.prepare("SELECT option_json FROM planner_options WHERE account_id = ? AND id = ?")
    .bind(accountId, id).first();
  return JSON.parse(found(row).option_json);
}

export async function dispatchPlanner(env, accountId, action, input = {}, dependencies = {}) {
  if (!Number.isSafeInteger(accountId) || accountId < 1) throw new PlannerError(401, "Sign in to open the planner.");
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new PlannerError(400, "Invalid planner request.");
  const db = env.DB;
  const wardrobe = () => (dependencies.getGarments ?? getGarments)(env, accountId);
  switch (action) {
    case "wardrobe": return wardrobe();
    case "saveBrief": return found(await saveBrief(db, accountId, input));
    case "option": return option(db, accountId, input.id);
    case "generate": {
      const brief = found(await getBrief(db, accountId, input.briefId));
      const generation = await (dependencies.generateLooks ?? generateLooks)(env, brief, await wardrobe(), input.priorLooks);
      if (generation.status !== "ready") return generation;
      const looks = generation.looks.map(look => ({ ...look, id: crypto.randomUUID(), occasion: brief.occasion }));
      await db.batch(looks.map(look => db.prepare(
        "INSERT INTO planner_options (account_id, id, brief_id, option_json) VALUES (?, ?, ?, ?)"
      ).bind(accountId, look.id, brief.id, JSON.stringify(look))));
      return { status: "ready", looks };
    }
    case "save": return saveLook(db, accountId, await option(db, accountId, input.optionId), input.slots, await wardrobe());
    case "list": return listLooks(db, accountId);
    case "detail": return found(await getLook(db, accountId, input.id));
    default: throw new PlannerError(400, "Unknown planner action.");
  }
}
