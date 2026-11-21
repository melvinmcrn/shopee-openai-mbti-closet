import { encode } from "fast-png";
import { readCutoutSheet } from "./extraction-image.mjs";

const glyphs = ["111101101101111", "010110010010111", "111001111100111", "111001111001111",
  "101101111001001", "111100111001111", "111100111101111", "111001001001001", "111101111101111", "111101111001111"];
const gap = 12;

export function sheetGrid(count) {
  if (!Number.isInteger(count) || count < 2 || count > 20) throw new RangeError("Invalid wardrobe batch size");
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
  const size = grid.tile - gap * 2;
  return slots.map((metadata, slot) => {
    if (!metadata) return null;
    const [left, top] = origin(grid, slot);
    const data = new Uint8Array(size * size * 4);
    let visible = 0;
    let clear = 0;
    for (let y = 0; y < size; y++) {
      const offset = ((top + gap + y) * grid.width + left + gap) * 4;
      const line = png.subarray(offset, offset + size * 4);
      data.set(line, y * size * 4);
      for (let i = 3; i < line.length; i += 4) {
        visible += Number(line[i] >= 128);
        clear += Number(line[i] === 0);
      }
    }
    if (visible < size * size * 0.005 || clear < size * size * 0.005) return null;
    return { ...metadata, png: encode({ width: size, height: size, data }) };
  });
}
