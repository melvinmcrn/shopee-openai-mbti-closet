import { after } from "next/server";
import { createVercelHandler } from "../../../../server/vercel-api.mjs";
import { vercelStorage } from "../../../../server/vercel-storage.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handle = createVercelHandler(process.env, vercelStorage);

function route(request: Request) {
  return handle(request, {
    waitUntil(task: Promise<unknown>) {
      after(async () => { await task; });
    },
  });
}

export { route as GET, route as HEAD, route as POST, route as PUT, route as PATCH, route as DELETE };
