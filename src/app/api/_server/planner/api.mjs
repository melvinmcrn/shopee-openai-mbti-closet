import { saveBrief, getBrief } from "./brief.mjs";
import { readOption, generateOptions } from "./options.mjs";
import { wearAction } from "./wear.mjs";
import { evaluateEnhancement, shoppingAction } from "./shopping.mjs";
import { generatePreview } from "./preview.mjs";
import { previewFiles } from "./preview-files.mjs";
import { saveLook, listLooks, getLook, snapshotSlots } from "./saved.mjs";

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
    AND image_file_id IS NOT NULL
    ORDER BY id
  `).bind(accountId).all();
  return results.map(row => ({ ...row, id: String(row.id), accountId: String(accountId),
    color: row.color ?? "", imageRef: row.imageRef ?? "", active: true, confirmed: true }));
}

async function option(db, accountId, id) {
  return found(await readOption(db, accountId, id));
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
      return generateOptions(env, accountId, brief, await wardrobe(), input.priorLooks, dependencies.generateLooks);
    }
    case "wearList": case "wearAdd": case "wearGet": case "wearUpdate":
      return wearAction(db, accountId, action, input);
    case "enhancement": {
      const source = await option(db, accountId, input.optionId);
      if (!Object.keys(source.slots).length) return null;
      const garments = await wardrobe();
      const slots = snapshotSlots(input.slots ?? source.slots, garments);
      return evaluateEnhancement(env, accountId, source, slots, () => garments, dependencies.shoppingFetch);
    }
    case "shopping": case "hide":
      return shoppingAction(env, accountId, action, input, dependencies.shoppingFetch, wardrobe);
    case "preview": {
      const source = await option(db, accountId, input.optionId);
      const profileOnly = input.useProfilePhoto === true && Object.keys(source.slots ?? {}).length === 0
        && input.slots && Object.keys(input.slots).length === 0;
      const final = profileOnly ? {} : snapshotSlots(input.slots, await wardrobe());
      const files = dependencies.preview ?? previewFiles(env, accountId, source.id, input.slots, input.useProfilePhoto === true);
      const cached = await files.cachedImage?.();
      if (cached) return { imageRef: cached };
      const brief = await getBrief(db, accountId, source.briefId);
      return generatePreview(env, accountId, Object.values(final), input.useProfilePhoto, files, brief);
    }
    case "savedPreview": {
      const look = found(await getLook(db, accountId, input.id));
      if (look.previewRef) return { imageRef: look.previewRef };
      const ids = Object.fromEntries(Object.entries(look.slots).map(([slot, garment]) => [slot, garment.id]));
      const files = dependencies.preview ?? previewFiles(env, accountId, look.optionId, ids, look.useProfilePhoto);
      const source = await option(db, accountId, look.optionId);
      const brief = await getBrief(db, accountId, source.briefId);
      return generatePreview(env, accountId, Object.values(look.slots), look.useProfilePhoto, files, brief);
    }
    case "save": return saveLook(db, accountId, await option(db, accountId, input.optionId), input.slots, await wardrobe(), input.useProfilePhoto === true);
    case "list": return listLooks(db, accountId);
    case "detail": return found(await getLook(db, accountId, input.id));
    default: throw new PlannerError(400, "Unknown planner action.");
  }
}
