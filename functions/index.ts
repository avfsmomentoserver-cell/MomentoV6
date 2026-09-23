// functions/index.ts — Momento platform backend entrypoint.
// Every route dispatches into the MomentoCore Durable Object ("global" instance).

export { MomentoCore } from "./core";

type Env = { DO: Fetcher };

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    const wrapped = new Request(request.url, request); // 2-arg form preserves all headers
    wrapped.headers.set("X-Rork-DO-Class", "MomentoCore");
    wrapped.headers.set("X-Rork-DO-Id", "global");
    const response = await env.DO.fetch(wrapped);
    const headers = new Headers(response.headers);
    for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
    return new Response(response.body, { status: response.status, headers });
  },
} satisfies ExportedHandler<Env>;
