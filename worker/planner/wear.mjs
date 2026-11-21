class WearError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function found(entry) {
  if (!entry) throw new WearError(404, "This item could not be found.");
  return entry;
}

function requireId(id) {
  if (typeof id !== "string" || !id.trim()) {
    throw new WearError(400, "Choose a saved look or wear entry.");
  }
  return id;
}

function requireDate(date) {
  if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) && !date.startsWith("0000")) {
    const parsed = new Date(date + "T00:00:00Z");
    if (Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date) {
      return date;
    }
  }
  throw new WearError(400, "Enter a valid wear date.");
}

function feedback({ rating, note }) {
  if (rating != null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
    throw new WearError(400, "Choose a rating from 1 to 5.");
  }
  if (note != null && (typeof note !== "string" || note.trim().length > 1000)) {
    throw new WearError(400, "Enter a note of up to 1,000 characters.");
  }
  return { rating: rating ?? null, note: note?.trim() || null };
}

async function listEntries(db, accountId, lookId) {
  const { results } = await db.prepare(
    `SELECT wear.id, look.id AS lookId, wear.date, wear.rating, wear.note
     FROM planner_saved_looks AS look
     LEFT JOIN planner_wear_history AS wear ON wear.look_id = look.id
     WHERE look.account_id = ? AND look.id = ?
     ORDER BY wear.date DESC`,
  ).bind(accountId, lookId).all();
  return found(results[0]).id === null ? [] : results;
}

async function addEntry(db, accountId, lookId, date) {
  await db.prepare(
    `INSERT INTO planner_wear_history (id, look_id, date)
     SELECT ?, id, ? FROM planner_saved_looks WHERE id = ? AND account_id = ?
     ON CONFLICT (look_id, date) DO NOTHING`,
  ).bind(crypto.randomUUID(), date, lookId, accountId).run();

  return found(await db.prepare(
    `SELECT wear.id, wear.look_id AS lookId, wear.date, wear.rating, wear.note
     FROM planner_wear_history AS wear
     JOIN planner_saved_looks AS look ON look.id = wear.look_id
     WHERE look.account_id = ? AND wear.look_id = ? AND wear.date = ?`,
  ).bind(accountId, lookId, date).first());
}

async function getEntry(db, accountId, id) {
  return found(await db.prepare(
    `SELECT wear.id, wear.look_id AS lookId, wear.date, wear.rating, wear.note
     FROM planner_wear_history AS wear
     JOIN planner_saved_looks AS look ON look.id = wear.look_id
     WHERE look.account_id = ? AND wear.id = ?`,
  ).bind(accountId, id).first());
}

async function updateEntry(db, accountId, id, input) {
  const { rating, note } = feedback(input);
  return found(await db.prepare(
    `UPDATE planner_wear_history
     SET rating = CASE WHEN ? THEN ? ELSE rating END,
         note = CASE WHEN ? THEN ? ELSE note END
     WHERE id = ? AND EXISTS (
       SELECT 1 FROM planner_saved_looks WHERE id = planner_wear_history.look_id AND account_id = ?
     )
     RETURNING id, look_id AS lookId, date, rating, note`,
  ).bind(Number(input.rating !== undefined), rating, Number(input.note !== undefined), note, id, accountId).first());
}

export async function wearAction(db, accountId, action, input = {}) {
  if (!Number.isSafeInteger(accountId) || accountId < 1) {
    throw new WearError(401, "Sign in to open the planner.");
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new WearError(400, "Invalid planner request.");
  }
  switch (action) {
    case "wearList":
      return listEntries(db, accountId, requireId(input.lookId));
    case "wearAdd":
      return addEntry(db, accountId, requireId(input.lookId), requireDate(input.date));
    case "wearGet":
      return getEntry(db, accountId, requireId(input.id));
    case "wearUpdate":
      return updateEntry(db, accountId, requireId(input.id), input);
    default:
      throw new WearError(400, "Unknown wear history action.");
  }
}
