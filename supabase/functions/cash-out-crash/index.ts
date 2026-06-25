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

    if (!betId || !Number.isFinite(cashedAtMultiplier) || cashedAtMultiplier < 1) {
      return jsonResponse({ error: "Invalid cash-out params." }, 400, req);
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

    const row = (Array.isArray(result) ? result[0] : result) as
      | Record<string, unknown>
      | undefined;

    return jsonResponse({
      betId,
      cashedAtMultiplier,
      payout: Number(row?.payout ?? 0),
      balance: Number(row?.out_balance ?? 0),
      won: true,
      coinType,
    });
  } catch (err) {
    console.error("cash-out-crash:", err);
    return jsonResponse({ error: "Server error." }, 500, req);
  }
});
