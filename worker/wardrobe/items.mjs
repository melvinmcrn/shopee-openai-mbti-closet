import { fileUrl } from "../wardrobe-files.mjs";

const categories = new Set(["top", "bottom", "dress", "shoes", "outerwear", "accessory", "other"]);
const itemColumns = "id, name, category, garment_type, color, image_file_id, extraction_source";

function itemView(row) {
  return {
    id: row.id,
    name: row.name,
    ...(row.extraction_source ? { extractionSource: row.extraction_source } : {}),
    category: row.category,
    garmentType: row.garment_type,
    color: row.color,
    imageFileId: row.image_file_id,
    imageUrl: fileUrl(row.image_file_id),
  };
}

function error(message, status) {
  return Response.json({ error: message }, { status });
}

async function listItems(request, db, userId) {
  const status = new URL(request.url).searchParams.get("status") ?? "active";
  if (status !== "active" && status !== "draft") {
    return error("Invalid wardrobe status.", 400);
  }

  const confirmation = status === "active" ? "IS NOT NULL" : "IS NULL";
  const { results } = await db.prepare(`
    SELECT ${itemColumns}
    FROM wardrobe_items
    WHERE user_id = ? AND archived_at IS NULL AND confirmed_at ${confirmation}
    ORDER BY id DESC
  `).bind(userId).all();
  return Response.json({ items: results.map(itemView) });
}

async function updateItem(request, db, userId, itemId) {
  let data;
  try {
    data = await request.json();
  } catch {
    return error("Expected a JSON object.", 400);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return error("Expected a JSON object.", 400);
  }

  const { name, category, garmentType, color, confirm } = data;
  if (name !== undefined && (typeof name !== "string" || !name.trim())) {
    return error("Enter an item name.", 400);
  }
  if (category !== undefined && !categories.has(category)) {
    return error("Choose a valid item category.", 400);
  }
  if (garmentType !== undefined && garmentType !== null &&
      (typeof garmentType !== "string" || garmentType.trim().length > 80)) {
    return error("Enter a garment type up to 80 characters or leave it blank.", 400);
  }
  if (color !== undefined && color !== null && typeof color !== "string") {
    return error("Enter a color or leave it blank.", 400);
  }
  if (confirm !== undefined && confirm !== true) {
    return error("Set confirm to true to confirm an item.", 400);
  }
  if (name === undefined && category === undefined && garmentType === undefined && color === undefined && !confirm) {
    return error("Supply at least one item change.", 400);
  }

  const updated = await db.prepare(`
    UPDATE wardrobe_items
    SET name = COALESCE(?, name),
        category = COALESCE(?, category),
        garment_type = CASE WHEN ? THEN ? ELSE garment_type END,
        color = CASE WHEN ? THEN ? ELSE color END,
        confirmed_at = CASE WHEN ? THEN COALESCE(confirmed_at, CURRENT_TIMESTAMP) ELSE confirmed_at END
    WHERE user_id = ? AND id = ? AND archived_at IS NULL
    RETURNING ${itemColumns}
  `).bind(
    name?.trim() ?? null,
    category ?? null,
    garmentType === undefined ? 0 : 1,
    garmentType?.trim() || null,
    color === undefined ? 0 : 1,
    color?.trim() || null,
    confirm ? 1 : 0,
    userId,
    itemId,
  ).first();
  return updated ? Response.json({ item: itemView(updated) }) : error("Wardrobe item not found.", 404);
}

async function archiveItem(db, userId, itemId) {
  // Keep outfit references and let a retry of the same archive succeed.
  const archived = await db.prepare(`
    UPDATE wardrobe_items
    SET archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP)
    WHERE user_id = ? AND id = ?
    RETURNING id
  `).bind(userId, itemId).first();
  return archived ? new Response(null, { status: 204 }) : error("Wardrobe item not found.", 404);
}

export async function items(request, env, userId, id) {
  const { method } = request;
  if (id == null && method === "GET") {
    return listItems(request, env.DB, userId);
  }
  if (id == null || (method !== "PATCH" && method !== "DELETE")) {
    return new Response(null, { status: 405, headers: { Allow: id == null ? "GET" : "PATCH, DELETE" } });
  }

  const itemId = /^[1-9]\d*$/.test(id) ? Number(id) : NaN;
  if (!Number.isSafeInteger(itemId)) {
    return error("Wardrobe item not found.", 404);
  }
  if (method === "PATCH") {
    return updateItem(request, env.DB, userId, itemId);
  }
  return archiveItem(env.DB, userId, itemId);
}
