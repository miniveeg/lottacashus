import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

function bytesToFloat(bytes: Uint8Array, offset = 0): number {
  let value = 0;
  for (let i = 0; i < 4; i++) {
    value += bytes[offset + i]! / Math.pow(256, i + 1);
  }
  return value;
}

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

function truncateCrashMultiplier(value: number): number {
  return Math.trunc(value * 100) / 100;
}

async function crashPointFromSeeds(serverSeed: string, clientSeed: string, nonce: number): Promise<number> {
  const msg = `${clientSeed}:${nonce}:0`;
  const hash = await hmacSha256(serverSeed, msg);
  const float = bytesToFloat(hash, 0);
  const scaled = float * 16777216;
  const raw = (16777216 / (scaled + 1)) * 0.99;
  return truncateCrashMultiplier(Math.max(1, raw));
}

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
    const coinType = String(body?.coinType ?? "balance");

    if (!Number.isFinite(wager) || wager <= 0) {
      return jsonResponse({ error: "Invalid wager." }, 400);
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

    const { data: excluded } = await supabaseAdmin.rpc("check_user_self_exclusion", {
      p_user_id: user.id,
    });
    if (excluded) {
      return jsonResponse({ error: "Your account is self-excluded." }, 403);
    }

    const coinColumn = coinType === "sweeps_coins" ? "sweeps_coins" : "balance";

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select(coinColumn)
      .eq("id", user.id)
      .maybeSingle();

    const balance = Number(profile?.[coinColumn as keyof typeof profile] ?? 0);
    if (balance < wager) {
      return jsonResponse({ error: "Insufficient balance" }, 400);
    }

    const { data: seedData, error: seedError } = await supabaseAdmin.rpc(
      "consume_keno_nonce",
      { p_user_id: user.id, p_advance: 1 }
    );

    if (seedError) {
      console.error("consume_keno_nonce:", seedError);
      return jsonResponse({ error: seedError.message ?? "Could not load game seeds." }, 500);
    }

    const raw = (Array.isArray(seedData) ? seedData[0] : seedData) as
      | Record<string, unknown>
      | undefined;
    const serverSeed = raw?.server_seed ?? raw?.serverSeed;
    const clientSeed = raw?.client_seed ?? raw?.clientSeed ?? "default";
    const nonce = Number(raw?.nonce ?? raw?.next_nonce ?? 0);

    if (typeof serverSeed !== "string" || !serverSeed) {
      return jsonResponse({ error: "Could not load game seeds." }, 500);
    }

    const crashPoint = await crashPointFromSeeds(serverSeed, String(clientSeed), nonce);

    const { data: placed, error: placeError } = await supabaseAdmin.rpc(
      "place_crash_bet",
      {
        p_user_id: user.id,
        p_wager: wager,
        p_crash_point: crashPoint,
        p_nonce: nonce,
        p_coin_type: coinType,
      }
    );

    if (placeError) {
      console.error("place_crash_bet:", placeError);
      return jsonResponse({ error: placeError.message }, 400);
    }

    const row = (Array.isArray(placed) ? placed[0] : placed) as
      | Record<string, unknown>
      | undefined;

    return jsonResponse({
      betId: row?.bet_id,
      crashPoint,
      won: false,
      payout: 0,
      cashedAt: null,
      nonce,
      balance: Number(row?.out_balance ?? balance - wager),
      coinType,
    });
  } catch (err) {
    console.error("place-crash-bet:", err);
    return jsonResponse({ error: "Server error." }, 500);
  }
});
