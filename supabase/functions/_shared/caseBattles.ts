/** Case battles (mirrors src/lib/games/case-battles) — self-contained for Deno deploy. */

import type { LootCase } from "./caseBattlesTypes.ts";
import { GENERATED_CASE_CATALOG } from "./caseCatalog.generated.ts";
import { biasCaseRollFloat } from "./rtp.ts";

export type { CaseItem, LootCase } from "./caseBattlesTypes.ts";

export const CASE_CATALOG: LootCase[] = GENERATED_CASE_CATALOG;

export const BOT_CLIENT_SEED = "case-battle-bot";

export function getCaseById(id: string): LootCase | undefined {
  return CASE_CATALOG.find((c) => c.id === id);
}

export function battleEntryCost(caseId: string, rounds: number): number {
  const lootCase = getCaseById(caseId);
  if (!lootCase || rounds < 1) return 0;
  return Math.round(lootCase.price * rounds * 100) / 100;
}

export function battleEntryCostFromCaseIds(caseIds: string[]): number {
  let total = 0;
  for (const id of caseIds) {
    const lootCase = getCaseById(id);
    if (lootCase) total += lootCase.price;
  }
  return Math.round(total * 100) / 100;
}

const MODE_MAX: Record<string, number> = {
  "1v1": 2,
  "1v1v1": 3,
  "1v1v1v1": 4,
  "1v1v1v1v1v1": 6,
  "2v2": 4,
  "2v2v2": 6,
  "3v3": 6,
  "2p": 2,
  "3p": 3,
  "4p": 4,
  "6p": 6,
};

export function maxPlayersForMode(mode: string): number {
  return MODE_MAX[mode] ?? 0;
}

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

async function rollCaseItem(
  lootCase: LootCase,
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  round: number,
  slot: number,
  eosBlockId = ""
): Promise<CaseItem> {
  const hash = await hmacSha256(
    serverSeed,
    `${clientSeed}:${nonce}:${round}:${slot}:${eosBlockId}`
  );
  const f = biasCaseRollFloat(bytesToFloat(hash, 0));
  const total = lootCase.items.reduce((s, i) => s + i.weight, 0);
  let cursor = f * total;
  for (const item of lootCase.items) {
    cursor -= item.weight;
    if (cursor < 0) return item;
  }
  return lootCase.items[lootCase.items.length - 1]!;
}

export function generateBattleSeed(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashSeed(seed: string): Promise<string> {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(seed));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function deriveBattleSeedFromEos(
  internalSeed: string,
  eosBlockId: string
): Promise<string> {
  return hashSeed(`${internalSeed}:${eosBlockId}`);
}

export async function deriveJackpotSeedFromEos(
  battleSeed: string,
  jackpotEosBlockId: string
): Promise<string> {
  return hashSeed(`jackpot:${battleSeed}:${jackpotEosBlockId}`);
}

export type RoundDrop = {
  round: number;
  caseId: string;
  itemId: string;
  name: string;
  value: number;
  rarity: string;
};

export type BattlePlayerResult = {
  slot: number;
  userId: string | null;
  isBot: boolean;
  displayName: string;
  totalValue: number;
  drops: RoundDrop[];
  nonces: number[];
};

export type WinnerPayout = { userId: string; amount: number };

export type ResolvedBattle = {
  caseIds: string[];
  rounds: number;
  gamemode: string;
  players: BattlePlayerResult[];
  winnerSlot: number;
  winnerUserId: string | null;
  winningSlots: number[];
  potTotal: number;
  winnerPayout: number;
  winnerPayouts: WinnerPayout[];
  battleSeed: string;
  jackpotWeights?: { slot: number; weight: number }[];
  jackpotReelSlot?: number;
};

export function isTeamMode(mode: string): boolean {
  return mode === "2v2" || mode === "2v2v2" || mode === "3v3";
}

export function teamIndexForMode(mode: string, slot: number): number {
  switch (mode) {
    case "2v2":
      return slot < 2 ? 0 : 1;
    case "2v2v2":
      return Math.floor(slot / 2);
    case "3v3":
      return slot < 3 ? 0 : 1;
    default:
      return slot;
  }
}

export function parseCaseIds(raw: unknown, fallbackCaseId?: string): string[] {
  if (Array.isArray(raw) && raw.length > 0) return raw.map(String);
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed) && parsed.length > 0) return parsed.map(String);
    } catch {
      /* ignore */
    }
  }
  if (fallbackCaseId) return [fallbackCaseId];
  return [];
}

