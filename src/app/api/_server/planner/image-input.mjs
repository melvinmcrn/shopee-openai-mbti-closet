const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
export const supportedTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export function hasSignature(bytes, signature, offset = 0) {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

export function sourceType(blob, bytes) {
  const declared = blob.type.split(";")[0].trim();
  if (supportedTypes.has(declared)) return declared;
  if (hasSignature(bytes, pngSignature)) return "image/png";
  if (hasSignature(bytes, [255, 216, 255])) return "image/jpeg";
  if (hasSignature(bytes, [82, 73, 70, 70]) && hasSignature(bytes, [87, 69, 66, 80], 8)) return "image/webp";
  if (hasSignature(bytes, [71, 73, 70, 56])) return "image/gif";
  return null;
}

export async function dataUrl(blob) {
  if (!(blob instanceof Blob) || !blob.size) throw new Error();
  const bytes = new Uint8Array(await blob.arrayBuffer());

  let base64 = "";
  // Multiples of three keep the independently encoded chunks aligned.
  const chunkSize = 24 * 1024;
  for (let start = 0; start < bytes.length; start += chunkSize) {
    base64 += btoa(String.fromCharCode(...bytes.subarray(start, start + chunkSize)));
  }
  return "data:" + blob.type + ";base64," + base64;
}
