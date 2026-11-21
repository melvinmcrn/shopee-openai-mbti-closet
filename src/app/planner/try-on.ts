import type { CatalogProduct } from "./enhancement";
import { api, type Look, type SavedLook } from "./shared";

export type TryOnResult = { imageRef: string | null };

export async function requestTryOn(action: "preview" | "savedPreview", input: object): Promise<TryOnResult> {
  const controller = new AbortController();
  // Allow the server's three-minute render, one-minute inventory check and file transfers.
  const timer = setTimeout(() => controller.abort(), 270_000);
  try {
    const result = await api<unknown>(action, input, controller.signal);
    if (result && typeof result === "object" && "imageRef" in result) {
      const { imageRef } = result;
      if (imageRef === null || (typeof imageRef === "string" && imageRef.trim())) return { imageRef };
    }
    throw new Error("We couldn’t open the try-on photo. Please try again.");
  } catch (cause) {
    if (controller.signal.aborted) throw new Error("The try-on took too long. Please try again.");
    throw cause;
  } finally {
    clearTimeout(timer);
  }
}

function selectionKey(look: Look) {
  return JSON.stringify([look.id, Object.entries(look.slots).sort(([a], [b]) => a.localeCompare(b))]);
}

export function listingKey(products: CatalogProduct[]) {
  return JSON.stringify([...products].sort((a, b) => a.id.localeCompare(b.id)).map(product => [
    product.id, product.searchGroup, product.searchTerm, product.ocrImage, product.imageUrl, product.title, product.wardrobeGap,
  ]));
}

export function createTryOnLoader() {
  const requests = new Map<string, Promise<TryOnResult>>();
  const savedSelections = new Map<string, string>();

  function load(look: Look, products: CatalogProduct[]) {
    const key = JSON.stringify([selectionKey(look), listingKey(products)]);
    const existing = requests.get(key);
    if (existing) return existing;
    const request = requestTryOn("preview", {
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
