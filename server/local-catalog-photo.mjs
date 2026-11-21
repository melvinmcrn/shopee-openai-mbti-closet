import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { catalogPhotoKey } from "../src/app/api/_server/catalog-photo.mjs";

export async function readLocalCatalogPhoto(key) {
  if (!key || key !== catalogPhotoKey(key)) return null;
  try {
    return await readFile(join(process.cwd(), "Shopee Database", key));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
