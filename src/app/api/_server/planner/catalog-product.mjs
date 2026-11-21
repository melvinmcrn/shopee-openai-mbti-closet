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
    imageUrl: row.imageUrl, category: row.category, price: row.price, currency: row.currency,
  } : null;
}

export function enhancementSelection(slots, gap) {
  const items = Object.entries(slots)
    .map(([slot, item]) => [slot, String(item.id)])
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(gap ? [gap, items] : items);
}

export const productColumns = `product.item_id, product.shop_id, product.name AS title, product.url,
  product.search_term AS category, product.price, product.currency, product.image_url AS imageUrl`;

export const searchableProduct = `EXISTS (
  SELECT 1 FROM clothes_listing_details d WHERE d.item_id = product.item_id
)`;

export const basicTerms = {
  top: ["men shirt", "men sweater", "men tank top", "women sweater", "women tank top"],
  bottom: ["business men pants", "business women pants", "men pants", "women pants"],
};

export function missingBasics(slots, garments) {
  if (slots.dress) return [];
  return Object.keys(basicTerms).filter(slot =>
    !slots[slot] && !garments.some(garment => garment.category === slot));
}

// One lookup for the saved list. A hidden or retired saved listing suppresses
// that gap only, leaving other approved pieces visible.
export async function readSavedProducts(db, accountId, selectionsByLook) {
  const { results: owned } = await db.prepare(`
    SELECT DISTINCT category FROM wardrobe_items WHERE user_id = ? AND confirmed_at IS NOT NULL
      AND archived_at IS NULL AND image_file_id IS NOT NULL AND category IN ('top','bottom')
  `).bind(accountId).all();
  const loadPicks = gapColumn => db.prepare(`
    WITH targets AS (
      SELECT look.id, look.user_id, look.source_option_id, slot.value AS items
      FROM json_each(?) AS slot JOIN saved_looks look ON look.id = CAST(slot.key AS BIGINT)
      WHERE look.user_id = ?
    ), picks AS (
      SELECT t.id AS look_id, s.catalog_item_id AS item_id, s.hidden_at, ${gapColumn} AS wardrobe_gap,
             CASE WHEN s.catalog_item_id IS NULL THEN 1 ELSE 2 END AS saved
      FROM targets t JOIN shopping_suggestions s ON s.saved_look_id = t.id
      WHERE s.catalog_item_id IS NOT NULL OR s.hidden_at IS NOT NULL
      UNION ALL
      SELECT t.id, e.item_id, NULL,
        CASE WHEN e.selection = t.items THEN NULL
             WHEN e.selection = '["top",' || t.items || ']' THEN 'top' ELSE 'bottom' END, 0
      FROM targets t JOIN outfit_enhancements e ON e.option_id = t.source_option_id AND e.user_id = t.user_id
      WHERE e.selection IN (t.items, '["top",' || t.items || ']', '["bottom",' || t.items || ']')
    )
    SELECT picks.look_id, picks.hidden_at, picks.wardrobe_gap, picks.saved, ${productColumns}
    FROM picks LEFT JOIN clothes_image_database product ON product.item_id = picks.item_id AND ${searchableProduct}
    ORDER BY picks.saved DESC
  `).bind(JSON.stringify(selectionsByLook), accountId).all();
  let picksResult;
  try {
    picksResult = await loadPicks("s.wardrobe_gap");
  } catch (error) {
    // Before migration 0110 each saved look could have one general suggestion.
    if (!/no such column: s\.wardrobe_gap|column s\.wardrobe_gap does not exist/i.test(error.message)) throw error;
    picksResult = await loadPicks("CAST(NULL AS TEXT)");
  }

  const byLook = new Map();
  for (const row of picksResult.results) {
    const key = String(row.look_id);
    if (!byLook.has(key)) byLook.set(key, new Map());
    const picks = byLook.get(key);
    if (!picks.has(row.wardrobe_gap)) picks.set(row.wardrobe_gap, row);
  }
  const products = new Map();
  for (const [id, picks] of byLook) {
    const slots = Object.fromEntries(JSON.parse(selectionsByLook[id]));
    const gaps = missingBasics(slots, owned);
    if (!gaps.length || picks.get(null)?.saved) gaps.push(null);
    const selected = [];
    for (const gap of gaps) {
      const row = picks.get(gap);
      const product = !row?.hidden_at && catalogProduct(row);
      if (product) selected.push(gap ? { ...product, wardrobeGap: gap } : product);
    }
    products.set(id, selected);
  }
  return products;
}
