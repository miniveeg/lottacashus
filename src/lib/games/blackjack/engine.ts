import {
  handValue,
  isBlackjack,
  isBusted,
  type CardIndex,
} from "./cards";
import { buildShuffledShoe, drawFromShoe } from "./provablyFair";
import { retainStakeStyleWin } from "../rtp";

export type BlackjackOutcome = "blackjack" | "win" | "lose" | "push" | "bust" | null;
export type BlackjackPhase = "insurance_offer" | "player_turn" | "settled";

export type PlayerHandLine = {
  cards: CardIndex[];
  wager: number;
  doubled: boolean;
  finished: boolean;
};

export type BlackjackHandState = {
  shoe: CardIndex[];
  shoeIndex: number;
  dealerCards: CardIndex[];
  dealerRevealed: boolean;
  wager: number;
  totalWager: number;
  doubled: boolean;
  playerCards: CardIndex[];
  isSplit: boolean;
  playerHands: PlayerHandLine[];
  activeHandIndex: number;
  phase: BlackjackPhase;
  insuranceWager: number;
  insuranceTaken: boolean;
  insuranceDecided: boolean;
};

export function cardRankIndex(card: CardIndex): number {
  return Math.floor(card / 4);
}

export function dealerUpcard(cards: CardIndex[]): CardIndex {
  return cards[0]!;
}

export function dealerShowsAce(cards: CardIndex[]): boolean {
  return cardRankIndex(dealerUpcard(cards)) === 12;
}

export function dealerShowsAceOrTen(cards: CardIndex[]): boolean {
  const r = cardRankIndex(dealerUpcard(cards));
  return r === 12 || r >= 9;
}

/** Stake-style: dealer hits soft 17. */
export function dealerShouldHit(cards: CardIndex[]): boolean {
  const v = handValue(cards);
  if (v.total < 17) return true;
  if (v.total === 17 && v.soft) return true;
  return false;
}

export function playDealer(shoe: CardIndex[], shoeIndex: number, dealerCards: CardIndex[]) {
  const cards = [...dealerCards];
  let idx = shoeIndex;
  while (dealerShouldHit(cards)) {
    const draw = drawFromShoe(shoe, idx);
    cards.push(draw.card);
    idx = draw.nextIndex;
  }
  return { dealerCards: cards, shoeIndex: idx };
}

export function compareOutcome(
  playerCards: CardIndex[],
  dealerCards: CardIndex[]
): Exclude<BlackjackOutcome, "bust" | "blackjack" | null> {
  const p = handValue(playerCards);
  const d = handValue(dealerCards);
  if (isBusted(playerCards)) return "lose";
  if (isBusted(dealerCards)) return "win";
  if (p.total > d.total) return "win";
  if (p.total < d.total) return "lose";
  return "push";
}

export function calculatePayout(
  outcome: BlackjackOutcome,
  wager: number,
  totalWager: number,
  fromSplit = false
): number {
  if (!outcome) return 0;
  if (outcome === "blackjack" && !fromSplit) {
    return Math.round(wager * 2.5 * 100) / 100;
  }
  if (outcome === "win") return Math.round(totalWager * 2 * 100) / 100;
  if (outcome === "push") return totalWager;
  return 0;
}

/** Apply target RTP by downgrading some fair wins (payouts unchanged). */
export function applyRtpBiasToOutcome(
  outcome: BlackjackOutcome,
  rtpBias: number | undefined
): BlackjackOutcome {
  if (rtpBias == null || !outcome || outcome === "lose" || outcome === "bust" || outcome === "push") {
    return outcome;
  }
  return retainStakeStyleWin(rtpBias) ? outcome : "lose";
}

export function insuranceAmount(wager: number): number {
  return Math.round((wager / 2) * 100) / 100;
}

export function insurancePayout(insuranceWager: number): number {
  return Math.round(insuranceWager * 3 * 100) / 100;
}

function singleHandLine(cards: CardIndex[], wager: number): PlayerHandLine {
  return { cards, wager, doubled: false, finished: false };
}

function syncActiveHand(state: BlackjackHandState): BlackjackHandState {
  const active = state.playerHands[state.activeHandIndex];
  if (!active) return state;
  return {
    ...state,
    playerCards: active.cards,
    doubled: active.doubled,
  };
}

function withHands(state: BlackjackHandState, hands: PlayerHandLine[]): BlackjackHandState {
  return syncActiveHand({ ...state, playerHands: hands, isSplit: hands.length > 1 });
}

export function createInitialState(
  shoe: CardIndex[],
  shoeIndex: number,
  playerCards: CardIndex[],
  dealerCards: CardIndex[],
  wager: number
): BlackjackHandState {
  return {
    shoe,
    shoeIndex,
    dealerCards,
    dealerRevealed: false,
    wager,
    totalWager: wager,
    doubled: false,
    playerCards,
    isSplit: false,
    playerHands: [singleHandLine(playerCards, wager)],
    activeHandIndex: 0,
    phase: "player_turn",
    insuranceWager: 0,
    insuranceTaken: false,
    insuranceDecided: true,
  };
}

