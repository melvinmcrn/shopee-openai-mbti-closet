import { privateFetch } from "../private-fetch.mjs";
import type { CatalogProduct } from "./enhancement";

export type Garment = { id: string; name: string; color: string; category: string; imageRef: string };
export const occasionLookLabel = "Styled for your occasion";
type LookKind = "occasion";
export type Look = { kind?: LookKind; id: string; profileRef?: string; occasion: string; explanation: string; slots: Record<string, string> };
export type PhotoClothes = { profile: string[]; original: string[] };
export type CompletedLook = Look & { imageRef: string; products: CatalogProduct[]; photoClothes?: PhotoClothes; effectiveSlots?: Record<string, string>; useProfilePhoto?: boolean };
export type Brief = { hasSavedPhoto?: boolean; id?: string; version?: string; occasion: string; timing: string; location: string; formality: string; comfort: string; preferences: string[]; styles?: string[]; profileStyles?: string[] };
export type SavedLook = { kind?: LookKind; enhancements: CatalogProduct[]; id: string; optionId: string; useProfilePhoto: boolean; previewRef: string | null; hasPinnedPreview?: boolean; occasion: string; explanation: string; createdAt: string; slots: Record<string, Garment>; originalSlots: Record<string, Garment> };

export function imageUrl(imageRef: string) {
  return "/api/files/" + encodeURIComponent(imageRef);
}

export class PlannerApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export async function api<T>(action: string, input: object = {}, signal?: AbortSignal): Promise<T> {
  const response = await privateFetch("/api/planner", {
    method: "POST",
    cache: "no-store",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, input }),
  });
  if (response.status === 401) throw new PlannerApiError(401, "Sign in to open your planner.");
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new PlannerApiError(response.status, error.message || "Your request could not be completed. Try again.");
  }
  return response.json();
}
