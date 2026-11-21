import type { CatalogProduct } from "./enhancement";
import { catalogListingKey } from "./catalog-listing.mjs";
import { api, type CompletedLook, type Look } from "./shared";

export type TryOnResult = { imageRef: string | null; useProfilePhoto?: boolean; effectiveSlots?: Record<string, string> };

export async function requestTryOn(action: "preview" | "savedPreview", input: object): Promise<TryOnResult> {
  const controller = new AbortController();
  // Allow the server's three-minute render, one-minute inventory check and file transfers.
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

async function completeLook(look: Look): Promise<CompletedLook | null> {
  const selection = { optionId: look.id, slots: look.slots };
  const products = await api<CatalogProduct[]>("enhancements", selection, AbortSignal.timeout(270_000));
  const photo = await requestTryOn("preview", {
    ...selection, catalogItemIds: products.map(product => product.id), catalogListings: products.map(catalogListingKey),
  });
  return photo.imageRef ? { ...look, ...photo, imageRef: photo.imageRef, products } : null;
}

export function createTryOnLoader() {
  const requests = new Map<string, Promise<CompletedLook | null>>();
  function key(look: Look) {
    return JSON.stringify([look.id, Object.entries(look.slots).sort(([a], [b]) => a.localeCompare(b))]);
  }
  function load(look: Look) {
    const selection = key(look);
    const existing = requests.get(selection);
    if (existing) return existing;
    const request = completeLook(look).finally(() => {
      if (requests.get(selection) === request) requests.delete(selection);
    });
    requests.set(selection, request);
    return request;
  }
  return Object.assign(load, { clear: (look: Look) => requests.delete(key(look)) });
}

export type LoadTryOn = ReturnType<typeof createTryOnLoader>;
