const garmentCategories = new Set(["top", "bottom", "dress", "shoes", "outerwear", "accessory"]);

export class BriefValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "BriefValidationError";
  }
}

function readText(value, field, { required = false, maxLength = 500 } = {}) {
  if (value === undefined && !required) return "";
  if (typeof value !== "string") {
    throw new BriefValidationError(`${field} must be text.`);
  }
  const text = value.trim();
  if (required && !text) {
    throw new BriefValidationError(`${field} is required.`);
  }
  if (text.length > maxLength) {
    throw new BriefValidationError(`${field} must be at most ${maxLength} characters.`);
  }
  return text;
}

function readPreferences(value = []) {
  if (!Array.isArray(value) || value.some((category) => !garmentCategories.has(category))) {
    throw new BriefValidationError("Preferences must be an array of supported garment categories.");
  }
  return [...new Set(value)];
}

function readBrief(row) {
  if (!row) return null;
  return { ...row, preferences: JSON.parse(row.preferences) };
}

export async function saveBrief(db, accountId, input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new BriefValidationError("An occasion brief is required.");
  }
  const occasion = readText(input.occasion, "Occasion", { required: true });
  const timing = readText(input.timing, "Timing");
  const location = readText(input.location, "Location");
  const formality = readText(input.formality, "Formality");
  const comfort = readText(input.comfort, "Comfort");
  const preferences = JSON.stringify(readPreferences(input.preferences));

  if (input.id === undefined) {
    const row = await db.prepare(`
      INSERT INTO planner_briefs (account_id, id, occasion, timing, location, formality, comfort, preferences)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING id, occasion, timing, location, formality, comfort, preferences
    `).bind(accountId, crypto.randomUUID(), occasion, timing, location, formality, comfort, preferences).first();
    return readBrief(row);
  }

  const id = readText(input.id, "Brief ID", { required: true, maxLength: 128 });
  const row = await db.prepare(`
    UPDATE planner_briefs
    SET occasion = ?, timing = ?, location = ?, formality = ?, comfort = ?, preferences = ?
    WHERE account_id = ? AND id = ?
    RETURNING id, occasion, timing, location, formality, comfort, preferences
  `).bind(occasion, timing, location, formality, comfort, preferences, accountId, id).first();
  return readBrief(row);
}

export async function getBrief(db, accountId, id) {
  const briefId = readText(id, "Brief ID", { required: true, maxLength: 128 });
  const row = await db.prepare(`
    SELECT id, occasion, timing, location, formality, comfort, preferences
    FROM planner_briefs
    WHERE account_id = ? AND id = ?
  `).bind(accountId, briefId).first();
  return readBrief(row);
}
