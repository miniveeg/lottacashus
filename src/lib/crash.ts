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
  const { data, error } = await invokeEdgeFunction<CrashBetResult>("place-crash-bet", {
    wager: params.wager,
    coinType: params.coinType ?? "balance",
  });

  if (error) return { data: null as CrashBetResult | null, error };
  if (!data) return { data: null, error: "No response from server." };
  return { data, error: null };
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
