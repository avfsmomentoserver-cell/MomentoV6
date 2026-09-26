// functions/index.ts — Momento platform backend entrypoint.
// Every route dispatches into the MomentoCore Durable Object ("global" instance).

export { MomentoCore } from "./core";

type Env = { DO: Fetcher; CORS_ORIGINS?: string };

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Momento-Ts, X-Momento-Nonce, X-Momento-Signature",
  "Access-Control-Expose-Headers": "X-Momento-As-Of",
  "Access-Control-Max-Age": "86400",
};

/** CORS allow-list (Platform Book S-8): CORS_ORIGINS="https://a.com,https://b.com"; unset → "*". */
function corsFor(request: Request, env: Env): Record<string, string> {
  const allow = (env.CORS_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!allow.length || allow.includes("*")) return CORS;
  const origin = request.headers.get("Origin") ?? "";
  return { ...CORS, "Access-Control-Allow-Origin": allow.includes(origin) ? origin : allow[0], Vary: "Origin" };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsFor(request, env);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    const wrapped = new Request(request.url, request); // 2-arg form preserves all headers
    wrapped.headers.set("X-Rork-DO-Class", "MomentoCore");
    wrapped.headers.set("X-Rork-DO-Id", "global");
    const response = await env.DO.fetch(wrapped);
    const headers = new Headers(response.headers);
    for (const [k, v] of Object.entries(cors)) headers.set(k, v);
    return new Response(response.body, { status: response.status, headers });
  },
} satisfies ExportedHandler<Env>;