export async function dealNewHand(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  wager: number
): Promise<{
  state: BlackjackHandState;
  outcome: BlackjackOutcome;
  payout: number;
  instantSettle: boolean;
}> {
  const shoe = await buildShuffledShoe(serverSeed, clientSeed, nonce);
  let idx = 0;
  const playerCards: CardIndex[] = [];
  const dealerCards: CardIndex[] = [];

  for (let i = 0; i < 2; i++) {
    const p = drawFromShoe(shoe, idx);
    playerCards.push(p.card);
    idx = p.nextIndex;
    const d = drawFromShoe(shoe, idx);
    dealerCards.push(d.card);
    idx = d.nextIndex;
  }

  let state = createInitialState(shoe, idx, playerCards, dealerCards, wager);

  const playerBJ = isBlackjack(playerCards);
  const dealerBJ = isBlackjack(dealerCards);

  if (playerBJ || (dealerShowsAceOrTen(dealerCards) && dealerBJ)) {
    state.dealerRevealed = true;
    state.phase = "settled";
    let outcome: BlackjackOutcome;
    if (playerBJ && dealerBJ) outcome = "push";
    else if (playerBJ) outcome = "blackjack";
    else outcome = "lose";
    const payout = calculatePayout(outcome, wager, wager);
    return { state, outcome, payout, instantSettle: true };
  }

  if (dealerShowsAce(dealerCards)) {
    state = {
      ...state,
      phase: "insurance_offer",
      insuranceDecided: false,
    };
  }

  return { state, outcome: null, payout: 0, instantSettle: false };
}

function settleMainHand(
  hand: PlayerHandLine,
  dealerCards: CardIndex[],
  fromSplit: boolean
): { outcome: BlackjackOutcome; payout: number } {
  if (hand.finished && isBusted(hand.cards)) {
    return { outcome: "bust", payout: 0 };
  }
  const totalWager = hand.doubled ? hand.wager * 2 : hand.wager;
  let outcome: BlackjackOutcome = compareOutcome(hand.cards, dealerCards);
  if (
    !fromSplit &&
    isBlackjack(hand.cards) &&
    !isBlackjack(dealerCards) &&
    hand.cards.length === 2
  ) {
    outcome = "blackjack";
  }
  const payout = calculatePayout(outcome, hand.wager, totalWager, fromSplit);
  return { outcome, payout };
}

function aggregateOutcome(outcomes: BlackjackOutcome[]): BlackjackOutcome {
  const filtered = outcomes.filter(Boolean) as Exclude<BlackjackOutcome, null>[];
  if (filtered.length === 0) return null;
  if (filtered.some((o) => o === "blackjack" || o === "win")) return "win";
  if (filtered.every((o) => o === "push")) return "push";
  if (filtered.every((o) => o === "bust" || o === "lose")) return "lose";
  return "win";
}

export function settleDealerBlackjack(state: BlackjackHandState): {
  state: BlackjackHandState;
  outcome: BlackjackOutcome;
  payout: number;
} {
  let mainPayout = 0;
  const outcomes: BlackjackOutcome[] = [];

  for (const hand of state.playerHands) {
    const totalWager = hand.doubled ? hand.wager * 2 : hand.wager;
    let outcome: BlackjackOutcome;
    if (isBlackjack(hand.cards) && !state.isSplit) {
      outcome = "push";
      mainPayout += totalWager;
    } else {
      outcome = "lose";
    }
    outcomes.push(outcome);
  }

  if (state.insuranceTaken) {
    mainPayout += insurancePayout(state.insuranceWager);
  }

  const next: BlackjackHandState = {
    ...state,
    dealerRevealed: true,
    phase: "settled",
    playerHands: state.playerHands.map((h) => ({ ...h, finished: true })),
  };

  return {
    state: syncActiveHand(next),
    outcome: aggregateOutcome(outcomes),
    payout: Math.round(mainPayout * 100) / 100,
  };
}

export function resolveInsurance(
  state: BlackjackHandState,
  take: boolean
): {
  state: BlackjackHandState;
  outcome: BlackjackOutcome;
  payout: number;
  instantSettle: boolean;
  insuranceDebit: number;
} {
  if (state.phase !== "insurance_offer" || state.insuranceDecided) {
    throw new Error("Insurance not offered");
  }

  const insWager = take ? insuranceAmount(state.wager) : 0;
  const next: BlackjackHandState = {
    ...state,
    insuranceDecided: true,
    insuranceTaken: take,
    insuranceWager: insWager,
  };

  if (isBlackjack(state.dealerCards)) {
    const settled = settleDealerBlackjack(next);
    return {
      state: settled.state,
      outcome: settled.outcome,
      payout: settled.payout,
      instantSettle: true,
      insuranceDebit: insWager,
    };
  }

  return {
    state: syncActiveHand({ ...next, phase: "player_turn" }),
    outcome: null,
    payout: 0,
    instantSettle: false,
    insuranceDebit: insWager,
  };
}

