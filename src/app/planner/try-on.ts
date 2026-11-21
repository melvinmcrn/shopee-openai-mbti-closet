import { api, type Look, type SavedLook } from "./shared";

function selectionKey(look: Look) {
  return JSON.stringify([look.id, Object.entries(look.slots).sort(([a], [b]) => a.localeCompare(b))]);
}

export function createTryOnLoader() {
  type TryOn = Promise<{ imageRef: string }>;
  const requests = new Map<string, TryOn>();
  const savedSelections = new Map<string, string>();

  function load(look: Look) {
    const key = selectionKey(look);
    const existing = requests.get(key);
    if (existing) return existing;
    const request = api<{ imageRef: string }>("preview", {
      optionId: look.id, slots: look.slots,
    }).finally(() => requests.delete(key));
    requests.set(key, request);
    return request;
  }

  function rememberSaved(look: Look, savedId: string) {
    savedSelections.set(savedId, selectionKey(look));
  }

  function find(look: SavedLook) {
    const key = savedSelections.get(look.id);
    return key === undefined ? undefined : requests.get(key);
  }

  return Object.assign(load, { find, rememberSaved });
}

export type LoadTryOn = ReturnType<typeof createTryOnLoader>;