const MAX_CASES_PER_BATTLE = 50;
const MAX_COPIES_PER_CASE_TYPE = 10;

export function validateCaseSelection(caseIds: string[]): string | null {
  if (!caseIds.length) return "Add at least one case.";
  if (caseIds.length > MAX_CASES_PER_BATTLE) {
    return `Maximum ${MAX_CASES_PER_BATTLE} cases per battle.`;
  }
  const counts = new Map<string, number>();
  for (const id of caseIds) {
    if (!getCaseById(id)) return `Unknown case: ${id}`;
    const n = (counts.get(id) ?? 0) + 1;
    counts.set(id, n);
    if (n > MAX_COPIES_PER_CASE_TYPE) {
      return `Maximum ${MAX_COPIES_PER_CASE_TYPE} of each case type.`;
    }
  }
  return null;
}

const VALID_GAMEMODES = ["normal", "group", "terminal", "jackpot"] as const;
const MAX_BORROW_PERCENT = 80;

export function validateCreateParams(params: {
  caseIds: string[];
  playerMode: string;
  gamemode: string;
  crazyMode?: boolean;
  borrowPercent?: number;
}): string | null {
  const caseErr = validateCaseSelection(params.caseIds);
  if (caseErr) return caseErr;
  if (!(VALID_GAMEMODES as readonly string[]).includes(params.gamemode)) {
    return "Invalid gamemode.";
  }
  if (maxPlayersForMode(params.playerMode) < 2) {
    return "Invalid player mode.";
  }
  if (params.gamemode === "group" && !["2p", "3p", "4p", "6p"].includes(params.playerMode)) {
    return "Group mode requires 2p, 3p, 4p, or 6p.";
  }
  if (params.gamemode !== "group" && ["2p", "3p", "4p", "6p"].includes(params.playerMode)) {
    return "Player mode not valid for this gamemode.";
  }
  if (params.crazyMode && params.gamemode === "group") {
    return "Crazy mode is not available for Group battles.";
  }
  if (params.borrowPercent != null) {
    const b = Number(params.borrowPercent);
    if (!Number.isFinite(b) || b < 0 || b > MAX_BORROW_PERCENT) {
      return `Borrow must be between 0 and ${MAX_BORROW_PERCENT}%.`;
    }
  }
  return null;
}

type OutcomeResult = {
  winnerSlot: number;
  winnerUserId: string | null;
  winnerPayout: number;
  winnerPayouts: WinnerPayout[];
  winningSlots: number[];
  jackpotWeights?: { slot: number; weight: number }[];
  jackpotReelSlot?: number;
};

export function entryAfterBorrow(fullEntry: number, borrowPercent: number): number {
  const pct = Math.min(MAX_BORROW_PERCENT, Math.max(0, borrowPercent));
  return Math.round(fullEntry * (1 - pct / 100) * 100) / 100;
}

export function payoutKeepMultiplier(borrowPercent: number): number {
  const pct = Math.min(MAX_BORROW_PERCENT, Math.max(0, borrowPercent));
  return 1 - pct / 100;
}

export function applyBorrowToPayouts(
  payouts: WinnerPayout[],
  borrowByUserId: Map<string, number>
): WinnerPayout[] {
  return payouts.map((p) => {
    const borrow = borrowByUserId.get(p.userId) ?? 0;
    const mult = payoutKeepMultiplier(borrow);
    return { ...p, amount: Math.round(p.amount * mult * 100) / 100 };
  });
}

