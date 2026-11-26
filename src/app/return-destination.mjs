const exportedPages = new Set([
  "/account", "/closet", "/planner",
  "/profile/details", "/profile/ready", "/profile/settings", "/profile/style",
  "/wardrobe/add", "/wardrobe/confirm",
]);

const reservedRoots = new Set(["api", "auth", "assets", "public", "sample-wardrobe", "index", "404", "offline"]);

/** Return only a local app URL, preserving its query and planner screen. */
export function returnDestination(value, origin) {
  if (typeof value !== "string" || !(value.startsWith("/") || value.startsWith(origin + "/"))
    || value.startsWith("//") || value.includes("\\")) return null;
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin || url.username || url.password) return null;
    let path = url.pathname.replace(/\/$/, "");
    if (path.endsWith(".html") && exportedPages.has(path.slice(0, -5))) path = path.slice(0, -5);
    // Inspect decoded segments so an encoded service name or slash cannot change the destination.
    const segments = path.slice(1).split("/").map(decodeURIComponent);
    if (segments[0].startsWith("_") || reservedRoots.has(segments[0].toLowerCase())
      || segments.some(segment => !segment || /[.%/\\]|\p{Cc}/u.test(segment))) return null;
    return path + url.search + url.hash;
  } catch {
    return null;
  }
}
