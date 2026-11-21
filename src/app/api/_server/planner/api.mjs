import { saveBrief, getBrief } from "./brief.mjs";
import { readOption, generateOptions } from "./options.mjs";
import { wearAction } from "./wear.mjs";
import { enhancementSelection, readSavedProducts } from "./catalog-product.mjs";
import { evaluateEnhancements, shoppingAction, suggestionsForLook } from "./shopping.mjs";
import { generatePreview, profilePhotoChanged, profilePhotoRequired } from "./preview.mjs";
import { previewFiles, previewSelection, profilePhotoRef } from "./preview-files.mjs";
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

function matchesRequestedProducts(input, products) {
  const expected = input.catalogItemIds ?? (input.catalogItemId === undefined ? undefined :
    input.catalogItemId == null ? [] : [input.catalogItemId]);
  if (expected === undefined) return true;
  if (!Array.isArray(expected) || expected.length !== products.length) return false;
  const ids = new Set(expected);
  return ids.size === products.length && products.every(product => ids.has(product.id));
}

async function renderPreview(env, accountId, optionId, slots, ref, products, photo, overrides) {
  const files = overrides ?? previewFiles(env, accountId, optionId, slots, products, ref);
  return generatePreview(env, Object.values(slots), { ...files, profilePhotoRef: photo }, products, ref);
}

export async function dispatchPlanner(env, accountId, action, input = {}, dependencies = {}) {
  if (!Number.isSafeInteger(accountId) || accountId < 1) throw new PlannerError(401, "Sign in to open the planner.");
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new PlannerError(400, "Invalid planner request.");
  // Old clients can explicitly decline photo use, but cannot request an anonymous render.
  if ((action === "preview" || action === "savedPreview") && input.useProfilePhoto === false) {
    throw new PlannerError(422, "Try-on photos require your profile photo.");
  }
  const db = env.DB;
  const photo = () => dependencies.preview?.profilePhotoRef ? dependencies.preview.profilePhotoRef() : profilePhotoRef(db, accountId);
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
    case "enhancements": case "enhancement": case "preview": {
      const source = await option(db, accountId, input.optionId);
      const garments = await wardrobe();
      const requested = input.slots ?? source.slots;
      const profileOnly = !Object.keys(source.slots).length && requested && typeof requested === "object" &&
        !Array.isArray(requested) && !Object.keys(requested).length;
      const slots = profileOnly ? {} : snapshotSlots(requested, garments);
      const ref = action === "preview" ? await photo() : null;
      if (action === "preview" && !ref) throw profilePhotoRequired();
      const products = await evaluateEnhancements(env, accountId, source, slots, garments, dependencies.shoppingFetch);
      if (action === "enhancements") return products;
      if (action === "enhancement") return products[0] ?? null;
      if (!matchesRequestedProducts(input, products)) return { imageRef: null };
      return renderPreview(env, accountId, source.id, slots, ref, products, photo, dependencies.preview);
    }
    case "shopping": case "hide":
      return shoppingAction(env, accountId, action, input, dependencies.shoppingFetch, wardrobe);
    case "savedPreview": {
      const look = found(await getLook(db, accountId, input.id));
      const ref = await photo();
      if (!ref) throw profilePhotoRequired();
      const suggestions = await suggestionsForLook(env, accountId, look, wardrobe, dependencies.shoppingFetch);
      const products = suggestions.map(suggestion => ({ ...suggestion, id: suggestion.catalogItemId }));
      if (!matchesRequestedProducts(input, products)) return { imageRef: null };
      const result = await renderPreview(env, accountId, look.optionId, look.slots, ref, products, photo, dependencies.preview);
      if (result.imageRef) {
        // Visibility and listing photos can change while the image provider is running.
        const choices = await readSavedProducts(db, accountId, { [look.id]: enhancementSelection(look.slots) });
        const current = choices.get(look.id) ?? [];
        if (await photo() !== ref) throw profilePhotoChanged();
        if (previewSelection(look.slots, current, ref) !== previewSelection(look.slots, products, ref)) {
          return { imageRef: null };
        }
      }
      return result;
    }
    case "save": {
      const source = await option(db, accountId, input.optionId);
      return saveLook(db, accountId, source, input.slots, await wardrobe());
    }
    case "list": return listLooks(db, accountId);
    case "detail": return found(await getLook(db, accountId, input.id));
    default: throw new PlannerError(400, "Unknown planner action.");
  }
}
