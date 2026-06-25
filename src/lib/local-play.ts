/**
 * Local play layer — runs every game client-side with a localStorage wallet
 * when the Supabase backend is unavailable. Used as a fallback in
 * `invokeEdgeFunction` so the original game UI works without any rewrite.
 *
 * RTP: 96.5% on all house games, 94.5% on case battles. The edge is baked
 * into the outcome distribution (the player loses 3.5% / 5.5% of every wager
 * on average over time), NOT deducted from individual payouts.
 */

import { GAME_RTP } from "./games/rtp";

// ── Wallet (localStorage) ──────────────────────────────────────────────────
const BAL_KEY = "lottacash:local:balance";
const SWEEPS_KEY = "lottacash:local:sweeps";
const START_GC = 1000;
const START_SC = 50;

function readNum(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null || raw === "") return fallback;
    const v = Number(raw);
    return isFinite(v) && v >= 0 ? v : fallback;
  } catch { return fallback; }
}
function writeNum(key: string, v: number) { try { localStorage.setItem(key, String(v)); } catch { /* */ } }

export function localBalance(coinType: string): number {
  return coinType === "sweeps_coins" ? readNum(SWEEPS_KEY, START_SC) : readNum(BAL_KEY, START_GC);
}
function localDebit(coinType: string, amount: number): boolean {
  const cur = localBalance(coinType);
  if (amount > cur) return false;
  writeNum(coinType === "sweeps_coins" ? SWEEPS_KEY : BAL_KEY, cur - amount);
  return true;
}
function localCredit(coinType: string, amount: number) {
  const cur = localBalance(coinType);
  writeNum(coinType === "sweeps_coins" ? SWEEPS_KEY : BAL_KEY, cur + amount);
}

// ── RNG ────────────────────────────────────────────────────────────────────
function rand(): number {
  const buf = new Uint32Array(1); crypto.getRandomValues(buf); return buf[0] / 2 ** 32;
}
function randInt(n: number): number { return Math.floor(rand() * n); }
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  k = Math.min(k, n - k);
  let r = 1; for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return r;
}
function crashPoint(rtp = GAME_RTP): number {
  const h = rand(); const raw = rtp / (1 - h);
  return Math.max(1, Math.min(Math.floor(raw * 100) / 100, 1_000_000));
}
function keepWin(fairRtp: number, targetRtp = GAME_RTP): boolean {
  if (targetRtp >= fairRtp) return true;
  return rand() < targetRtp / fairRtp;
}
function uid(): string { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

// ── Pending state (in-memory) ──────────────────────────────────────────────
type PendingCrash = { crashPoint: number; wager: number; coinType: string; busted: boolean };
const crashBets = new Map<string, PendingCrash>();

type PendingMines = { mines: Set<number>; revealed: Set<number>; wager: number; mineCount: number; coinType: string; status: string };
const minesGames = new Map<string, PendingMines>();

type PendingBlackjack = {
  shoe: { rank: string; suit: string }[]; player: { rank: string; suit: string }[]; dealer: { rank: string; suit: string }[];
  wager: number; coinType: string; doubled: boolean; phase: string; dealerRevealed: boolean;
};
const bjHands = new Map<string, PendingBlackjack>();

const RANKS = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
const SUITS = ["♠","♥","♦","♣"];
function freshShoe(): { rank: string; suit: string }[] {
  const shoe: { rank: string; suit: string }[] = [];
  for (let d = 0; d < 6; d++) for (const s of SUITS) for (const r of RANKS) shoe.push({ rank: r, suit: s });
  return shuffle(shoe);
}
function handValue(cards: { rank: string; suit: string }[]): number {
  let total = 0, aces = 0;
  for (const c of cards) { if (c.rank === "A") { aces++; total += 11; } else if (["K","Q","J"].includes(c.rank)) total += 10; else total += Number(c.rank); }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}
function cardToNum(card: { rank: string; suit: string }): number {
  const suitIdx = SUITS.indexOf(card.suit);
  const rankIdx = RANKS.indexOf(card.rank);
  return rankIdx * 4 + suitIdx;
}

// ── Game resolvers ─────────────────────────────────────────────────────────
type Result = { data: unknown | null; error: string | null };

export function localPlay(name: string, body: Record<string, unknown>): Result {
  try {
    switch (name) {
      case "place-limbo-bet": return placeLimboBet(body);
      case "place-crash-bet": return placeCrashBet(body);
      case "cash-out-crash": return cashOutCrash(body);
      case "mines-game": return minesGame(body);
      case "place-keno-bet": return placeKenoBet(body);
      case "place-roulette-bet": return placeRouletteBet(body);
      case "blackjack-game": return blackjackGame(body);
      case "place-slots-bet": return placeSlotsBet(body);
      default: return { data: null, error: `"${name}" is not available in local play.` };
    }
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : "Local play error." };
  }
}

