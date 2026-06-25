import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

const SYMBOLS = ["Cherry", "Bell", "Seven", "Bar", "Watermelon", "Star", "Crown"];

// 96.5% RTP paytable (matches src/lib/local-play.ts SLOTS_PAYOUTS).
// 3-of-a-kind only — no 2-cherry or 1-cherry side payouts.
//   3-of-a-kind EV: (3+5+8+15+30+80+190)/343 = 331/343 = 96.5%.
// (Each symbol has P=1/7 per reel; P(3-of-a-kind for one symbol) = 1/343.)
const PAYTABLE: Record<number, number> = {
  0: 3,    // Cherry
  1: 5,    // Bell
  2: 8,    // Seven
  3: 15,   // Bar
  4: 30,   // Watermelon
  5: 80,   // Star
  6: 190,  // Crown
};

async function hmacSha256(key: string, message: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return new Uint8Array(sig);
}

function bytesToFloat(bytes: Uint8Array, offset = 0): number {
  let value = 0;
  for (let i = 0; i < 4; i++) {
    value += bytes[offset + i]! / Math.pow(256, i + 1);
  }
  return value;
}

function pickSymbol(hash: Uint8Array, offset: number): number {
  const float = bytesToFloat(hash, offset * 4);
  return Math.floor(float * SYMBOLS.length) % SYMBOLS.length;
}

function determineMultiplier(reels: number[]): { won: boolean; multiplier: number } {
  const [a, b, c] = reels;

  // 3-of-a-kind only (matches local-play: no 2-cherry or 1-cherry side payouts).
  if (a === b && b === c) {
    return { won: true, multiplier: PAYTABLE[a] ?? 0 };
  }

  return { won: false, multiplier: 0 };
}

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
    const coinType = String(body?.coinType ?? "balance");

    if (!Number.isFinite(wager) || wager < 1) {
      return jsonResponse({ error: "Minimum bet is 1 SC or GC." }, 400, req);
    }

    // SECURITY (audit R5): max-payout cap. Slots max multiplier is 190×
    // (Crown 3-of-a-kind). Cap potential payout to bound treasury risk.
    const SLOTS_MAX_PAYOUT = 100_000;
    const slotsWorstCaseMultiplier = 190;
    const slotsPotentialPayout = Math.round(wager * slotsWorstCaseMultiplier * 100) / 100;
    if (slotsPotentialPayout > SLOTS_MAX_PAYOUT) {
      return jsonResponse(
        { error: `Potential payout exceeds the maximum allowed (${SLOTS_MAX_PAYOUT.toLocaleString()}). Lower your wager.` },
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

    const msg = `${String(clientSeed)}:${nonce}:0,1,2`;
    const hash = await hmacSha256(serverSeed, msg);

    const reels = [
      pickSymbol(hash, 0),
      pickSymbol(hash, 1),
      pickSymbol(hash, 2),
    ];

    const { won, multiplier } = determineMultiplier(reels);
    const payout = won ? Math.round(wager * multiplier * 100) / 100 : 0;

    const { data: settled, error: settleError } = await supabaseAdmin.rpc(
      "settle_slots_bet",
      {
        p_user_id: user.id,
        p_wager: wager,
        p_reels: reels,
        p_won: won,
        p_multiplier: multiplier,
        p_payout: payout,
        p_nonce: nonce,
        p_coin_type: coinType,
      }
    );

    if (settleError) {
      console.error("settle_slots_bet:", settleError);
      return jsonResponse({ error: settleError.message }, 400, req);
    }

    const settleRow = (Array.isArray(settled) ? settled[0] : settled) as
      | Record<string, unknown>
      | undefined;

    return jsonResponse({
      reels,
      symbols: reels.map((i) => SYMBOLS[i]),
      won,
      multiplier,
      payout,
      outBalance: Number(settleRow?.out_balance ?? balance - wager + payout),
      gameId: settleRow?.game_id,
      nonce,
      coinType,
    });
  } catch (err) {
    console.error("place-slots-bet:", err);
    return jsonResponse({ error: "Server error." }, 500, req);
  }
});