/**
 * Cryptographic tie-break (audit #002).
 *
 * Previously, ties were broken by lowest slot index — whoever joined first
 * always won. We replace this with a deterministic SHA-256-based coinflip
 * derived from the battleSeed: SHA-256(`${battleSeed}:tie:${slot}`) acts as
 * each slot's "vote". The tied slots are sorted by the hex output and the
 * lowest hex digest wins. The SQL mirror in supabase/migrations/002_ uses
 * the same domain separator so server- and client-side resolutions agree.
 *
 * Falls back to lowest-slot order when `battleSeed` is unknown (pre-commit UI
 * previews only — the server is authoritative so client previews never affect
 * the actual payout).
 *
 * `domain` namespaces the tie domain so a slot or team tie can never collide
 * with the other's hash input. Keep these strings in sync with SQL.
 */
async function coinflipWinningSlot(
  tiedSlots: number[],
  battleSeed: string | null,
  domain: 'tie' | 'team-tie'
): Promise<number> {
  if (tiedSlots.length <= 1) return tiedSlots[0] ?? -1;
  if (!battleSeed) {
    return tiedSlots.reduce((a, b) => (a < b ? a : b));
  }
  const enc = new TextEncoder();
  const ranked = await Promise.all(
    tiedSlots.map(async (slot) => {
      const buf = await crypto.subtle.digest(
        'SHA-256',
        enc.encode(`${battleSeed}:${domain}:${slot}`),
      );
      return {
        slot,
        hash: Array.from(new Uint8Array(buf))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join(''),
      };
    }),
  );
  ranked.sort((a, b) =>
    a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : a.slot - b.slot
  );
  return ranked[0]!.slot;
}

/**
 * Async extreme-picker used by the resolveXxx functions. Returns the slot
 * index whose `score(players[i])` is best (max or min per `pickMax`), with
 * ties broken by `coinflipWinningSlot`. Replaces the slot-index-biased
 * `pickExtremeIndex` legacy helper (audit #002).
 */
async function pickExtremeByScore(
  players: BattlePlayerResult[],
  score: (p: BattlePlayerResult) => number,
  pickMax: boolean,
  battleSeed: string | null,
): Promise<number> {
  if (players.length === 0) return -1;
  // Bucket slots by score so ties are easy to detect.
  const scored = players.map((p) => ({ slot: p.slot, v: score(p) }));
  let bestV = scored[0]!.v;
  for (let i = 1; i < scored.length; i++) {
    const s = scored[i]!;
    if (pickMax ? s.v > bestV : s.v < bestV) bestV = s.v;
  }
  const tied = scored.filter((s) => s.v === bestV).map((s) => s.slot);
  return coinflipWinningSlot(tied, battleSeed, 'tie');
}

function jackpotWeightsForPlayers(players: BattlePlayerResult[], crazy: boolean): number[] {
  const values = players.map((p) => p.totalValue);
  if (!crazy) return values;
  const sum = values.reduce((s, v) => s + v, 0);
  return values.map((v) => Math.max(0.01, sum - v + 0.01));
}

function lastRoundValue(p: BattlePlayerResult): number {
  const last = p.drops[p.drops.length - 1];
  return last ? last.value : 0;
}

/** Split a payout pool equally among ALL player slots (humans AND bots).
 *
 *  Each slot receives an equal share of the pool. Only humans actually
 *  receive a credit (bots have no `userId` to pay); bot shares are not
 *  paid out — they are effectively returned to the house. This makes Group
 *  mode a true "fair unbox" where the total unboxed value is divided per
 *  seat, so playing with bots reduces each human's take (prevents Group-mode
 *  farming with bots). */
