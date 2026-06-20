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
    if (Deno.env.get("DENO_DEPLOYMENT_ID") !== undefined || Deno.env.get("SUPABASE_URL")) {
      console.warn(
        "ALLOWED_ORIGINS is not set; CORS is open to any origin. Set it in production to lock down the API."
      );
    }
    return "*";
  }
  const origin = req.headers.get("Origin") ?? "";
  const allowed = configured
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return allowed.includes(origin) ? origin : allowed[0] ?? "*";
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
