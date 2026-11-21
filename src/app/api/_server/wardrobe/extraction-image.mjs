import jpeg from "jpeg-js";
import { convertIndexedToRgb, decode, hasPngSignature } from "fast-png";

const maxSourcePixels = 24_000_000;
const maxPngPixels = 8_000_000;
const maxDimension = 1024;
export const maxCutoutBytes = 8 * 1024 * 1024;
const maxCutoutDimension = 1536;
const maxCutoutPixels = 1024 * 1536;
const maxCutoutChunks = 4096;

export class ExtractionImageError extends Error {
  constructor(message, status = 415) {
    super(message);
    this.status = status;
  }
}

function jpegOrientation(exif) {
  if (!exif || exif.length < 14) return 1;
  const view = new DataView(exif.buffer, exif.byteOffset, exif.byteLength);
  // jpeg-js preserves the Exif header without the trailing zero byte.
  const offset = exif[0] === 0 ? 1 : 0;
  const littleEndian = exif[offset] === 0x49 && exif[offset + 1] === 0x49;
  const bigEndian = exif[offset] === 0x4d && exif[offset + 1] === 0x4d;
  if ((!littleEndian && !bigEndian) || view.getUint16(offset + 2, littleEndian) !== 42) return 1;
  const ifd = offset + view.getUint32(offset + 4, littleEndian);
  if (ifd + 2 > exif.length) return 1;
  const entries = view.getUint16(ifd, littleEndian);
  for (let index = ifd + 2; index < ifd + 2 + entries * 12 && index + 12 <= exif.length; index += 12) {
    if (view.getUint16(index, littleEndian) === 0x0112) {
      return view.getUint16(index + 8, littleEndian);
    }
  }
  return 1;
}

function sourcePoint(x, y, width, height, orientation) {
  switch (orientation) {
    case 2: return [width - 1 - x, y];
    case 3: return [width - 1 - x, height - 1 - y];
    case 4: return [x, height - 1 - y];
    case 5: return [y, x];
    case 6: return [y, height - 1 - x];
    case 7: return [width - 1 - y, height - 1 - x];
    case 8: return [width - 1 - y, x];
    default: return [x, y];
  }
}

async function decodePng(bytes, validateCutout = false, expectedSheet) {
  if (bytes.length < 33) throw new ExtractionImageError("The PNG photo could not be decoded.");
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = header.getUint32(16);
  const height = header.getUint32(20);
  const depth = bytes[24];
  const color = bytes[25];
  const indexed = validateCutout && color === 3;
  const channels = indexed ? 1 : { 0: 1, 2: 3, 4: 2, 6: 4 }[color];
  if (expectedSheet && (width !== expectedSheet.width || height !== expectedSheet.height)) {
    throw new ExtractionImageError("Unexpected cutout sheet dimensions.");
  }
  if (validateCutout && !expectedSheet && (width > maxCutoutDimension || height > maxCutoutDimension ||
      width * height > maxCutoutPixels)) {
    throw new ExtractionImageError("Invalid cutout dimensions.");
  }
  if (width * height > maxPngPixels || width * height * depth * (channels ?? 1) > 256_000_000) {
    throw new ExtractionImageError("Choose a smaller PNG for automatic extraction.", 413);
  }
  const validDepth = indexed ? [1, 2, 4, 8].includes(depth) : depth === 8 || depth === 16;
  if (!width || !height || !channels || !validDepth || bytes[28] !== 0) {
    throw new ExtractionImageError("Choose a JPEG or a non-interlaced PNG for automatic extraction.");
  }

  const retained = [bytes.subarray(0, 8)];
  const idat = [];
  let ended = false;
  let chunks = 0;
  let paletteLength = 0;
  let transparency = false;
  for (let offset = 8; offset + 12 <= bytes.length;) {
    if (validateCutout && ++chunks > maxCutoutChunks) break;
    const length = header.getUint32(offset);
    const end = offset + length + 12;
    if (end > bytes.length) break;
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (type === "IHDR" && (offset !== 8 || length !== 13)) break;
    if (offset === 8 && type !== "IHDR") break;
    if (validateCutout) {
      if (["acTL", "fcTL", "fdAT"].includes(type)) break;
      if (type === "PLTE" && indexed) {
        if (idat.length || paletteLength || !length || length % 3 || length / 3 > 2 ** depth) break;
        paletteLength = length / 3;
        retained.push(bytes.subarray(offset, end));
      }
      if (type === "tRNS") {
        if (transparency || idat.length || (indexed
          ? !length || length > paletteLength
          : (channels !== 1 && channels !== 3) || length !== channels * 2)) break;
        transparency = true;
      }
    }
    if (["IHDR", "IDAT", "tRNS", "IEND"].includes(type)) retained.push(bytes.subarray(offset, end));
    if (type === "IDAT") idat.push(bytes.subarray(offset + 8, end - 4));
    if (type === "IEND") {
      ended = length === 0 && (!validateCutout || end === bytes.length);
      break;
    }
    offset = end;
  }
  if (!ended || !idat.length || (indexed && !paletteLength)) {
    throw new ExtractionImageError("The PNG photo could not be decoded.");
  }

  // Check compressed data before letting the synchronous decoder allocate its full output.
  // Discard metadata chunks so compressed profiles and text are never decoded.
  const expected = (Math.ceil(width * channels * depth / 8) + 1) * height;
  const reader = new Blob(idat).stream().pipeThrough(new DecompressionStream("deflate")).getReader();
  let inflated = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    inflated += value.byteLength;
    if (inflated > expected) {
      await reader.cancel();
      throw new ExtractionImageError("The PNG photo could not be decoded.");
    }
  }
  if (inflated !== expected) throw new ExtractionImageError("The PNG photo could not be decoded.");
  return decode(new Uint8Array(await new Blob(retained).arrayBuffer()), { checkCrc: true });
}

