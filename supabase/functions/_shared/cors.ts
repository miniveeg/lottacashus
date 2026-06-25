/**
 * Resolve the allowed CORS origin.
 *
 * In production, set `ALLOWED_ORIGINS` (comma-separated) in Edge Function
 * secrets to the exact list of frontend URLs (e.g.
 * `https://lottacash.com,https://www.lottacash.com`). When unset, we fall
 * back to `*` so local development keeps working — but a warning is logged
 * so the misconfiguration is visible in production deployments.
 */
function getAllowedOrigin(req: Request): string {
  const configured = Deno.env.get("ALLOWED_ORIGINS")?.trim();
  if (!configured) {
    // SECURITY: in production (Deno Deploy / Supabase URL set), refuse to
    // serve cross-origin requests when ALLOWED_ORIGINS is unset. Returning
    // "null" makes the browser block the response. Local dev (no env set)
    // still gets "*" so `vite dev` works.
    const isProd = Deno.env.get("DENO_DEPLOYMENT_ID") !== undefined || Deno.env.get("SUPABASE_URL");
    if (isProd) {
      console.error("ALLOWED_ORIGINS is not set in production — refusing cross-origin requests.");
      return "null";
    }
    return "*";
  }
  const origin = req.headers.get("Origin") ?? "";
  const allowed = configured
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return allowed.includes(origin) ? origin : "null";
}

export function corsHeaders(req?: Request) {
  const origin = req ? getAllowedOrigin(req) : "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-cron-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

export function jsonResponse(body: unknown, status = 200, req?: Request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}
