/** Pure blackjack payload mapping — no supabase so unit tests can import it. */
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
  coinType: string;
};

function asNumberArray(value: unknown): number[] {
  return Array.isArray(value) ? (value as number[]) : [];
}

function firstDefined(data: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (data[key] != null) return data[key];
  }
  return undefined;
}

function asPlayerHands(value: unknown): BlackjackPlayerHandView[] {
  if (!Array.isArray(value)) return [];
  return (value as Record<string, unknown>[]).map((h) => ({
    cards: asNumberArray(h?.cards),
    total: Number(h?.total ?? 0),
    wager: Number(h?.wager ?? 0),
    doubled: Boolean(h?.doubled),
    finished: Boolean(h?.finished),
  }));
}

const SETTLED_BJ_STATUSES = new Set([
  "settled",
  "win",
  "lose",
  "push",
  "bust",
  "blackjack",
  "bj",
  "dealer_blackjack",
]);

/** True when the backend refused a new deal because a live hand already exists. */
export function isActiveBlackjackConflict(error: string | null | undefined): boolean {
  if (!error) return false;
  const m = error.toLowerCase();
  return (
    m.includes("already have an active blackjack") ||
    m.includes("finish your current blackjack") ||
    m.includes("active blackjack hand")
  );
}

export function isSettledBlackjackStatus(status: string, phase?: string): boolean {
  const raw = (status || phase || "").toLowerCase();
  return SETTLED_BJ_STATUSES.has(raw);
}

export function isPlayableBlackjackStatus(status: string, phase?: string): boolean {
  const raw = status || phase || "";
  return raw === "player_turn" || raw === "insurance_offer";
}

/** Normalize an in-progress restore payload so the felt shows Hit/Stand/etc. */
export function normalizeResumedBlackjack(
  hand: BlackjackActionResult
): BlackjackActionResult {
  if (isSettledBlackjackStatus(hand.status, hand.phase)) {
    return { ...hand, status: "settled" };
  }
  if (hand.status === "insurance_offer" || hand.phase === "insurance_offer") {
    return { ...hand, status: "insurance_offer", phase: "insurance_offer" };
  }
  return { ...hand, status: "player_turn" };
}

export function mapBlackjackHand(
  data: Record<string, unknown>,
  opts?: { assumeInProgress?: boolean }
): BlackjackActionResult {
  const playerHands = asPlayerHands(data.playerHands ?? data.player_hands);
  const phase = String(firstDefined(data, "phase", "status") ?? "player_turn");
  let status = String(firstDefined(data, "status", "phase") ?? "");
  if (!status) {
    status = phase === "insurance_offer" ? "insurance_offer" : phase === "settled" ? "settled" : "";
  }
  if (opts?.assumeInProgress && !isSettledBlackjackStatus(status, phase) && status !== "insurance_offer") {
    status = "player_turn";
  }
  return {
    handId: String(firstDefined(data, "handId", "hand_id", "out_hand_id", "id") ?? ""),
    balance: Number(firstDefined(data, "balance", "out_balance") ?? 0),
    status,
    outcome: (data.outcome as string | null) ?? null,
    payout: data.payout != null ? Number(data.payout) : undefined,
    nonce: data.nonce != null ? Number(data.nonce) : undefined,
    coinType: String(firstDefined(data, "coinType", "coin_type") ?? "balance"),
    wager: Number(data.wager ?? 0),
    totalWager: Number(firstDefined(data, "totalWager", "total_wager") ?? 0),
    doubled: Boolean(data.doubled),
    playerCards: asNumberArray(firstDefined(data, "playerCards", "player_cards")),
    dealerCards: asNumberArray(firstDefined(data, "dealerCards", "dealer_cards")),
    dealerRevealed: Boolean(firstDefined(data, "dealerRevealed", "dealer_revealed")),
    playerTotal: Number(firstDefined(data, "playerTotal", "player_total") ?? 0),
    dealerTotal: Number(firstDefined(data, "dealerTotal", "dealer_total") ?? 0),
    canDouble: Boolean(firstDefined(data, "canDouble", "can_double")),
    canSplit: Boolean(firstDefined(data, "canSplit", "can_split")),
    canInsurance: Boolean(firstDefined(data, "canInsurance", "can_insurance")),
    insuranceAmount: Number(firstDefined(data, "insuranceAmount", "insurance_amount") ?? 0),
    phase,
    isSplit: Boolean(firstDefined(data, "isSplit", "is_split")),
    activeHandIndex: Number(firstDefined(data, "activeHandIndex", "active_hand_index") ?? 0),
    playerHands,
  };
}

