import type { CatalogProduct } from "./enhancement";
import { api, type CompletedLook, type Look } from "./shared";

export type TryOnResult = { imageRef: string | null; useProfilePhoto?: boolean };

async function completeLook(look: Look): Promise<CompletedLook | null> {
  const selection = { optionId: look.id, slots: look.slots };
  const products = await api<CatalogProduct[]>("enhancements", selection);
  const { imageRef, useProfilePhoto } = await api<TryOnResult>("preview", {
    ...selection, catalogItemIds: products.map(product => product.id),
  });
  return imageRef ? { ...look, products, imageRef, useProfilePhoto } : null;
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
    const request = completeLook(look);
    requests.set(selection, request);
    return request;
  }
  return Object.assign(load, { clear: (look: Look) => requests.delete(key(look)) });
}

export type LoadTryOn = ReturnType<typeof createTryOnLoader>;
