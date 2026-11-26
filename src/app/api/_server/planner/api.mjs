import { catalogListingKey } from "../../../planner/catalog-listing.mjs";
import { resumePlanner, setDraftStage } from "./resume.mjs";
import { getGarments } from "./garments.mjs";
import { saveBrief, getBrief } from "./brief.mjs";
import { readOption, generateOptions } from "./options.mjs";
import { wearAction } from "./wear.mjs";
import { evaluateEnhancements, shoppingAction, suggestionsForLook } from "./shopping.mjs";
import { readBaseCoverage } from "./base-coverage.mjs";
import { combineBaseCoverage, effectiveWardrobeSlots } from "./wardrobe-completion.mjs";
import { generatePreview, readProfileImage, ProfilePhotoError, profilePhotoRequired, profilePhotoChanged } from "./preview.mjs";
import { previewFiles, previewSelection, profilePhotoRef, readPreviewImage } from "./preview-files.mjs";
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

function requestedSlots(source, input) {
  const slots = input.slots ?? source.slots;
  if (source.kind === "occasion" && (
    !slots || typeof slots !== "object" || Array.isArray(slots) ||
    Object.keys(slots).length !== Object.keys(source.slots).length ||
    Object.entries(source.slots).some(([slot, id]) => slots[slot] !== id)
  )) throw new PlannerError(400, "The selected items have changed. Reopen this look.");
  return slots;
}

function matchesRequestedProducts(input, products) {
  const expected = input.catalogItemIds ?? (input.catalogItemId === undefined ? undefined :
    input.catalogItemId == null ? [] : [input.catalogItemId]);
  if (input.catalogListings !== undefined) {
    const listings = input.catalogListings;
    if (!Array.isArray(listings) || new Set(listings).size !== products.length ||
        listings.length !== products.length || !products.every(product => listings.includes(catalogListingKey(product)))) return false;
  }
  if (expected === undefined) return true;
  if (!Array.isArray(expected) || expected.length !== products.length) return false;
  const ids = new Set(expected);
  return ids.size === products.length && products.every(product => ids.has(product.id));
}