async function readImage(bytes) {
  if (hasPngSignature(bytes)) return decodePng(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return {
      ...jpeg.decode(bytes, {
        useTArray: true,
        maxResolutionInMP: maxSourcePixels / 1_000_000,
        maxMemoryUsageInMB: 72,
        tolerantDecoding: false,
      }),
      channels: 4,
      depth: 8,
    };
  }
  throw new ExtractionImageError("Automatic extraction accepts JPEG and PNG photos. You can review this photo manually.");
}

export async function normalizePhoto(bytes, dimension = maxDimension) {
  let photo;
  try {
    photo = await readImage(bytes);
  } catch (error) {
    if (error instanceof ExtractionImageError) throw error;
    throw new ExtractionImageError("The photo could not be decoded for automatic extraction.");
  }

  return normalizedPixels(photo, dimension);
}

function normalizedPixels(photo, dimension) {
  const orientation = jpegOrientation(photo.exifBuffer);
  const rotated = orientation >= 5 && orientation <= 8;
  const orientedWidth = rotated ? photo.height : photo.width;
  const orientedHeight = rotated ? photo.width : photo.height;
  const ratio = Math.min(1, dimension / Math.max(orientedWidth, orientedHeight));
  const width = Math.max(1, Math.round(orientedWidth * ratio));
  const height = Math.max(1, Math.round(orientedHeight * ratio));
  const data = new Uint8Array(width * height * 4);
  const grayscale = photo.channels <= 2;
  const divisor = photo.depth === 16 ? 257 : 1;
  for (let y = 0; y < height; y++) {
    const sourceY = Math.floor(y * orientedHeight / height);
    for (let x = 0; x < width; x++) {
      const sourceX = Math.floor(x * orientedWidth / width);
      const [col, row] = sourcePoint(sourceX, sourceY, photo.width, photo.height, orientation);
      const source = (row * photo.width + col) * photo.channels;
      const target = (y * width + x) * 4;
      const red = photo.data[source];
      const green = grayscale ? red : photo.data[source + 1];
      const blue = grayscale ? red : photo.data[source + 2];
      let alpha = photo.channels % 2 === 0 ? photo.data[source + photo.channels - 1] : 255 * divisor;
      if (photo.transparency?.[0] === red &&
          (grayscale || (photo.transparency[1] === green && photo.transparency[2] === blue))) alpha = 0;
      data[target] = Math.round(red / divisor);
      data[target + 1] = Math.round(green / divisor);
      data[target + 2] = Math.round(blue / divisor);
      data[target + 3] = Math.round(alpha / divisor);
    }
  }
  return { width, height, data };
}

// Decode only to check the image. The caller stores the provider's original bytes.
export async function validateCutoutPng(bytes) {
  if (bytes.length < 33 || bytes.length > maxCutoutBytes || !hasPngSignature(bytes)) {
    throw new ExtractionImageError("Invalid cutout PNG.");
  }
  const png = await decodePng(bytes, true);
  const { width, height, data, channels, depth, palette, transparency } = png;
  const half = depth === 16 ? 32768 : 128;
  let transparent = 0;
  let solid = 0;
  if (palette) {
    const stride = Math.ceil(width * depth / 8);
    const indexMask = (1 << depth) - 1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const bit = x * depth;
        const index = (data[y * stride + (bit >> 3)] >> (8 - depth - (bit % 8))) & indexMask;
        if (!palette[index]) throw new ExtractionImageError("Invalid cutout palette index.");
        const alpha = palette[index][3] ?? 255;
        transparent += Number(alpha === 0);
        solid += Number(alpha >= 128);
      }
    }
  } else if (channels === 2 || channels === 4) {
    for (let i = channels - 1; i < data.length; i += channels) {
      transparent += Number(data[i] === 0);
      solid += Number(data[i] >= half);
    }
  } else if (transparency) {
    for (let i = 0; i < data.length; i += channels) {
      if (data[i] === transparency[0] && (channels === 1 ||
          (data[i + 1] === transparency[1] && data[i + 2] === transparency[2]))) transparent++;
      else solid++;
    }
  }

  // A real cutout needs both visible fabric and a genuinely transparent background.
  const minPixels = Math.ceil(png.width * png.height * 0.005);
  return transparent >= minPixels && solid >= minPixels;
}


// Batch edits are cropped from the provider's existing alpha pixels, not masked.
export async function readCutoutSheet(bytes, width, height) {
  if (bytes.length < 33 || bytes.length > maxCutoutBytes || !hasPngSignature(bytes)) {
    throw new ExtractionImageError("Invalid cutout sheet PNG.");
  }
  const png = await decodePng(bytes, true, { width, height });
  if (png.palette?.[0]?.length === 4) return convertIndexedToRgb(png);
  if (png.channels === 4 && png.depth === 8) return png.data;
  if (png.transparency || png.channels % 2 === 0) return normalizedPixels(png, Math.max(width, height)).data;
  throw new ExtractionImageError("Expected a transparent cutout sheet.");
}
