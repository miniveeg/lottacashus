/** Stake Blackjack logic (mirrors src/lib/games/blackjack). */

import { retainStakeStyleWin } from "./rtp.ts";
import { rtpBiasFloat } from "./rtpBias.ts";

export type CardIndex = number;
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

const SHOE_SIZE = 52;

function bytesToFloat(bytes: Uint8Array, offset: number): number {
  let value = 0;
  for (let i = 0; i < 4; i++) value += bytes[offset + i]! / Math.pow(256, i + 1);
  return value;
}

async function hmacSha256(key: string, message: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return new Uint8Array(sig);
}

async function blackjackFloatsFromSeeds(
  serverSeed: string,
  clientSeed: string,
  nonce: number
): Promise<number[]> {
  const floats: number[] = [];
  let cursor = 0;
  while (floats.length < SHOE_SIZE) {
    const hash = await hmacSha256(serverSeed, `${clientSeed}:${nonce}:${cursor}`);
    for (let i = 0; i + 4 <= hash.length && floats.length < SHOE_SIZE; i += 4) {
      floats.push(bytesToFloat(hash, i));
    }
    cursor++;
  }
  return floats;
}

function shuffleShoe(floats: number[]): CardIndex[] {
  const pool = Array.from({ length: SHOE_SIZE }, (_, i) => i);
  for (let i = 0; i < SHOE_SIZE - 1; i++) {
    const remaining = SHOE_SIZE - i;
    const idx = Math.floor(floats[i]! * remaining);
    const pick = i + idx;
    const tmp = pool[i]!;
    pool[i] = pool[pick]!;
    pool[pick] = tmp;
  }
  return pool;
}

async function buildShuffledShoe(
  serverSeed: string,
  clientSeed: string,
  nonce: number
): Promise<CardIndex[]> {
  return shuffleShoe(await blackjackFloatsFromSeeds(serverSeed, clientSeed, nonce));
}

function drawFromShoe(shoe: CardIndex[], index: number) {
  return { card: shoe[index]!, nextIndex: index + 1 };
}

function handValue(cards: CardIndex[]) {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    const r = Math.floor(c / 4);
    if (r === 12) aces++;
    else if (r >= 9) total += 10;
    else total += r + 2;
  }
  for (let i = 0; i < aces; i++) {
    if (total + 11 <= 21) total += 11;
    else total += 1;
  }
  return { total, soft: aces > 0 && total <= 21 && total >= 12 };
}

function cardRankIndex(card: CardIndex): number {
  return Math.floor(card / 4);
}

function isBlackjack(cards: CardIndex[]) {
  return cards.length === 2 && handValue(cards).total === 21;
}

function isBusted(cards: CardIndex[]) {
  return handValue(cards).total > 21;
}

function dealerShowsAce(cards: CardIndex[]) {
  return cardRankIndex(cards[0]!) === 12;
}

function dealerShowsAceOrTen(cards: CardIndex[]) {
  const r = cardRankIndex(cards[0]!);
  return r === 12 || r >= 9;
}

function dealerShouldHit(cards: CardIndex[]) {
  const v = handValue(cards);
  if (v.total < 17) return true;
  if (v.total === 17 && v.soft) return true;
  return false;
}

function playDealer(shoe: CardIndex[], shoeIndex: number, dealerCards: CardIndex[]) {
  const cards = [...dealerCards];
  let idx = shoeIndex;
  while (dealerShouldHit(cards)) {
    const d = drawFromShoe(shoe, idx);
    cards.push(d.card);
    idx = d.nextIndex;
  }
  return { dealerCards: cards, shoeIndex: idx };
}

function compareOutcome(playerCards: CardIndex[], dealerCards: CardIndex[]) {
  if (isBusted(playerCards)) return "lose" as const;
  if (isBusted(dealerCards)) return "win" as const;
  const p = handValue(playerCards);
  const d = handValue(dealerCards);
  if (p.total > d.total) return "win" as const;
  if (p.total < d.total) return "lose" as const;
  return "push" as const;
}

export function calculatePayout(
  outcome: BlackjackOutcome,
  wager: number,
  totalWager: number,
  fromSplit = false
): number {
  if (!outcome) return 0;
  if (outcome === "blackjack" && !fromSplit) return Math.round(wager * 2.5 * 100) / 100;
  if (outcome === "win") return Math.round(totalWager * 2 * 100) / 100;
  if (outcome === "push") return totalWager;
  return 0;
}

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
  return { ...state, playerCards: active.cards, doubled: active.doubled };
}

function withHands(state: BlackjackHandState, hands: PlayerHandLine[]): BlackjackHandState {
  return syncActiveHand({ ...state, playerHands: hands, isSplit: hands.length > 1 });
}

function createInitialState(
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
) {
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
    const bias = await rtpBiasFloat(serverSeed, clientSeed, nonce, "bj-deal");
    outcome = applyRtpBiasToOutcome(outcome, bias);
    return {
      state,
      outcome,
      payout: calculatePayout(outcome, wager, wager),
      instantSettle: true,
    };
  }
  if (dealerShowsAce(dealerCards)) {
    state = { ...state, phase: "insurance_offer", insuranceDecided: false };
  }
  return { state, outcome: null, payout: 0, instantSettle: false };
}

