import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const app = new URL("../src/app/", import.meta.url);
const read = (path) => readFileSync(new URL(path, app), "utf8");
const css = read("globals.css");
const palette = Object.fromEntries(
  [...css.matchAll(/--palette-([\w-]+):\s*(#[\da-f]+);/gi)].map(([, name, hex]) => [name, hex]),
);

function luminance(hex) {
  assert.match(hex, /^#(?:[\da-f]{3}|[\da-f]{6})$/i);
  const rgb = hex.slice(1).length === 3 ? [...hex.slice(1)].map((digit) => digit.repeat(2)) : hex.slice(1).match(/../g);
  return rgb.reduce((sum, channel, index) => {
    const s = parseInt(channel, 16) / 255;
    return sum + [0.2126, 0.7152, 0.0722][index] * (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4);
  }, 0);
}

function contrast(foreground, background) {
  const a = luminance(palette[foreground]);
  const b = luminance(palette[background]);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test("primary actions use white large text on the shared coral in both states", () => {
  assert.equal(palette.primary.toLowerCase(), "#ef5b5b");
  assert.match(palette["on-primary"], /^#(?:fff|ffffff)$/i);
  assert.match(css, /@layer utilities\s*{\s*\.bg-primary\.text-on-primary\s*{\s*font-size: 1\.25rem;\s*font-weight: 700;/);
  for (const background of ["primary", "primary-hover"]) {
    assert.ok(contrast("on-primary", background) >= 3, background);
    assert.match(css, new RegExp(`--color-${background}: var\\(--palette-${background}\\);`));
  }
  assert.match(css, /--color-on-primary: var\(--palette-on-primary\);/);
});

test("app screens take their colors and heading typography from the global theme", () => {
  const classColorOverride = /\b(?:bg|text|border|outline|accent|ring|fill|stroke|divide)(?:-[tblrxy])?-(?:\[(?:#|rgba?\(|hsla?\(|oklch\()|(?:white|black|neutral|red|green|gray|stone|zinc|slate|orange|purple|pink)\b)/;
  for (const file of readdirSync(app, { recursive: true }).filter((entry) => entry.endsWith(".tsx"))) {
    const screen = read(file);
    assert.doesNotMatch(screen, classColorOverride, file);
    assert.doesNotMatch(screen, /\b(?:fill|stroke|color)="#[\da-f]+"/i, file);
    assert.doesNotMatch(screen, /\bfont-serif\b/, file);
    assert.doesNotMatch(screen, /\bdark:(?:bg|text|border)-/, file);
  }
});

test("the main flows share the same primary action colors and label style", () => {
  for (const file of [
    "google-account.tsx",
    "closet/page.tsx",
    "planner/home.tsx",
    "planner/occasion.tsx",
    "planner/style.tsx",
    "planner/compare.tsx",
    "planner/refine.tsx",
    "planner/saved-list.tsx",
    "planner/detail.tsx",
    "planner/wear.tsx",
    "profile/ready/page.tsx",
    "account/page.tsx",
    "profile/style/page.tsx",
    "wardrobe/add/page.tsx",
    "wardrobe/confirm/page.tsx",
  ]) {
    assert.match(read(file), /\bbg-primary [^"\x60]*\btext-on-primary\b/, file);
  }
});
