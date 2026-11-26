const garmentCategories = new Set(["top", "bottom", "dress", "shoes", "outerwear", "accessory"]);

export class BriefValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "BriefValidationError";
  }
}

function readText(value, field, { required = false } = {}) {
  if (value === undefined && !required) return "";
  if (typeof value !== "string") {
    throw new BriefValidationError(`${field} must be text.`);
  }
  const text = value.trim();
  if (required && !text) {
    throw new BriefValidationError(`${field} is required.`);
  }
  if (text.length > 500) {
    throw new BriefValidationError(`${field} must be at most 500 characters.`);
  }
  return text;
}

function readId(value) {
  if (typeof value !== "string" || !/^-?\d{1,19}$/.test(value)) {
    throw new BriefValidationError("Brief ID must be an integer.");
  }
  const id = BigInt(value);
  if (id < -9223372036854775808n || id > 9223372036854775807n) {
    throw new BriefValidationError("Brief ID must be a valid SQLite integer.");
  }
  return id.toString();
}

function readPreferences(value = []) {
  if (!Array.isArray(value) || value.some((category) => !garmentCategories.has(category))) {
    throw new BriefValidationError("Preferences must be an array of supported garment categories.");
  }
  return [...new Set(value)];
}

function newBriefId() {
  // Carry the same safe integer into all statements of the D1 batch.
  const [high, low] = crypto.getRandomValues(new Uint32Array(2));
  return (high & 0x1fffff) * 0x100000000 + low || 1;
}

const comfortForRequest = `
  COALESCE((
    SELECT group_concat(choice, ', ')
    FROM (
      SELECT choice FROM request_comfort_choices WHERE request_id = request.id ORDER BY choice
    ) AS sorted_comfort_choices
  ), '')
`;

function selectBrief(db, accountId, id, version) {
  return db.prepare(`
    SELECT CAST(request.id AS TEXT) AS id, request.occasion,
      COALESCE(request.planned_for, '') AS timing,
      COALESCE(request.location_or_weather, '') AS location,
      COALESCE(request.formality, '') AS formality,
      ${comfortForRequest} AS comfort,
      (
        SELECT json_group_array(category)
        FROM (
          SELECT DISTINCT category
          FROM request_clothing_choices
          WHERE request_id = request.id
          ORDER BY category
        ) AS sorted_categories
      ) AS preferences
    FROM outfit_requests AS request
    WHERE request.user_id = ? AND request.id = ? ${version ? "AND resume_version = ?" : ""}
  `).bind(accountId, id, ...(version ? [version] : []));
}

function readBrief(row) {
  if (!row) return null;
  return { ...row, preferences: JSON.parse(row.preferences) };
}

export async function saveBrief(db, accountId, input, stage) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new BriefValidationError("An occasion brief is required.");
  }
  const occasion = readText(input.occasion, "Occasion", { required: true });
  const timing = readText(input.timing, "Timing") || null;
  const location = readText(input.location, "Location") || null;
  const formality = readText(input.formality, "Formality") || null;
  const comfort = readText(input.comfort, "Comfort");
  const preferences = JSON.stringify(readPreferences(input.preferences));

  const creating = input.id === undefined;
  const id = creating ? newBriefId() : readId(input.id);
  const nextVersion = stage ? crypto.randomUUID() : null;
  const versionGuard = stage ? " AND resume_version = ?" : "";
  const guardValues = stage ? [nextVersion] : [];
  const saveRequest = creating
    ? db.prepare(`
      INSERT INTO outfit_requests (id, user_id, occasion, planned_for, location_or_weather, formality${stage ? ", resume_stage, resume_version" : ""})
      SELECT ?, ?, ?, ?, ?, ?${stage ? `, ?, ? WHERE NOT EXISTS (
        SELECT 1 FROM outfit_requests WHERE user_id = ? AND resume_stage IS NOT NULL AND resume_stage <> 'closed')` : ""}
    `).bind(id, accountId, occasion, timing, location, formality, ...(stage ? [stage, nextVersion, accountId] : []))
    : db.prepare(`
      UPDATE outfit_requests
      SET occasion = ?, planned_for = ?, location_or_weather = ?, formality = ?
        ${stage ? `, resume_stage = ?, resume_version = ?, resume_option_id = NULL,
          resume_after_run = COALESCE((SELECT MAX(r.id) FROM generation_runs r WHERE r.request_id = outfit_requests.id), 0)` : ""}
      WHERE user_id = ? AND id = ? ${stage ? "AND resume_stage <> 'closed' AND resume_version IS ?" : ""}
    `).bind(occasion, timing, location, formality, ...(stage ? [stage, nextVersion] : []), accountId, id, ...(stage ? [input.version ?? null] : []));

  const statements = [saveRequest];
  if (!creating) {
    statements.push(
      // Keep existing separate choices when the submitted display text stayed the same.
      db.prepare(`
        DELETE FROM request_comfort_choices
        WHERE request_id IN (
          SELECT request.id FROM outfit_requests AS request
          WHERE request.user_id = ? AND request.id = ?${versionGuard} AND ${comfortForRequest} <> ?
        )
      `).bind(accountId, id, ...guardValues, comfort),
      db.prepare(`
        DELETE FROM request_clothing_choices
        WHERE request_id IN (SELECT id FROM outfit_requests WHERE user_id = ? AND id = ?${versionGuard})
          AND category NOT IN (SELECT value FROM json_each(?))
      `).bind(accountId, id, ...guardValues, preferences),
    );
  }
  if (comfort) {
    statements.push(db.prepare(`
      INSERT INTO request_comfort_choices (request_id, choice)
      SELECT request.id, ? FROM outfit_requests AS request
      WHERE request.user_id = ? AND request.id = ?${versionGuard}
        AND NOT EXISTS (SELECT 1 FROM request_comfort_choices WHERE request_id = request.id)
    `).bind(comfort, accountId, id, ...guardValues));
  }
  // The planner selects categories. Preserve garment types already stored for those categories.
  statements.push(
    db.prepare(`
      INSERT INTO request_clothing_choices (request_id, category, garment_type)
      SELECT request.id, selected.value, ''
      FROM outfit_requests AS request CROSS JOIN json_each(?) AS selected
      WHERE request.user_id = ? AND request.id = ?${versionGuard}
        AND NOT EXISTS (
          SELECT 1 FROM request_clothing_choices
          WHERE request_id = request.id AND category = selected.value
        )
    `).bind(preferences, accountId, id, ...guardValues),
    selectBrief(db, accountId, id, nextVersion),
  );

  const results = await db.batch(statements);
  const saved = readBrief(results.at(-1).results[0]);
  if (stage && !saved) throw Object.assign(new Error("This plan changed. Reopen the planner to continue."), { status: 409 });
  return saved && nextVersion ? { ...saved, version: nextVersion } : saved;
}

export async function getBrief(db, accountId, id) {
  return readBrief(await selectBrief(db, accountId, readId(id)).first());
}