function placeLimboBet(body: Record<string, unknown>): Result {
  const wager = Number(body.wager); const target = Number(body.target); const coinType = String(body.coinType ?? "balance");
  if (!isFinite(wager) || wager < 1) return { data: null, error: "Minimum bet is 1." };
  if (!isFinite(target) || target < 1.01) return { data: null, error: "Target must be ≥ 1.01." };
  if (!localDebit(coinType, wager)) return { data: null, error: "Insufficient balance." };
  const point = crashPoint();
  const won = point >= target;
  const payout = won ? Math.round(wager * target * 100) / 100 : 0;
  if (won) localCredit(coinType, payout);
  return { data: { betId: uid(), balance: localBalance(coinType), target, resultMultiplier: point, won, payout, profit: payout - wager, nonce: randInt(999999), coinType }, error: null };
}

function placeCrashBet(body: Record<string, unknown>): Result {
  const wager = Number(body.wager); const coinType = String(body.coinType ?? "balance");
  if (!isFinite(wager) || wager < 1) return { data: null, error: "Minimum bet is 1." };
  if (!localDebit(coinType, wager)) return { data: null, error: "Insufficient balance." };
  const point = crashPoint();
  const betId = uid();
  crashBets.set(betId, { crashPoint: point, wager, coinType, busted: false });
  return { data: { betId, crashPoint: point, won: false, payout: 0, cashedAt: null, nonce: randInt(999999), balance: localBalance(coinType), coinType }, error: null };
}

function cashOutCrash(body: Record<string, unknown>): Result {
  const betId = String(body.betId); const cashedAt = Number(body.cashedAtMultiplier); const coinType = String(body.coinType ?? "balance");
  const bet = crashBets.get(betId);
  if (!bet) return { data: null, error: "Bet not found." };
  if (bet.busted) return { data: null, error: "Bet already crashed." };
  if (cashedAt > bet.crashPoint) return { data: null, error: "Cash out after crash." };
  const payout = Math.round(bet.wager * cashedAt * 100) / 100;
  localCredit(coinType, payout);
  crashBets.delete(betId);
  return { data: { payout, cashedAt, balance: localBalance(coinType), coinType }, error: null };
}

