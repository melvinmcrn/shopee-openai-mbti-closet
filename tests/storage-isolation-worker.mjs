/* global TEST_MIGRATIONS */
import { handleApi, resolveAccount } from "../src/app/api/_server/handle-api.mjs";
import { deletePrivateFile, isOwnedPrivateFileId, writePrivateFile } from "../src/app/api/_server/private-files.mjs";
import { userData } from "../src/app/api/_server/user-data.mjs";

// This entry point runs only in the local test. Production requests use the normal
// Worker. The test routes exercise the server-side methods through real bindings.
const testWorker = {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (!pathname.startsWith("/_test/")) return handleApi(request, env, ctx);

    const { args } = await request.json();
    if (pathname === "/_test/seed") {
      for (const sql of TEST_MIGRATIONS) await env.DB.prepare(sql).run();
      const insert = env.DB.prepare("INSERT INTO users (auth_provider, auth_subject, email) VALUES ('google', ?, ?)");
      await env.DB.batch(args.map(([subject, email]) => insert.bind(subject, email)));
      return Response.json(true);
    }

    const account = await resolveAccount(request, env);
    if (!account) return Response.json(null, { status: 401 });

    switch (pathname) {
      case "/_test/data": {
        const [method, ...values] = args;
        const data = userData(env.DB, account.id);
        if (!Object.hasOwn(data, method)) return Response.json(null, { status: 404 });
        try {
          return Response.json(await data[method](...values));
        } catch (error) {
          return Response.json({ message: error.message }, { status: 409 });
        }
      }
      case "/_test/write-file": {
        const [body, contentType] = args;
        return Response.json(await writePrivateFile(env, account, Uint8Array.from(atob(body), (byte) => byte.charCodeAt(0)), contentType));
      }
      case "/_test/delete-file":
        return Response.json(await deletePrivateFile(env, account, args[0]));
      case "/_test/age-file": {
        const update = await env.DB.prepare(
          "UPDATE private_files SET state_changed_at = 0 WHERE user_id = ? AND file_id = ?",
        ).bind(account.id, args[0]).run();
        return Response.json(update.meta.changes === 1);
      }
      case "/_test/file-state": {
        const [id] = args;
        if (!isOwnedPrivateFileId(account, id)) return Response.json(null, { status: 404 });

        const row = await env.DB.prepare(
          "SELECT state FROM private_files WHERE user_id = ? AND file_id = ?",
        ).bind(account.id, id).first();
        const object = await env.BUCKET.head(id);
        return Response.json({ state: row?.state ?? null, inBucket: Boolean(object) });
      }
      default:
        return Response.json(null, { status: 404 });
    }
  },
};

export default testWorker;
