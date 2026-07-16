import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(req) });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, req);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "Log in required." }, 401, req);

    const body = await req.json();
    const betId = String(body?.betId ?? "");
    const cashedAtMultiplier = Number(body?.cashedAtMultiplier ?? 0);
    const coinType = String(body?.coinType ?? "balance");

    // MEDIUM (audit fix-games): reject cashout at exactly 1.00×. The crash
    // formula's minimum is `Math.max(1, raw)` → 1.00×, so a 1.00× cashout
    // would always succeed (1.00 <= crash_point) and return the wager
    // unchanged — a break-even bot could play indefinitely with zero risk,
    // defeating the house edge. Minimum cashout must be 1.01×.
    if (!betId || !Number.isFinite(cashedAtMultiplier) || cashedAtMultiplier < 1.01) {
      return jsonResponse({ error: "Minimum cash-out is 1.01×." }, 400, req);
    }

    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const {
      data: { user },
      error: userError,
    } = await supabaseUser.auth.getUser();

    if (userError || !user) return jsonResponse({ error: "Invalid session." }, 401, req);

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: excluded } = await supabaseAdmin.rpc("check_user_self_exclusion", {
      p_user_id: user.id,
    });
    if (excluded) {
      return jsonResponse({ error: "Your account is self-excluded." }, 403, req);
    }

    const { data: result, error: cashError } = await supabaseAdmin.rpc(
      "cash_out_crash",
      {
        p_user_id: user.id,
        p_bet_id: betId,
        p_cashed_at: cashedAtMultiplier,
      }
    );

    if (cashError) {
      console.error("cash_out_crash:", cashError);
      return jsonResponse({ error: cashError.message }, 400, req);
    }

    // The SQL function now returns: (out_balance, payout, cashed_at, success,
    // crash_point, already_settled). When success=false, the bet was settled
    // as a loss because the user tried to cash out after the crash point.
    // We return the crash_point so the client can show the crash animation.
    const row = (Array.isArray(result) ? result[0] : result) as
      | Record<string, unknown>
      | undefined;

    const success = Boolean(row?.success);
    const crashPoint = row?.crash_point !== null && row?.crash_point !== undefined
      ? Number(row.crash_point)
      : null;
    const payout = Number(row?.payout ?? 0);
    const balance = Number(row?.out_balance ?? 0);
    const alreadySettled = Boolean(row?.already_settled);

    const cashedAt = Number(row?.cashed_at ?? cashedAtMultiplier);
    return jsonResponse({
      betId,
      // Client reads `cashedAt` (see src/lib/crash.ts). Keep
      // `cashedAtMultiplier` as a backwards-compatible alias.
      cashedAt,
      cashedAtMultiplier: cashedAt,
      payout,
      balance,
      won: success,
      // Reveal the crash point to the client only when the round is over
      // (success=false OR alreadySettled=true). The client uses this to
      // animate the crash and is NOT used for payout calculation.
      crashPoint,
      alreadySettled,
      coinType,
    });
  } catch (err) {
    console.error("cash-out-crash:", err);
    return jsonResponse({ error: "Server error." }, 500, req);
  }
});
