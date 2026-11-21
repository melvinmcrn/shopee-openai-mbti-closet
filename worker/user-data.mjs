import { isOwnedPrivateFileId } from "./private-files.mjs";

const wardrobeColumns = `
  id, name, category, garment_type AS garmentType, color,
  image_file_id AS imageFileId, confirmed_at AS confirmedAt,
  archived_at AS archivedAt, created_at AS createdAt
`;
const activeWardrobe = "confirmed_at IS NOT NULL AND archived_at IS NULL";
const requestColumns = `
  id, occasion, planned_for AS plannedFor, location_or_weather AS locationOrWeather,
  formality, created_at AS createdAt
`;
const runColumns = `
  id, request_id AS requestId, status, model, prompt_version AS promptVersion,
  error_code AS errorCode, created_at AS createdAt
`;
const optionColumns = `
  id, run_id AS runId, position, title, explanation, preview_file_id AS previewFileId
`;
const lookColumns = "id, source_option_id AS sourceOptionId, name, saved_at AS savedAt";
const slotColumns = "slot, item_id AS itemId, item_name AS itemName";
const feedbackColumns = "id, saved_look_id AS savedLookId, worn_at AS wornAt, rating, note";
const suggestionColumns = `
  id, saved_look_id AS savedLookId, product_name AS productName, merchant,
  product_url AS productUrl, is_sponsored AS isSponsored, disclosure_text AS disclosureText,
  hidden_at AS hiddenAt
`;

const wardrobeFields = {
  name: "name",
  category: "category",
  garmentType: "garment_type",
  color: "color",
  imageFileId: "image_file_id",
  confirmedAt: "confirmed_at",
};
const runFields = { status: "status", model: "model", promptVersion: "prompt_version", errorCode: "error_code" };

function validId(id) {
  return Number.isSafeInteger(id) && id > 0;
}

function updateValues(patch, allowedFields) {
  return Object.entries(allowedFields)
    .filter(([key]) => Object.hasOwn(patch, key) && patch[key] !== undefined)
    .map(([key, column]) => [column, patch[key]]);
}

function encodeSlots(slots) {
  if (!Array.isArray(slots) || slots.length === 0) {
    throw new TypeError("At least one outfit slot is required");
  }
  const names = new Set();
  const values = slots.map(({ slot, itemId }) => {
    if (typeof slot !== "string" || !slot.trim() || names.has(slot) || !validId(itemId)) {
      throw new TypeError("Each outfit slot needs a unique name and a valid garment ID");
    }
    names.add(slot);
    return { slot, itemId };
  });
  return JSON.stringify(values);
}

