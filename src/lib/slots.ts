import { invokeEdgeFunction } from "./edgeFunctions";
import { supabase, isSupabaseConfigured } from "./supabase";

export type SlotsPfState = {
  serverSeedHash: string;
  clientSeed: string;
  nextNonce: number;
};

export type SlotsBetResult = {
  reels: number[];
  symbols: string[];
  won: boolean;
  multiplier: number;
  payout: number;
  outBalance: number;
  gameId: string;
  nonce: number;
  coinType: string;
};

function parsePfRow(data: unknown): SlotsPfState | null {
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!row) return null;
  return {
    serverSeedHash: String(row.server_seed_hash ?? row.serverSeedHash ?? ""),
    clientSeed: String(row.client_seed ?? row.clientSeed ?? "default"),
    nextNonce: Number(row.next_nonce ?? row.nextNonce ?? 0),
  };
}

export async function fetchSlotsPfState(): Promise<{
  data: SlotsPfState | null;
  error: string | null;
}> {
  if (!isSupabaseConfigured) {
    return { data: null, error: "Supabase is not configured." };
  }

  const { data, error } = await supabase.rpc("get_slots_pf_state");
  if (error) {
    const msg = error.message ?? "Could not load seed state.";
    if (msg.includes("get_slots_pf_state") && msg.includes("does not exist")) {
      return { data: null, error: "Slots is not set up in the database yet." };
    }
    return { data: null, error: msg };
  }

  const parsed = parsePfRow(data);
  if (!parsed) return { data: null, error: "No seed state returned." };
  return { data: parsed, error: null };
}

export async function setSlotsClientSeed(clientSeed: string): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured) {
    return { error: "Supabase is not configured." };
  }

  const { error } = await supabase.rpc("set_slots_client_seed", {
    p_client_seed: clientSeed,
  });
  return { error: error?.message ?? null };
}

export async function placeSlotsBet(params: {
  wager: number;
  coinType?: string;
}): Promise<{ data: SlotsBetResult | null; error: string | null }> {
  const { data, error } = await invokeEdgeFunction<SlotsBetResult>("place-slots-bet", {
    wager: params.wager,
    coinType: params.coinType ?? "balance",
  });

  if (error) return { data: null, error };
  if (!data) return { data: null, error: "No response from server." };
  return { data, error: null };
}
