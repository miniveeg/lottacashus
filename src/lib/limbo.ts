import { invokeEdgeFunction } from "./edgeFunctions";
import { supabase, isSupabaseConfigured } from "./supabase";

export type LimboPfState = {
  serverSeedHash: string;
  clientSeed: string;
  nextNonce: number;
};

export type LimboBetResult = {
  betId?: string;
  balance: number;
  target: number;
  resultMultiplier: number;
  won: boolean;
  payout: number;
  profit: number;
  nonce: number;
  coinType: string;
};

function parsePfRow(data: unknown): LimboPfState | null {
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!row) return null;
  return {
    serverSeedHash: String(row.server_seed_hash ?? row.serverSeedHash ?? ""),
    clientSeed: String(row.client_seed ?? row.clientSeed ?? "default"),
    nextNonce: Number(row.next_nonce ?? row.nextNonce ?? 0),
  };
}

export async function fetchLimboPfState(): Promise<{
  data: LimboPfState | null;
  error: string | null;
}> {
  if (!isSupabaseConfigured) {
    return { data: null, error: "Supabase is not configured." };
  }

  const { data, error } = await supabase.rpc("get_limbo_pf_state");
  if (error) {
    const msg = error.message ?? "Could not load seed state.";
    if (msg.includes("get_limbo_pf_state") && msg.includes("does not exist")) {
      return {
        data: null,
        error: "Limbo is not set up in the database yet. Run migration 20250521500000_limbo_game.sql.",
      };
    }
    return { data: null, error: msg };
  }

  const parsed = parsePfRow(data);
  if (!parsed) return { data: null, error: "No seed state returned." };
  return { data: parsed, error: null };
}

export async function setLimboClientSeed(clientSeed: string): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured) {
    return { error: "Supabase is not configured." };
  }

  const { error } = await supabase.rpc("set_limbo_client_seed", {
    p_client_seed: clientSeed,
  });
  return { error: error?.message ?? null };
}

export async function placeLimboBet(params: { wager: number; target: number; coinType?: string }) {
  const { data, error } = await invokeEdgeFunction<LimboBetResult>("place-limbo-bet", {
    wager: params.wager,
    target: params.target,
    coinType: params.coinType ?? "balance",
  });

  if (error) return { data: null as LimboBetResult | null, error };
  if (!data) return { data: null, error: "No response from server." };
  return { data, error: null };
}
