const slotNames = new Set(["top", "bottom", "dress", "shoes", "outerwear", "accessory"]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function snapshotSlots(slots, garmentsById) {
  if (!isRecord(slots)) {
    throw new TypeError("A look must provide its garment slots");
  }

  const snapshot = {};
  for (const [slot, garmentId] of Object.entries(slots)) {
    if (!slotNames.has(slot)) {
      throw new TypeError("A look contains an unknown garment slot");
    }
    if (garmentId === null) continue;

    const garment = typeof garmentId === "string" ? garmentsById.get(garmentId) : undefined;
    if (!garment || garment.category !== slot) {
      throw new TypeError("A look contains an ineligible garment");
    }

    snapshot[slot] = {
      id: garment.id,
      name: garment.name,
      category: garment.category,
      color: garment.color ?? null,
      imageRef: garment.imageRef ?? null,
    };
  }

  const hasValidBase = snapshot.dress
    ? !snapshot.top && !snapshot.bottom
    : snapshot.top && snapshot.bottom;
  if (!snapshot.shoes || !hasValidBase) {
    throw new TypeError("A look needs shoes and either a dress or a top and bottom");
  }
  return snapshot;
}

function deserializeLook(row) {
  return {
    id: row.id,
    optionId: row.option_id,
    occasion: row.occasion,
    slots: JSON.parse(row.slots),
    originalSlots: JSON.parse(row.original_slots),
    explanation: row.explanation,
    createdAt: row.created_at,
  };
}

export async function saveLook(db, accountId, sourceOption, slots, garments) {
  if (
    !isRecord(sourceOption) ||
    typeof sourceOption.id !== "string" ||
    typeof sourceOption.occasion !== "string" ||
    typeof sourceOption.explanation !== "string"
  ) {
    throw new TypeError("A saved look must have a generated option");
  }

  const garmentsById = new Map(garments.map((garment) => [garment.id, garment]));
  const look = {
    id: crypto.randomUUID(),
    optionId: sourceOption.id,
    occasion: sourceOption.occasion,
    slots: snapshotSlots(slots, garmentsById),
    originalSlots: snapshotSlots(sourceOption.slots, garmentsById),
    explanation: sourceOption.explanation,
    createdAt: new Date().toISOString(),
  };

  await db.prepare(
    `INSERT INTO planner_saved_looks
       (id, account_id, option_id, occasion, slots, original_slots, explanation, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    look.id,
    accountId,
    look.optionId,
    look.occasion,
    JSON.stringify(look.slots),
    JSON.stringify(look.originalSlots),
    look.explanation,
    look.createdAt,
  ).run();
  return look;
}

export async function listLooks(db, accountId) {
  const { results } = await db.prepare(
    `SELECT id, option_id, occasion, slots, original_slots, explanation, created_at
     FROM planner_saved_looks
     WHERE account_id = ?
     ORDER BY created_at DESC, id DESC`,
  ).bind(accountId).all();
  return results.map(deserializeLook);
}

export async function getLook(db, accountId, id) {
  const row = await db.prepare(
    `SELECT id, option_id, occasion, slots, original_slots, explanation, created_at
     FROM planner_saved_looks
     WHERE account_id = ? AND id = ?`,
  ).bind(accountId, id).first();
  return row ? deserializeLook(row) : null;
}