function advanceHandIndex(state: BlackjackHandState): BlackjackHandState {
  const nextIdx = state.playerHands.findIndex((h, i) => i > state.activeHandIndex && !h.finished);
  if (nextIdx === -1) return state;
  return syncActiveHand({ ...state, activeHandIndex: nextIdx });
}

function markHandFinished(
  state: BlackjackHandState,
  index: number,
  hands: PlayerHandLine[]
): BlackjackHandState {
  const updated = hands.map((h, i) => (i === index ? { ...h, finished: true } : h));
  const allDone = updated.every((h) => h.finished);
  if (allDone) return withHands(state, updated);
  return advanceHandIndex(withHands({ ...state, playerHands: updated }, updated));
}

function settleAllHands(state: BlackjackHandState): {
  state: BlackjackHandState;
  outcome: BlackjackOutcome;
  payout: number;
} {
  const played = playDealer(state.shoe, state.shoeIndex, state.dealerCards);
  let totalPayout = 0;
  const outcomes: BlackjackOutcome[] = [];

  for (const hand of state.playerHands) {
    const result = settleMainHand(hand, played.dealerCards, state.isSplit);
    outcomes.push(result.outcome);
    totalPayout += result.payout;
  }

  const next: BlackjackHandState = {
    ...state,
    shoeIndex: played.shoeIndex,
    dealerCards: played.dealerCards,
    dealerRevealed: true,
    phase: "settled",
    playerHands: state.playerHands.map((h) => ({ ...h, finished: true })),
  };

  return {
    state: syncActiveHand(next),
    outcome: aggregateOutcome(outcomes),
    payout: Math.round(totalPayout * 100) / 100,
  };
}

export function hitCard(state: BlackjackHandState): {
  state: BlackjackHandState;
  outcome: BlackjackOutcome;
  payout: number;
  done: boolean;
} {
  const idx = state.activeHandIndex;
  const hand = state.playerHands[idx]!;
  const draw = drawFromShoe(state.shoe, state.shoeIndex);
  const cards = [...hand.cards, draw.card];
  const hands = [...state.playerHands];
  hands[idx] = { ...hand, cards };

  let next = withHands({ ...state, shoeIndex: draw.nextIndex }, hands);

  if (isBusted(cards)) {
    next = markHandFinished(next, idx, next.playerHands);
    if (next.playerHands.every((h) => h.finished)) {
      const bustedOnly = next.playerHands.every((h) => isBusted(h.cards));
      if (bustedOnly) {
        return {
          state: { ...next, dealerRevealed: true, phase: "settled" },
          outcome: "bust",
          payout: 0,
          done: true,
        };
      }
      const settled = settleAllHands(next);
      return { state: settled.state, outcome: settled.outcome, payout: settled.payout, done: true };
    }
    return { state: next, outcome: null, payout: 0, done: false };
  }

  if (handValue(cards).total === 21) {
    next = markHandFinished(next, idx, next.playerHands);
    if (next.playerHands.every((h) => h.finished)) {
      const settled = settleAllHands(next);
      return { state: settled.state, outcome: settled.outcome, payout: settled.payout, done: true };
    }
    return { state: next, outcome: null, payout: 0, done: false };
  }

  return { state: next, outcome: null, payout: 0, done: false };
}

export function standHand(state: BlackjackHandState): {
  state: BlackjackHandState;
  outcome: BlackjackOutcome;
  payout: number;
  done: boolean;
} {
  const idx = state.activeHandIndex;
  const hands = [...state.playerHands];
  hands[idx] = { ...hands[idx]!, finished: true };
  let next = withHands(state, hands);

  if (next.playerHands.every((h) => h.finished)) {
    const settled = settleAllHands(next);
    return { state: settled.state, outcome: settled.outcome, payout: settled.payout, done: true };
  }

  next = advanceHandIndex(next);
  return { state: next, outcome: null, payout: 0, done: false };
}

