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

export function enhancementSelection(slots) {
  return JSON.stringify(Object.entries(slots)
    .map(([slot, item]) => [slot, String(item.id)])
    .sort(([a], [b]) => a.localeCompare(b)));
}

export const productColumns = `product.item_id, product.shop_id, product.name AS title, product.url,
  product.search_term AS category, product.price, product.currency, product.image_url AS imageUrl`;

export const searchableProduct = `EXISTS (
  SELECT 1 FROM clothes_listing_details d WHERE d.item_id = product.item_id
)`;

// A saved dismissal applies to this saved look only. Otherwise use its linked
// suggestion, or the existing decision for its exact outfit when it was planned.
export async function readSavedProducts(db, accountId, selectionsByLook) {
  const { results } = await db.prepare(`
    SELECT look.id AS look_id, ${productColumns}
    FROM json_each(?) AS slot JOIN saved_looks look ON look.id = CAST(slot.key AS BIGINT)
    JOIN clothes_image_database product ON product.item_id = (
      CASE WHEN EXISTS (
        SELECT 1 FROM shopping_suggestions s WHERE s.saved_look_id = look.id
          AND (s.hidden_at IS NOT NULL OR s.catalog_item_id IS NOT NULL)
      ) THEN (
        SELECT s.catalog_item_id FROM shopping_suggestions s
        WHERE s.saved_look_id = look.id AND s.hidden_at IS NULL AND s.catalog_item_id IS NOT NULL
      ) ELSE (
        SELECT e.item_id FROM outfit_enhancements e WHERE e.user_id = look.user_id
          AND e.option_id = look.source_option_id AND e.selection = slot.value
      ) END
    )
    WHERE look.user_id = ? AND ${searchableProduct}
  `).bind(JSON.stringify(selectionsByLook), accountId).all();
  return new Map(results.map(row => [String(row.look_id), catalogProduct(row)]));
}
