import { normalizeUpload } from "./normalize-upload.mjs";

export const maxBatchSize = 20;
// Leave room below Vercel's request-body limit for boundaries, headers and keys.
export const maxBatchImageBytes = 3_950_000;

const compressionSteps = [
  [1024, 0.87],
  [1024, 0.72],
  [896, 0.75],
  [768, 0.75],
  [640, 0.73],
  [512, 0.68],
  [384, 0.65],
  [256, 0.62],
];

/** @param {number[]} sizes @param {number} limit */
export function allocateImageBudgets(sizes, limit) {
  let remaining = limit;
  const sorted = sizes.map((size, index) => ({ size, index })).sort((a, b) => a.size - b.size);
  const budgets = Array(sizes.length);
  sorted.forEach(({ size, index }, offset) => {
    // Small photos keep the original bytes and free up room for larger ones.
    budgets[index] = Math.min(size, Math.floor(remaining / (sizes.length - offset)));
    remaining -= budgets[index];
  });
  return budgets;
}

/** @param {File} file @param {number} budget @returns {Promise<File>} */
async function compressImage(file, budget) {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Image preparation is unavailable");
    for (const [edge, quality] of compressionSteps) {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob?.type === "image/jpeg" && blob.size > 0 && blob.size <= budget) {
        return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: blob.type });
      }
    }
    throw new Error("Image does not fit in the batch");
  } finally {
    bitmap.close();
  }
}

/**
 * Prepare every photo before sending. Never drop entries or make a partial
 * upload if an individual file cannot be prepared.
 * @param {{draftKey: string, file: File, id: number | null}[]} batch
 * @returns {Promise<{draftKey: string, image?: File}[]>}
 */
export async function prepareWardrobeBatch(batch) {
  if (!batch.length || batch.length > maxBatchSize) {
    throw new Error(`Choose between 1 and ${maxBatchSize} photos to upload.`);
  }
  /** @type {{draftKey: string, image?: File}[]} */
  const entries = [];
  const sizes = [];
  for (const { draftKey, file, id } of batch) {
    try {
      // Existing drafts keep their image and only need the key for a retry.
      const image = id === null ? await normalizeUpload(file) : undefined;
      entries.push({ draftKey, image });
      sizes.push(image?.size ?? 0);
    } catch {
      throw new Error(`“${file.name}” could not be prepared. Remove it or choose a JPEG or PNG version. No photos were sent.`);
    }
  }
  if (sizes.reduce((total, size) => total + size, 0) <= maxBatchImageBytes) return entries;

  const budgets = allocateImageBudgets(sizes, maxBatchImageBytes);
  for (const [index, entry] of entries.entries()) {
    if (!entry.image || entry.image.size <= budgets[index]) continue;
    try {
      entry.image = await compressImage(entry.image, budgets[index]);
    } catch {
      throw new Error(`“${batch[index].file.name}” could not be reduced to fit in one upload. Choose a smaller version or fewer photos. No photos were sent.`);
    }
  }
  return entries;
}
