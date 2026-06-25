/**
 * Local Case Battles — in-memory battle state machine with 94.5% RTP.
 * Used as a fallback when the Supabase backend is unavailable.
 */

import { GENERATED_CASE_CATALOG } from "./games/case-battles/caseCatalog.generated";
import type { LootCase, CaseItem } from "./games/case-battles/caseTypes";
import { CASE_BATTLES_RTP, biasCaseRollFloat } from "./games/rtp";

// ── Wallet (shared with local-play.ts) ─────────────────────────────────────
const BAL_KEY = "lottacash:local:balance";
const SWEEPS_KEY = "lottacash:local:sweeps";

function readNum(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null || raw === "") return fallback;
    const v = Number(raw);
    return isFinite(v) && v >= 0 ? v : fallback;
  } catch { return fallback; }
}
function writeNum(key: string, v: number) { try { localStorage.setItem(key, String(v)); } catch { /* */ } }
function localBalance(coinType: string): number {
  return coinType === "sweeps_coins" ? readNum(SWEEPS_KEY, 50) : readNum(BAL_KEY, 1000);
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
function uid(): string { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

// ── Battle store (in-memory) ───────────────────────────────────────────────
export type LocalBattle = {
  id: string; creatorId: string; gamemode: string; crazy: boolean;
  playerMode: string; maxPlayers: number; caseIds: string[]; rounds: number;
  entryCost: number; coinType: "balance" | "sweeps_coins"; borrowPercent: number;
  potTotal: number; status: "waiting" | "committing" | "running" | "completed";
  seedHash: string; eosBlockTarget: number | null; eosBlockId: string | null;
  battleSeed: string | null; createdAt: string; startedAt: string | null;
  completedAt: string | null; players: LocalPlayer[]; drops: LocalDrop[];
  winnerSlot: number | null; claimed: Set<number>;
};

export type LocalPlayer = {
  slot: number; userId: string | null; isBot: boolean;
  username: string; avatarSeed: string | null;
};

export type LocalDrop = {
  slot: number; round: number; caseId: string; itemId: string;
  itemName: string; itemValue: number; itemRarity: string;
};

const battles = new Map<string, LocalBattle>();
const BOT_NAMES = ["CryptoKing", "LuckyAce", "RollDeep", "HighRoller", "TheWhale", "JackpotJoe", "AllIn", "SpinMaster"];

function getCase(id: string): LootCase | undefined { return GENERATED_CASE_CATALOG.find((c) => c.id === id); }

/** Drop a weighted-random item from a case, applying the RTP bias. */
function dropItem(c: LootCase): CaseItem {
  const total = c.items.reduce((s: number, it: CaseItem) => s + it.weight, 0);
  const r = biasCaseRollFloat(rand()) * total;
  for (const it of c.items) {
    if (r <= it.weight) return it;
  }
  return c.items[c.items.length - 1]!;
}

// ── Public API (mirrors caseBattlesApi.ts) ─────────────────────────────────

export function localListOpenBattles(): LocalBattle[] {
  return Array.from(battles.values())
    .filter((b) => b.status === "waiting" || b.status === "committing" || b.status === "running")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function localViewCaseBattle(battleId: string): LocalBattle | null {
  return battles.get(battleId) ?? null;
}

export function localCreateBattle(params: {
  gamemode: string; crazy: boolean; playerMode: string; caseIds: string[];
  entryCost: number; coinType: "balance" | "sweeps_coins"; borrowPercent: number;
}): { battleId: string | null; error: string | null } {
  const entry = params.entryCost * (1 - params.borrowPercent / 100);
  if (!localDebit(params.coinType, entry)) return { battleId: null, error: "Insufficient balance." };
  const id = uid();
  const parts = params.playerMode.split("v").map((s) => parseInt(s, 10)).filter((n) => !isNaN(n));
  const maxPlayers = parts.length > 0 ? parts.reduce((a, b) => a + b, 0) : 2;
  const battle: LocalBattle = {
    id, creatorId: "guest", gamemode: params.gamemode, crazy: params.crazy,
    playerMode: params.playerMode, maxPlayers,
    caseIds: params.caseIds, rounds: params.caseIds.length, entryCost: params.entryCost,
    coinType: params.coinType, borrowPercent: params.borrowPercent, potTotal: entry,
    status: "waiting", seedHash: uid().slice(0, 16), eosBlockTarget: null, eosBlockId: null,
    battleSeed: null, createdAt: new Date().toISOString(), startedAt: null, completedAt: null,
    players: [{ slot: 0, userId: "guest", isBot: false, username: "You", avatarSeed: "you" }],
    drops: [], winnerSlot: null, claimed: new Set(),
  };
  battles.set(id, battle);
  return { battleId: id, error: null };
}

export function localAddBot(battleId: string): { error: string | null } {
  const b = battles.get(battleId);
  if (!b) return { error: "Battle not found." };
  if (b.players.length >= b.maxPlayers) return { error: "Battle is full." };
  const slot = b.players.length;
  const name = BOT_NAMES[slot % BOT_NAMES.length] ?? `Bot${slot}`;
  b.players.push({ slot, userId: null, isBot: true, username: name, avatarSeed: name });
  return { error: null };
}

export function localLeaveBattle(battleId: string): { error: string | null } {
  const b = battles.get(battleId);
  if (!b) return { error: "Battle not found." };
  if (b.status !== "waiting") return { error: "Cannot leave — battle already started." };
  const entry = b.entryCost * (1 - b.borrowPercent / 100);
  localCredit(b.coinType, entry);
  battles.delete(battleId);
  return { error: null };
}

export function localStartBattle(battleId: string): { data: { seedHash: string; eosBlockTarget: number } | null; error: string | null } {
  const b = battles.get(battleId);
  if (!b) return { data: null, error: "Battle not found." };
  if (b.players.length < 2) return { data: null, error: "Need at least 2 players." };
  b.status = "committing";
  b.eosBlockTarget = 0;
  b.battleSeed = uid();
  return { data: { seedHash: b.seedHash, eosBlockTarget: 0 }, error: null };
}

export function localCheckEos(battleId: string): { data: { ready: boolean; status?: string } | null; error: string | null } {
  const b = battles.get(battleId);
  if (!b) return { data: null, error: "Battle not found." };
  if (b.status === "committing") {
    resolveBattle(b);
  }
  return { data: { ready: true, status: b.status }, error: null };
}

function resolveBattle(b: LocalBattle) {
  b.status = "running";
  b.startedAt = new Date().toISOString();
  b.eosBlockId = uid().slice(0, 32);
  for (let round = 0; round < b.rounds; round++) {
    const caseId = b.caseIds[round] ?? b.caseIds[0]!;
    const c = getCase(caseId);
    if (!c) continue;
    for (const p of b.players) {
      const item = dropItem(c);
      b.drops.push({
        slot: p.slot, round, caseId, itemId: uid(),
        itemName: item.name, itemValue: item.value, itemRarity: item.rarity,
      });
    }
  }
  let bestSlot = 0, bestTotal = -1;
  for (const p of b.players) {
    const total = b.drops.filter((d) => d.slot === p.slot).reduce((s, d) => s + d.itemValue, 0);
    if (total > bestTotal) { bestTotal = total; bestSlot = p.slot; }
  }
  b.winnerSlot = bestSlot;
  b.status = "completed";
  b.completedAt = new Date().toISOString();
}

export function localClaimPayout(battleId: string, slot: number): { data: { balance: number } | null; error: string | null } {
  const b = battles.get(battleId);
  if (!b) return { data: null, error: "Battle not found." };
  if (b.status !== "completed") return { data: null, error: "Battle not completed." };
  if (b.winnerSlot !== slot) return { data: null, error: "You didn't win this battle." };
  if (b.claimed.has(slot)) return { data: null, error: "Already claimed." };
  b.claimed.add(slot);
  const totalValue = b.drops.filter((d) => d.slot === slot).reduce((s, d) => s + d.itemValue, 0)
    + b.drops.filter((d) => d.slot !== slot).reduce((s, d) => s + d.itemValue, 0);
  const keepMult = (100 - b.borrowPercent) / 100;
  const payout = Math.round(totalValue * keepMult * 100) / 100;
  localCredit(b.coinType, payout);
  return { data: { balance: localBalance(b.coinType) }, error: null };
}

export { CASE_BATTLES_RTP };
