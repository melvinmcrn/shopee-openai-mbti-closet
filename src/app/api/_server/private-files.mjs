const inlineImageTypes = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const unattachedFileGraceSeconds = 24 * 60 * 60;
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function accountId(account) {
  return Number.isSafeInteger(account?.id) && account.id > 0 ? account.id : null;
}

export function isOwnedPrivateFileId(account, fileId) {
  const userId = accountId(account);
  if (userId === null || typeof fileId !== "string") return false;

  const prefix = `private/${userId}/`;
  return fileId.length === prefix.length + 36
    && fileId.startsWith(prefix)
    && uuidV4.test(fileId.slice(prefix.length));
}

function imageContentType(value) {
  const type = typeof value === "string" ? value.split(";")[0].trim().toLowerCase() : "";
  return inlineImageTypes.has(type) ? type : "application/octet-stream";
}

export async function writePrivateFile(env, account, body, contentType) {
  const userId = accountId(account);
  if (userId === null) throw new TypeError("Invalid file owner");

  const fileId = `private/${userId}/${crypto.randomUUID()}`;
  const reserved = await env.DB.prepare(`
    INSERT INTO private_files (file_id, user_id, state, state_changed_at)
    SELECT ?, id, 'uploading', unixepoch() FROM users WHERE id = ?
    RETURNING file_id
  `).bind(fileId, userId).first();
  if (!reserved) throw new Error("File owner is unavailable");

  try {
    await env.BUCKET.put(fileId, body, {
      httpMetadata: { contentType: imageContentType(contentType) },
    });
    const uploaded = await env.DB.prepare(`
      UPDATE private_files SET state = 'ready', state_changed_at = unixepoch()
      WHERE file_id = ? AND user_id = ? AND state = 'uploading'
      RETURNING file_id
    `).bind(fileId, userId).first();
    if (!uploaded) throw new Error("Private file upload could not be finalized");
    return uploaded.file_id;
  } catch (error) {
    try {
      // A slow upload may finish after its registry entry already expired.
      // Requeue this reserved ID so its late object is removed as well.
      await env.DB.prepare(`
        INSERT INTO private_files (file_id, user_id, state)
        SELECT ?, ?, 'deleting'
        WHERE NOT EXISTS (SELECT 1 FROM private_file_references WHERE file_id = ?)
        ON CONFLICT(file_id) DO UPDATE SET state = 'deleting'
        WHERE private_files.user_id = excluded.user_id
      `).bind(fileId, userId, fileId).run();
      await deletePrivateFile(env, account, fileId);
    } catch {
      console.warn("Private file upload cleanup is pending");
    }
    throw error;
  }
}

export async function readPrivateFile(env, account, fileId, { headOnly = false } = {}) {
  const userId = accountId(account);
  if (userId === null || typeof fileId !== "string" || !fileId) return null;

  const reference = await env.DB.prepare(`
    SELECT 1 FROM private_file_references AS reference
    LEFT JOIN private_files AS file ON file.file_id = reference.file_id
    WHERE reference.user_id = ? AND reference.file_id = ?
      AND (file.file_id IS NULL OR (file.user_id = reference.user_id AND file.state = 'ready'))
    LIMIT 1
  `).bind(userId, fileId).first();
  if (!reference) return null;

  return headOnly ? env.BUCKET.head(fileId) : env.BUCKET.get(fileId);
}

export async function deletePrivateFile(env, account, fileId) {
  const userId = accountId(account);
  if (userId === null || typeof fileId !== "string" || !fileId) return false;

  // Claim in D1 before touching R2. Attachment triggers reject the file once claimed.
  const pending = await env.DB.prepare(`
    UPDATE private_files
    SET state = 'deleting', cleanup_attempts = cleanup_attempts + 1
    WHERE user_id = ? AND file_id = ? AND state IN ('ready', 'deleting')
      AND NOT EXISTS (SELECT 1 FROM private_file_references WHERE file_id = ?)
    RETURNING file_id
  `).bind(userId, fileId, fileId).first();
  if (!pending) return false;

  await env.BUCKET.delete(pending.file_id);
  // R2 delete is idempotent, so a failure here leaves a safe retry.
  await env.DB.prepare(`
    DELETE FROM private_files WHERE user_id = ? AND file_id = ? AND state = 'deleting'
  `).bind(userId, pending.file_id).run();
  return true;
}

export async function retryPrivateFileCleanup(env, account) {
  const userId = accountId(account);
  if (userId === null) return;

  // Expire interrupted uploads and unused writes atomically with the reference check.
  await env.DB.prepare(`
    UPDATE private_files SET state = 'deleting'
    WHERE file_id IN (
      SELECT file_id FROM private_files
      WHERE user_id = ? AND state IN ('ready', 'uploading')
        AND state_changed_at <= unixepoch() - ?
        AND NOT EXISTS (
          SELECT 1 FROM private_file_references AS reference
          WHERE reference.file_id = private_files.file_id
        )
      ORDER BY state_changed_at, file_id
      LIMIT 10
    )
  `).bind(userId, unattachedFileGraceSeconds).run();
  const { results } = await env.DB.prepare(`
    SELECT file_id FROM private_files
    WHERE user_id = ? AND state = 'deleting'
    ORDER BY cleanup_attempts, file_id
    LIMIT 10
  `).bind(userId).all();
  const attempts = await Promise.allSettled(
    results.map(({ file_id }) => deletePrivateFile(env, account, file_id)),
  );
  const failures = attempts.filter(({ status }) => status === "rejected");
  if (failures.length) {
    throw new AggregateError(failures.map(({ reason }) => reason), "Private file cleanup remains pending");
  }
}

export async function servePrivateFile(request, env, account, encodedFileId) {
  const headers = new Headers({
    "Cache-Control": "private, no-store",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
  });
  if (request.method !== "GET" && request.method !== "HEAD") {
    headers.set("Allow", "GET, HEAD");
    return new Response(null, { status: 405, headers });
  }

  if (typeof encodedFileId !== "string" || !encodedFileId) {
    return new Response(null, { status: 404, headers });
  }
  let fileId;
  try {
    fileId = decodeURIComponent(encodedFileId);
  } catch {
    return new Response(null, { status: 404, headers });
  }

  const headOnly = request.method === "HEAD";
  const file = await readPrivateFile(env, account, fileId, { headOnly });
  if (!file) return new Response(null, { status: 404, headers });

  const contentType = imageContentType(file.httpMetadata?.contentType);
  headers.set("Content-Type", contentType);
  headers.set("Content-Length", String(file.size));
  if (contentType === "application/octet-stream") {
    headers.set("Content-Disposition", "attachment");
    headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
  }
  return new Response(headOnly ? null : file.body, { headers });
}
