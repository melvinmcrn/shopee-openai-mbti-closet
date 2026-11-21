const maxSourceBytes = 32 * 1024 * 1024;
const maxUploadBytes = 8 * 1024 * 1024;
// Leave room for the multipart envelope on deployments with a 4.5 MB request limit.
const maxPassthroughBytes = 4 * 1024 * 1024;
const extractionInputLimit = 1024;

const typesByExtension = new Map([
  ["heic", "image/heic"], ["heif", "image/heif"],
  ["jpg", "image/jpeg"], ["jpeg", "image/jpeg"], ["png", "image/png"], ["webp", "image/webp"],
]);
const imageTypes = new Set([...typesByExtension.values(), "image/heic-sequence", "image/heif-sequence"]);
export const photoAccept = [...imageTypes, ...Array.from(typesByExtension.keys(), (ext) => "." + ext)].join(",");
export const photoRequirements = "JPEG, PNG, WebP, or HEIC/HEIF · Up to 32 MB each";

async function decodePhoto(file, type) {
  try {
    return await createImageBitmap(file);
  } catch (error) {
    const isHeifContainer = await file.slice(4, 8).text() === "ftyp";
    if (!isHeifContainer && !type?.startsWith("image/hei") && !/\.hei[cf]$/i.test(file.name)) throw error;
    const { heicTo } = await import("heic-to/csp");
    return heicTo({ blob: file, type: "bitmap" });
  }
}

/** @param {File} file @returns {Promise<File>} */
export async function normalizeUpload(file) {
  const extension = file.name.match(/\.([^.]+)$/)?.[1].toLowerCase();
  const type = !file.type || file.type === "application/octet-stream"
    ? typesByExtension.get(extension)
    : file.type;
  if (!imageTypes.has(type) || file.size === 0 || file.size > maxSourceBytes) {
    throw new Error("Unsupported photo type or size");
  }

  if ((type === "image/jpeg" || type === "image/png") && file.size <= maxPassthroughBytes) {
    return type === file.type ? file : new File([file], file.name, { type, lastModified: file.lastModified });
  }

  const outputType = type === "image/webp" || type === "image/png" ? "image/png" : "image/jpeg";
  return convertPhoto(file, type, outputType, extractionInputLimit, maxUploadBytes);
}

export const profilePhotoAccept = "image/*,.heic,.heif,.avif,.jfif";
export const profilePhotoRequirements = "Choose a photo up to 32 MB.";

/** @param {File} file @returns {Promise<File>} */
export async function normalizeProfilePhoto(file) {
  if (!file.size) throw new Error("This photo is empty. Choose another photo.");
  if (file.size > maxSourceBytes) throw new Error(profilePhotoRequirements);

  try {
    return await convertPhoto(file, file.type, "image/jpeg", 1600, maxPassthroughBytes);
  } catch {
    throw new Error("This photo could not be read. Try exporting it as JPEG or PNG.");
  }
}

async function convertPhoto(file, type, outputType, maxDimension, maxBytes) {
  const bitmap = await decodePhoto(file, type);
  try {
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image conversion unavailable");
    if (outputType === "image/jpeg") {
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, outputType, 0.9));
    if (!blob || blob.type !== outputType || blob.size === 0 || blob.size > maxBytes) {
      throw new Error("Image conversion failed");
    }
    const suffix = outputType === "image/png" ? ".png" : ".jpg";
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + suffix, { type: outputType, lastModified: file.lastModified });
  } finally {
    bitmap.close();
  }
}
