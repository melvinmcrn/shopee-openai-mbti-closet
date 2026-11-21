import site, { authOrigin, resolveAccount } from "./index.mjs";
import { dispatchPlanner } from "./planner/api.mjs";
import { BriefValidationError } from "./planner/brief.mjs";
import { ShoppingDecisionUnavailableError } from "./planner/shopping.mjs";

function json(value, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}

const plannerWorker = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/planner" || url.pathname === "/planner/") {
      return site.fetch(new Request(new URL("/planner.html", url), request), env, ctx);
    }
    if (url.pathname !== "/api/planner") return site.fetch(request, env, ctx);
    const origin = authOrigin(env);
    if (request.method !== "POST") return json({message:"POST required."}, 405);
    if (url.origin !== origin || request.headers.get("Origin") !== origin) return json({ message:"Forbidden." }, 403);
    try {
      const account = await resolveAccount(request, env);
      if (!account) return json({message:"Sign in to open the planner."}, 401);
      const payload = await request.json().catch(() => null);
      if (!payload) return json({message:"Expected a planner request."}, 400);
      return json(await dispatchPlanner(env, account.id, payload.action, payload.input));
    } catch (error) {
      const status = error.status ?? (error instanceof BriefValidationError || error instanceof TypeError ? 400 : 503);
      const safeMessage = status < 500 || error instanceof ShoppingDecisionUnavailableError;
      return json({ message: safeMessage ? error.message : "The planner is temporarily unavailable." }, status);
    }
  },
};

export default plannerWorker;
