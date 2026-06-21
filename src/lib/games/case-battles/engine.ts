import { battleEntryCostFromCaseIds } from "./cases";
import {
  BATTLE_GAMEMODES,
  isTeamMode,
  maxPlayersForMode,
  MAX_CASES_PER_BATTLE,
  MAX_COPIES_PER_CASE_TYPE,
  MAX_BORROW_PERCENT,
  teamIndexForMode,
  type PlayerModeId,
} from "./config";
import { getCaseById } from "./cases";
import { bytesToFloat, rollCaseItem } from "./provablyFair";

export const BATTLE_RAKE = 0.05;
export const BOT_CLIENT_SEED = "case-battle-bot";

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

export { isTeamMode, teamIndexForMode };

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

export function validateCreateParams(params: {
  caseIds: string[];
  playerMode: PlayerModeId | string;
  gamemode: string;
  crazyMode?: boolean;
  borrowPercent?: number;
}): string | null {
  const caseErr = validateCaseSelection(params.caseIds);
  if (caseErr) return caseErr;
  if (maxPlayersForMode(params.playerMode) < 2) return "Invalid player mode.";
  if (!(BATTLE_GAMEMODES as readonly string[]).includes(params.gamemode)) {
    return "Invalid gamemode.";
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

async function rollPlayerRounds(params: {
  caseIds: string[];
  serverSeed: string;
  clientSeed: string;
  startNonce: number;
  slot: number;
  isBot: boolean;
  eosBlockId?: string;
}): Promise<{ drops: RoundDrop[]; nonces: number[]; total: number }> {
  const drops: RoundDrop[] = [];
  const nonces: number[] = [];
  let total = 0;

  for (let r = 0; r < params.caseIds.length; r++) {
    const caseId = params.caseIds[r]!;
    const lootCase = getCaseById(caseId);
    if (!lootCase) throw new Error(`Unknown case: ${caseId}`);

    const nonce = params.isBot ? params.slot * 1000 + r : params.startNonce + r;
    nonces.push(nonce);

    const item = await rollCaseItem({
      lootCase,
      serverSeed: params.serverSeed,
      clientSeed: params.clientSeed,
      nonce,
      round: r,
      slot: params.slot,
      eosBlockId: params.eosBlockId,
    });

    drops.push({
      round: r,
      caseId,
      itemId: item.id,
      name: item.name,
      value: item.value,
      rarity: item.rarity,
    });
    total += item.value;
  }

  return { drops, nonces, total: Math.round(total * 100) / 100 };
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

function totalUnboxedPool(players: BattlePlayerResult[]): number {
  return Math.round(players.reduce((s, p) => s + p.totalValue, 0) * 100) / 100;
}

function pickExtremeIndex(
  players: BattlePlayerResult[],
  score: (p: BattlePlayerResult) => number,
  pickMax: boolean
): number {
  let idx = 0;
  for (let i = 1; i < players.length; i++) {
    const a = score(players[i]!);
    const b = score(players[idx]!);
    const better = pickMax ? a > b : a < b;
    const tie = a === b && players[i]!.slot < players[idx]!.slot;
    if (better || tie) idx = i;
  }
  return idx;
}

function jackpotWeightsForPlayers(players: BattlePlayerResult[], crazy: boolean): number[] {
  const values = players.map((p) => p.totalValue);
  if (!crazy) return values;
  const sum = values.reduce((s, v) => s + v, 0);
  return values.map((v) => Math.max(0.01, sum - v + 0.01));
}

function resolveNormal(
  players: BattlePlayerResult[],
  playerMode: string,
  _potTotal: number,
  crazy: boolean
): OutcomeResult {
  const unboxedPool = totalUnboxedPool(players);

  if (!isTeamMode(playerMode)) {
    const bestIdx = pickExtremeIndex(players, (p) => p.totalValue, !crazy);
    const winner = players[bestIdx]!;
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

  const teamTotals = new Map<number, number>();
  const teamSlots = new Map<number, number[]>();
  for (const p of players) {
    const t = teamIndexForMode(playerMode, p.slot);
    teamTotals.set(t, (teamTotals.get(t) ?? 0) + p.totalValue);
    const slots = teamSlots.get(t) ?? [];
    slots.push(p.slot);
    teamSlots.set(t, slots);
  }

  let bestTeam = 0;
  let bestTotal = crazy ? Number.POSITIVE_INFINITY : -1;
  for (const [t, total] of teamTotals) {
    const better = crazy
      ? total < bestTotal || (total === bestTotal && t < bestTeam)
      : total > bestTotal || (total === bestTotal && t < bestTeam);
    if (better) {
      bestTotal = total;
      bestTeam = t;
    }
  }

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

function resolveTerminal(
  players: BattlePlayerResult[],
  playerMode: string,
  _potTotal: number,
  crazy: boolean
): OutcomeResult {
  const unboxedPool = totalUnboxedPool(players);
  const scoreOf = (p: BattlePlayerResult) => lastRoundValue(p);

  if (!isTeamMode(playerMode)) {
    const bestIdx = pickExtremeIndex(players, scoreOf, !crazy);
    const winner = players[bestIdx]!;
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

  const teamScores = new Map<number, number>();
  const teamSlots = new Map<number, number[]>();
  for (const p of players) {
    const t = teamIndexForMode(playerMode, p.slot);
    teamScores.set(t, (teamScores.get(t) ?? 0) + scoreOf(p));
    const slots = teamSlots.get(t) ?? [];
    slots.push(p.slot);
    teamSlots.set(t, slots);
  }

  let bestTeam = 0;
  let bestScore = crazy ? Number.POSITIVE_INFINITY : -1;
  for (const [t, score] of teamScores) {
    const better = crazy
      ? score < bestScore || (score === bestScore && t < bestTeam)
      : score > bestScore || (score === bestScore && t < bestTeam);
    if (better) {
      bestScore = score;
      bestTeam = t;
    }
  }

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
    // Solo jackpot: each player's weight IS their odds. The returned
    // jackpotWeights reflects actual win probability per slot.
    const jackpotWeights = players.map((p, i) => ({ slot: p.slot, weight: weightValues[i]! }));
    const idx = await pickWeightedIndex(
      weightValues,
      battleSeed,
      crazy ? "jackpot-winner-crazy" : "jackpot-winner"
    );
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
  // The returned jackpotWeights gives each player their TEAM's total weight
  // (not their individual weight) so the UI's `weight / total * 100` shows
  // the team's actual odds — every player on a team shares the same fate.
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

  // Build per-player weights where each player gets their team's total weight.
  // This ensures the displayed percentages match the actual team selection
  // probability (all players on a team have identical odds).
  const totalTeamWeight = teamWeights.reduce((s, w) => s + w, 0);
  const jackpotWeights = players.map((p, i) => ({
    slot: p.slot,
    weight: teamWeights[playerTeamIndex[i]] ?? 0,
  }));
  void totalTeamWeight; // used implicitly via jackpotWeights normalization in UI

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
      return resolveTerminal(players, playerMode, potTotal, crazy);
    case "jackpot":
      return await resolveJackpot(players, playerMode, potTotal, battleSeed, crazy);
    case "normal":
    default:
      return resolveNormal(players, playerMode, potTotal, crazy);
  }
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
}): Promise<ResolvedBattle> {
  if (!params.caseIds.length) throw new Error("No cases in battle");
  const eosBlockId = params.eosBlockId ?? "";

  const players: BattlePlayerResult[] = [];

  for (const p of params.participants) {
    const seed = p.isBot ? params.battleSeed : p.serverSeed;
    const client = p.isBot ? BOT_CLIENT_SEED : p.clientSeed;
    const rolled = await rollPlayerRounds({
      caseIds: params.caseIds,
      serverSeed: seed,
      clientSeed: client,
      startNonce: p.startNonce,
      slot: p.slot,
      isBot: p.isBot,
      eosBlockId,
    });
    players.push({
      slot: p.slot,
      userId: p.userId,
      isBot: p.isBot,
      displayName: p.displayName,
      totalValue: rolled.total,
      drops: rolled.drops,
      nonces: rolled.nonces,
    });
  }

  players.sort((a, b) => a.slot - b.slot);
  const potTotal = Math.round(params.potTotal * 100) / 100;
  const gamemode = params.gamemode || "normal";
  const crazy = Boolean(params.crazyMode) && gamemode !== "group";
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
}

export function entryCostForCaseIds(caseIds: string[]): number {
  return battleEntryCostFromCaseIds(caseIds);
}

export function parseCaseIds(raw: unknown, fallbackCaseId?: string): string[] {
  if (Array.isArray(raw) && raw.length > 0) {
    return raw.map(String);
  }
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
