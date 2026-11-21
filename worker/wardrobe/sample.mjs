import { fileUrl, putFile } from "../wardrobe-files.mjs";

const samples = [
  { slug: "black-ribbed-tee", name: "Black ribbed tee", category: "top", type: "T-shirt", color: "Black" },
  { slug: "ivory-button-down", name: "Ivory button-down", category: "top", type: "Button-down shirt", color: "Ivory" },
  { slug: "indigo-straight-jeans", name: "Indigo straight-leg jeans", category: "bottom", type: "Jeans", color: "Indigo" },
  { slug: "charcoal-wide-leg-trousers", name: "Charcoal wide-leg trousers", category: "bottom", type: "Trousers", color: "Charcoal" },
  { slug: "sand-utility-jacket", name: "Sand utility jacket", category: "outerwear", type: "Utility jacket", color: "Sand" },
  { slug: "white-low-top-sneakers", name: "White low-top sneakers", category: "shoes", type: "Sneakers", color: "White" },
  { slug: "black-penny-loafers", name: "Black penny loafers", category: "shoes", type: "Loafers", color: "Black" },
];

function sampleItems(db, userId) {
  return db.prepare(`
    SELECT id, name, category, color, image_file_id, sample_slug, archived_at
    FROM wardrobe_items
    WHERE user_id = ? AND sample_slug IS NOT NULL
    ORDER BY id
  `).bind(userId);
}

function itemResponse(rows) {
  return Response.json({
    items: rows.filter((row) => row.archived_at === null).map((row) => ({
      id: row.id,
      name: row.name,
      category: row.category,
      color: row.color,
      imageFileId: row.image_file_id,
      imageUrl: fileUrl(row.image_file_id),
    })),
  });
}

export async function sample(_request, env, userId) {
  const { results: existing } = await sampleItems(env.DB, userId).all();
  const addedSlugs = new Set(existing.map((row) => row.sample_slug));
  const missing = samples.filter((item) => !addedSlugs.has(item.slug));
  if (missing.length === 0) return itemResponse(existing);

  const inserts = await Promise.all(missing.map(async (item) => {
    const path = `/sample-wardrobe/${item.slug}.webp`;
    const [, encodedImage] = SITE_ASSETS[path];
    const bytes = Uint8Array.from(atob(encodedImage), (byte) => byte.charCodeAt(0));
    const key = `users/${userId}/wardrobe/samples/${item.slug}.webp`;
    await putFile(env, userId, key, bytes, "image/webp");
    return env.DB.prepare(`
      INSERT INTO wardrobe_items (user_id, name, category, garment_type, color, image_file_id, sample_slug)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (user_id, sample_slug) DO NOTHING
    `).bind(userId, item.name, item.category, item.type, item.color, key, item.slug);
  }));

  // Deterministic keys let concurrent requests stage the same photos safely.
  // Commit rows only after all of their photos are present.
  const results = await env.DB.batch([...inserts, sampleItems(env.DB, userId)]);
  return itemResponse(results.at(-1).results);
}