function minesGame(body: Record<string, unknown>): Result {
  const action = String(body.action);
  const coinType = String(body.coinType ?? "balance");
  if (action === "active") return { data: { active: false }, error: null };
  if (action === "start") {
    const wager = Number(body.wager); const mineCount = Number(body.mineCount);
    if (!isFinite(wager) || wager < 1) return { data: null, error: "Minimum bet is 1." };
    if (mineCount < 1 || mineCount > 24) return { data: null, error: "Mines must be 1–24." };
    if (!localDebit(coinType, wager)) return { data: null, error: "Insufficient balance." };
    const gameId = uid();
    const mines = new Set(shuffle(Array.from({ length: 25 }, (_, i) => i)).slice(0, mineCount));
    minesGames.set(gameId, { mines, revealed: new Set(), wager, mineCount, coinType, status: "playing" });
    return { data: { gameId, balance: localBalance(coinType), mineCount, wager, maxGems: 25 - mineCount, nonce: randInt(999999), coinType }, error: null };
  }
  if (action === "reveal") {
    const gameId = String(body.gameId); const tile = Number(body.tile);
    const g = minesGames.get(gameId);
    if (!g) return { data: null, error: "Game not found." };
    if (g.revealed.has(tile)) return { data: null, error: "Tile already revealed." };
    const isMine = g.mines.has(tile);
    if (isMine) {
      const mineTiles = Array.from(g.mines);
      minesGames.delete(gameId);
      return { data: { gameId, tile, isMine: true, gemsRevealed: g.revealed.size, multiplier: 0, status: "busted", balance: localBalance(coinType), payout: 0, mineTiles }, error: null };
    }
    g.revealed.add(tile);
    const gems = g.revealed.size;
    const mult = +(binomial(25, gems) / binomial(25 - g.mineCount, gems) * GAME_RTP).toFixed(4);
    return { data: { gameId, tile, isMine: false, gemsRevealed: gems, multiplier: mult, status: "playing", balance: localBalance(coinType), payout: 0 }, error: null };
  }
  if (action === "cashout") {
    const gameId = String(body.gameId);
    const g = minesGames.get(gameId);
    if (!g) return { data: null, error: "Game not found." };
    if (g.revealed.size === 0) return { data: null, error: "Reveal at least one tile." };
    const gems = g.revealed.size;
    const mult = +(binomial(25, gems) / binomial(25 - g.mineCount, gems) * GAME_RTP).toFixed(4);
    const payout = Math.round(g.wager * mult * 100) / 100;
    localCredit(coinType, payout);
    minesGames.delete(gameId);
    return { data: { gameId, status: "cashed_out", payout, multiplier: mult, gemsRevealed: gems, balance: localBalance(coinType) }, error: null };
  }
  return { data: null, error: "Unknown mines action." };
}

function placeKenoBet(body: Record<string, unknown>): Result {
  const wager = Number(body.wager); const picks = (body.picks as number[]) ?? []; const coinType = String(body.coinType ?? "balance");
  if (!isFinite(wager) || wager < 1) return { data: null, error: "Minimum bet is 1." };
  if (picks.length < 1 || picks.length > 10) return { data: null, error: "Pick 1–10 numbers." };
  if (!localDebit(coinType, wager)) return { data: null, error: "Insufficient balance." };
  const draw = shuffle(Array.from({ length: 40 }, (_, i) => i + 1)).slice(0, 10);
  const hits = draw.filter((n) => picks.includes(n)).length;
  const BASE: Record<number, number[]> = {
    1: [0, 3.5], 2: [0, 1, 9], 3: [0, 0, 2, 40], 4: [0, 0, 1, 5, 90], 5: [0, 0, 0, 3, 15, 300],
    6: [0, 0, 0, 2, 8, 50, 700], 7: [0, 0, 0, 1, 4, 20, 120, 1000], 8: [0, 0, 0, 0, 3, 10, 50, 250, 2000],
    9: [0, 0, 0, 0, 2, 6, 25, 100, 500, 3000], 10: [0, 0, 0, 0, 1, 4, 18, 75, 300, 1500, 8000],
  };
  const k = picks.length;
  const base = BASE[k] ?? [];
  const probHits = (h: number) => (binomial(k, h) * binomial(40 - k, 10 - h)) / binomial(40, 10);
  const baseRtp = base.reduce((s, p, h) => s + probHits(h) * p, 0);
  const scale = GAME_RTP / baseRtp;
  const mult = (base[hits] ?? 0) * scale;
  const payout = Math.round(wager * mult * 100) / 100;
  if (payout > 0) localCredit(coinType, payout);
  return { data: { betId: uid(), balance: localBalance(coinType), drawn: draw, hits, multiplier: mult, payout, profit: payout - wager, nonce: randInt(999999), picks, risk: body.risk ?? "classic", coinType }, error: null };
}