function splitAmongAllSlots(players: BattlePlayerResult[], payoutPool: number): WinnerPayout[] {
  const slots = [...players].sort((a, b) => a.slot - b.slot);
  if (!slots.length || payoutPool <= 0) return [];

  const each = Math.round((payoutPool / slots.length) * 100) / 100;
  let distributed = 0;
  const payouts: WinnerPayout[] = [];
  for (let i = 0; i < slots.length; i++) {
    const p = slots[i]!;
    const share =
      i === slots.length - 1
        ? Math.round((payoutPool - distributed) * 100) / 100
        : each;
    distributed += share;
    // Only humans receive payouts; bot shares are not credited.
    if (!p.isBot && p.userId) {
      payouts.push({ userId: p.userId, amount: share });
    }
  }
  return payouts;
}

/** Split prize pool evenly across every winning team slot; only humans receive payouts. */
function splitWinningTeamPayouts(
  teamPlayers: BattlePlayerResult[],
  payoutPool: number
): WinnerPayout[] {
  const slots = [...teamPlayers].sort((a, b) => a.slot - b.slot);
  if (!slots.length || payoutPool <= 0) return [];

  const each = Math.round((payoutPool / slots.length) * 100) / 100;
  let distributed = 0;
  const payouts: WinnerPayout[] = [];

  for (let i = 0; i < slots.length; i++) {
    const p = slots[i]!;
    const share =
      i === slots.length - 1
        ? Math.round((payoutPool - distributed) * 100) / 100
        : each;
    distributed += share;
    if (!p.isBot && p.userId) {
      payouts.push({ userId: p.userId, amount: share });
    }
  }
  return payouts;
}

/**
 * House edge comes from the case item distribution (cases are priced below
 * their EV so the cumulative unboxed value is below the entry pot). No extra
 * flat rake on top — see audit #002.
 */
function totalUnboxedPool(players: BattlePlayerResult[]): number {
  return Math.round(players.reduce((s, p) => s + p.totalValue, 0) * 100) / 100;
}

async function resolveNormal(
  players: BattlePlayerResult[],
  playerMode: string,
  _potTotal: number,
  crazy: boolean,
  battleSeed: string | null,
): Promise<OutcomeResult> {
  const unboxedPool = totalUnboxedPool(players);

  if (!isTeamMode(playerMode)) {
    const winnerSlot = await pickExtremeByScore(
      players, (p) => p.totalValue, !crazy, battleSeed,
    );
    const winner = players.find((p) => p.slot === winnerSlot)!;
    const winnerPayouts: WinnerPayout[] = [];
    if (!winner.isBot && winner.userId) {
      winnerPayouts.push({ userId: winner.userId, amount: unboxedPool });
    }
    return {
      winnerSlot: winner.slot,
      winnerUserId: winner.isBot ? null : winner.userId,
      winnerPayout: winnerPayouts.length ? unboxedPool : 0,
      winnerPayouts,
      winningSlots: [winner.slot],
    };
  }

  // Team: aggregate by team, then coinflip on tied team totals.
  const teamTotals = new Map<number, number>();
  const teamSlots = new Map<number, number[]>();
  for (const p of players) {
    const t = teamIndexForMode(playerMode, p.slot);
    teamTotals.set(t, (teamTotals.get(t) ?? 0) + p.totalValue);
    const slots = teamSlots.get(t) ?? [];
    slots.push(p.slot);
    teamSlots.set(t, slots);
  }

  const teamIds = Array.from(teamTotals.keys());
  const scoreMap = new Map(teamIds.map((t) => [t, teamTotals.get(t) ?? 0]));
  const minS = Math.min(...scoreMap.values());
  const maxS = Math.max(...scoreMap.values());
  const tiedTeams = teamIds.filter((t) => scoreMap.get(t) === (crazy ? minS : maxS));
  const bestTeam = await coinflipWinningSlot(tiedTeams, battleSeed, 'team-tie');

  const winningSlots = [...(teamSlots.get(bestTeam) ?? [])].sort((a, b) => a - b);
  const winnerPayouts = splitWinningTeamPayouts(
    players.filter((p) => winningSlots.includes(p.slot)),
    unboxedPool
  );
  const paidTotal = winnerPayouts.reduce((s, p) => s + p.amount, 0);

  return {
    winnerSlot: winningSlots[0] ?? 0,
    winnerUserId: winnerPayouts[0]?.userId ?? null,
    winnerPayout: paidTotal,
    winnerPayouts,
    winningSlots,
  };
}