function aggregateOutcome(outcomes: BlackjackOutcome[]): BlackjackOutcome {
  const filtered = outcomes.filter(Boolean) as Exclude<BlackjackOutcome, null>[];
  if (filtered.length === 0) return null;
  if (filtered.some((o) => o === "blackjack" || o === "win")) return "win";
  if (filtered.every((o) => o === "push")) return "push";
  if (filtered.every((o) => o === "bust" || o === "lose")) return "lose";
  return "win";
}

function settleMainHand(
  hand: PlayerHandLine,
  dealerCards: CardIndex[],
  fromSplit: boolean,
  rtpBias?: number
) {
  if (hand.finished && isBusted(hand.cards)) return { outcome: "bust" as const, payout: 0 };
  const totalWager = hand.doubled ? hand.wager * 2 : hand.wager;
  let outcome: BlackjackOutcome = compareOutcome(hand.cards, dealerCards);
  if (!fromSplit && isBlackjack(hand.cards) && !isBlackjack(dealerCards) && hand.cards.length === 2) {
    outcome = "blackjack";
  }
  outcome = applyRtpBiasToOutcome(outcome, rtpBias);
  return { outcome, payout: calculatePayout(outcome, hand.wager, totalWager, fromSplit) };
}

export function settleDealerBlackjack(state: BlackjackHandState) {
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
  if (state.insuranceTaken) mainPayout += insurancePayout(state.insuranceWager);
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

export function resolveInsurance(state: BlackjackHandState, take: boolean) {
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

function markHandFinished(state: BlackjackHandState, index: number, hands: PlayerHandLine[]) {
  const updated = hands.map((h, i) => (i === index ? { ...h, finished: true } : h));
  const allDone = updated.every((h) => h.finished);
  if (allDone) return withHands(state, updated);
  return advanceHandIndex(withHands({ ...state, playerHands: updated }, updated));
}

function settleAllHands(
  state: BlackjackHandState,
  handRtpBias?: (handIndex: number) => number | undefined
) {
  const played = playDealer(state.shoe, state.shoeIndex, state.dealerCards);
  let totalPayout = 0;
  const outcomes: BlackjackOutcome[] = [];
  state.playerHands.forEach((hand, i) => {
    const result = settleMainHand(hand, played.dealerCards, state.isSplit, handRtpBias?.(i));
    outcomes.push(result.outcome);
    totalPayout += result.payout;
  });
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

export function hitCard(
  state: BlackjackHandState,
  handRtpBias?: (handIndex: number) => number | undefined
) {
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
      if (next.playerHands.every((h) => isBusted(h.cards))) {
        return {
          state: { ...next, dealerRevealed: true, phase: "settled" },
          outcome: "bust" as const,
          payout: 0,
          done: true,
        };
      }
      const settled = settleAllHands(next, handRtpBias);
      return { state: settled.state, outcome: settled.outcome, payout: settled.payout, done: true };
    }
    return { state: next, outcome: null, payout: 0, done: false };
  }
  if (handValue(cards).total === 21) {
    next = markHandFinished(next, idx, next.playerHands);
    if (next.playerHands.every((h) => h.finished)) {
      const settled = settleAllHands(next, handRtpBias);
      return { state: settled.state, outcome: settled.outcome, payout: settled.payout, done: true };
    }
    return { state: next, outcome: null, payout: 0, done: false };
  }
  return { state: next, outcome: null, payout: 0, done: false };
}

export function standHand(
  state: BlackjackHandState,
  handRtpBias?: (handIndex: number) => number | undefined
) {
  const idx = state.activeHandIndex;
  const hands = [...state.playerHands];
  hands[idx] = { ...hands[idx]!, finished: true };
  let next = withHands(state, hands);
  if (next.playerHands.every((h) => h.finished)) {
    const settled = settleAllHands(next, handRtpBias);
    return { state: settled.state, outcome: settled.outcome, payout: settled.payout, done: true };
  }
  next = advanceHandIndex(next);
  return { state: next, outcome: null, payout: 0, done: false };
}

export function doubleHand(
  state: BlackjackHandState,
  handRtpBias?: (handIndex: number) => number | undefined
) {
  const idx = state.activeHandIndex;
  const hand = state.playerHands[idx]!;
  if (hand.cards.length !== 2 || hand.doubled) throw new Error("Cannot double");
  const draw = drawFromShoe(state.shoe, state.shoeIndex);
  const cards = [...hand.cards, draw.card];
  const hands = [...state.playerHands];
  hands[idx] = { ...hand, cards, doubled: true, finished: true };
  let next = withHands(
    { ...state, shoeIndex: draw.nextIndex, totalWager: state.totalWager + hand.wager },
    hands
  );
  if (next.playerHands.every((h) => h.finished)) {
    if (next.playerHands.every((h) => isBusted(h.cards))) {
      return {
        state: { ...next, dealerRevealed: true, phase: "settled" },
        outcome: "bust" as const,
        payout: 0,
        extraWager: hand.wager,
        done: true,
      };
    }
    const settled = settleAllHands(next, handRtpBias);
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

export function splitHand(
  state: BlackjackHandState,
  handRtpBias?: (handIndex: number) => number | undefined
) {
  if (state.isSplit || state.phase !== "player_turn") throw new Error("Cannot split");
  const hand = state.playerHands[0]!;
  if (hand.cards.length !== 2 || cardRankIndex(hand.cards[0]!) !== cardRankIndex(hand.cards[1]!)) {
    throw new Error("Cannot split");
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
  if (handValue(hands[0]!.cards).total === 21) next.playerHands[0] = { ...next.playerHands[0]!, finished: true };
  if (handValue(hands[1]!.cards).total === 21) next.playerHands[1] = { ...next.playerHands[1]!, finished: true };
  next = withHands(next, [...next.playerHands]);
  if (next.playerHands.every((h) => h.finished)) {
    const settled = settleAllHands(next, handRtpBias);
    return {
      state: settled.state,
      outcome: settled.outcome,
      payout: settled.payout,
      extraWager: hand.wager,
      instantSettle: true,
    };
  }
  if (next.playerHands[0]!.finished) next = advanceHandIndex(next);
  return {
    state: next,
    outcome: null,
    payout: 0,
    extraWager: hand.wager,
    instantSettle: false,
  };
}

export function canDouble(state: BlackjackHandState) {
  if (state.phase !== "player_turn") return false;
  const hand = state.playerHands[state.activeHandIndex];
  return Boolean(hand && hand.cards.length === 2 && !hand.doubled && !hand.finished);
}

export function canSplit(state: BlackjackHandState) {
  if (state.phase !== "player_turn" || state.isSplit) return false;
  const hand = state.playerHands[0];
  if (!hand || hand.cards.length !== 2 || hand.finished) return false;
  return cardRankIndex(hand.cards[0]!) === cardRankIndex(hand.cards[1]!);
}

export function canTakeInsurance(state: BlackjackHandState) {
  return state.phase === "insurance_offer" && !state.insuranceDecided;
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

export function stateFromRow(row: {
  shoe: number[];
  shoe_index: number;
  player_cards: number[];
  dealer_cards: number[];
  wager: number;
  total_wager: number;
  doubled: boolean;
  dealer_revealed: boolean;
  phase?: string;
  insurance_wager?: number;
  insurance_taken?: boolean;
  insurance_decided?: boolean;
  is_split?: boolean;
  player_hands?: unknown;
  active_hand_index?: number;
}): BlackjackHandState {
  const wager = Number(row.wager);
  const parsedHands = handsFromJson(row.player_hands);
  const playerHands =
    parsedHands ??
    [singleHandLine(row.player_cards, wager)];
  const state: BlackjackHandState = {
    shoe: row.shoe,
    shoeIndex: row.shoe_index,
    dealerCards: row.dealer_cards,
    dealerRevealed: row.dealer_revealed,
    wager,
    totalWager: Number(row.total_wager),
    doubled: row.doubled,
    playerCards: row.player_cards,
    isSplit: Boolean(row.is_split),
    playerHands,
    activeHandIndex: Number(row.active_hand_index ?? 0),
    phase: (row.phase as BlackjackPhase) ?? "player_turn",
    insuranceWager: Number(row.insurance_wager ?? 0),
    insuranceTaken: Boolean(row.insurance_taken),
    insuranceDecided: row.insurance_decided !== false,
  };
  return syncActiveHand(state);
}

export function clientHandPayload(state: BlackjackHandState) {
  const visibleDealer = state.dealerRevealed
    ? state.dealerCards
    : state.dealerCards.length > 0
      ? [state.dealerCards[0]!]
      : [];
  return {
    playerCards: state.playerCards,
    dealerCards: visibleDealer,
    dealerRevealed: state.dealerRevealed,
    playerTotal: handValue(state.playerCards).total,
    dealerTotal: state.dealerRevealed
      ? handValue(state.dealerCards).total
      : visibleDealer.length
        ? handValue(visibleDealer).total
        : 0,
    doubled: state.doubled,
    totalWager: state.totalWager,
    canDouble: canDouble(state),
    canSplit: canSplit(state),
    canInsurance: canTakeInsurance(state),
    insuranceAmount: insuranceAmount(state.wager),
    phase: state.phase,
    isSplit: state.isSplit,
    activeHandIndex: state.activeHandIndex,
    playerHands: state.playerHands.map((h) => ({
      cards: h.cards,
      total: handValue(h.cards).total,
      wager: h.wager,
      doubled: h.doubled,
      finished: h.finished,
    })),
  };
}

export function validateWager(wager: number): string | null {
  if (!Number.isFinite(wager) || wager < 1) return "Minimum bet is 1 SC or GC.";
  if (wager > 100_000) return "Maximum bet is $100,000.";
  return null;
}
