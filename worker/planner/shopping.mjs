import { getLook } from "./saved.mjs";

function accessorySuggestion({ occasion, slots }) {
  if (/\b(wedding|gala|cocktail|anniversary|dinner|formal|ceremony|black tie)\b/i.test(occasion)) {
    return "Simple stud earrings";
  }
  if (/\b(hike|hiking|gym|workout|sports|running)\b/i.test(occasion)) {
    return "Lightweight sports cap";
  }
  if (/\b(casual|weekend|picnic|brunch|coffee)\b/i.test(occasion)
    || /\b(sneakers?|trainers?)\b/i.test(slots.shoes?.name ?? "")) {
    return "Canvas tote bag";
  }
  return "Compact crossbody bag";
}

async function loadSuggestions(db, accountId, lookId) {
  const { results } = await db.prepare(`
    SELECT suggestion.id, suggestion.product_name, suggestion.product_url,
           suggestion.is_sponsored, suggestion.hidden_at
    FROM shopping_suggestions AS suggestion
    JOIN saved_looks AS look ON look.id = suggestion.saved_look_id
    WHERE look.user_id = ? AND look.id = ?
    ORDER BY suggestion.id
  `).bind(accountId, lookId).all();
  return results;
}

async function seedSuggestion(db, accountId, look) {
  const title = accessorySuggestion(look);
  const url = new URL("https://shopee.sg/search");
  url.searchParams.set("keyword", title.toLowerCase());
  // Check all rows, including hidden ones, in the same statement as the insert.
  await db.prepare(`
    INSERT INTO shopping_suggestions (saved_look_id, product_name, merchant, product_url)
    SELECT look.id, ?, 'Shopee', ?
    FROM saved_looks AS look
    WHERE look.id = ? AND look.user_id = ?
      AND NOT EXISTS (
        SELECT 1 FROM shopping_suggestions WHERE saved_look_id = look.id
      )
  `).bind(title, url.href, look.id, accountId).run();
}

function visibleSuggestions(rows) {
  const suggestions = [];
  for (const row of rows) {
    if (row.hidden_at !== null) continue;
    let url;
    try {
      url = new URL(row.product_url);
    } catch {
      continue;
    }
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) continue;
    suggestions.push({
      id: String(row.id),
      title: row.product_name,
      url: url.href,
      sponsored: row.is_sponsored === 1,
    });
  }
  return suggestions;
}

export async function shoppingAction(db, accountId, action, input) {
  if (typeof input?.lookId !== "string" || !input.lookId) {
    throw new TypeError("A saved look is required.");
  }

  const look = await getLook(db, accountId, input.lookId);
  if (!look) throw Object.assign(new Error("This item could not be found."), { status: 404 });

  if (action === "shopping") {
    let rows = await loadSuggestions(db, accountId, look.id);
    const hasAccessory = Object.keys(look.slots).some((slot) => /^accessory(?:_\d+)?$/.test(slot));
    if (!rows.length && !hasAccessory) {
      await seedSuggestion(db, accountId, look);
      rows = await loadSuggestions(db, accountId, look.id);
    }
    return visibleSuggestions(rows);
  }

  if (action === "hide") {
    if (typeof input.id !== "string" || !input.id) {
      throw new TypeError("A shopping suggestion is required.");
    }
    const hidden = await db.prepare(`
      UPDATE shopping_suggestions
      SET hidden_at = COALESCE(hidden_at, CURRENT_TIMESTAMP)
      WHERE id = ? AND saved_look_id IN (
        SELECT id FROM saved_looks WHERE id = ? AND user_id = ?
      )
      RETURNING id
    `).bind(input.id, look.id, accountId).first();
    if (!hidden) {
      throw Object.assign(new Error("This suggestion could not be found."), { status: 404 });
    }
    return { hidden: true };
  }

  throw new TypeError("Unknown shopping action.");
}
