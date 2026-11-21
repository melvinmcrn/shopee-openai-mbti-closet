export type Garment = { id: string; name: string; color: string; category: string; imageRef: string };
export type Look = { id: string; occasion: string; explanation: string; slots: Record<string, string> };
export type Brief = { id?: string; occasion: string; timing: string; location: string; formality: string; comfort: string; preferences: string[] };
export type SavedLook = { id: string; occasion: string; explanation: string; createdAt: string; slots: Record<string, Garment>; originalSlots: Record<string, Garment> };

export function imageUrl(imageRef: string) {
  return "/api/files/" + encodeURIComponent(imageRef);
}

export async function api<T>(action: string, input: object = {}): Promise<T> {
  const response = await fetch("/api/planner", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, input }),
  });
  if (response.status === 401) throw new Error("Sign in to open your planner.");
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || "Your request could not be completed. Try again.");
  }
  return response.json();
}
