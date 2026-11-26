import type { Brief } from "./shared";

export const emptyBrief: Brief = { occasion: "", timing: "", location: "", formality: "", comfort: "", preferences: [] };
export type FormStage = "occasion" | "style";
type FormDraft = { stage: FormStage; brief: Brief };

function key(accountId: string) {
  return "closet:planner-fields:v1:" + accountId;
}

export function readForm(accountId: string, server: Brief | undefined): FormDraft | null {
  try {
    const data = JSON.parse(localStorage.getItem(key(accountId)) ?? "null");
    if (!data || !["occasion", "style"].includes(data.stage) || data.brief?.id !== server?.id ||
        data.brief?.version !== server?.version) return null;
    // Only text input is kept on this device. The server resolves photos and options for each visit.
    const brief = { ...(server ?? emptyBrief) };
    for (const field of ["occasion", "timing", "location", "formality", "comfort"] as const) {
      if (typeof data.brief[field] !== "string" || data.brief[field].length > 500) return null;
      brief[field] = data.brief[field];
    }
    return { stage: data.stage, brief };
  } catch {
    return null;
  }
}

export function writeForm(accountId: string, form: FormDraft | null) {
  try {
    if (form) localStorage.setItem(key(accountId), JSON.stringify(form));
    else localStorage.removeItem(key(accountId));
  } catch {
    // Signed-in milestones still work when browser storage is unavailable.
  }
}
