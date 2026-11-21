import { deletePrivateFile, writePrivateFile } from "../private-files.mjs";
import { fileUrl } from "../wardrobe-files.mjs";

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

  const account = { id: userId };
  const uploads = await Promise.allSettled(missing.map(async (item) => {
    const bytes = await env.readSampleImage(item.slug);
    return { item, fileId: await writePrivateFile(env, account, bytes, "image/webp") };
  }));
  const files = uploads.filter(({ status }) => status === "fulfilled").map(({ value }) => value);
  let usedFiles = new Set();

  try {
    const failedUpload = uploads.find(({ status }) => status === "rejected");
    if (failedUpload) throw failedUpload.reason;

    const inserts = files.map(({ item, fileId }) => env.DB.prepare(`
      INSERT INTO wardrobe_items (user_id, name, category, garment_type, color, image_file_id, sample_slug)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (user_id, sample_slug) DO NOTHING
    `).bind(userId, item.name, item.category, item.type, item.color, fileId, item.slug));

    const results = await env.DB.batch([...inserts, sampleItems(env.DB, userId)]);
    const rows = results.at(-1).results;
    usedFiles = new Set(rows.map(({ image_file_id }) => image_file_id));
    return itemResponse(rows);
  } finally {
    // Concurrent requests can upload the same samples before one commits.
    // The file service checks references again before deleting any unused upload.
    await Promise.allSettled(files.filter(({ fileId }) => !usedFiles.has(fileId))
      .map(({ fileId }) => deletePrivateFile(env, account, fileId)));
  }
}
