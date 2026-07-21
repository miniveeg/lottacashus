import { invokeEdgeFunction } from "./edgeFunctions";
import { supabase, isSupabaseConfigured } from "./supabase";
import type { KenoRisk } from "./games/keno";

export type KenoPfState = {
  serverSeedHash: string;
  clientSeed: string;
  nextNonce: number;
};

export type KenoBetResult = {
  betId: string;
  balance: number;
  drawn: number[];
  hits: number;
  multiplier: number;
  payout: number;
  profit: number;
  nonce: number;
  picks: number[];
  risk: KenoRisk;
  coinType: string;
};

export async function fetchKenoPfState(): Promise<{
  data: KenoPfState | null;
  error: string | null;
}> {
  if (!isSupabaseConfigured) {
    return { data: null, error: "Supabase is not configured." };
  }

  const { data, error } = await supabase.rpc("get_keno_pf_state");
  if (error) {
    const msg = error.message ?? "Could not load seed state.";
    if (msg.includes("get_keno_pf_state") && msg.includes("does not exist")) {
      return {
        data: null,
        error:
          "Keno is not set up in the database yet. Apply migration 20250521110000_fix_keno_pf_seeds.sql.",
      };
    }
    return { data: null, error: msg };
  }

  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!row) return { data: null, error: "No seed state returned." };

  const hash = row.server_seed_hash ?? row.serverSeedHash;
  const client = row.client_seed ?? row.clientSeed;
  const nonce = row.next_nonce ?? row.nextNonce;

  return {
    data: {
      serverSeedHash: String(hash ?? ""),
      clientSeed: String(client ?? "default"),
      nextNonce: Number(nonce ?? 0),
    },
    error: null,
  };
}

export async function setKenoClientSeed(
  clientSeed: string
): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured) {
    return { error: "Supabase is not configured." };
  }

  const { error } = await supabase.rpc("set_keno_client_seed", {
    p_client_seed: clientSeed,
  });
  return { error: error?.message ?? null };
}

export async function placeKenoBet(params: {
  wager: number;
  picks: number[];
  risk: KenoRisk;
  coinType?: string;
}): Promise<{ data: KenoBetResult | null; error: string | null }> {
  const {
    getOrCreateRequestId,
    clearRequestId,
    IDEM_KEY_KENO_BET,
  } = await import("./idempotency");
  const clientRequestId = getOrCreateRequestId(IDEM_KEY_KENO_BET);
  const { data, error } = await invokeEdgeFunction<KenoBetResult>("place-keno-bet", {
    wager: params.wager,
    picks: params.picks,
    risk: params.risk,
    coinType: params.coinType ?? "balance",
    clientRequestId,
  });

  if (error) return { data: null, error };
  if (!data) return { data: null, error: "No response from server." };
  clearRequestId(IDEM_KEY_KENO_BET);
  return { data, error: null };
}
