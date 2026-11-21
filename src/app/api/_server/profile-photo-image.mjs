export const maxProfilePhotoBytes = 8 * 1024 * 1024;

function matches(bytes, signature, offset = 0) {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

// Validate the container independently of the client or storage MIME type.
export async function profilePhotoType(blob) {
  if (!(blob instanceof Blob) || blob.size < 20 || blob.size > maxProfilePhotoBytes) return null;
  const header = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
  const view = new DataView(header.buffer);

  if (matches(header, [137, 80, 78, 71, 13, 10, 26, 10])) {
    if (blob.size < 45 || view.getUint32(8) !== 13 || !matches(header, [73, 72, 68, 82], 12) ||
      !view.getUint32(16) || !view.getUint32(20)) return null;
    const footer = new Uint8Array(await blob.slice(-12).arrayBuffer());
    return matches(footer, [0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]) ? "image/png" : null;
  }

  if (matches(header, [255, 216, 255])) {
    const footer = new Uint8Array(await blob.slice(-2).arrayBuffer());
    return matches(footer, [255, 217]) ? "image/jpeg" : null;
  }

  if (matches(header, [82, 73, 70, 70]) && matches(header, [87, 69, 66, 80], 8)) {
    const length = view.getUint32(4, true) + 8;
    const tag = String.fromCharCode(...header.subarray(12, 16));
    return ["VP8 ", "VP8L", "VP8X"].includes(tag) && length <= blob.size && length > 20 &&
      view.getUint32(16, true) <= length - 20 ? "image/webp" : null;
  }

  return null;
}
