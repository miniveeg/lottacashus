import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { playKenoRound, validateKenoBet, type KenoRisk } from "../_shared/keno.ts";

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
    const risk = String(body?.risk ?? "classic") as KenoRisk;
    const picks = Array.isArray(body?.picks)
      ? body.picks.map((n: unknown) => Number(n)).filter((n: number) => Number.isFinite(n))
      : [];
    const coinType = String(body?.coinType ?? "balance");

    const validationError = validateKenoBet(picks, wager, risk);
    if (validationError) {
      return jsonResponse({ error: validationError }, 400, req);
    }

    // SECURITY (audit R5): max-payout cap. The Keno paytable's top multiplier
    // is 1000× (low/medium/high risk, 9 or 10 picks, all hits). The prior
    // value of 11000× did not match any paytable entry and made the
    // $100,000 cap reject any wager above $9 — unplayable at mid stakes.
    // Cap potential payout at 100,000 in the player's coin currency.
    const KENO_MAX_PAYOUT = 100_000;
    const kenoWorstCaseMultiplier = 1000;
    const kenoPotentialPayout = Math.round(wager * kenoWorstCaseMultiplier * 100) / 100;
    if (kenoPotentialPayout > KENO_MAX_PAYOUT) {
      return jsonResponse(
        { error: `Potential payout exceeds the maximum allowed (${KENO_MAX_PAYOUT.toLocaleString()}). Lower your wager.` },
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

    const seedRows = Array.isArray(seedData)
      ? seedData
      : seedData
        ? [seedData]
        : [];

    if (seedError) {
      console.error("consume_keno_nonce:", seedError);
      const msg = seedError.message ?? "Could not load game seeds.";
      if (msg.includes("consume_keno_nonce") && msg.includes("does not exist")) {
        return jsonResponse(
          {
            error:
              "Keno database functions are missing. Run migration 20250521110000_fix_keno_pf_seeds.sql in Supabase SQL Editor.",
          },
          500
        );
      }
      return jsonResponse({ error: msg }, 500, req);
    }

    const raw = seedRows[0] as Record<string, unknown> | undefined;
    const serverSeed = raw?.server_seed ?? raw?.serverSeed;
    const clientSeed = raw?.client_seed ?? raw?.clientSeed;
    const nonceVal = raw?.nonce ?? raw?.next_nonce;

    if (typeof serverSeed !== "string" || !serverSeed) {
      console.error("consume_keno_nonce empty:", seedData);
      return jsonResponse(
        {
          error:
            "Could not load game seeds. Run migration 20250521110000_fix_keno_pf_seeds.sql in Supabase SQL Editor.",
        },
        500
      );
    }

    const seedRow = {
      server_seed: serverSeed,
      client_seed: typeof clientSeed === "string" ? clientSeed : "default",
      nonce: Number(nonceVal ?? 0),
    };

    const sortedPicks = [...picks].sort((a, b) => a - b);
    const { drawn, hits, multiplier } = await playKenoRound({
      serverSeed: seedRow.server_seed,
      clientSeed: seedRow.client_seed,
      nonce: Number(seedRow.nonce),
      picks: sortedPicks,
      risk,
    });

    const payout = Math.round(wager * multiplier * 100) / 100;

    const { data: settled, error: settleError } = await supabaseAdmin.rpc(
      "settle_keno_bet",
      {
        p_user_id: user.id,
        p_wager: wager,
        p_risk: risk,
        p_picks: sortedPicks,
        p_drawn: drawn,
        p_hits: hits,
        p_multiplier: multiplier,
        p_payout: payout,
        p_nonce: Number(seedRow.nonce),
        p_coin_type: coinType,
      }
    );

    if (settleError) {
      console.error("settle_keno_bet:", settleError);
      return jsonResponse({ error: settleError.message }, 400, req);
    }

    const result = settled?.[0] as Record<string, unknown> | undefined;
    const outBalance = result?.out_balance ?? result?.balance;

    return jsonResponse({
      betId: result?.bet_id as string | undefined,
      balance: Number(outBalance ?? balance),
      coinType,
      drawn,
      hits,
      multiplier,
      payout,
      profit: payout - wager,
      nonce: Number(seedRow.nonce),
      picks: sortedPicks,
      risk,
    });
  } catch (err) {
    console.error("place-keno-bet:", err);
    return jsonResponse({ error: "Server error." }, 500, req);
  }
});