function resolveGroup(players: BattlePlayerResult[], _potTotal: number): OutcomeResult {
  const unboxedPool = totalUnboxedPool(players);
  // Group mode: split the total unboxed value equally among ALL player slots
  // (humans AND bots). Only humans receive actual balance credits; bot shares
  // are not paid out. All slots are marked as "winners" since everyone
  // participates in the cooperative unbox.
  const winnerPayouts = splitAmongAllSlots(players, unboxedPool);
  const paidTotal = winnerPayouts.reduce((s, p) => s + p.amount, 0);

  return {
    winnerSlot: players[0]?.slot ?? 0,
    winnerUserId: winnerPayouts[0]?.userId ?? null,
    winnerPayout: paidTotal,
    winnerPayouts,
    winningSlots: players.map((p) => p.slot),
  };
}

async function resolveTerminal(
  players: BattlePlayerResult[],
  playerMode: string,
  _potTotal: number,
  crazy: boolean,
  battleSeed: string | null,
): Promise<OutcomeResult> {
  const unboxedPool = totalUnboxedPool(players);
  const scoreOf = (p: BattlePlayerResult) => lastRoundValue(p);

  if (!isTeamMode(playerMode)) {
    const winnerSlot = await pickExtremeByScore(
      players, scoreOf, !crazy, battleSeed,
    );
    const winner = players.find((p) => p.slot === winnerSlot)!;
    const winnerPayouts: WinnerPayout[] = [];
    if (!winner.isBot && winner.userId) {
      winnerPayouts.push({ userId: winner.userId, amount: unboxedPool });
    }
    return {
      winnerSlot: winner.slot,
      winnerUserId: winner.isBot ? null : winner.userId,
      winnerPayout: winnerPayouts.length ? unboxedPool : 0,
      winnerPayouts,
      winningSlots: [winner.slot],
    };
  }

  // Team: aggregate per team, then coinflip on tied team scores.
  const teamScores = new Map<number, number>();
  const teamSlots = new Map<number, number[]>();
  for (const p of players) {
    const t = teamIndexForMode(playerMode, p.slot);
    teamScores.set(t, (teamScores.get(t) ?? 0) + scoreOf(p));
    const slots = teamSlots.get(t) ?? [];
    slots.push(p.slot);
    teamSlots.set(t, slots);
  }

  const teamIds = Array.from(teamScores.keys());
  const minS = Math.min(...teamIds.map((t) => teamScores.get(t) ?? 0));
  const maxS = Math.max(...teamIds.map((t) => teamScores.get(t) ?? 0));
  const tiedTeams = teamIds.filter((t) => teamScores.get(t) === (crazy ? minS : maxS));
  const bestTeam = await coinflipWinningSlot(tiedTeams, battleSeed, 'team-tie');

  const winningSlots = [...(teamSlots.get(bestTeam) ?? [])].sort((a, b) => a - b);
  const winnerPayouts = splitWinningTeamPayouts(
    players.filter((p) => winningSlots.includes(p.slot)),
    unboxedPool
  );
  const paidTotal = winnerPayouts.reduce((s, p) => s + p.amount, 0);

  return {
    winnerSlot: winningSlots[0] ?? 0,
    winnerUserId: winnerPayouts[0]?.userId ?? null,
    winnerPayout: paidTotal,
    winnerPayouts,
    winningSlots,
  };
}

