import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import {
  resolveRouletteRound,
  roulettePayoutMultiplier,
  validateRouletteBet,
  type RouletteBetType,
} from "../_shared/roulette.ts";

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
    const betType = String(body?.betType ?? body?.bet ?? "").toLowerCase();
    const coinType = String(body?.coinType ?? "balance");

    const validationError = validateRouletteBet(wager, betType);
    if (validationError) {
      return jsonResponse({ error: validationError }, 400, req);
    }

    // SECURITY (audit R4): enforce a max-payout cap server-side. Green pays
    // 36× — without a cap, a large wager could produce an unbounded payout.
    // Same pattern as the Limbo cap (audit R3). Never trust the client.
    const ROULETTE_MAX_PAYOUT = 100_000;
    const rouletteMultiplier = betType === "green" ? 36 : 2;
    const potentialPayout = Math.round(wager * rouletteMultiplier * 100) / 100;
    if (potentialPayout > ROULETTE_MAX_PAYOUT) {
      return jsonResponse(
        { error: `Payout exceeds the maximum allowed (${ROULETTE_MAX_PAYOUT.toLocaleString()}). Lower your wager.` },
        400,
        req,
      );
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

    const coinColumn = coinType === "sweeps_coins" ? "sweeps_coins" : "balance";

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select(coinColumn)
      .eq("id", user.id)
      .maybeSingle();

    const balance = Number(profile?.[coinColumn as keyof typeof profile] ?? 0);
    if (balance < wager) {
      return jsonResponse({ error: "Insufficient balance" }, 400, req);
    }

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

    const typedBet = betType as RouletteBetType;
    const { resultPocket, resultColor, won } = await resolveRouletteRound(
      serverSeed,
      String(clientSeed),
      nonce,
      typedBet
    );
    const multiplier = roulettePayoutMultiplier(typedBet, won);
    const payout = won ? Math.round(wager * multiplier * 100) / 100 : 0;

    const { data: settled, error: settleError } = await supabaseAdmin.rpc(
      "settle_roulette_bet",
      {
        p_user_id: user.id,
        p_wager: wager,
        p_bet_type: typedBet,
        p_result_pocket: resultPocket,
        p_result_color: resultColor,
        p_won: won,
        p_payout: payout,
        p_nonce: nonce,
        p_coin_type: coinType,
      }
    );

    if (settleError) {
      console.error("settle_roulette_bet:", settleError);
      return jsonResponse({ error: settleError.message }, 400, req);
    }

    const row = (Array.isArray(settled) ? settled[0] : settled) as
      | Record<string, unknown>
      | undefined;
    const outBalance = row?.out_balance ?? row?.balance;

    return jsonResponse({
      betId: row?.bet_id,
      balance: Number(outBalance ?? balance),
      coinType,
      betType: typedBet,
      resultPocket,
      resultColor,
      won,
      payout,
      profit: payout - wager,
      multiplier: won ? multiplier : 0,
      nonce,
    });
  } catch (err) {
    console.error("place-roulette-bet:", err);
    return jsonResponse({ error: "Server error." }, 500, req);
  }
});
