/**
 * @param {string} draftKey
 * @param {File} [image]
 */
export function requestWardrobeUpload(draftKey, image) {
  const body = new FormData();
  body.set("draftKey", draftKey);
  if (image) body.set("image", image);
  return fetch("/api/wardrobe/upload", { method: "POST", body });
}
