/**
 * HotelOps · Anthropic API proxy (Cloudflare Worker)
 * =================================================================
 * Deploy this Worker (`wrangler deploy`) and point HotelOps at its URL via
 *   Settings → System → Anthropic Proxy URL
 * The browser app will then call the Worker, the Worker calls Anthropic with
 * the API key stored as a Worker secret, and the key never ships to clients.
 *
 * REQUIRED secrets / vars (set with `wrangler secret put` or in the dashboard):
 *   ANTHROPIC_API_KEY  — your Anthropic key (kept server-side)
 *   PROXY_AUTH_TOKEN   — (optional) a shared secret the client must send in
 *                        the X-HotelOps-Auth header. If unset, the proxy is
 *                        open to anyone who knows the URL.
 *   ALLOWED_ORIGINS    — (optional) CSV of origins to allow via CORS, e.g.
 *                        "file://,https://app.hotelops.app". Defaults to "*".
 *
 * Endpoint shape: POST /messages — body is forwarded straight to Anthropic's
 * /v1/messages. We strip any anthropic-* headers from the client and inject
 * the right ones server-side.
 */

const ANTHROPIC_BASE = "https://api.anthropic.com";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS pre-flight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(request, env) });
    }

    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405, request, env);
    }

    if (!env.ANTHROPIC_API_KEY) {
      return json({ error: "Worker is missing ANTHROPIC_API_KEY secret" }, 500, request, env);
    }

    // Optional shared-secret gate
    if (env.PROXY_AUTH_TOKEN) {
      const provided = request.headers.get("X-HotelOps-Auth");
      if (provided !== env.PROXY_AUTH_TOKEN) {
        return json({ error: "Unauthorized" }, 401, request, env);
      }
    }

    // Accept either /messages (preferred) or pass-through to /v1/*
    const path = url.pathname === "/" || url.pathname === "/messages"
      ? "/v1/messages"
      : url.pathname.startsWith("/v1/") ? url.pathname : `/v1${url.pathname}`;

    let body;
    try {
      body = await request.text();
    } catch {
      return json({ error: "Could not read body" }, 400, request, env);
    }

    // Forward to Anthropic
    let upstream;
    try {
      upstream = await fetch(`${ANTHROPIC_BASE}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body,
      });
    } catch (err) {
      return json({ error: `Upstream fetch failed: ${err.message}` }, 502, request, env);
    }

    // Stream response body; copy status + content-type, strip anthropic-internal headers
    const respHeaders = new Headers();
    upstream.headers.forEach((v, k) => {
      if (/^x-amzn|^cf-|^server$|^via$|^anthropic-/i.test(k)) return;
      respHeaders.set(k, v);
    });
    Object.entries(corsHeaders(request, env)).forEach(([k, v]) => respHeaders.set(k, v));

    return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
  },
};

function corsHeaders(request, env) {
  const allowed = (env?.ALLOWED_ORIGINS || "*").split(",").map(s => s.trim()).filter(Boolean);
  const reqOrigin = request.headers.get("Origin") || "";
  const origin = allowed.includes("*") ? "*"
    : allowed.includes(reqOrigin) ? reqOrigin
    : allowed[0] || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-HotelOps-Auth, Anthropic-Version",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(payload, status, request, env) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(request, env) },
  });
}
