// Catalog references are trusted only inside this fixed namespace; user uploads have a separate prefix.
const catalogName = /^(?:clothes_image_database\/)?([a-zA-Z0-9][a-zA-Z0-9_-]{0,127}\.jpe?g)$/i;
const maxBytes = 5 * 1024 * 1024;

export function catalogPhotoKey(ocrImage) {
  if (typeof ocrImage !== "string") return null;
  const match = catalogName.exec(ocrImage);
  if (!match || match[0] !== ocrImage) return null;
  return "clothes_image_database/" + match[1];
}

function jpegPhoto(bytes) {
  if (!bytes || bytes.byteLength < 3 || bytes.byteLength > maxBytes) return null;
  const header = new Uint8Array(bytes.buffer ?? bytes, bytes.byteOffset ?? 0, 3);
  return header[0] === 255 && header[1] === 216 && header[2] === 255 ? new Blob([bytes], { type: "image/jpeg" }) : null;
}

export async function readCatalogPhoto(env, ocrImage, itemId) {
  const key = catalogPhotoKey(ocrImage);
  if (!key) return null;
  const object = await env.BUCKET.get(key);
  if (object) {
    if (object.size > maxBytes) return null;
    return jpegPhoto(await object.arrayBuffer());
  }
  if (!env.readCatalogFallback) return null;
  return jpegPhoto(await env.readCatalogFallback(key, itemId));
}

export async function readWorkerCatalogFallback(env, key, itemId, request = fetch) {
  if (key !== catalogPhotoKey(key) || !key) return null;
  let response;
  if (env.CATALOG_ASSETS) {
    const filename = key.slice("clothes_image_database/".length);
    response = await env.CATALOG_ASSETS.fetch("https://catalog.local/" + filename);
  } else {
    if (!itemId) return null;
    const row = await env.DB.prepare(
      "SELECT image_url FROM clothes_listing_details WHERE item_id=? AND ocr_image=?"
    ).bind(String(itemId), key).first();
    if (typeof row?.image_url !== "string" || !/^https:\/\/down-th\.img\.susercontent\.com\/file\/[A-Za-z0-9_-]+$/.test(row.image_url)) return null;
    response = await request(row.image_url, { redirect: "manual", signal: AbortSignal.timeout(8000) });
  }
  if (!response.ok || !response.body || Number(response.headers.get("content-length")) > maxBytes) return null;
  const chunks = [];
  let length = 0;
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new Blob(chunks).arrayBuffer();
}
