import type { CatalogProduct } from "./enhancement";
import { api, type Look, type SavedLook } from "./shared";

export type TryOnResult = { imageRef: string | null };

function selectionKey(look: Look) {
  return JSON.stringify([look.id, Object.entries(look.slots).sort(([a], [b]) => a.localeCompare(b))]);
}

export function listingKey(products: CatalogProduct[]) {
  return JSON.stringify([...products].sort((a, b) => a.id.localeCompare(b.id)).map(product => [
    product.id, product.imageUrl, product.title, product.wardrobeGap,
  ]));
}

export function createTryOnLoader() {
  const requests = new Map<string, Promise<TryOnResult>>();
  const savedSelections = new Map<string, string>();

  function load(look: Look, products: CatalogProduct[]) {
    const key = JSON.stringify([selectionKey(look), listingKey(products)]);
    const existing = requests.get(key);
    if (existing) return existing;
    const request = api<TryOnResult>("preview", {
      optionId: look.id, slots: look.slots, catalogItemIds: products.map(product => product.id),
    }).catch(error => {
      requests.delete(key);
      throw error;
    });
    requests.set(key, request);
    return request;
  }

  function rememberSaved(look: Look, savedId: string) {
    savedSelections.set(savedId, selectionKey(look));
  }

  function find(look: SavedLook, products: CatalogProduct[]) {
    const key = savedSelections.get(look.id);
    return key === undefined ? undefined : requests.get(JSON.stringify([key, listingKey(products)]));
  }

  return Object.assign(load, { find, rememberSaved });
}

export type LoadTryOn = ReturnType<typeof createTryOnLoader>;
