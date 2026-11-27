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
  if (typeof id !== "string" || !/^[1-9][0-9]{0,18}$/.test(id)) {
    throw new WearError(400, "Choose a saved look or wear entry.");
  }
  return id;
}

export function requireWearDate(date) {
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
    `SELECT CAST(wear.id AS TEXT) AS id, CAST(look.id AS TEXT) AS lookId,
            substr(wear.worn_at, 1, 10) AS date, wear.rating, wear.note
     FROM saved_looks AS look
     LEFT JOIN wear_feedback AS wear ON wear.saved_look_id = look.id
     WHERE look.user_id = ? AND look.id = ?
     ORDER BY date DESC, wear.id DESC`,
  ).bind(accountId, lookId).all();
  return found(results[0]).id === null ? [] : results;
}

async function addEntry(db, accountId, lookId, date) {
  const insert = db.prepare(
    `INSERT INTO wear_feedback (saved_look_id, worn_at)
     SELECT look.id, ? FROM saved_looks AS look
     WHERE look.id = ? AND look.user_id = ?
     AND NOT EXISTS (
       SELECT 1 FROM wear_feedback AS wear
       WHERE wear.saved_look_id = look.id AND substr(wear.worn_at, 1, 10) = ?
     ) RETURNING id`,
  ).bind(date + " 00:00:00", lookId, accountId, date);

  const lookup = db.prepare(
    `SELECT CAST(wear.id AS TEXT) AS id, CAST(wear.saved_look_id AS TEXT) AS lookId,
            substr(wear.worn_at, 1, 10) AS date, wear.rating, wear.note
     FROM wear_feedback AS wear
     JOIN saved_looks AS look ON look.id = wear.saved_look_id
     WHERE look.user_id = ? AND wear.saved_look_id = ? AND substr(wear.worn_at, 1, 10) = ?
     ORDER BY wear.id DESC
     LIMIT 1`,
  ).bind(accountId, lookId, date);
  // D1 serializes the batch. The Postgres adapter retries it at SERIALIZABLE.
  const [added, existing] = await db.batch([insert, lookup]);
  return { ...found(existing.results[0]), created: added.results.length === 1 };
}

async function getEntry(db, accountId, id) {
  return found(await db.prepare(
    `SELECT CAST(wear.id AS TEXT) AS id, CAST(wear.saved_look_id AS TEXT) AS lookId,
            substr(wear.worn_at, 1, 10) AS date, wear.rating, wear.note
     FROM wear_feedback AS wear
     JOIN saved_looks AS look ON look.id = wear.saved_look_id
     WHERE look.user_id = ? AND wear.id = ?`,
  ).bind(accountId, id).first());
}

async function updateEntry(db, accountId, id, input) {
  const { rating, note } = feedback(input);
  return found(await db.prepare(
    `UPDATE wear_feedback
     SET rating = CASE WHEN ? THEN ? ELSE rating END,
         note = CASE WHEN ? THEN ? ELSE note END
     WHERE id = ? AND EXISTS (
       SELECT 1 FROM saved_looks WHERE id = wear_feedback.saved_look_id AND user_id = ?
     )
     RETURNING CAST(id AS TEXT) AS id, CAST(saved_look_id AS TEXT) AS lookId,
               substr(worn_at, 1, 10) AS date, rating, note`,
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
      return addEntry(db, accountId, requireId(input.lookId), requireWearDate(input.date));
    case "wearGet":
      return getEntry(db, accountId, requireId(input.id));
    case "wearUpdate":
      return updateEntry(db, accountId, requireId(input.id), input);
    default:
      throw new WearError(400, "Unknown wear history action.");
  }
}
