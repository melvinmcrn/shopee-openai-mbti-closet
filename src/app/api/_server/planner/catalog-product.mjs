import { retainedBaseCategories } from "./wardrobe-completion.mjs";

export function listingUrl({ url, shop_id, item_id }) {
  if (!/^\d+$/.test(shop_id) || !/^\d+$/.test(item_id)) return null;
  try {
    const link = new URL(url);
    if (link.origin !== "https://shopee.co.th" || link.username || link.password) return null;
    if (link.pathname === `/product/${shop_id}/${item_id}` || link.pathname.endsWith(`-i.${shop_id}.${item_id}`)) {
      return link.href;
    }
  } catch {
    // A listing without a usable purchase link is ineligible.
  }
  return null;
}

export function catalogProduct(row) {
  const url = row?.item_id && listingUrl(row);
  return url ? {
    id: row.item_id, title: row.title, url,
    imageUrl: row.imageUrl, category: row.searchTerm, price: row.price, currency: row.currency,
    searchGroup: row.searchGroup, searchTerm: row.searchTerm, ocrImage: row.ocrImage,
  } : null;
}

export function enhancementSelection(slots, gap, coverage) {
  const items = Object.entries(slots)
    .map(([slot, item]) => [slot, String(item.id)])
    .sort(([a], [b]) => a.localeCompare(b));
  if (!coverage) return JSON.stringify(gap ? [gap, items] : items);
  return JSON.stringify(["photo", coverage.top, coverage.bottom, coverage.dress, coverage.shoes, coverage.outerwear, gap, items]);
}

export const productColumns = `product.item_id, product.shop_id, product.name AS title, product.url,
  product.search_term AS searchTerm, product.search_group AS searchGroup, product.ocr_image AS ocrImage,
  product.price, product.currency, product.image_url AS imageUrl`;

// Older picks store only the product ID. Its original catalog search identifies that listing.
export function listingJoin(source, idColumn, hasSearch = true) {
  const group = hasSearch ? `COALESCE(${source}.search_group, original.search_group)` : "original.search_group";
  const term = hasSearch ? `COALESCE(${source}.search_term, original.search_term)` : "original.search_term";
  return `LEFT JOIN clothes_image_database original ON original.item_id = ${source}.${idColumn}
    LEFT JOIN clothes_catalog product ON product.item_id = original.item_id
      AND product.search_group = ${group} AND product.search_term = ${term} AND trim(product.ocr_image) <> ''`;
}

export const catalogTerms = {
  top: ["men shirt", "men sweater", "men tank top", "women sweater", "women tank top"],
  bottom: ["business men pants", "business women pants", "men pants", "women pants", "men shorts", "women shorts", "women skirt"],
  shoes: ["men shoes", "sneaker", "women shoes", "women high heels"],
  outerwear: ["men jacket"],
  accessory: ["men fashion accessories", "men necklace", "men watch", "women fashion accessories", "women necklace", "women earrings", "women watch"],
};

export function shoppingIntents(slots, garments, base) {
  const coverage = retainedBaseCategories(base, slots);
  const owns = category => garments.some(item => item.category === category);
  const top = slots.top || coverage?.top;
  const bottom = slots.bottom || coverage?.bottom;
  const dress = slots.dress || coverage?.dress || (coverage && !top && !bottom && owns("dress"));
  const gaps = [];
  if (!dress && !top && !owns("top")) gaps.push("top");
  if (!dress && !bottom && !owns("bottom")) gaps.push("bottom");
  if (!coverage) return gaps.length ? gaps : [null];
  if (coverage.top && coverage.bottom && !slots.outerwear && !coverage.outerwear) gaps.push("outerwear");
  if (!slots.shoes && !coverage.shoes && !owns("shoes")) gaps.push("shoes");
  return gaps.length ? gaps : [null];
}

