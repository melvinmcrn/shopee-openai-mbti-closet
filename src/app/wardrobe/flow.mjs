/** @typedef {{ from?: string | null, brief?: string | null }} WardrobeOrigin */

/** @param {{ get(name: string): string | null }} params */
export function wardrobeOrigin(params) {
  const from = params.get("from");
  if (from !== "planner" && from !== "closet" && from !== "onboarding") return {};
  const brief = params.get("brief");
  if (from === "planner" && brief && /^[1-9]\d{0,18}$/.test(brief)) return { from, brief };
  return { from };
}

/** @param {string} path @param {WardrobeOrigin} origin @param {URLSearchParams} [reviewParams] */
export function wardrobeHref(path, { from, brief }, reviewParams) {
  const params = new URLSearchParams(reviewParams);
  if (from) params.set("from", from);
  if (from === "planner" && brief) params.set("brief", brief);
  return params.size ? path + "?" + params : path;
}

/** @param {WardrobeOrigin} origin @param {string | null | undefined} setupCompletedAt */
export function wardrobeDestination({ from, brief }, setupCompletedAt) {
  if (from === "planner") {
    return brief
      ? { href: "/planner?brief=" + brief + "#compare", label: "Return to outfit" }
      : { href: "/planner", label: "Return to planner" };
  }
  if (from === "closet" || setupCompletedAt) return { href: "/closet", label: "Return to closet" };
  if (setupCompletedAt === null) return { href: "/profile/style", label: "Continue to style profile" };
  return null;
}
