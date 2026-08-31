import { invokeEdgeFunction } from "./edgeFunctions";
import { supabase, isSupabaseConfigured } from "./supabase";

export type CrashPfState = {
  serverSeedHash: string;
  clientSeed: string;
  nextNonce: number;
};

export type CrashBetResult = {
  betId: string;
  // Note: crashPoint is intentionally NOT returned by place-crash-bet (the
  // server withholds it to preserve the provably-fair guarantee). The client
  // never knows the crash point during an active round. It's revealed only
  // via cashOutCrash (on failure) or via the crash_bets_safe view (after
  // completed_at is set).
  crashPoint?: number;
  won: boolean;
  payout: number;
  cashedAt: number | null;
  nonce: number;
  balance: number;
  coinType: string;
};

function parsePfRow(data: unknown): CrashPfState | null {
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!row) return null;
  return {
    serverSeedHash: String(row.server_seed_hash ?? row.serverSeedHash ?? ""),
    clientSeed: String(row.client_seed ?? row.clientSeed ?? "default"),
    nextNonce: Number(row.next_nonce ?? row.nextNonce ?? 0),
  };
}

export async function fetchCrashPfState(): Promise<{
  data: CrashPfState | null;
  error: string | null;
}> {
  if (!isSupabaseConfigured) {
    return { data: null, error: "Supabase is not configured." };
  }

  const { data, error } = await supabase.rpc("get_crash_pf_state");
  if (error) {
    const msg = error.message ?? "Could not load seed state.";
    if (msg.includes("get_crash_pf_state") && msg.includes("does not exist")) {
      return {
        data: null,
        error: "Crash is not set up in the database yet. Run the crash game migration.",
      };
    }
    return { data: null, error: msg };
  }

  const parsed = parsePfRow(data);
  if (!parsed) return { data: null, error: "No seed state returned." };
  return { data: parsed, error: null };
}

/**
 * Reveal the server-side crash point for a settled bet. The `crash_bets_safe`
 * view only exposes `crash_point` after `completed_at` is set, so this is the
 * authoritative read used by both:
 *   - The realtime UPDATE handler (whose payload leaks `crash_point` even
 *     though we don't trust it; we'd rather query the safe view explicitly).
 *   - The poll fallback, in case realtime isn't configured.
 *   - The client-side self-cap path: when the client can't keep climbing
 *     anymore, we don't fabricate a crash point — we wait for this response.
 *
 * Returns `null` if the bet is not yet settled server-side, or the
 * `crashPoint` if it is.
 */
export async function fetchCrashFinalState(
  betId: string
): Promise<{ crashPoint: number; completedAt: string } | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabase
    .from("crash_bets_safe")
    .select("crash_point, completed_at")
    .eq("id", betId)
    .maybeSingle();
  if (error || !data) return null;
  if (!data.completed_at || data.crash_point == null) return null;
  const crashPoint = Number(data.crash_point);
  if (!Number.isFinite(crashPoint) || crashPoint < 1) return null;
  return { crashPoint, completedAt: String(data.completed_at) };
}

export async function setCrashClientSeed(clientSeed: string): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured) {
    return { error: "Supabase is not configured." };
  }

  const { error } = await supabase.rpc("set_crash_client_seed", {
    p_client_seed: clientSeed,
  });
  return { error: error?.message ?? null };
}

export async function placeCrashBet(params: {
  wager: number;
  coinType?: string;
}): Promise<{ data: CrashBetResult | null; error: string | null }> {
  // Idempotency: reuse the same UUID across retries of the SAME bet so a
  // network blip after the SQL commit doesn't double-debit. Clear on
  // success so the next round gets a fresh key.
  const {
    getOrCreateRequestId,
    clearRequestId,
    IDEM_KEY_CRASH_BET,
  } = await import("./idempotency");
  const clientRequestId = getOrCreateRequestId(IDEM_KEY_CRASH_BET);
  const { data, error } = await invokeEdgeFunction<CrashBetResult>("place-crash-bet", {
    wager: params.wager,
    coinType: params.coinType ?? "balance",
    clientRequestId,
  });

  if (error) return { data: null as CrashBetResult | null, error };
  if (!data) return { data: null, error: "No response from server." };
  const row = data as CrashBetResult & { bet_id?: string };
  const betId = String(row.betId ?? row.bet_id ?? "");
  if (!betId) return { data: null, error: "No bet id returned." };
  clearRequestId(IDEM_KEY_CRASH_BET);
  return { data: { ...row, betId }, error: null };
}

export async function cashOutCrash(params: {
  betId: string;
  cashedAtMultiplier: number;
  coinType?: string;
}): Promise<{
  data: {
    payout: number;
    cashedAt: number;
    balance: number;
    coinType: string;
    won: boolean;
    crashPoint: number | null;
    alreadySettled: boolean;
  } | null;
  error: string | null;
}> {
  const { data, error } = await invokeEdgeFunction<{
    payout: number;
    cashedAt?: number;
    cashedAtMultiplier?: number;
    balance: number;
    coinType: string;
    won: boolean;
    crashPoint: number | null;
    alreadySettled: boolean;
  }>("cash-out-crash", {
    betId: params.betId,
    cashedAtMultiplier: params.cashedAtMultiplier,
    coinType: params.coinType ?? "balance",
  });

  if (error) return { data: null, error };
  if (!data) return { data: null, error: "No response from server." };

  // Normalize field name: edge function historically returned
  // `cashedAtMultiplier`; client always uses `cashedAt`.
  const cashedAt = Number(
    data.cashedAt ?? data.cashedAtMultiplier ?? params.cashedAtMultiplier
  );
  if (!Number.isFinite(cashedAt) || cashedAt < 1) {
    return { data: null, error: "Invalid cash-out response from server." };
  }

  return {
    data: {
      payout: Number(data.payout ?? 0),
      cashedAt,
      balance: Number(data.balance ?? 0),
      coinType: String(data.coinType ?? params.coinType ?? "balance"),
      won: Boolean(data.won),
      crashPoint:
        data.crashPoint != null && Number.isFinite(Number(data.crashPoint))
          ? Number(data.crashPoint)
          : null,
      alreadySettled: Boolean(data.alreadySettled),
    },
    error: null,
  };
}