// Load saved and draft decisions together so the list can display a try-on that
// finished before a look was saved. A hidden saved suggestion overrides its draft.
export async function readSavedProducts(db, accountId, selectionsByLook, coverageByLook = {}) {
  const { results: owned } = await db.prepare(`
    SELECT DISTINCT category FROM wardrobe_items WHERE user_id = ? AND confirmed_at IS NOT NULL
      AND archived_at IS NULL AND image_file_id IS NOT NULL AND category IN ('top','bottom','dress','shoes')
  `).bind(accountId).all();
  const targets = {};
  for (const [id, selection] of Object.entries(selectionsByLook)) {
    const slots = Object.fromEntries(JSON.parse(selection).map(([slot, item]) => [slot, { id: item }]));
    const coverage = coverageByLook[id];
    for (const gap of shoppingIntents(slots, owned, coverage)) {
      (targets[id] ??= {})[enhancementSelection(slots, gap, coverage)] = gap;
    }
    targets[id] ??= {};
  }
  const selections = [...new Set(Object.values(targets).flatMap(Object.keys))];
  const loadPicks = (hasSearch, hasGap) => db.prepare(`
    WITH targets AS (
      SELECT look.id, look.user_id, look.source_option_id FROM json_each(?) AS slot
      JOIN saved_looks look ON look.id = CAST(slot.key AS BIGINT) WHERE look.user_id = ?
    ), picks AS (
      SELECT t.id AS look_id, s.catalog_item_id AS item_id, s.hidden_at, ${hasGap ? "s.wardrobe_gap" : "CAST(NULL AS TEXT)"} AS wardrobe_gap,
        ${hasSearch ? "s.search_group, s.search_term" : "CAST(NULL AS TEXT) AS search_group, CAST(NULL AS TEXT) AS search_term"},
        CAST(NULL AS TEXT) AS selection, CASE WHEN s.catalog_item_id IS NULL THEN 1 ELSE 2 END AS saved
      FROM targets t JOIN shopping_suggestions s ON s.saved_look_id = t.id
      WHERE s.catalog_item_id IS NOT NULL OR s.hidden_at IS NOT NULL
      UNION ALL
      SELECT t.id, e.item_id, NULL, NULL, ${hasSearch ? "e.search_group, e.search_term" : "NULL, NULL"}, e.selection, 0
      FROM targets t JOIN outfit_enhancements e ON e.option_id = t.source_option_id AND e.user_id = t.user_id
      WHERE e.selection IN (SELECT value FROM json_each(?))
    )
    SELECT picks.look_id, picks.hidden_at, picks.wardrobe_gap, picks.selection, picks.saved, ${productColumns}
    FROM picks ${listingJoin("picks", "item_id")} ORDER BY picks.saved DESC
  `).bind(JSON.stringify(selectionsByLook), accountId, JSON.stringify(selections)).all();
  let rows;
  try {
    rows = (await loadPicks(true, true)).results;
  } catch (error) {
    // Saved looks are also readable on databases predating the catalog pick and gap migrations.
    if (!/no such column: [es]\.(search_group|search_term|wardrobe_gap)|column [es]\.(search_group|search_term|wardrobe_gap) does not exist/i.test(error.message)) throw error;
    try { rows = (await loadPicks(false, true)).results; }
    catch (legacyError) {
      if (!/no such column: s\.wardrobe_gap|column s\.wardrobe_gap does not exist/i.test(legacyError.message)) throw legacyError;
      rows = (await loadPicks(false, false)).results;
    }
  }

  const picks = new Map();
  for (const row of rows) {
    const id = String(row.look_id);
    const targetsForLook = targets[id];
    const gap = row.saved ? row.wardrobe_gap : targetsForLook[row.selection];
    if (gap === undefined || (gap && !Object.values(targetsForLook).includes(gap))) continue;
    if (!picks.has(id)) picks.set(id, new Map());
    if (!picks.get(id).has(gap)) picks.get(id).set(gap, row);
  }
  const products = new Map();
  for (const [id, byGap] of picks) {
    const selected = [];
    for (const [gap, row] of byGap) {
      const item = !row.hidden_at && catalogProduct(row);
      if (item) selected.push(gap ? { ...item, wardrobeGap: gap } : item);
    }
    products.set(id, selected);
  }
  return products;
}