async function pickWeightedIndex(weights: number[], seed: string, message: string): Promise<number> {
  const total = weights.reduce((s, w) => s + w, 0);
  const hash = await hmacSha256(seed, message);
  const f = bytesToFloat(hash, 0);

  if (total <= 0) {
    return Math.min(Math.floor(f * weights.length), weights.length - 1);
  }

  let cursor = f * total;
  for (let i = 0; i < weights.length; i++) {
    cursor -= weights[i]!;
    if (cursor < 0) return i;
  }
  return weights.length - 1;
}

async function pickJackpotReelSlot(
  winningSlots: number[],
  battleSeed: string
): Promise<number> {
  if (winningSlots.length === 0) return 0;
  if (winningSlots.length === 1) return winningSlots[0]!;
  const hash = await hmacSha256(battleSeed, "jackpot-reel-slot");
  const f = bytesToFloat(hash, 0);
  const idx = Math.min(Math.floor(f * winningSlots.length), winningSlots.length - 1);
  return winningSlots[idx]!;
}

async function resolveJackpot(
  players: BattlePlayerResult[],
  playerMode: string,
  _potTotal: number,
  battleSeed: string,
  crazy: boolean
): Promise<OutcomeResult> {
  const unboxedPool = totalUnboxedPool(players);
  const weightValues = jackpotWeightsForPlayers(players, crazy);

  if (!isTeamMode(playerMode)) {
    // Solo jackpot: each player's weight IS their odds.
    const jackpotWeights = players.map((p, i) => ({ slot: p.slot, weight: weightValues[i]! }));
    const idx = await pickWeightedIndex(weightValues, battleSeed, crazy ? "jackpot-winner-crazy" : "jackpot-winner");
    const winner = players[idx]!;
    const winnerPayouts: WinnerPayout[] = [];
    if (!winner.isBot && winner.userId) {
      winnerPayouts.push({ userId: winner.userId, amount: unboxedPool });
    }
    return {
      winnerSlot: winner.slot,
      winnerUserId: winner.isBot ? null : winner.userId,
      winnerPayout: winnerPayouts.length ? unboxedPool : 0,
      winnerPayouts,
      winningSlots: [winner.slot],
      jackpotWeights,
      jackpotReelSlot: winner.slot,
    };
  }

  // Team jackpot: sum per-player weights into team buckets, then pick a team.
  // Each player's returned weight = their TEAM's total weight so UI percentages
  // show the team's actual odds (all players on a team share the same fate).
  const teamIds: number[] = [];
  const teamWeights: number[] = [];
  const teamSlots = new Map<number, number[]>();
  const playerTeamIndex: number[] = [];

  for (let pi = 0; pi < players.length; pi++) {
    const p = players[pi]!;
    const t = teamIndexForMode(playerMode, p.slot);
    const w = weightValues[pi] ?? 0;
    let idx = teamIds.indexOf(t);
    if (idx === -1) {
      teamIds.push(t);
      teamWeights.push(0);
      teamSlots.set(t, []);
      idx = teamIds.length - 1;
    }
    teamWeights[idx] = (teamWeights[idx] ?? 0) + w;
    teamSlots.get(t)!.push(p.slot);
    playerTeamIndex[pi] = idx;
  }

  const jackpotWeights = players.map((p, i) => ({
    slot: p.slot,
    weight: teamWeights[playerTeamIndex[i]] ?? 0,
  }));

  const teamIdx = await pickWeightedIndex(
    teamWeights,
    battleSeed,
    crazy ? "jackpot-team-crazy" : "jackpot-team"
  );
  const winningTeam = teamIds[teamIdx] ?? 0;
  const winningSlots = [...(teamSlots.get(winningTeam) ?? [])].sort((a, b) => a - b);
  const winnerPayouts = splitWinningTeamPayouts(
    players.filter((p) => winningSlots.includes(p.slot)),
    unboxedPool
  );
  const paidTotal = winnerPayouts.reduce((s, p) => s + p.amount, 0);
  const jackpotReelSlot = await pickJackpotReelSlot(winningSlots, battleSeed);

  return {
    winnerSlot: jackpotReelSlot,
    winnerUserId: winnerPayouts[0]?.userId ?? null,
    winnerPayout: paidTotal,
    winnerPayouts,
    winningSlots,
    jackpotWeights,
    jackpotReelSlot,
  };
}

