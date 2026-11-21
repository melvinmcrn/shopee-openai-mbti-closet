import { api, type Look, type SavedLook } from "./shared";

function keyFor(id: string, slots: Record<string, string>, useProfilePhoto: boolean) {
  return JSON.stringify([id, Object.keys(slots).sort().map(slot => [slot, slots[slot]]), useProfilePhoto]);
}

export function createTryOnLoader() {
  const requests = new Map<string, Promise<{ imageRef: string }>>();

  function load(look: Look, useProfilePhoto: boolean) {
    const key = keyFor(look.id, look.slots, useProfilePhoto);
    const existing = requests.get(key);
    if (existing) return existing;
    const request = api<{ imageRef: string }>("preview", {
      optionId: look.id, slots: look.slots, useProfilePhoto,
    }).catch(error => {
      requests.delete(key);
      throw error;
    });
    requests.set(key, request);
    return request;
  }

  function find(look: SavedLook) {
    const slots = Object.fromEntries(Object.entries(look.slots).map(([slot, garment]) => [slot, garment.id]));
    return requests.get(keyFor(look.optionId, slots, look.useProfilePhoto));
  }

  return Object.assign(load, { find });
}

export type LoadTryOn = ReturnType<typeof createTryOnLoader>;
