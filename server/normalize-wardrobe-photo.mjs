import { ExtractionImageError, normalizePhoto } from "../src/app/api/_server/wardrobe/extraction-image.mjs";

export async function normalizeWardrobePhoto(bytes, dimension = 1024) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    return normalizePhoto(bytes, dimension);
  }

  // Shrink camera JPEGs during native decode, before allocating the RGBA pixels.
  const { default: sharp } = await import("sharp");
  try {
    const { data, info } = await sharp(bytes, { limitInputPixels: 64_000_000 })
      .autoOrient()
      .resize({ width: dimension, height: dimension, fit: "inside", withoutEnlargement: true })
      .toColourspace("srgb")
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return { width: info.width, height: info.height, data };
  } catch {
    throw new ExtractionImageError("The JPEG could not be decoded for automatic extraction.");
  }
}
