import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

// Cron-callable endpoint that settles abandoned Crash bets (won=false,
// completed_at=null, older than 2 minutes). Without this, a user who places
// a bet and never cashes out leaves the bet open forever — eventually
// producing thousands of orphaned rows that bloat the DB and slow every
// query on `crash_bets`.
//
// Schedule: every 60 seconds via Supabase's scheduled functions or external
// cron (e.g. Vercel Cron, GitHub Actions, Render Cron).
//
// Auth: this endpoint is callable WITHOUT a user JWT, but it requires a
// `CRON_SECRET` header matching the server-side secret. This prevents
// anonymous abuse while letting cron invoke it.
//
// Supabase scheduled function example:
//   {
//     "name": "crash-settle-expired",
//     "schedule": "* * * * *",
//     "verify_jwt": false
//   }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(req) });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, req);
  }

  try {
    // Verify the cron secret. Both `x-cron-secret` header and `Authorization:
    // Bearer <secret>` are accepted for flexibility.
    const cronSecret = Deno.env.get("CRON_SECRET");
    if (!cronSecret) {
      return jsonResponse({ error: "CRON_SECRET is not configured." }, 500, req);
    }
    const headerSecret = req.headers.get("x-cron-secret")
      ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (headerSecret !== cronSecret) {
      return jsonResponse({ error: "Unauthorized." }, 401, req);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data, error } = await supabase.rpc("crash_settle_expired_bets");

    if (error) {
      console.error("crash_settle_expired_bets:", error);
      return jsonResponse({ error: error.message }, 500, req);
    }

    const settled = typeof data === "number" ? data : 0;
    if (settled > 0) {
      console.log(`[crash-settle-expired] settled ${settled} abandoned bet(s).`);
    }
    return jsonResponse({ success: true, settled });
  } catch (err) {
    console.error("crash-settle-expired:", err);
    return jsonResponse({ error: "Server error." }, 500, req);
  }
});
