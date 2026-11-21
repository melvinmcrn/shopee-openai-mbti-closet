import { readFile } from "node:fs/promises";
import { join } from "node:path";

export function readSampleImage(slug) {
  return readFile(join(process.cwd(), "public", "sample-wardrobe", slug + ".webp"));
}
