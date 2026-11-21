import { encode } from "fast-png";
import { readCutoutSheet } from "./extraction-image.mjs";

const glyphs = ["111101101101111", "010110010010111", "111001111100111", "111001111001111",
  "101101111001001", "111100111001111", "111100111101111", "111001001001001", "111101111101111", "111101111001111"];
const gap = 12;

export function sheetGrid(count) {
  if (!Number.isInteger(count) || count < 1 || count > 20) throw new RangeError("Invalid wardrobe batch size");
  if (count === 1) return { columns: 1, rows: 1, tile: 1024, count, width: 1024, height: 1024 };
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  const tile = count === 2 ? 608 : Math.min(512, Math.floor(1440 / rows / 16) * 16);
  return { columns, rows, tile, count, width: columns * tile, height: rows * tile };
}

function origin(grid, slot) {
  return [(slot % grid.columns) * grid.tile, Math.floor(slot / grid.columns) * grid.tile];
}

export function sourceSheet(photos, grid) {
  const data = new Uint8Array(grid.width * grid.height * 4).fill(255);
  const ink = Uint8Array.of(20, 27, 39, 255);
  photos.forEach((photo, slot) => {
    const [left, top] = origin(grid, slot);
    const available = grid.tile - 2 * gap;
    const scale = Math.min(available / photo.width, (available - 26) / photo.height);
    const width = Math.max(1, Math.floor(photo.width * scale));
    const height = Math.max(1, Math.floor(photo.height * scale));
    const x = left + Math.floor((grid.tile - width) / 2);
    const y = top + 26 + Math.floor((grid.tile - 26 - height) / 2);
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        const from = (Math.floor(r * photo.height / height) * photo.width + Math.floor(c * photo.width / width)) * 4;
        const to = ((y + r) * grid.width + x + c) * 4;
        const alpha = photo.data[from + 3] / 255;
        for (let channel = 0; channel < 3; channel++) {
          data[to + channel] = 255 - (255 - photo.data[from + channel]) * alpha;
        }
      }
    }
    [...String(slot + 1)].forEach((digit, index) => {
      for (let i = 0; i < 15; i++) {
        if (glyphs[Number(digit)][i] === "0") continue;
        for (let dy = 0; dy < 3; dy++) {
          for (let dx = 0; dx < 3; dx++) {
            const row = top + 8 + Math.floor(i / 3) * 3 + dy;
            const col = left + gap + index * 12 + (i % 3) * 3 + dx;
            data.set(ink, (row * grid.width + col) * 4);
          }
        }
      }
    });
  });
  return { data, width: grid.width, height: grid.height };
}

function cropCutout(png, stride, left, top, right, bottom) {
  const width = right - left + 1 + 2 * gap;
  const height = bottom - top + 1 + 2 * gap;
  const data = new Uint8Array(width * height * 4);
  for (let y = top; y <= bottom; y++) {
    let from = (y * stride + left) * 4;
    let to = ((y - top + gap) * width + gap) * 4;
    for (let x = left; x <= right; x++, from += 4, to += 4) {
      if (!png[from + 3]) continue;
      data[to] = png[from];
      data[to + 1] = png[from + 1];
      data[to + 2] = png[from + 2];
      data[to + 3] = png[from + 3];
    }
  }
  return encode({ width, height, data });
}

function splitPhoto(png, grid, slot, garments) {
  if (!garments) return null;
  const [left, top] = origin(grid, slot);
  const columns = Math.max(1, Math.ceil(Math.sqrt(garments.length)));
  const rows = Math.max(1, Math.ceil(garments.length / columns));
  const items = [];
  for (let index = 0; index < columns * rows; index++) {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const x = left + Math.floor(grid.tile * col / columns);
    const y = top + Math.floor(grid.tile * row / rows);
    const width = left + Math.floor(grid.tile * (col + 1) / columns) - x;
    const height = top + Math.floor(grid.tile * (row + 1) / rows) - y;
    const garment = garments[index];
    let visible = 0;
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let dy = 0; dy < height; dy++) {
      const offset = ((y + dy) * grid.width + x) * 4;
      const line = png.subarray(offset, offset + width * 4);
      for (let dx = 0; dx < width; dx++) {
        const alpha = line[dx * 4 + 3];
        if (alpha === 0) continue;
        if (!garment || dx < gap || dy < gap || dx >= width - gap || dy >= height - gap) return null;
        minX = Math.min(minX, dx);
        maxX = Math.max(maxX, dx);
        minY = Math.min(minY, dy);
        maxY = dy;
        if (alpha >= 128) visible++;
      }
    }
    if (!garment) continue;
    if (visible < width * height * 0.005) return null;
    const cropped = cropCutout(png, grid.width, x + minX, y + minY, x + maxX, y + maxY);
    // Tight crops make exact duplicates detectable even if the provider translated one.
    if (items.some(({ png }) => png.length === cropped.length && png.every((byte, i) => byte === cropped[i]))) return null;
    items.push({ ...garment, png: cropped });
  }
  return items;
}

export async function splitCutoutSheet(bytes, grid, slots) {
  const png = await readCutoutSheet(bytes, grid.width, grid.height);
  // A marked, moved or overlapping sheet cannot be mapped by its grid.
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const slot = Math.floor(y / grid.tile) * grid.columns + Math.floor(x / grid.tile);
      const a = png[(y * grid.width + x) * 4 + 3];
      if (a === 0) continue;
      const tx = x % grid.tile;
      const ty = y % grid.tile;
      if (slot >= grid.count || tx < gap || ty < gap || tx >= grid.tile - gap || ty >= grid.tile - gap) {
        throw new Error("Sheet content crosses a slot boundary");
      }
    }
  }
  return slots.map((garments, slot) => splitPhoto(png, grid, slot, garments));
}
