import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { resolveLimboRound, validateLimboBet } from "../_shared/limbo.ts";
import { extractClientRequestId } from "../_shared/hardened.ts";

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
    const wager = Number(body?.wager);
    const target = Number(body?.target ?? body?.targetMultiplier);
    const coinType = String(body?.coinType ?? "balance");
    const clientRequestId = extractClientRequestId(body ?? null);

    const validationError = validateLimboBet(wager, target);
    if (validationError) {
      return jsonResponse({ error: validationError }, 400, req);
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

    // Self-exclusion + balance check + atomic debit now live inside
    // place_limbo_bet (reject_if_self_excluded + game_debit + ON CONFLICT
    // idempotency). The redundant edge-side checks were removed.
    const { data: seedData, error: seedError } = await supabaseAdmin.rpc(
      "consume_keno_nonce",
      { p_user_id: user.id, p_advance: 1 }
    );

    if (seedError) {
      console.error("consume_keno_nonce:", seedError);
      return jsonResponse({ error: seedError.message ?? "Could not load game seeds." }, 500, req);
    }

    const raw = (Array.isArray(seedData) ? seedData[0] : seedData) as
      | Record<string, unknown>
      | undefined;
    const serverSeed = raw?.server_seed ?? raw?.serverSeed;
    const clientSeed = raw?.client_seed ?? raw?.clientSeed ?? "default";
    const nonce = Number(raw?.nonce ?? raw?.next_nonce ?? 0);

    if (typeof serverSeed !== "string" || !serverSeed) {
      return jsonResponse({ error: "Could not load game seeds." }, 500, req);
    }

    const { resultMultiplier, won } = await resolveLimboRound(
      serverSeed,
      String(clientSeed),
      nonce,
      target
    );
    const payout = won ? Math.round(wager * target * 100) / 100 : 0;

    const { data: placed, error: placeError } = await supabaseAdmin.rpc(
      "place_limbo_bet",
      {
        p_user_id: user.id,
        p_wager: wager,
        p_target_multiplier: target,
        p_result_multiplier: resultMultiplier,
        p_won: won,
        p_payout: payout,
        p_nonce: nonce,
        p_coin_type: coinType,
        p_client_request_id: clientRequestId,
      }
    );

    if (placeError) {
      console.error("place_limbo_bet:", placeError);
      return jsonResponse({ error: placeError.message }, 400, req);
    }

    const row = (Array.isArray(placed) ? placed[0] : placed) as
      | Record<string, unknown>
      | undefined;
    const outBalance = row?.out_balance ?? row?.balance;

    return jsonResponse({
      betId: row?.bet_id,
      balance: Number(outBalance ?? 0),
      coinType,
      target,
      resultMultiplier,
      won,
      payout,
      profit: payout - wager,
      nonce,
    });
  } catch (err) {
    console.error("place-limbo-bet:", err);
    return jsonResponse({ error: "Server error." }, 500, req);
  }
});
