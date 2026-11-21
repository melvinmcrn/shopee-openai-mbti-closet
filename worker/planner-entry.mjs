import site from "./index.mjs";
import { dispatchPlanner } from "./planner/api.mjs";
import { BriefValidationError } from "./planner/brief.mjs";

const origin = "https://mbti-closet.stonyimpala.chatgpt.site";
function json(value, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/planner" || url.pathname === "/planner/") {
      return site.fetch(new Request(new URL("/planner.html", url), request), env, ctx);
    }
    if (url.pathname !== "/api/planner") return site.fetch(request, env, ctx);
    if (request.method !== "POST") return json({message:"POST required."}, 405);
    if (url.origin !== origin || request.headers.get("Origin") !== origin) return json({ message:"Forbidden." }, 403);
    try {
      const sessionResponse = await site.fetch(new Request(origin + "/api/account", {
        method: "POST", headers: { Origin: origin, Cookie: request.headers.get("Cookie") ?? "" },
      }), env, ctx);
      if (!sessionResponse.ok) return json({message:"Sign-in is unavailable."}, sessionResponse.status);
      const session = await sessionResponse.json();
      if (!session?.user) return json({message:"Sign in to open the planner."}, 401);
      if (!Number.isSafeInteger(session.user.id)) return json({message:"Sign in again after the account service is available."}, 503);
      const payload = await request.json().catch(() => null);
      if (!payload) return json({message:"Expected a planner request."}, 400);
      return json(await dispatchPlanner(env, session.user.id, payload.action, payload.input));
    } catch (error) {
      const status = error.status ?? (error instanceof BriefValidationError || error instanceof TypeError ? 400 : 503);
      return json({ message: status < 500 ? error.message : "The planner is temporarily unavailable." }, status);
    }
  },
};
