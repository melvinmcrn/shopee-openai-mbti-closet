const maxImageBytes = 8 * 1024 * 1024;
const extractionInputLimit = 1024;

// The Worker masks normalized JPEG/PNG pixels. Convert WebP locally so both
// the image sent for analysis and the saved cutout use the same coordinates.
/** @param {File} file @returns {Promise<File>} */
export async function normalizeUpload(file) {
  if (file.type !== "image/webp") return file;

  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, extractionInputLimit / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image conversion unavailable");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob || blob.type !== "image/png" || blob.size === 0 || blob.size > maxImageBytes) {
      throw new Error("Image conversion failed");
    }
    return new File([blob], file.name.replace(/\.webp$/i, "") + ".png", { type: "image/png" });
  } finally {
    bitmap.close();
  }
}

