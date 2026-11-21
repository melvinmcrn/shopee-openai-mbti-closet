import { api, type Look } from "./shared";

export function createTryOnLoader() {
  const requests = new Map<string, Promise<{ imageRef: string }>>();

  return (look: Look, useProfilePhoto: boolean) => {
    // A planner option is immutable once generated.
    const key = JSON.stringify([look.id, useProfilePhoto]);
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
  };
}

export type LoadTryOn = ReturnType<typeof createTryOnLoader>;
