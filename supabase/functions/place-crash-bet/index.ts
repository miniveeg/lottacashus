import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { extractClientRequestId } from "../_shared/hardened.ts";

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

// Inverse of the client animation curve `current = e^(k * t^1.6)`, with
//   CRASH_SPEED_K = 0.008 and CRASH_SPEED_EXP = 1.6 (see src/pages/Crash/Crash.tsx).
// Given crash_point, returns the wall-clock seconds it should take the curve
// to reach that multiplier, plus a small buffer to absorb clock skew between
// the client's handleBet and the server's now() snapshot.
//
// The server's 1-second crash_settle_due_bets cron filters active rows by
// `crash_at <= now()`. Setting crash_at = bet_creation_ts + this duration
// makes the cron fire UPDATE within ~1s of the implied crash moment, so the
// client's realtime/poll paths reveal the round outcome promptly without
// the user needing to click Cash Out.
//
// We do NOT return crash_point to the client here — provably-fair integrity
// requires the client NOT learn crash_point during the round. The server's
// UPDATE after the cron fires triggers crash_bets_safe to expose crash_point.
function roundDurationMsFromCrashPoint(crashPoint: number): number {
  if (!Number.isFinite(crashPoint) || crashPoint <= 1) {
    // floor at 1s — crash_point 1.00 is technically a same-tick bust; the
    // 1s floor just keeps the cron interval realistic.
    return 1000;
  }
  const CRASH_SPEED_K = 0.008;
  const CRASH_SPEED_EXP = 1.6;
  const tSeconds = (Math.log(crashPoint) / CRASH_SPEED_K) ** (1 / CRASH_SPEED_EXP);
  // CRITICAL: the buffer MUST exceed Supabase RPC return latency (~30-80ms
  // typical) so server fires AFTER the client's visual crash_point crossing.
  // If server fires before, the chart shows "Crashed at X.XXx" while still
  // climbing UP — a worse UX than overshooting by 100ms.
  //
  // +150ms buffer = RPC return latency (30-80ms) + client render frame
  // (~16-33ms at 30-60fps) + safety margin. Combined with the
  // crash-settle-loop Edge Function (5ms / 200Hz internal polling) and
  // crash_settle_due_bets() using clock_timestamp() (microsecond precision
  // in the SQL comparison), the typical overshoot is ~70-120ms after the
  // client's visual crash_point crossing.
  //
  // Tightest achievable precision is bounded by Supabase RPC return latency
  // (~30-80ms), NOT by polling cadence. Polling is fast; RPC round-trip is
  // the floor. For sub-50ms overshoot (true millisecond precision per-bet),
  // per-bet pg_sleep scheduling via a Postgres trigger is required (dblink /
  // pg_background extension + connection-per-bet scaling; tracked
  // separately as migration 011).
  //
  // Notes for reviewers:
  //   - buffer = +150ms is in the safe direction (server LATER than client)
  //   - buffer = +30ms or smaller would let server fire BEFORE client
  //     visual crossing in some network conditions (higher-latency regions,
  //     loaded Postgres) — visibly shows "Crashed" while chart still climbs
  return Math.ceil(tSeconds * 1000) + 150;
}

async function crashPointFromSeeds(serverSeed: string, clientSeed: string, nonce: number): Promise<number> {
  const msg = `${clientSeed}:${nonce}:0`;
  const hash = await hmacSha256(serverSeed, msg);
  const float = bytesToFloat(hash, 0);
  const scaled = float * 16777216;
  // 96.5% RTP: P(point >= x) = 0.965/x  =>  EV of "cash at t" = 0.965.
  const raw = (16777216 / (scaled + 1)) * 0.965;
  return truncateCrashMultiplier(Math.max(1, raw));
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
    // Idempotency key — client supplies for retries, server generates fresh
    // for new requests. SQL UNIQUE (user_id, client_request_id) collapses
    // duplicate retries into one row.
    const clientRequestId = extractClientRequestId(body ?? null);

    if (!Number.isFinite(wager) || wager < 1) {
      return jsonResponse({ error: "Minimum bet is 1 SC or GC." }, 400, req);
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

    // Self-exclusion check is now enforced inside place_crash_bet via
    // reject_if_self_excluded (defense-in-depth). The redundant edge-side
    // check was removed and balance is no longer read here — the SQL
    // placer handles balance check + debit atomically with SELECT FOR UPDATE.
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

    const crashPoint = await crashPointFromSeeds(serverSeed, String(clientSeed), nonce);
    // Round duration: milliseconds the client curve should take to reach
    // crashPoint. Computed server-side here (the client never sees this
    // value) and stored on the crash_bets row so the settle-due cron can
    // fire UPDATE within ~1s of the actual crash moment. See
    // roundDurationMsFromCrashPoint above for the inverse-curve derivation.
    const roundDurationMs = roundDurationMsFromCrashPoint(crashPoint);

    const { data: placed, error: placeError } = await supabaseAdmin.rpc(
      "place_crash_bet",
      {
        p_user_id: user.id,
        p_wager: wager,
        p_crash_point: crashPoint,
        p_nonce: nonce,
        p_coin_type: coinType,
        p_client_request_id: clientRequestId,
        p_round_duration_ms: roundDurationMs,
      }
    );

    if (placeError) {
      console.error("place_crash_bet:", placeError);
      return jsonResponse({ error: placeError.message }, 400, req);
    }

    const row = (Array.isArray(placed) ? placed[0] : placed) as
      | Record<string, unknown>
      | undefined;

    return jsonResponse({
      betId: row?.bet_id ?? row?.out_bet_id ?? row?.id,
      bet_id: row?.bet_id ?? row?.out_bet_id ?? row?.id,
      // SECURITY: do NOT return crashPoint here. The client learns the crash
      // point only when the round resolves (settle-loss / a dedicated reveal
      // endpoint). Returning it in the bet-creation response lets a client
      // know the bust point before deciding when to cash out — defeating the
      // game. The Crash UI derives its animation curve from the server's
      // cash_out_crash / crash_settle_loss responses instead.
      won: false,
      payout: 0,
      cashedAt: null,
      nonce,
      balance: Number(row?.out_balance ?? 0),
      coinType,
    });
  } catch (err) {
    console.error("place-crash-bet:", err);
    return jsonResponse({ error: "Server error." }, 500, req);
  }
});