function placeRouletteBet(body: Record<string, unknown>): Result {
  const wager = Number(body.wager); const betType = String(body.betType) as "red"|"black"|"green"|"low"|"high"|"dozen1"|"dozen2"|"dozen3"; const coinType = String(body.coinType ?? "balance");
  if (!isFinite(wager) || wager < 1) return { data: null, error: "Minimum bet is 1." };
  if (!localDebit(coinType, wager)) return { data: null, error: "Insufficient balance." };
  const RED = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
  const colorOf = (n: number) => n === 0 ? "green" : RED.has(n) ? "red" : "black";
  const wins = (b: typeof betType, n: number) => {
    switch (b) { case "red": return colorOf(n)==="red"; case "black": return colorOf(n)==="black"; case "green": return n===0; case "low": return n>=1&&n<=18; case "high": return n>=19&&n<=36; case "dozen1": return n>=1&&n<=12; case "dozen2": return n>=13&&n<=24; case "dozen3": return n>=25&&n<=36; }
  };
  const payoutMap: Record<string, number> = { red:2, black:2, green:36, low:2, high:2, dozen1:3, dozen2:3, dozen3:3 };
  let pocket = randInt(37);
  if (wins(betType, pocket) && !keepWin(36/37, GAME_RTP)) {
    const losing: number[] = []; for (let n = 0; n < 37; n++) if (!wins(betType, n)) losing.push(n);
    pocket = losing[randInt(losing.length)] ?? pocket;
  }
  const won = wins(betType, pocket);
  const payout = won ? Math.round(wager * payoutMap[betType] * 100) / 100 : 0;
  if (won) localCredit(coinType, payout);
  return { data: { betId: uid(), balance: localBalance(coinType), betType, resultPocket: pocket, resultColor: colorOf(pocket) as "red"|"black"|"green", won, payout, profit: payout - wager, multiplier: payoutMap[betType], nonce: randInt(999999), coinType }, error: null };
}

function blackjackGame(body: Record<string, unknown>): Result {
  const action = String(body.action); const coinType = String(body.coinType ?? "balance");
  if (action === "active") return { data: { active: false }, error: null };
  if (action === "start") {
    const wager = Number(body.wager);
    if (!isFinite(wager) || wager < 1) return { data: null, error: "Minimum bet is 1." };
    if (!localDebit(coinType, wager)) return { data: null, error: "Insufficient balance." };
    const shoe = freshShoe();
    const player = [shoe.pop()!, shoe.pop()!];
    const dealer = [shoe.pop()!, shoe.pop()!];
    const handId = uid();
    bjHands.set(handId, { shoe, player, dealer, wager, coinType, doubled: false, phase: "player_turn", dealerRevealed: false });
    const pv = handValue(player), dv = handValue(dealer);
    let status = "player_turn", outcome: string | null = null, payout: number | undefined;
    if (pv === 21 && dv === 21) { status = "push"; outcome = "push"; payout = wager; localCredit(coinType, wager); }
    else if (pv === 21) {
      status = "bj"; outcome = "bj";
      if (keepWin(0.993, GAME_RTP)) { payout = Math.round(wager * 2.5 * 100) / 100; localCredit(coinType, payout); }
      else { status = "lose"; outcome = "lose"; }
    }
    else if (dv === 21) { status = "dealer_blackjack"; outcome = "lose"; }
    return { data: mapBj(handId, bjHands.get(handId)!, status, outcome, payout), error: null };
  }
  const handId = String(body.handId);
  const h = bjHands.get(handId);
  if (!h) return { data: null, error: "Hand not found." };
  if (action === "hit") {
    h.player.push(h.shoe.pop()!);
    const v = handValue(h.player);
    if (v > 21) { bjHands.delete(handId); return { data: mapBj(handId, h, "bust", "lose", undefined, true), error: null }; }
    if (v === 21) { return standBj(handId, h); }
    return { data: mapBj(handId, h, "player_turn", null, undefined), error: null };
  }
  if (action === "stand") return standBj(handId, h);
  if (action === "double") {
    if (h.player.length !== 2) return { data: null, error: "Can only double on first two cards." };
    if (!localDebit(coinType, h.wager)) return { data: null, error: "Insufficient balance to double." };
    h.wager *= 2; h.doubled = true;
    h.player.push(h.shoe.pop()!);
    if (handValue(h.player) > 21) { bjHands.delete(handId); return { data: mapBj(handId, h, "bust", "lose", undefined, true), error: null }; }
    return standBj(handId, h);
  }
  return { data: null, error: "Unknown blackjack action." };
}

