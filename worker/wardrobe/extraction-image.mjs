import jpeg from "jpeg-js";
import { decode, encode, hasPngSignature } from "fast-png";

const maxSourcePixels = 24_000_000;
const maxPngPixels = 8_000_000;
const maxDimension = 1024;
const scale = 1000;

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

async function decodePng(bytes) {
  if (bytes.length < 33) throw new ExtractionImageError("The PNG photo could not be decoded.");
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = header.getUint32(16);
  const height = header.getUint32(20);
  const depth = bytes[24];
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[bytes[25]];
  if (width * height > maxPngPixels || width * height * depth * (channels ?? 1) > 256_000_000) {
    throw new ExtractionImageError("Choose a smaller PNG for automatic extraction.", 413);
  }
  if (!width || !height || !channels || (depth !== 8 && depth !== 16) || bytes[28] !== 0) {
    throw new ExtractionImageError("Choose a JPEG or a non-interlaced PNG for automatic extraction.");
  }

  const retained = [bytes.subarray(0, 8)];
  const idat = [];
  let ended = false;
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = header.getUint32(offset);
    const end = offset + length + 12;
    if (end > bytes.length) break;
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (type === "IHDR" && (offset !== 8 || length !== 13)) break;
    if (offset === 8 && type !== "IHDR") break;
    if (["IHDR", "IDAT", "tRNS", "IEND"].includes(type)) retained.push(bytes.subarray(offset, end));
    if (type === "IDAT") idat.push(bytes.subarray(offset + 8, end - 4));
    if (type === "IEND") {
      ended = length === 0;
      break;
    }
    offset = end;
  }
  if (!ended || !idat.length) throw new ExtractionImageError("The PNG photo could not be decoded.");

  // Check compressed data before letting the synchronous decoder allocate its full output.
  // Discard metadata chunks so compressed profiles and text are never decoded.
  const expected = (width * channels * depth / 8 + 1) * height;
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

export async function normalizePhoto(bytes) {
  let photo;
  try {
    photo = await readImage(bytes);
  } catch (error) {
    if (error instanceof ExtractionImageError) throw error;
    throw new ExtractionImageError("The photo could not be decoded for automatic extraction.");
  }

  const orientation = jpegOrientation(photo.exifBuffer);
  const rotated = orientation >= 5 && orientation <= 8;
  const orientedWidth = rotated ? photo.height : photo.width;
  const orientedHeight = rotated ? photo.width : photo.height;
  const ratio = Math.min(1, maxDimension / Math.max(orientedWidth, orientedHeight));
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

function drawRegion(mask, width, height, { outer, holes }) {
  const rings = [outer, ...holes].map((ring) =>
    ring.map(([x, y]) => [x * width / scale, y * height / scale]));
  const top = Math.max(0, Math.floor(Math.min(...rings[0].map(([, y]) => y))));
  const bottom = Math.min(height, Math.ceil(Math.max(...rings[0].map(([, y]) => y))));
  for (let row = top; row < bottom; row++) {
    const y = row + 0.5;
    const edges = [];
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [x1, y1] = ring[j];
        const [x2, y2] = ring[i];
        if ((y1 > y) !== (y2 > y)) edges.push(x1 + (y - y1) * (x2 - x1) / (y2 - y1));
      }
    }
    edges.sort((left, right) => left - right);
    for (let i = 0; i + 1 < edges.length; i += 2) {
      const start = Math.max(0, Math.ceil(edges[i] - 0.5));
      const end = Math.min(width, Math.ceil(edges[i + 1] - 0.5));
      mask.fill(1, row * width + start, row * width + end);
    }
  }
}

export function cutout(photo, regions) {
  const { data, width, height } = photo;
  const mask = new Uint8Array(width * height);
  for (const region of regions) drawRegion(mask, width, height, region);
  let garmentPixels = 0;
  for (let index = 0; index < mask.length; index++) {
    const offset = index * 4;
    if (mask[index]) garmentPixels += Number(data[offset + 3] > 0);
    else data.fill(0, offset, offset + 4);
  }
  if (garmentPixels < mask.length * 0.005 || garmentPixels > mask.length * 0.995) {
    throw new ExtractionImageError("The garment outline could not be used. You can review the original photo.", 422);
  }
  return encode(photo);
}
