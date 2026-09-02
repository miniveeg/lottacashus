/**
 * Local Case Battles — in-memory battle state machine with 94.5% RTP.
 * Used as a fallback when the Supabase backend is unavailable.
 */

import { GENERATED_CASE_CATALOG } from "./games/case-battles/caseCatalog.generated";
import type { LootCase, CaseItem } from "./games/case-battles/caseTypes";
import { CASE_BATTLES_RTP, biasCaseRollFloat } from "./games/rtp";
import { isTeamMode, teamIndexForMode } from "./games/case-battles/config";

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
  /** All slots that share the payout (tie-aware). */
  winningSlots: number[];
  /** Per-slot gross share (before borrow multiplier). */
  payoutBySlot: Map<number, number>;
  claimed: Set<number>;
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
    drops: [], winningSlots: [], payoutBySlot: new Map(), claimed: new Set(),
  };
  battles.set(id, battle);
  return { battleId: id, error: null };
}

export function localAddBot(battleId: string, slotIndex?: number): { error: string | null } {
  const b = battles.get(battleId);
  if (!b) return { error: "Battle not found." };
  if (b.status !== "waiting") return { error: "Battle already started." };
  if (b.players.length >= b.maxPlayers) return { error: "Battle is full." };
  let slot = -1;
  if (slotIndex != null && slotIndex >= 0 && slotIndex < b.maxPlayers) {
    if (!b.players.some((p) => p.slot === slotIndex)) slot = slotIndex;
  }
  if (slot < 0) {
    for (let i = 0; i < b.maxPlayers; i++) {
      if (!b.players.some((p) => p.slot === i)) { slot = i; break; }
    }
  }
  if (slot < 0) return { error: "No empty slots." };
  const name = BOT_NAMES[slot % BOT_NAMES.length] ?? `Bot${slot}`;
  b.players.push({ slot, userId: null, isBot: true, username: name, avatarSeed: name });
  // Bots contribute full entry_cost to pot (house-sponsored seats) — matches SQL
  // trigger in 006_case_battles_per_slot_bot.sql.
  b.potTotal = Math.round((b.potTotal + b.entryCost) * 100) / 100;
  b.players.sort((a, c) => a.slot - c.slot);
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
        slot: p.slot, round, caseId, itemId: item.id,
        itemName: item.name, itemValue: item.value, itemRarity: item.rarity,
      });
    }
  }
  // ── Gamemode-aware winner — mirrors edge `computePayouts` ────────────────
  const slotTotals = new Map<number, number>();
  const lastRound = b.rounds - 1;
  const lastRoundTotals = new Map<number, number>();
  for (const p of b.players) {
    const drops = b.drops.filter((d) => d.slot === p.slot);
    slotTotals.set(p.slot, drops.reduce((s, d) => s + d.itemValue, 0));
    const last = drops.find((d) => d.round === lastRound);
    lastRoundTotals.set(p.slot, last?.itemValue ?? 0);
  }
  const scoreOf = (slot: number): number =>
    b.gamemode === "terminal"
      ? (lastRoundTotals.get(slot) ?? 0)
      : (slotTotals.get(slot) ?? 0);
  const pickMax = !b.crazy;
  const better = (a: number, ref: number) => (pickMax ? a > ref : a < ref);
  b.winningSlots = [];
  b.payoutBySlot = new Map();

  if (b.gamemode === "group") {
    // Group: share pot equally among every human; bots are NOT credited.
    const humans = b.players
      .filter((p) => !p.isBot)
      .sort((a, c) => a.slot - c.slot);
    const pot = Math.round(b.potTotal * 100) / 100;
    const each = Math.round((pot / Math.max(1, humans.length)) * 100) / 100;
    let remaining = pot;
    for (let i = 0; i < humans.length; i++) {
      const share =
        i === humans.length - 1
          ? Math.round(remaining * 100) / 100
          : each;
      remaining = Math.round((remaining - share) * 100) / 100;
      b.payoutBySlot.set(humans[i]!.slot, share);
    }
    b.winningSlots = humans.map((p) => p.slot);
  } else if (isTeamMode(b.playerMode)) {
    // Team: aggregate by team index. Tied eligible teams split pot evenly;
    // team members divide their team's slice. Bot-only tied teams forfeit
    // their share (house keeps it).
    const teamTotals = new Map<number, number>();
    for (const p of b.players) {
      const t = teamIndexForMode(b.playerMode, p.slot);
      teamTotals.set(t, (teamTotals.get(t) ?? 0) + scoreOf(p.slot));
    }
    const teamScores = Array.from(teamTotals.values());
    let bestTeamScore = teamScores[0]!;
    for (const s of teamScores) {
      if (better(s, bestTeamScore)) bestTeamScore = s;
    }
    const tiedTeams = Array.from(teamTotals.entries())
      .filter(([, s]) => s === bestTeamScore)
      .map(([t]) => t)
      .sort((a, c) => a - c);
    const hasHuman = (team: number) =>
      b.players.some(
        (p) => teamIndexForMode(b.playerMode, p.slot) === team && !p.isBot,
      );
    const eligibleTeamOrder = tiedTeams.filter(hasHuman);
    if (eligibleTeamOrder.length === 0) {
      b.winningSlots = [];
      b.payoutBySlot = new Map();
    } else {
      const pot = Math.round(b.potTotal * 100) / 100;
      const teamShare = Math.round((pot / eligibleTeamOrder.length) * 100) / 100;
      let teamRemaining = pot;
      for (let i = 0; i < eligibleTeamOrder.length; i++) {
        const team = eligibleTeamOrder[i]!;
        const amt =
          i === eligibleTeamOrder.length - 1
            ? Math.round(teamRemaining * 100) / 100
            : teamShare;
        teamRemaining = Math.round((teamRemaining - amt) * 100) / 100;
        const humans = b.players
          .filter(
            (p) => teamIndexForMode(b.playerMode, p.slot) === team && !p.isBot,
          )
          .sort((a, c) => a.slot - c.slot);
        const eachMember = Math.round((amt / humans.length) * 100) / 100;
        let memRemaining = amt;
        for (let j = 0; j < humans.length; j++) {
          const share =
            j === humans.length - 1
              ? Math.round(memRemaining * 100) / 100
              : eachMember;
          memRemaining = Math.round((memRemaining - share) * 100) / 100;
          b.payoutBySlot.set(humans[j]!.slot, share);
          b.winningSlots.push(humans[j]!.slot);
        }
      }
    }
  } else {
    // Solo: tied slots for the best score split the pot among ELIGIBLE
    // (human) tied slots. Bots involved in a tie forfeit their share —
    // the next iteration's "last slot" absorbs the rounding remainder.
    const pot = Math.round(b.potTotal * 100) / 100;
    const scores = b.players.map((p) => scoreOf(p.slot));
    let bestScore = scores[0] ?? 0;
    for (const s of scores) {
      if (better(s, bestScore)) bestScore = s;
    }
    const tiedSlotsAll = b.players
      .filter((_, i) => scores[i] === bestScore)
      .map((p) => p.slot)
      .sort((a, c) => a - c);
    const eligibleSlots = tiedSlotsAll.filter((slot) => {
      const p = b.players.find((q) => q.slot === slot);
      return Boolean(p && !p.isBot);
    });
    if (eligibleSlots.length === 0) {
      b.winningSlots = [];
      b.payoutBySlot = new Map();
    } else {
      const share = Math.round((pot / eligibleSlots.length) * 100) / 100;
      let remaining = pot;
      let credited = 0;
      for (const slot of tiedSlotsAll) {
        const p = b.players.find((q) => q.slot === slot);
        if (!p || p.isBot) continue;
        const isLast = credited === eligibleSlots.length - 1;
        const amt = isLast ? Math.round(remaining * 100) / 100 : share;
        remaining = Math.round((remaining - amt) * 100) / 100;
        b.payoutBySlot.set(slot, amt);
        credited++;
      }
      b.winningSlots = eligibleSlots;
    }
  }

  b.status = "completed";
  b.completedAt = new Date().toISOString();
}

export function localClaimPayout(battleId: string, slot: number): { data: { balance: number } | null; error: string | null } {
  const b = battles.get(battleId);
  if (!b) return { data: null, error: "Battle not found." };
  if (b.status !== "completed") return { data: null, error: "Battle not completed." };
  if (b.claimed.has(slot)) return { data: null, error: "Already claimed." };
  const player = b.players.find((p) => p.slot === slot);
  if (!player || player.isBot) return { data: null, error: "You didn't win this battle." };

  const clamped = Math.max(0, Math.min(80, b.borrowPercent));
  const keepMult = (100 - clamped) / 100;
  const grossShare = b.payoutBySlot.get(slot) ?? 0;
  const payout = Math.round(grossShare * keepMult * 100) / 100;

  if (payout <= 0) return { data: null, error: "No payout available for this slot." };
  if (!b.winningSlots.includes(slot)) {
    return { data: null, error: "You didn't win this battle." };
  }
  b.claimed.add(slot);
  localCredit(b.coinType, payout);
  return { data: { balance: localBalance(b.coinType) }, error: null };
}

export { CASE_BATTLES_RTP };