export function doubleHand(state: BlackjackHandState): {
  state: BlackjackHandState;
  outcome: BlackjackOutcome;
  payout: number;
  extraWager: number;
  done: boolean;
} {
  const idx = state.activeHandIndex;
  const hand = state.playerHands[idx]!;
  if (hand.cards.length !== 2 || hand.doubled) {
    throw new Error("Cannot double");
  }

  const draw = drawFromShoe(state.shoe, state.shoeIndex);
  const cards = [...hand.cards, draw.card];
  const hands = [...state.playerHands];
  hands[idx] = { ...hand, cards, doubled: true, finished: true };

  let next = withHands(
    {
      ...state,
      shoeIndex: draw.nextIndex,
      totalWager: state.totalWager + hand.wager,
    },
    hands
  );

  if (next.playerHands.every((h) => h.finished)) {
    const bustedOnly = next.playerHands.every((h) => isBusted(h.cards));
    if (bustedOnly) {
      return {
        state: { ...next, dealerRevealed: true, phase: "settled" },
        outcome: "bust",
        payout: 0,
        extraWager: hand.wager,
        done: true,
      };
    }
    const settled = settleAllHands(next);
    return {
      state: settled.state,
      outcome: settled.outcome,
      payout: settled.payout,
      extraWager: hand.wager,
      done: true,
    };
  }

  next = advanceHandIndex(next);
  return { state: next, outcome: null, payout: 0, extraWager: hand.wager, done: false };
}

export function splitHand(state: BlackjackHandState): {
  state: BlackjackHandState;
  outcome: BlackjackOutcome;
  payout: number;
  extraWager: number;
  instantSettle: boolean;
} {
  if (state.isSplit || state.phase !== "player_turn") {
    throw new Error("Cannot split");
  }
  const hand = state.playerHands[0]!;
  if (hand.cards.length !== 2 || hand.finished) {
    throw new Error("Cannot split");
  }
  if (cardRankIndex(hand.cards[0]!) !== cardRankIndex(hand.cards[1]!)) {
    throw new Error("Can only split pairs");
  }

  const draw1 = drawFromShoe(state.shoe, state.shoeIndex);
  const draw2 = drawFromShoe(state.shoe, draw1.nextIndex);

  const hands: PlayerHandLine[] = [
    { cards: [hand.cards[0]!, draw1.card], wager: hand.wager, doubled: false, finished: false },
    { cards: [hand.cards[1]!, draw2.card], wager: hand.wager, doubled: false, finished: false },
  ];

  let next = withHands(
    {
      ...state,
      shoeIndex: draw2.nextIndex,
      isSplit: true,
      activeHandIndex: 0,
      totalWager: state.totalWager + hand.wager,
    },
    hands
  );

  if (handValue(hands[0]!.cards).total === 21) {
    next.playerHands[0] = { ...next.playerHands[0]!, finished: true };
  }
  if (handValue(hands[1]!.cards).total === 21) {
    next.playerHands[1] = { ...next.playerHands[1]!, finished: true };
  }
  next = withHands(next, [...next.playerHands]);

  if (next.playerHands.every((h) => h.finished)) {
    const settled = settleAllHands(next);
    return {
      state: settled.state,
      outcome: settled.outcome,
      payout: settled.payout,
      extraWager: hand.wager,
      instantSettle: true,
    };
  }

  if (next.playerHands[0]!.finished) {
    next = advanceHandIndex(next);
  }

  return {
    state: next,
    outcome: null,
    payout: 0,
    extraWager: hand.wager,
    instantSettle: false,
  };
}

export function canDouble(state: BlackjackHandState): boolean {
  if (state.phase !== "player_turn") return false;
  const hand = state.playerHands[state.activeHandIndex];
  return Boolean(hand && hand.cards.length === 2 && !hand.doubled && !hand.finished);
}

export function canSplit(state: BlackjackHandState): boolean {
  if (state.phase !== "player_turn" || state.isSplit) return false;
  const hand = state.playerHands[0];
  if (!hand || hand.cards.length !== 2 || hand.finished) return false;
  return cardRankIndex(hand.cards[0]!) === cardRankIndex(hand.cards[1]!);
}

export function canTakeInsurance(state: BlackjackHandState): boolean {
  return state.phase === "insurance_offer" && !state.insuranceDecided;
}

export function visibleDealerCards(state: BlackjackHandState): CardIndex[] {
  if (state.dealerRevealed) return state.dealerCards;
  return state.dealerCards.length > 0 ? [state.dealerCards[0]!] : [];
}

export function hiddenDealerCount(state: BlackjackHandState): number {
  return state.dealerRevealed ? 0 : Math.max(0, state.dealerCards.length - 1);
}

export function handsToJson(hands: PlayerHandLine[]) {
  return hands.map((h) => ({
    cards: h.cards,
    wager: h.wager,
    doubled: h.doubled,
    finished: h.finished,
  }));
}

export function handsFromJson(raw: unknown): PlayerHandLine[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.map((item) => {
    const row = item as Record<string, unknown>;
    return {
      cards: (row.cards as CardIndex[]) ?? [],
      wager: Number(row.wager ?? 0),
      doubled: Boolean(row.doubled),
      finished: Boolean(row.finished),
    };
  });
}