export async function dispatchPlanner(env, accountId, action, input = {}, dependencies = {}) {
  if (!Number.isSafeInteger(accountId) || accountId < 1) throw new PlannerError(401, "Sign in to open the planner.");
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new PlannerError(400, "Invalid planner request.");
  if ((action === "preview" || action === "save") && input.useProfilePhoto != null && typeof input.useProfilePhoto !== "boolean") {
    throw new PlannerError(400, "Invalid profile photo choice.");
  }
  if ((action === "preview" || action === "savedPreview") && input.useProfilePhoto === false) {
    throw new PlannerError(422, "Try-on photos require your profile photo.");
  }
  const db = env.DB;
  const photo = () => dependencies.preview?.profilePhotoRef ? dependencies.preview.profilePhotoRef() : profilePhotoRef(db, accountId);
  const wardrobe = () => (dependencies.getGarments ?? getGarments)(env, accountId);
  async function currentPortrait(ref) {
    if (!ref) throw profilePhotoRequired();
    const read = dependencies.preview?.readImage ?? (id => readPreviewImage(env, accountId, id));
    return { ref, image: await readProfileImage(read, ref) };
  }
  function render(optionId, slots, portrait, products, effective, base, identityOnly = false, pinnedFile) {
    const files = dependencies.preview ?? previewFiles(env, accountId, optionId, slots, true, products, portrait.ref, effective, identityOnly);
    return generatePreview(env, Object.values(effective),
      { ...files, cachedImage: () => files.cachedImage?.(pinnedFile), profilePhotoRef: photo }, products, base, portrait);
  }
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
    case "resumePlanner": return resumePlanner(db, accountId, input.briefId);
    case "setDraftStage": return setDraftStage(db, accountId, input);
    case "wardrobe": return wardrobe();
    case "prepareTryOn": {
      try {
        await currentPortrait(await photo());
      } catch (error) {
        if (error instanceof ProfilePhotoError && error.code === "profile_photo_required") return input.trackDraft
          ? { status: "photo_required", brief: found(await saveBrief(db, accountId, input, "photo")) }
          : { status: "photo_required" };
        throw error;
      }
      return { status: "ready", brief: found(await saveBrief(db, accountId, input, input.trackDraft ? "compare" : undefined)) };
    }
    case "saveBrief": return found(await saveBrief(db, accountId, input, input.trackDraft ? "style" : undefined));
    case "option": return option(db, accountId, input.id);
    case "generate": {
      const brief = found(await getBrief(db, accountId, input.briefId));
      return generateOptions(env, accountId, brief, await wardrobe(), input.priorLooks, dependencies.generateLooks, dependencies.generateOccasionLook);
    }
    case "wearList": case "wearAdd": case "wearGet": case "wearUpdate":
      return wearAction(db, accountId, action, input);
    case "enhancements": case "enhancement": case "preview": {
      const source = await option(db, accountId, input.optionId);
      const garments = await wardrobe();
      const requested = requestedSlots(source, input);
      const noWardrobePieces = !Object.keys(source.slots).length && requested && typeof requested === "object" &&
        !Array.isArray(requested) && !Object.keys(requested).length;
      const slots = noWardrobePieces ? {} : snapshotSlots(requested, garments);
      const ref = await photo();
      const portrait = action === "preview" ? await currentPortrait(ref) : null;
      const base = source.kind === "occasion" ? {} : await basePhotos(ref, slots);
      const evaluate = dependencies.evaluateEnhancements ?? evaluateEnhancements;
      const products = await evaluate(env, accountId, source, slots, garments, dependencies.shoppingFetch, base.coverage);
      if (action === "enhancements") return products;
      if (action === "enhancement") return products[0] ?? null;
      if (!matchesRequestedProducts(input, products)) return { imageRef: null };
      const effective = effectiveWardrobeSlots(slots, garments, base.coverage);
      const result = await render(source.id, slots, portrait, products, effective, base);
      if (!result.imageRef) return result;
      const added = Object.keys(effective).length !== Object.keys(slots).length;
      return { ...result, useProfilePhoto: Boolean(ref), ...(added ? {
        effectiveSlots: Object.fromEntries(Object.entries(effective).map(([slot, item]) => [slot, String(item.id)])),
      } : {}) };
    }
    case "shopping": case "hide":
      return shoppingAction(env, accountId, action, input, dependencies.shoppingFetch, wardrobe, savedCoverage);
    case "savedPreview": {
      const ref = await photo();
      const look = found(await getLook(db, accountId, input.id));
      const portrait = await currentPortrait(ref);
      const garments = await wardrobe();
      const identityOnly = Boolean(ref && look.hasPinnedPreview && !look.retainProfileClothes);
      const base = look.kind === "occasion" ? {} : await basePhotos(identityOnly ? null : ref, look.slots);
      const suggestions = await suggestionsForLook(env, accountId, look, () => garments, dependencies.shoppingFetch, () => base.coverage);
      const products = suggestions.map(suggestion => ({ ...suggestion, id: suggestion.catalogItemId }));
      if (!matchesRequestedProducts(input, products)) return { imageRef: null };
      const frozen = look.kind === "occasion" || look.hasPinnedPreview;
      const effective = frozen ? look.slots : effectiveWardrobeSlots(look.slots, garments, base.coverage);
      const result = await render(look.optionId, look.slots, portrait, products, effective, base, identityOnly, look.hasPinnedPreview ? look.previewRef : null);
      if (result.imageRef) {
        // Visibility, face photos and wardrobe pieces may change while the provider is running.
        const [current, latestRef, latestWardrobe] = await Promise.all([
          getLook(db, accountId, look.id, base.coverage), photo(),
          !frozen && base.coverage ? wardrobe() : garments,
        ]);
        if (latestRef !== ref) throw profilePhotoChanged();
        const expected = previewSelection(look.slots, Boolean(ref), products, ref, effective);
        const latest = current && previewSelection(current.slots, Boolean(latestRef), current.enhancements, latestRef,
          frozen ? current.slots : effectiveWardrobeSlots(current.slots, latestWardrobe, base.coverage));
        if (latest !== expected) return { imageRef: null };
      }
      return result;
    }
    case "save": {
      const source = await option(db, accountId, input.optionId);
      const rendered = input.previewRef === undefined ? undefined : { previewRef: input.previewRef, draftVersion: input.draftVersion, catalogItemIds: input.catalogItemIds };
      return saveLook(db, accountId, source, requestedSlots(source, input), await wardrobe(), rendered);
    }
    case "list": return listLooks(db, accountId);
    case "detail": return found(await getLook(db, accountId, input.id));
    default: throw new PlannerError(400, "Unknown planner action.");
  }
}
