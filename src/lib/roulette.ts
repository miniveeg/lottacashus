import { invokeEdgeFunction } from "./edgeFunctions";
import { supabase, isSupabaseConfigured } from "./supabase";
import type { RouletteBetType, RouletteColor } from "./games/roulette";

export type RoulettePfState = {
  serverSeedHash: string;
  clientSeed: string;
  nextNonce: number;
};

export type RouletteBetResult = {
  betId?: string;
  balance: number;
  betType: RouletteBetType;
  resultPocket: number;
  resultColor: RouletteColor;
  won: boolean;
  payout: number;
  profit: number;
  multiplier: number;
  nonce: number;
  coinType: string;
};

function parsePfRow(data: unknown): RoulettePfState | null {
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!row) return null;
  return {
    serverSeedHash: String(row.server_seed_hash ?? row.serverSeedHash ?? ""),
    clientSeed: String(row.client_seed ?? row.clientSeed ?? "default"),
    nextNonce: Number(row.next_nonce ?? row.nextNonce ?? 0),
  };
}

export async function fetchRoulettePfState(): Promise<{
  data: RoulettePfState | null;
  error: string | null;
}> {
  if (!isSupabaseConfigured) {
    return { data: null, error: "Supabase is not configured." };
  }

  const { data, error } = await supabase.rpc("get_roulette_pf_state");
  if (error) {
    const msg = error.message ?? "Could not load seed state.";
    if (msg.includes("get_roulette_pf_state") && msg.includes("does not exist")) {
      return {
        data: null,
        error: "Roulette is not set up in the database yet. Run migration 20250525000000_roulette_game.sql.",
      };
    }
    return { data: null, error: msg };
  }

  const parsed = parsePfRow(data);
  if (!parsed) return { data: null, error: "No seed state returned." };
  return { data: parsed, error: null };
}

export async function setRouletteClientSeed(
  clientSeed: string
): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured) {
    return { error: "Supabase is not configured." };
  }

  const { error } = await supabase.rpc("set_roulette_client_seed", {
    p_client_seed: clientSeed,
  });
  return { error: error?.message ?? null };
}

export async function placeRouletteBet(params: {
  wager: number;
  betType: RouletteBetType;
  coinType?: string;
}): Promise<{ data: RouletteBetResult | null; error: string | null }> {
  const {
    getOrCreateRequestId,
    clearRequestId,
    IDEM_KEY_ROULETTE_BET,
  } = await import("./idempotency");
  const clientRequestId = getOrCreateRequestId(IDEM_KEY_ROULETTE_BET);
  const { data, error } = await invokeEdgeFunction<RouletteBetResult>("place-roulette-bet", {
    wager: params.wager,
    betType: params.betType,
    coinType: params.coinType ?? "balance",
    clientRequestId,
  });

  if (error) return { data: null as RouletteBetResult | null, error };
  if (!data) return { data: null, error: "No response from server." };
  clearRequestId(IDEM_KEY_ROULETTE_BET);
  return { data, error: null };
}
