import { saveBrief, getBrief } from "./brief.mjs";
import { readOption, generateOptions } from "./options.mjs";
import { wearAction } from "./wear.mjs";
import { evaluateEnhancements, shoppingAction } from "./shopping.mjs";
import { generatePreview } from "./preview.mjs";
import { previewFiles, profilePhotoRef } from "./preview-files.mjs";
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

function selectedPhotoRef(db, accountId, preference, overrides) {
  if (preference === false) return null;
  return overrides?.profilePhotoRef ? overrides.profilePhotoRef() : profilePhotoRef(db, accountId);
}

async function renderPreview(env, accountId, source, slots, garments, ref, personal, overrides) {
  const files = overrides ?? previewFiles(env, accountId, source.id, slots, personal);
  const cached = await files.cachedImage?.();
  if (cached) return { imageRef: cached };
  if (!ref && (personal || !garments.length)) {
    throw new PlannerError(400, "Add a profile photo to generate this try-on.");
  }
  const brief = await getBrief(env.DB, accountId, source.briefId);
  return generatePreview(env, garments, ref, files, brief);
}

export async function dispatchPlanner(env, accountId, action, input = {}, dependencies = {}) {
  if (!Number.isSafeInteger(accountId) || accountId < 1) throw new PlannerError(401, "Sign in to open the planner.");
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new PlannerError(400, "Invalid planner request.");
  if ((action === "preview" || action === "save") && input.useProfilePhoto != null && typeof input.useProfilePhoto !== "boolean") {
    throw new PlannerError(400, "Invalid profile photo choice.");
  }
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
    case "enhancements": case "enhancement": {
      const source = await option(db, accountId, input.optionId);
      const garments = await wardrobe();
      const requested = input.slots ?? source.slots;
      const profileOnly = !Object.keys(source.slots).length && !Object.keys(requested).length;
      const slots = profileOnly ? {} : snapshotSlots(requested, garments);
      const products = await evaluateEnhancements(env, accountId, source, slots, garments, dependencies.shoppingFetch);
      return action === "enhancement" ? products[0] ?? null : products;
    }
    case "shopping": case "hide":
      return shoppingAction(env, accountId, action, input, dependencies.shoppingFetch, wardrobe);
    case "preview": {
      const source = await option(db, accountId, input.optionId);
      const profileOnly = !Object.keys(source.slots).length && input.slots &&
        !Array.isArray(input.slots) && typeof input.slots === "object" && !Object.keys(input.slots).length;
      const final = profileOnly ? {} : snapshotSlots(input.slots, await wardrobe());
      const ref = await selectedPhotoRef(db, accountId, input.useProfilePhoto, dependencies.preview);
      return renderPreview(env, accountId, source, input.slots, Object.values(final), ref,
        input.useProfilePhoto === true || Boolean(ref), dependencies.preview);
    }
    case "savedPreview": {
      const look = found(await getLook(db, accountId, input.id));
      if (look.previewRef) return { imageRef: look.previewRef };
      const ids = Object.fromEntries(Object.entries(look.slots).map(([slot, garment]) => [slot, garment.id]));
      const source = await option(db, accountId, look.optionId);
      const ref = await selectedPhotoRef(db, accountId, look.useProfilePhoto, dependencies.preview);
      const result = await renderPreview(env, accountId, source, ids, Object.values(look.slots), ref, Boolean(ref), dependencies.preview);
      if (look.useProfilePhoto && !ref) {
        // Only adopt the studio mode after its image is ready.
        await db.prepare("UPDATE saved_looks SET use_profile_photo=0 WHERE user_id=? AND id=?")
          .bind(accountId, look.id).run();
      }
      return result;
    }
    case "save": {
      const source = await option(db, accountId, input.optionId);
      const personal = input.useProfilePhoto ?? Boolean(await profilePhotoRef(db, accountId));
      return saveLook(db, accountId, source, input.slots, await wardrobe(), personal === true);
    }
    case "list": return listLooks(db, accountId);
    case "detail": return found(await getLook(db, accountId, input.id));
    default: throw new PlannerError(400, "Unknown planner action.");
  }
}
