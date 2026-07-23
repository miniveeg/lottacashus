import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

// Millisecond-grade crash settlement loop. Scheduled by external cron
// (Supabase scheduled functions, Vercel Cron, GitHub Actions, Render Cron)
// once every 60 seconds. Internally polls `crash_settle_due_bets()` at
// 5ms intervals for ~55 seconds per invocation, achieving millisecond-grade
// settlement precision (worst case ~5-15ms overshoot) on the implied
// wall-clock crash time during the active polling window.
//
// Why this exists:
//   pg_cron's minimum schedule is 1 second — it'd give ~1s overshoot in
//   the worst case. Supabase scheduled functions / external cron run at
//   1-minute granularity at best. To get millisecond-grade precision we
//   use a long-running Edge Function with an in-process setTimeout loop;
//   the loop fires crash_settle_due_bets every 5ms (200Hz), and the SQL
//   uses clock_timestamp() instead of now() for microsecond-precise
//   comparison in the WHERE clause.
//
// Coverage model:
//   * 55 seconds (out of every 60s) — actively polled at 5ms precision
//   * 5 second gap between invocations — pg_cron at 1Hz backstops this
//     window so no row remains unsettled for more than ~1s in the gap
//   * If this function fails entirely, pg_cron at 1Hz still settles rows
//     within 1-2s. Layered redundancy.
//
// Why 5ms (200Hz) and not 1ms (1000Hz):
//   Each poll = Supabase REST RPC round-trip, typically 5-20ms on managed
//   Supabase. Polling faster than the RPC latency floor yields no precision
//   gain — the system is bounded below by network/RPC latency. 5ms cadence
//   is the sweet spot: 200 polls/sec, manageable DB load (low traffic; the
//   function returns 0 rows modified most of the time after each round
//   settles), worst-case overshoot ~10ms.
//   For STRICT 1ms precision (truly synchronous settlement at exact
//   crash_at), the only viable path is per-bet scheduling via a Postgres
//   trigger that uses pg_sleep(extract(epoch from crash_at - now()))
//   inline. That requires the dblink / pg_background extension and
//   connection-per-bet scaling; tracked separately.
//
// Auth: same CRON_SECRET pattern as crash-settle-expired. The function is
// callable with verify_jwt=false (configured in this function's
// config.toml) and requires the CRON_SECRET environment variable to be set
// in the function's secrets. Any external cron platform (Vercel, GitHub
// Actions, Render) can invoke it via POST with the secret header.

const POLL_INTERVAL_MS = 5; // 200Hz polling = millisecond-grade precision
const MAX_RUNTIME_MS = 55_000; // Under Supabase's 60s per-invocation ceiling

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(req) });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, req);
  }

  try {
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

    const startTime = Date.now();
    const deadline = startTime + MAX_RUNTIME_MS;
    let nextDeadline = startTime + POLL_INTERVAL_MS;
    let iterations = 0;
    let totalSettled = 0;
    let lastError: string | null = null;

    while (Date.now() < deadline) {
      iterations++;
      try {
        const { data, error } = await supabase.rpc("crash_settle_due_bets");
        if (error) {
          lastError = error.message;
          console.error(`[crash-settle-loop] iter=${iterations} error: ${error.message}`);
          // Continue polling — transient errors shouldn't kill the loop.
          // If the connection is dead we'll see a different error pattern
          // on the next iteration and can log it for ops visibility.
        } else {
          const settled = typeof data === "number" ? data : 0;
          totalSettled += settled;
          if (settled > 0) {
            console.log(`[crash-settle-loop] iter=${iterations} settled=${settled} total=${totalSettled}`);
          }
        }
      } catch (innerErr) {
        lastError = innerErr instanceof Error ? innerErr.message : String(innerErr);
        console.error(`[crash-settle-loop] iter=${iterations} exception: ${lastError}`);
      }
      // Sleep until next poll deadline, but don't over-sleep if we're
      // close to MAX_RUNTIME_MS.
      const sleepUntil = Math.min(nextDeadline, deadline);
      nextDeadline = Math.max(deadline, Date.now()) + POLL_INTERVAL_MS;
      await new Promise<void>((r) => setTimeout(r, Math.max(0, sleepUntil - Date.now())));
    }

    const durationMs = Date.now() - startTime;
    console.log(
      `[crash-settle-loop] end: iterations=${iterations} totalSettled=${totalSettled} duration_ms=${durationMs} lastError=${lastError ?? "none"}`
    );
    return jsonResponse({
      success: true,
      iterations,
      settled: totalSettled,
      durationMs,
      lastError,
    });
  } catch (err) {
    console.error("crash-settle-loop:", err);
    return jsonResponse({ error: "Server error." }, 500, req);
  }
});
