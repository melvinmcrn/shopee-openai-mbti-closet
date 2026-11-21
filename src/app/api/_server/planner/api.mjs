import { getGarments } from "./garments.mjs";
import { saveBrief, getBrief } from "./brief.mjs";
import { readOption, generateOptions } from "./options.mjs";
import { wearAction } from "./wear.mjs";
import { enhancementSelection, readSavedProducts } from "./catalog-product.mjs";
import { evaluateEnhancements, shoppingAction, suggestionsForLook } from "./shopping.mjs";
import { readBaseCoverage } from "./base-coverage.mjs";
import { combineBaseCoverage, effectiveWardrobeSlots } from "./wardrobe-completion.mjs";
import { generatePreview } from "./preview.mjs";
import { previewFiles, previewSelection, profilePhotoRef } from "./preview-files.mjs";
import { saveLook, listLooks, getLook, snapshotSlots } from "./saved.mjs";

export { getGarments };

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

async function renderPreview(env, accountId, optionId, slots, profileRef, products, wardrobe, base, overrides) {
  const personal = Boolean(profileRef);
  const effective = effectiveWardrobeSlots(slots, wardrobe, base.coverage);
  const files = overrides ?? previewFiles(env, accountId, optionId, slots, personal, products, profileRef, effective);
  const cached = await files.cachedImage?.();
  if (cached) return { imageRef: cached };
  return generatePreview(env, accountId, Object.values(effective), personal,
    { ...files, profilePhotoRef: () => profileRef }, products, base);
}

export async function dispatchPlanner(env, accountId, action, input = {}, dependencies = {}) {
  if (!Number.isSafeInteger(accountId) || accountId < 1) throw new PlannerError(401, "Sign in to open the planner.");
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new PlannerError(400, "Invalid planner request.");
  if ((action === "preview" || action === "save") && input.useProfilePhoto != null && typeof input.useProfilePhoto !== "boolean") {
    throw new PlannerError(400, "Invalid profile photo choice.");
  }
  const db = env.DB;
  const photo = () => dependencies.preview?.profilePhotoRef ? dependencies.preview.profilePhotoRef() : profilePhotoRef(db, accountId);
  const wardrobe = () => (dependencies.getGarments ?? getGarments)(env, accountId);
  async function basePhotos(ref, slots) {
    const read = dependencies.readBaseCoverage ?? readBaseCoverage;
    const originalRef = slots.other?.imageRef;
    const [profile, original] = await Promise.all([ref, originalRef].map(id =>
      id ? read(env, accountId, id) : null));
    return { profile, original, coverage: combineBaseCoverage(profile, original) };
  }
  async function savedCoverage(look) {
    const ref = look.useProfilePhoto ? await photo() : null;
    return (await basePhotos(ref, look.slots)).coverage;
  }
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
      const ref = input.useProfilePhoto === false ? null : await photo();
      if (action === "preview" && !ref && (input.useProfilePhoto === true || profileOnly)) {
        throw new PlannerError(400, "Add a profile photo to generate this try-on.");
      }
      const base = await basePhotos(ref, slots);
      const evaluate = dependencies.evaluateEnhancements ?? evaluateEnhancements;
      const products = await evaluate(env, accountId, source, slots, garments, dependencies.shoppingFetch, base.coverage);
      if (action === "enhancements") return products;
      if (action === "enhancement") return products[0] ?? null;
      if (!matchesRequestedProducts(input, products)) return { imageRef: null };
      return renderPreview(env, accountId, source.id, slots, ref, products, garments, base, dependencies.preview);
    }
    case "shopping": case "hide":
      return shoppingAction(env, accountId, action, input, dependencies.shoppingFetch, wardrobe, savedCoverage);
    case "savedPreview": {
      const look = found(await getLook(db, accountId, input.id));
      const [ref, garments] = await Promise.all([look.useProfilePhoto ? photo() : null, wardrobe()]);
      const base = await basePhotos(ref, look.slots);
      const suggestions = await suggestionsForLook(env, accountId, look, () => garments, dependencies.shoppingFetch, () => base.coverage);
      const products = suggestions.map(suggestion => ({ ...suggestion, id: suggestion.catalogItemId }));
      if (!matchesRequestedProducts(input, products)) return { imageRef: null };
      const personal = Boolean(ref);
      const result = await renderPreview(env, accountId, look.optionId, look.slots, ref, products, garments, base, dependencies.preview);
      if (result.imageRef) {
        // Visibility and listing photos can change while the image provider is running.
        const [choices, latestRef, latestWardrobe] = await Promise.all([
          readSavedProducts(db, accountId, { [look.id]: enhancementSelection(look.slots) }, { [look.id]: base.coverage }),
          look.useProfilePhoto ? photo() : null,
          base.coverage ? wardrobe() : garments,
        ]);
        const expected = previewSelection(look.slots, personal, products, ref,
          effectiveWardrobeSlots(look.slots, garments, base.coverage));
        const current = previewSelection(look.slots, Boolean(latestRef), choices.get(look.id) ?? [], latestRef,
          effectiveWardrobeSlots(look.slots, latestWardrobe, base.coverage));
        if (current !== expected) {
          return { imageRef: null };
        }
        if (look.useProfilePhoto && !ref) {
          await db.prepare("UPDATE saved_looks SET use_profile_photo=0 WHERE user_id=? AND id=?")
            .bind(accountId, look.id).run();
        }
      }
      return result;
    }
    case "save": {
      const source = await option(db, accountId, input.optionId);
      const personal = input.useProfilePhoto ?? Boolean(await profilePhotoRef(db, accountId));
      return saveLook(db, accountId, source, input.slots, await wardrobe(), personal);
    }
    case "list": return listLooks(db, accountId);
    case "detail": return found(await getLook(db, accountId, input.id));
    default: throw new PlannerError(400, "Unknown planner action.");
  }
}
