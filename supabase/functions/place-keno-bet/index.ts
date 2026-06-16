import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { playKenoRound, validateKenoBet, type KenoRisk } from "../_shared/keno.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "Log in required." }, 401);

    const body = await req.json();
    const wager = Number(body?.wager);
    const risk = String(body?.risk ?? "classic") as KenoRisk;
    const picks = Array.isArray(body?.picks)
      ? body.picks.map((n: unknown) => Number(n)).filter((n: number) => Number.isFinite(n))
      : [];

    const validationError = validateKenoBet(picks, wager, risk);
    if (validationError) {
      return jsonResponse({ error: validationError }, 400);
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

    if (userError || !user) return jsonResponse({ error: "Invalid session." }, 401);

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("balance")
      .eq("id", user.id)
      .maybeSingle();

    const balance = Number(profile?.balance ?? 0);
    if (balance < wager) {
      return jsonResponse({ error: "Insufficient balance" }, 400);
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
      return jsonResponse({ error: msg }, 500);
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
      }
    );

    if (settleError) {
      console.error("settle_keno_bet:", settleError);
      return jsonResponse({ error: settleError.message }, 400);
    }

    const result = settled?.[0] as Record<string, unknown> | undefined;
    const outBalance = result?.out_balance ?? result?.balance;

    return jsonResponse({
      betId: result?.bet_id as string | undefined,
      balance: Number(outBalance ?? balance),
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
    return jsonResponse({ error: "Server error." }, 500);
  }
});
