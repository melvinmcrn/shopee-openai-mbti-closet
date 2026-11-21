import { getLook } from "./saved.mjs";

const shopeeOrigin = "https://shopee.sg";

function occasionGroup({ occasion, slots }) {
  if (/\b(wedding|gala|cocktail|anniversary|dinner|formal|ceremony|black tie)\b/i.test(occasion)) {
    return "dressy";
  }
  if (/\b(hike|hiking|gym|workout|sports|running)\b/i.test(occasion)) return "active";
  if (/\b(casual|weekend|picnic|brunch|coffee)\b/i.test(occasion)
    || /\b(sneakers?|trainers?)\b/i.test(slots.shoes?.name ?? "")) {
    return "casual";
  }
  return "any";
}

async function suggestionsForLook(db, look) {
  if (look.slots.accessory) return [];
  const group = occasionGroup(look);
  const { results } = await db.prepare(`
    SELECT id, title, url, sponsored FROM planner_shopping_catalog
    WHERE occasion_group IN (?, 'any')
    ORDER BY occasion_group = ? DESC, id
  `).bind(group, group).all();

  const suggestions = [];
  for (const { id, title, url, sponsored } of results) {
    let target;
    try {
      target = new URL(url);
    } catch {
      continue;
    }
    if (target.protocol !== "https:" || target.origin !== shopeeOrigin || target.username || target.password) continue;
    suggestions.push({ id, title, url: target.href, sponsored: sponsored === 1 });
    if (suggestions.length === 2) break;
  }
  return suggestions;
}

export async function shoppingAction(db, accountId, action, input) {
  if (typeof input?.lookId !== "string" || !input.lookId) {
    throw new TypeError("A saved look is required.");
  }

  const look = await getLook(db, accountId, input.lookId);
  if (!look) throw Object.assign(new Error("This item could not be found."), { status: 404 });
  const suggestions = await suggestionsForLook(db, look);

  if (action === "shopping") {
    const { results } = await db.prepare(`
      SELECT suggestion_id FROM planner_hidden_suggestions WHERE look_id = ?
    `).bind(look.id).all();
    const hiddenIds = new Set(results.map((row) => row.suggestion_id));
    return suggestions.filter(({ id }) => !hiddenIds.has(id));
  }

  if (action === "hide") {
    if (!suggestions.some(({ id }) => id === input.id)) {
      throw Object.assign(new Error("This suggestion could not be found."), { status: 404 });
    }
    await db.prepare(`
      INSERT INTO planner_hidden_suggestions (look_id, suggestion_id)
      SELECT id, ? FROM planner_saved_looks WHERE id = ? AND account_id = ?
      ON CONFLICT (look_id, suggestion_id) DO NOTHING
    `).bind(input.id, look.id, accountId).run();
    return { hidden: true };
  }

  throw new TypeError("Unknown shopping action.");
}