function standBj(handId: string, h: PendingBlackjack): Result {
  h.dealerRevealed = true;
  while (handValue(h.dealer) < 17) h.dealer.push(h.shoe.pop()!);
  const pv = handValue(h.player), dv = handValue(h.dealer);
  let status: string, outcome: string, payout: number | undefined;
  if (dv > 21 || pv > dv) {
    if (keepWin(0.993, GAME_RTP)) { status = "win"; outcome = "win"; payout = Math.round(h.wager * 2 * 100) / 100; localCredit(h.coinType, payout); }
    else { status = "lose"; outcome = "lose"; }
  } else if (pv === dv) { status = "push"; outcome = "push"; payout = h.wager; localCredit(h.coinType, h.wager); }
  else { status = "lose"; outcome = "lose"; }
  bjHands.delete(handId);
  return { data: mapBj(handId, h, status, outcome, payout), error: null };
}

function mapBj(handId: string, h: PendingBlackjack, status: string, outcome: string | null, payout?: number, dealerRevealed?: boolean): Record<string, unknown> {
  const pv = handValue(h.player), dv = handValue(h.dealer);
  return {
    handId, balance: localBalance(h.coinType), status, outcome: outcome ?? null,
    payout: payout ?? (status === "push" ? h.wager : 0),
    nonce: randInt(999999), coinType: h.coinType,
    wager: h.doubled ? h.wager / 2 : h.wager, totalWager: h.wager, doubled: h.doubled,
    playerCards: h.player.map(cardToNum), dealerCards: h.dealer.map(cardToNum),
    dealerRevealed: dealerRevealed ?? (h.dealerRevealed || status !== "player_turn"),
    playerTotal: pv, dealerTotal: dv,
    canDouble: h.player.length === 2 && !h.doubled, canSplit: false, canInsurance: false, insuranceAmount: 0,
    phase: status === "player_turn" ? "player_turn" : "resolved",
    isSplit: false, activeHandIndex: 0,
    playerHands: [{ cards: h.player.map(cardToNum), total: pv, wager: h.wager, doubled: h.doubled, finished: status !== "player_turn" }],
  };
}

// ── Slots ───────────────────────────────────────────────────────────────────
const SLOTS_SYMBOLS = ["🍒","🍋","🔔","⭐","7","💎","👑"];
const SLOTS_PAYOUTS = [3, 5, 8, 15, 30, 80, 190]; // sum = 331 → 331/343 = 96.5%

function placeSlotsBet(body: Record<string, unknown>): Result {
  const wager = Number(body.wager); const coinType = String(body.coinType ?? "balance");
  if (!isFinite(wager) || wager < 1) return { data: null, error: "Minimum bet is 1." };
  if (!localDebit(coinType, wager)) return { data: null, error: "Insufficient balance." };
  const reels = [randInt(7), randInt(7), randInt(7)];
  const won = reels[0] === reels[1] && reels[1] === reels[2];
  const mult = won ? SLOTS_PAYOUTS[reels[0]]! : 0;
  const payout = Math.round(wager * mult * 100) / 100;
  if (won) localCredit(coinType, payout);
  return { data: { reels, symbols: reels.map((i) => SLOTS_SYMBOLS[i]), won, multiplier: mult, payout, outBalance: localBalance(coinType), gameId: uid(), nonce: randInt(999999), coinType }, error: null };
}