async function resolveOutcome(
  players: BattlePlayerResult[],
  playerMode: string,
  gamemode: string,
  potTotal: number,
  battleSeed: string,
  crazy: boolean
): Promise<OutcomeResult> {
  switch (gamemode) {
    case "group":
      return resolveGroup(players, potTotal);
    case "terminal":
      return await resolveTerminal(players, playerMode, potTotal, crazy, battleSeed);
    case "jackpot":
      return await resolveJackpot(players, playerMode, potTotal, battleSeed, crazy);
    case "normal":
    default:
      return await resolveNormal(players, playerMode, potTotal, crazy, battleSeed);
  }
}

export async function finalizeJackpotOutcome(params: {
  players: BattlePlayerResult[];
  playerMode: string;
  potTotal: number;
  battleSeed: string;
  jackpotEosBlockId: string;
  crazyMode?: boolean;
}): Promise<OutcomeResult> {
  const jackpotSeed = await deriveJackpotSeedFromEos(params.battleSeed, params.jackpotEosBlockId);
  const crazy = Boolean(params.crazyMode);
  return resolveJackpot(
    params.players,
    params.playerMode,
    params.potTotal,
    jackpotSeed,
    crazy
  );
}

export async function resolveBattle(params: {
  caseIds: string[];
  battleSeed: string;
  participants: {
    slot: number;
    userId: string | null;
    isBot: boolean;
    displayName: string;
    serverSeed: string;
    clientSeed: string;
    startNonce: number;
  }[];
  potTotal: number;
  playerMode: string;
  gamemode: string;
  crazyMode?: boolean;
  eosBlockId?: string;
  deferJackpot?: boolean;
}): Promise<ResolvedBattle> {
  if (!params.caseIds.length) throw new Error("No cases");
  const eosBlockId = params.eosBlockId ?? "";

  const players: BattlePlayerResult[] = [];

  for (const p of params.participants) {
    const seed = p.isBot ? params.battleSeed : p.serverSeed;
    const client = p.isBot ? BOT_CLIENT_SEED : p.clientSeed;
    const drops: RoundDrop[] = [];
    const nonces: number[] = [];
    let total = 0;

    for (let r = 0; r < params.caseIds.length; r++) {
      const caseId = params.caseIds[r]!;
      const lootCase = getCaseById(caseId);
      if (!lootCase) throw new Error(`Unknown case: ${caseId}`);
      const nonce = p.isBot ? p.slot * 1000 + r : p.startNonce + r;
      nonces.push(nonce);
      const item = await rollCaseItem(lootCase, seed, client, nonce, r, p.slot, eosBlockId);
      drops.push({
        round: r,
        caseId: params.caseIds[r]!,
        itemId: item.id,
        name: item.name,
        value: item.value,
        rarity: item.rarity,
      });
      total += item.value;
    }

    players.push({
      slot: p.slot,
      userId: p.userId,
      isBot: p.isBot,
      displayName: p.displayName,
      totalValue: Math.round(total * 100) / 100,
      drops,
      nonces,
    });
  }

  players.sort((a, b) => a.slot - b.slot);
  const potTotal = Math.round(params.potTotal * 100) / 100;
  const gamemode = params.gamemode || "normal";
  const crazy = Boolean(params.crazyMode) && gamemode !== "group";

  if (gamemode === "jackpot" && params.deferJackpot) {
    const weightValues = jackpotWeightsForPlayers(players, crazy);
    const jackpotWeights = players.map((p, i) => ({ slot: p.slot, weight: weightValues[i]! }));
    return {
      caseIds: params.caseIds,
      rounds: params.caseIds.length,
      gamemode,
      players,
      winnerSlot: 0,
      winnerUserId: null,
      winningSlots: [],
      potTotal,
      winnerPayout: 0,
      winnerPayouts: [],
      battleSeed: params.battleSeed,
      jackpotWeights,
      jackpotReelSlot: undefined,
    };
  }

  const outcome = await resolveOutcome(
    players,
    params.playerMode,
    gamemode,
    potTotal,
    params.battleSeed,
    crazy
  );

  return {
    caseIds: params.caseIds,
    rounds: params.caseIds.length,
    gamemode,
    players,
    winnerSlot: outcome.winnerSlot,
    winnerUserId: outcome.winnerUserId,
    winningSlots: outcome.winningSlots,
    potTotal,
    winnerPayout: outcome.winnerPayout,
    winnerPayouts: outcome.winnerPayouts,
    battleSeed: params.battleSeed,
    jackpotWeights: outcome.jackpotWeights,
    jackpotReelSlot: outcome.jackpotReelSlot,
  };
}/**
 * Cryptographic tie-break (audit #002).
 *
 * Previously, ties were broken by lowest slot index — whoever joined first
 * always won. We replace this with a deterministic SHA-256-based coinflip
 * derived from the battleSeed: SHA-256(`${battleSeed}:tie:${slot}`) acts as
 * each slot's "vote". The tied slots are sorted by the hex output and the
 * lowest hex digest wins. The SQL mirror in supabase/migrations/002_ uses
 * the same domain separator so server- and client-side resolutions agree.
 *
 * Falls back to lowest-slot order when `battleSeed` is unknown (pre-commit UI
 * previews only — the server is authoritative so client previews never affect
 * the actual payout).
 *
 * `domain` namespaces the tie domain so a slot or team tie can never collide
 * with the other's hash input. Keep these strings in sync with SQL.
 */
