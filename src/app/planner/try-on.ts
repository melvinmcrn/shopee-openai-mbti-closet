import type { CatalogProduct } from "./enhancement";
import { catalogListingKey } from "./catalog-listing.mjs";
import { api, type CompletedLook, type Look, type PhotoClothes } from "./shared";

export type OutfitPieces = { products: CatalogProduct[]; effectiveSlots: Record<string, string>; photoClothes: PhotoClothes };
export type TryOnResult = { imageRef: string | null; photoClothes?: PhotoClothes; useProfilePhoto?: boolean; effectiveSlots?: Record<string, string> };

export async function requestTryOn(action: "preview" | "savedPreview", input: object): Promise<TryOnResult> {
  const controller = new AbortController();
  // Allow the server's three-minute render and file transfers.
  const timer = setTimeout(() => controller.abort(), 270_000);
  try {
    const result = await api<TryOnResult | null>(action, input, controller.signal);
    if (result && (result.imageRef === null || (typeof result.imageRef === "string" && result.imageRef.trim()))) return result;
    throw new Error("We couldn’t open the try-on photo. Please try again.");
  } catch (cause) {
    if (controller.signal.aborted) throw new Error("The try-on took too long. Please try again.");
    throw cause;
  } finally {
    clearTimeout(timer);
  }
}

function prepareLook(look: Look) {
  const selection = { optionId: look.id, slots: look.slots, includePieces: true };
  const pieces = api<OutfitPieces>("enhancements", selection, AbortSignal.timeout(270_000));
  const preview = pieces.then(async ({ products, effectiveSlots, photoClothes }): Promise<CompletedLook | null> => {
    const photo = await requestTryOn("preview", {
      ...selection, catalogItemIds: products.map(product => product.id), catalogListings: products.map(catalogListingKey),
    });
    return photo.imageRef ? { ...look, effectiveSlots, photoClothes, ...photo, imageRef: photo.imageRef, products } : null;
  });
  return { pieces, preview };
}

export function createTryOnLoader() {
  const requests = new Map<string, ReturnType<typeof prepareLook>>();
  function key(look: Look) {
    return JSON.stringify([look.id, Object.entries(look.slots).sort(([a], [b]) => a.localeCompare(b))]);
  }
  function load(look: Look) {
    const selection = key(look);
    const existing = requests.get(selection);
    if (existing) return existing;
    const request = prepareLook(look);
    requests.set(selection, request);
    return request;
  }
  return Object.assign(load, { clear: (look: Look) => requests.delete(key(look)) });
}

export type LoadTryOn = ReturnType<typeof createTryOnLoader>;
