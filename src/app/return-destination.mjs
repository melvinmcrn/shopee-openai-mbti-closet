const exportedPages = new Set([
  "/account", "/closet", "/planner",
  "/profile/details", "/profile/ready", "/profile/settings", "/profile/style",
  "/wardrobe/add", "/wardrobe/confirm",
]);

const reservedRoots = new Set(["api", "auth", "assets", "public", "sample-wardrobe", "index", "404", "offline"]);
const resourceExtension = /\.(?:avif|css|gif|html?|ico|jpe?g|js|json|map|mjs|png|svg|txt|webmanifest|webp|woff2?|xml)$/i;

function canonicalPath(pathname) {
  const path = pathname.replace(/\/$/, "");
  const page = path.endsWith(".html") && path.slice(0, -5);
  return page && exportedPages.has(page) ? page : path;
}

/** Exclude the app's asset and service URLs when the server sends its generic 404 document. */
export function isPublicResourcePath(pathname) {
  try {
    const path = decodeURI(canonicalPath(pathname));
    const root = path.split("/")[1] ?? "";
    return root.startsWith("_") || reservedRoots.has(root.toLowerCase()) || resourceExtension.test(path);
  } catch {
    return false;
  }
}

/** Return only a local app URL, preserving its query and planner screen. */
export function returnDestination(value, origin) {
  if (typeof value !== "string" || !(value.startsWith("/") || value.startsWith(origin + "/"))) return null;
  try {
    // Check the submitted path before URL parsing can normalize dot segments or backslashes.
    const relative = value.startsWith("/") ? value : value.slice(origin.length);
    const rawPath = relative.split(/[?#]/, 1)[0];
    const segments = rawPath.replace(/\/$/, "").slice(1).split("/").map(decodeURIComponent);
    if (segments.some(segment => !segment || segment === "." || segment === ".."
      || /[%/\\]|\p{Cc}/u.test(segment))) return null;
    const url = new URL(value, origin);
    if (url.origin !== origin || url.username || url.password || isPublicResourcePath(url.pathname)) return null;
    return canonicalPath(url.pathname) + url.search + url.hash;
  } catch {
    return null;
  }
}
