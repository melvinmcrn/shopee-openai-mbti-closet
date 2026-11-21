import { api, type Look, type SavedLook } from "./shared";

export type TryOnResult = { imageRef: string | null };

function keyFor(id: string, slots: Record<string, string>, useProfilePhoto: boolean, catalogItemId: string | null) {
  return JSON.stringify([id, Object.keys(slots).sort().map(slot => [slot, slots[slot]]), useProfilePhoto, catalogItemId]);
}

export function createTryOnLoader() {
  const requests = new Map<string, Promise<TryOnResult>>();

  function load(look: Look, useProfilePhoto: boolean, catalogItemId: string | null) {
    const key = keyFor(look.id, look.slots, useProfilePhoto, catalogItemId);
    const existing = requests.get(key);
    if (existing) return existing;
    const request = api<TryOnResult>("preview", {
      optionId: look.id, slots: look.slots, useProfilePhoto, catalogItemId,
    }).catch(error => {
      requests.delete(key);
      throw error;
    });
    requests.set(key, request);
    return request;
  }

  function find(look: SavedLook, catalogItemId: string | null) {
    const slots = Object.fromEntries(Object.entries(look.slots).map(([slot, garment]) => [slot, garment.id]));
    return requests.get(keyFor(look.optionId, slots, look.useProfilePhoto, catalogItemId));
  }

  return Object.assign(load, { find });
}

export type LoadTryOn = ReturnType<typeof createTryOnLoader>;
