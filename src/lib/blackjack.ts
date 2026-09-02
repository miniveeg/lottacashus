import { invokeEdgeFunction, type InvokeEdgeFunctionOptions } from "./edgeFunctions";
import { supabase, isSupabaseConfigured } from "./supabase";
import {
  mapBlackjackHand,
  type BlackjackActionResult,
} from "./blackjackMap";

export type {
  BlackjackActionResult,
  BlackjackHandView,
  BlackjackPlayerHandView,
} from "./blackjackMap";
export {
  isActiveBlackjackConflict,
  isPlayableBlackjackStatus,
  isSettledBlackjackStatus,
  mapBlackjackHand,
  normalizeResumedBlackjack,
} from "./blackjackMap";
import {
  getOrCreateRequestId,
  clearRequestId,
  IDEM_KEY_BLACKJACK_START,
} from "./idempotency";

export type BlackjackPfState = {
  serverSeedHash: string;
  clientSeed: string;
  nextNonce: number;
};


function parsePf(data: unknown): BlackjackPfState | null {
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!row) return null;
  return {
    serverSeedHash: String(row.server_seed_hash ?? row.serverSeedHash ?? ""),
    clientSeed: String(row.client_seed ?? row.clientSeed ?? "default"),
    nextNonce: Number(row.next_nonce ?? row.nextNonce ?? 0),
  };
}

export async function fetchBlackjackPfState(): Promise<{
  data: BlackjackPfState | null;
  error: string | null;
}> {
  if (!isSupabaseConfigured) {
    return { data: null, error: "Supabase is not configured." };
  }
  const { data, error } = await supabase.rpc("get_blackjack_pf_state");
  if (error) {
    const msg = error.message ?? "Could not load seed state.";
    if (msg.includes("get_blackjack_pf_state") && msg.includes("does not exist")) {
      return {
        data: null,
        error: "Blackjack is not set up. Run migration 20250521600000_blackjack_game.sql.",
      };
    }
    return { data: null, error: msg };
  }
  const parsed = parsePf(data);
  if (!parsed) return { data: null, error: "No seed state returned." };
  return { data: parsed, error: null };
}

export async function setBlackjackClientSeed(
  clientSeed: string
): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured) {
    return { error: "Supabase is not configured." };
  }
  const { error } = await supabase.rpc("set_blackjack_client_seed", {
    p_client_seed: clientSeed,
  });
  return { error: error?.message ?? null };
}

export async function blackjackAction(
  body: Record<string, unknown>,
  options?: InvokeEdgeFunctionOptions
): Promise<
  | { data: BlackjackActionResult | null; error: string | null; active?: boolean }
  | { data: null; error: string; active?: boolean }
> {
  const { data, error } = await invokeEdgeFunction<Record<string, unknown>>(
    "blackjack-game",
    body,
    options
  );
  if (error) return { data: null, error };
  if (!data) return { data: null, error: "No response from server." };
  if (data.active === false) return { data: null, error: null, active: false };
  const mapped = mapBlackjackHand(data, { assumeInProgress: data.active === true });
  // start / hit / stand all need a real hand id; empty id previously looked
  // like a successful deal with no cards (silent idle return).
  if (!mapped.handId && data.active !== true) {
    const action = String(body.action ?? "");
    if (action === "start" || action === "hit" || action === "stand" || action === "double" || action === "split" || action === "insurance") {
      return { data: null, error: "Server response missing hand id." };
    }
  }
  return {
    data: mapped,
    error: null,
    active: data.active === true ? true : undefined,
  };
}

export async function startBlackjack(
  wager: number,
  coinType?: string
): Promise<
  | { data: BlackjackActionResult | null; error: string | null; active?: boolean }
  | { data: null; error: string; active?: boolean }
> {
  // Idempotency: same UUID across retries of the SAME deal so a network
  // blip after the SQL commit doesn't double-debit. Clear on success so
  // the next deal gets a fresh key. Parallel to placeCrashBet / placeKenoBet /
  // placeLimboBet / placeRouletteBet / placeSlotsBet / startMinesGame.
  const clientRequestId = getOrCreateRequestId(IDEM_KEY_BLACKJACK_START);
  const res = await blackjackAction({
    action: "start",
    wager,
    coinType: coinType ?? "balance",
    clientRequestId,
  });
  if (res && "data" in res && res.data) {
    clearRequestId(IDEM_KEY_BLACKJACK_START);
  }
  return res;
}

export function hitBlackjack(
  handId: string,
  coinType?: string
): Promise<
  | { data: BlackjackActionResult | null; error: string | null; active?: boolean }
  | { data: null; error: string; active?: boolean }
> {
  return blackjackAction({ action: "hit", handId, hand_id: handId, coinType: coinType ?? "balance" });
}

export function standBlackjack(
  handId: string,
  coinType?: string
): Promise<
  | { data: BlackjackActionResult | null; error: string | null; active?: boolean }
  | { data: null; error: string; active?: boolean }
> {
  return blackjackAction({ action: "stand", handId, hand_id: handId, coinType: coinType ?? "balance" });
}

export function doubleBlackjack(
  handId: string,
  coinType?: string
): Promise<
  | { data: BlackjackActionResult | null; error: string | null; active?: boolean }
  | { data: null; error: string; active?: boolean }
> {
  return blackjackAction({ action: "double", handId, hand_id: handId, coinType: coinType ?? "balance" });
}

export function splitBlackjack(
  handId: string,
  coinType?: string
): Promise<
  | { data: BlackjackActionResult | null; error: string | null; active?: boolean }
  | { data: null; error: string; active?: boolean }
> {
  return blackjackAction({ action: "split", handId, hand_id: handId, coinType: coinType ?? "balance" });
}

export function insuranceBlackjack(
  handId: string,
  take: boolean,
  coinType?: string
): Promise<
  | { data: BlackjackActionResult | null; error: string | null; active?: boolean }
  | { data: null; error: string; active?: boolean }
> {
  return blackjackAction({
    action: "insurance",
    handId,
    hand_id: handId,
    take,
    coinType: coinType ?? "balance",
  });
}

export function fetchActiveBlackjack(): Promise<
  | { data: BlackjackActionResult | null; error: string | null; active?: boolean }
  | { data: null; error: string; active?: boolean }
> {
  return blackjackAction({ action: "active" }, { retryOnTransient: true });
}