export function userData(db, userId) {
  if (!validId(userId)) throw new TypeError("An authenticated user ID is required");

  const statement = (sql, ...values) => db.prepare(sql).bind(...values);
  const all = async (sql, ...values) => (await statement(sql, ...values).all()).results;
  function assertFileOwner(fileId) {
    if (!isOwnedPrivateFileId({ id: userId }, fileId)) {
      throw new TypeError("Expected a private file owned by the signed-in account");
    }
  }

  // The table, columns and patch keys are fixed by the methods below.
  function updateOwned(table, columns, id, values) {
    const assignments = values.map(([column]) => column + " = ?").join(", ");
    const args = values.map(([, value]) => value);
    const query = values.length
      ? `UPDATE ${table} SET ${assignments} WHERE user_id = ? AND id = ? RETURNING ${columns}`
      : `SELECT ${columns} FROM ${table} WHERE user_id = ? AND id = ?`;
    return statement(query, ...args, userId, id).first();
  }

  async function readSlots(parent, child) {
    const [record, slots] = await db.batch([parent, child]);
    return record.results.length ? { ...record.results[0], slots: slots.results } : null;
  }

  async function writeSlots(parent, table, parentColumn, slots) {
    // In a D1 batch, the next statement sees the parent insert on the same connection.
    // Capture the parent ID before any child inserts change last_insert_rowid().
    const [record] = await db.batch([
      parent,
      statement(`
        WITH inserted_parent AS MATERIALIZED (
          SELECT last_insert_rowid() AS id WHERE changes() = 1
        )
        INSERT INTO ${table} (user_id, ${parentColumn}, slot, item_id, item_name)
        SELECT w.user_id, p.id, s.value ->> '$.slot', w.id, w.name
        FROM inserted_parent p CROSS JOIN json_each(?) s
        JOIN wardrobe_items w ON w.id = (s.value ->> '$.itemId') AND w.user_id = ?
        WHERE ${activeWardrobe}
      `, slots, userId),
    ]);
    return record.results[0] ?? null;
  }

  const eligibleSlots = `
    (SELECT COUNT(*)
      FROM json_each(?) s
      JOIN wardrobe_items w ON w.id = (s.value ->> '$.itemId') AND w.user_id = ?
      WHERE ${activeWardrobe}) = ?
  `;

  const data = {
    async getProfile() {
      const [profile, styles] = await db.batch([
        statement(`
          SELECT height_cm AS heightCm, weight_kg AS weightKg, face_photo_file_id AS facePhotoFileId,
            setup_completed_at AS setupCompletedAt
          FROM profiles WHERE user_id = ?
        `, userId),
        statement("SELECT style FROM style_preferences WHERE user_id = ? ORDER BY style", userId),
      ]);
      if (!profile.results.length && !styles.results.length) return null;
      return {
        heightCm: null,
        weightKg: null,
        facePhotoFileId: null,
        setupCompletedAt: null,
        ...profile.results[0],
        styles: styles.results.map(({ style }) => style),
      };
    },

    async saveProfile({ heightCm = null, weightKg = null, facePhotoFileId = null, setupCompletedAt = null, styles = [] }) {
      const uniqueStyles = [...new Set(styles)].sort();
      await db.batch([
        statement("INSERT INTO profiles (user_id) VALUES (?) ON CONFLICT(user_id) DO NOTHING", userId),
        statement(`
          UPDATE profiles SET height_cm = ?, weight_kg = ?, face_photo_file_id = ?, setup_completed_at = ?
          WHERE user_id = ?
        `, heightCm, weightKg, facePhotoFileId, setupCompletedAt, userId),
        statement("DELETE FROM style_preferences WHERE user_id = ?", userId),
        statement(`
          INSERT INTO style_preferences (user_id, style)
          SELECT ?, value FROM json_each(?)
        `, userId, JSON.stringify(uniqueStyles)),
      ]);
      return { heightCm, weightKg, facePhotoFileId, setupCompletedAt, styles: uniqueStyles };
    },

    listWardrobeItems(category) {
      if (category === undefined) {
        return all(`
          SELECT ${wardrobeColumns} FROM wardrobe_items
          WHERE user_id = ? AND ${activeWardrobe} ORDER BY id
        `, userId);
      }
      return all(`
        SELECT ${wardrobeColumns} FROM wardrobe_items
        WHERE user_id = ? AND category = ? AND ${activeWardrobe} ORDER BY id
      `, userId, category);
    },

    getWardrobeItem(id) {
      return statement(`
        SELECT ${wardrobeColumns} FROM wardrobe_items WHERE user_id = ? AND id = ?
      `, userId, id).first();
    },

    getActiveWardrobeItems(ids) {
      if (!Array.isArray(ids) || !ids.every(validId)) {
        throw new TypeError("Expected valid garment IDs");
      }
      return all(`
        SELECT ${wardrobeColumns} FROM wardrobe_items
        WHERE user_id = ? AND ${activeWardrobe} AND id IN (SELECT value FROM json_each(?))
        ORDER BY id
      `, userId, JSON.stringify(ids));
    },

    createWardrobeItem({ name, category, garmentType = null, color = null, imageFileId, confirmedAt = null }) {
      assertFileOwner(imageFileId);
      return statement(`
        INSERT INTO wardrobe_items (user_id, name, category, garment_type, color, image_file_id, confirmed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING ${wardrobeColumns}
      `, userId, name, category, garmentType, color, imageFileId, confirmedAt).first();
    },

    updateWardrobeItem(id, fields) {
      return updateOwned("wardrobe_items", wardrobeColumns, id, updateValues(fields, wardrobeFields));
    },

    archiveWardrobeItem(id) {
      return statement(`
        UPDATE wardrobe_items SET archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP)
        WHERE user_id = ? AND id = ? RETURNING ${wardrobeColumns}
      `, userId, id).first();
    },

    async createOutfitRequest({
      occasion, plannedFor = null, locationOrWeather = null, formality = null,
      comfortChoices = [], clothingChoices = [],
    }) {
      const comfort = [...new Set(comfortChoices)];
      const clothing = JSON.stringify(clothingChoices);
      // The new request is the owner's highest ID within this atomic batch.
      const newRequestId = "(SELECT MAX(id) FROM outfit_requests WHERE user_id = ?)";
      const [created] = await db.batch([
        statement(`
          INSERT INTO outfit_requests (user_id, occasion, planned_for, location_or_weather, formality)
          VALUES (?, ?, ?, ?, ?) RETURNING ${requestColumns}
        `, userId, occasion, plannedFor, locationOrWeather, formality),
        statement(`
          INSERT INTO request_comfort_choices (request_id, choice)
          SELECT ${newRequestId}, value FROM json_each(?)
        `, userId, JSON.stringify(comfort)),
        statement(`
          INSERT INTO request_clothing_choices (request_id, category, garment_type)
          SELECT DISTINCT ${newRequestId}, value ->> '$.category', value ->> '$.garmentType' FROM json_each(?)
        `, userId, clothing),
      ]);
      return data.getOutfitRequest(created.results[0].id);
    },

    async getOutfitRequest(id) {
      const [request, comfort, clothing] = await db.batch([
        statement(`
          SELECT ${requestColumns} FROM outfit_requests WHERE user_id = ? AND id = ?
        `, userId, id),
        statement(`
          SELECT c.choice FROM request_comfort_choices c
          JOIN outfit_requests r ON r.id = c.request_id
          WHERE r.user_id = ? AND r.id = ? ORDER BY c.choice
        `, userId, id),
        statement(`
          SELECT c.category, c.garment_type AS garmentType FROM request_clothing_choices c
          JOIN outfit_requests r ON r.id = c.request_id
          WHERE r.user_id = ? AND r.id = ? ORDER BY c.category, c.garment_type
        `, userId, id),
      ]);
      return request.results.length ? {
        ...request.results[0],
        comfortChoices: comfort.results.map(({ choice }) => choice),
        clothingChoices: clothing.results,
      } : null;
    },

    createGenerationRun({ requestId, status = "queued", model = null, promptVersion = null, errorCode = null }) {
      return statement(`
        INSERT INTO generation_runs (user_id, request_id, status, model, prompt_version, error_code)
        SELECT user_id, id, ?, ?, ?, ? FROM outfit_requests WHERE user_id = ? AND id = ?
        RETURNING ${runColumns}
      `, status, model, promptVersion, errorCode, userId, requestId).first();
    },

    getGenerationRun(id) {
      return statement(`
        SELECT ${runColumns} FROM generation_runs WHERE user_id = ? AND id = ?
      `, userId, id).first();
    },

    updateGenerationRun(id, fields) {
      return updateOwned("generation_runs", runColumns, id, updateValues(fields, runFields));
    },

    listOutfitOptions(runId) {
      return all(`
        SELECT ${optionColumns} FROM outfit_options
        WHERE user_id = ? AND run_id = ? ORDER BY position
      `, userId, runId);
    },

    async createOutfitOption({ runId, position, title, explanation = null, previewFileId = null, slots }) {
      if (previewFileId !== null) assertFileOwner(previewFileId);
      const encoded = encodeSlots(slots);
      const option = await writeSlots(statement(`
        INSERT INTO outfit_options (user_id, run_id, position, title, explanation, preview_file_id)
        SELECT user_id, id, ?, ?, ?, ? FROM generation_runs
        WHERE user_id = ? AND id = ? AND ${eligibleSlots}
        RETURNING ${optionColumns}
      `, position, title, explanation, previewFileId, userId, runId, encoded, userId, slots.length),
      "outfit_option_items", "option_id", encoded);
      return option ? data.getOutfitOption(option.id) : null;
    },

    getOutfitOption(id) {
      return readSlots(
        statement(`SELECT ${optionColumns} FROM outfit_options WHERE user_id = ? AND id = ?`, userId, id),
        statement(`
          SELECT ${slotColumns} FROM outfit_option_items WHERE user_id = ? AND option_id = ? ORDER BY slot
        `, userId, id),
      );
    },

    updateOutfitOptionPreview(id, previewFileId) {
      return updateOwned("outfit_options", optionColumns, id, [["preview_file_id", previewFileId]]);
    },

    async saveLook({ sourceOptionId, name, slots }) {
      const encoded = encodeSlots(slots);
      const look = await writeSlots(statement(`
        INSERT INTO saved_looks (user_id, source_option_id, name)
        SELECT user_id, id, ? FROM outfit_options
        WHERE user_id = ? AND id = ? AND ${eligibleSlots}
        RETURNING ${lookColumns}
      `, name, userId, sourceOptionId, encoded, userId, slots.length),
      "saved_look_items", "saved_look_id", encoded);
      return look ? data.getSavedLook(look.id) : null;
    },

    getSavedLook(id) {
      return readSlots(
        statement(`SELECT ${lookColumns} FROM saved_looks WHERE user_id = ? AND id = ?`, userId, id),
        statement(`
          SELECT ${slotColumns} FROM saved_look_items WHERE user_id = ? AND saved_look_id = ? ORDER BY slot
        `, userId, id),
      );
    },

    listSavedLooks() {
      return all(`
        SELECT ${lookColumns} FROM saved_looks
        WHERE user_id = ? ORDER BY saved_at DESC, id DESC
      `, userId);
    },

    addWearFeedback(savedLookId, { wornAt = null, rating = null, note = null }) {
      return statement(`
        INSERT INTO wear_feedback (saved_look_id, worn_at, rating, note)
        SELECT id, COALESCE(?, CURRENT_TIMESTAMP), ?, ? FROM saved_looks WHERE user_id = ? AND id = ?
        RETURNING ${feedbackColumns}
      `, wornAt, rating, note, userId, savedLookId).first();
    },

    listWearFeedback(savedLookId) {
      return all(`
        SELECT f.id, f.saved_look_id AS savedLookId, f.worn_at AS wornAt, f.rating, f.note
        FROM wear_feedback f JOIN saved_looks l ON l.id = f.saved_look_id
        WHERE l.user_id = ? AND l.id = ? ORDER BY f.worn_at DESC, f.id DESC
      `, userId, savedLookId);
    },

    addShoppingSuggestion(savedLookId, {
      productName, merchant = null, productUrl, isSponsored = false, disclosureText = null,
    }) {
      return statement(`
        INSERT INTO shopping_suggestions (saved_look_id, product_name, merchant, product_url, is_sponsored, disclosure_text)
        SELECT id, ?, ?, ?, ?, ? FROM saved_looks WHERE user_id = ? AND id = ?
        RETURNING ${suggestionColumns}
      `, productName, merchant, productUrl, Number(isSponsored), disclosureText, userId, savedLookId).first();
    },

    listShoppingSuggestions(savedLookId) {
      return all(`
        SELECT s.id, s.saved_look_id AS savedLookId, s.product_name AS productName, s.merchant,
          s.product_url AS productUrl, s.is_sponsored AS isSponsored, s.disclosure_text AS disclosureText,
          s.hidden_at AS hiddenAt
        FROM shopping_suggestions s JOIN saved_looks l ON l.id = s.saved_look_id
        WHERE l.user_id = ? AND l.id = ? AND s.hidden_at IS NULL ORDER BY s.id
      `, userId, savedLookId);
    },

    hideShoppingSuggestion(id) {
      return statement(`
        UPDATE shopping_suggestions SET hidden_at = COALESCE(hidden_at, CURRENT_TIMESTAMP)
        WHERE id = ? AND saved_look_id IN (SELECT id FROM saved_looks WHERE user_id = ?)
        RETURNING ${suggestionColumns}
      `, id, userId).first();
    },
  };
  return data;
}
