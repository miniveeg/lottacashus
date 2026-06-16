import { invokeEdgeFunction } from "./edgeFunctions";
import { supabase, isSupabaseConfigured } from "./supabase";

export type BlackjackPfState = {
  serverSeedHash: string;
  clientSeed: string;
  nextNonce: number;
};

export type BlackjackPlayerHandView = {
  cards: number[];
  total: number;
  wager: number;
  doubled: boolean;
  finished: boolean;
};

export type BlackjackHandView = {
  handId: string;
  wager: number;
  totalWager: number;
  doubled: boolean;
  playerCards: number[];
  dealerCards: number[];
  dealerRevealed: boolean;
  playerTotal: number;
  dealerTotal: number;
  canDouble: boolean;
  canSplit: boolean;
  canInsurance: boolean;
  insuranceAmount: number;
  phase: string;
  isSplit: boolean;
  activeHandIndex: number;
  playerHands: BlackjackPlayerHandView[];
};

export type BlackjackActionResult = BlackjackHandView & {
  balance: number;
  status: string;
  outcome?: string | null;
  payout?: number;
  nonce?: number;
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

export async function fetchBlackjackPfState() {
  if (!isSupabaseConfigured) {
    return { data: null as BlackjackPfState | null, error: "Supabase is not configured." };
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

export async function setBlackjackClientSeed(clientSeed: string) {
  const { error } = await supabase.rpc("set_blackjack_client_seed", {
    p_client_seed: clientSeed,
  });
  return { error: error?.message ?? null };
}

function mapHand(data: Record<string, unknown>): BlackjackActionResult {
  const playerHands = (data.playerHands as BlackjackPlayerHandView[] | undefined) ?? [];
  return {
    handId: String(data.handId ?? ""),
    balance: Number(data.balance ?? 0),
    status: String(data.status ?? ""),
    outcome: (data.outcome as string | null) ?? null,
    payout: data.payout != null ? Number(data.payout) : undefined,
    nonce: data.nonce != null ? Number(data.nonce) : undefined,
    wager: Number(data.wager ?? 0),
    totalWager: Number(data.totalWager ?? 0),
    doubled: Boolean(data.doubled),
    playerCards: (data.playerCards as number[]) ?? [],
    dealerCards: (data.dealerCards as number[]) ?? [],
    dealerRevealed: Boolean(data.dealerRevealed),
    playerTotal: Number(data.playerTotal ?? 0),
    dealerTotal: Number(data.dealerTotal ?? 0),
    canDouble: Boolean(data.canDouble),
    canSplit: Boolean(data.canSplit),
    canInsurance: Boolean(data.canInsurance),
    insuranceAmount: Number(data.insuranceAmount ?? 0),
    phase: String(data.phase ?? "player_turn"),
    isSplit: Boolean(data.isSplit),
    activeHandIndex: Number(data.activeHandIndex ?? 0),
    playerHands,
  };
}

export async function blackjackAction(
  body: Record<string, unknown>
): Promise<
  | { data: BlackjackActionResult | null; error: string | null; active?: boolean }
  | { data: null; error: string; active?: boolean }
> {
  const { data, error } = await invokeEdgeFunction<Record<string, unknown>>("blackjack-game", body);
  if (error) return { data: null, error };
  if (!data) return { data: null, error: "No response from server." };
  if (data.active === false) return { data: null, error: null, active: false };
  return { data: mapHand(data), error: null };
}

export function startBlackjack(wager: number) {
  return blackjackAction({ action: "start", wager });
}

export function hitBlackjack(handId: string) {
  return blackjackAction({ action: "hit", handId });
}

export function standBlackjack(handId: string) {
  return blackjackAction({ action: "stand", handId });
}

export function doubleBlackjack(handId: string) {
  return blackjackAction({ action: "double", handId });
}

export function splitBlackjack(handId: string) {
  return blackjackAction({ action: "split", handId });
}

export function insuranceBlackjack(handId: string, take: boolean) {
  return blackjackAction({ action: "insurance", handId, take });
}

export function fetchActiveBlackjack() {
  return blackjackAction({ action: "active" });
}
