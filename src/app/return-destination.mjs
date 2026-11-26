const protectedPages = new Set([
  "/account", "/closet", "/planner",
  "/profile/details", "/profile/ready", "/profile/settings", "/profile/style",
  "/wardrobe/add", "/wardrobe/confirm",
]);

/** Return only a local Closet page, preserving its query and planner screen. */
export function returnDestination(value, origin) {
  if (typeof value !== "string" || !value || value.startsWith("//") || value.includes("\\")) return null;
  try {
    const url = new URL(value, origin);
    const path = url.pathname.replace(/\/$/, "").replace(/\.html$/, "");
    if (url.origin !== origin || url.username || url.password || !protectedPages.has(path)) return null;
    return path + url.search + url.hash;
  } catch {
    return null;
  }
}