async function coinflipWinningSlot(
  tiedSlots: number[],
  battleSeed: string | null,
  domain: 'tie' | 'team-tie'
): Promise<number> {
  if (tiedSlots.length <= 1) return tiedSlots[0] ?? -1;
  if (!battleSeed) {
    return tiedSlots.reduce((a, b) => (a < b ? a : b));
  }
  const enc = new TextEncoder();
  const ranked = await Promise.all(
    tiedSlots.map(async (slot) => {
      const buf = await crypto.subtle.digest(
        'SHA-256',
        enc.encode(`${battleSeed}:${domain}:${slot}`),
      );
      return {
        slot,
        hash: Array.from(new Uint8Array(buf))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join(''),
      };
    }),
  );
  ranked.sort((a, b) =>
    a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : a.slot - b.slot
  );
  return ranked[0]!.slot;
}

/**
 * Async extreme-picker used by the resolveXxx functions. Returns the slot
 * index whose `score(players[i])` is best (max or min per `pickMax`), with
 * ties broken by `coinflipWinningSlot`. Replaces the slot-index-biased
 * `pickExtremeIndex` legacy helper (audit #002).
 */
async function pickExtremeByScore(
  players: BattlePlayerResult[],
  score: (p: BattlePlayerResult) => number,
  pickMax: boolean,
  battleSeed: string | null,
): Promise<number> {
  if (players.length === 0) return -1;
  // Bucket slots by score so ties are easy to detect.
  const scored = players.map((p) => ({ slot: p.slot, v: score(p) }));
  let bestV = scored[0]!.v;
  for (let i = 1; i < scored.length; i++) {
    const s = scored[i]!;
    if (pickMax ? s.v > bestV : s.v < bestV) bestV = s.v;
  }
  const tied = scored.filter((s) => s.v === bestV).map((s) => s.slot);
  return coinflipWinningSlot(tied, battleSeed, 'tie');
}


