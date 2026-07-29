/**
 * Case Battles v2 — client-side API.
 * All functions call Supabase RPCs or the case-battle-v2 edge function.
 * Realtime is handled by the hooks in useBattleSubscription.ts.
 */

import { supabase, isSupabaseConfigured } from "../../lib/supabase";
import { invokeEdgeFunction } from "../../lib/edgeFunctions";
import type { CaseBattleView, BattlePlayer, BattleDrop, BattleGamemode } from "./types";
import {
  localListOpenBattles, localViewCaseBattle, localCreateBattle, localAddBot,
  localLeaveBattle, localStartBattle, localCheckEos, localClaimPayout,
  type LocalBattle,
} from "../../lib/local-case-battles";

function normalizeGamemode(raw: unknown): BattleGamemode {
  const s = String(raw ?? "standard");
  if (s === "normal") return "standard";
  return s as BattleGamemode;
}

function localToView(b: LocalBattle): CaseBattleView {
  const clamped = Math.max(0, Math.min(80, b.borrowPercent));
  const keepMult = (100 - clamped) / 100;
  return {
    battleId: b.id,
    creatorId: b.creatorId,
    gamemode: normalizeGamemode(b.gamemode),
    crazy: b.crazy,
    playerMode: b.playerMode,
    maxPlayers: b.maxPlayers,
    caseIds: b.caseIds,
    rounds: b.rounds,
    entryCost: b.entryCost,
    coinType: b.coinType,
    borrowPercent: b.borrowPercent,
    potTotal: b.potTotal,
    status: b.status as CaseBattleView["status"],
    seedHash: b.seedHash,
    eosBlockTarget: b.eosBlockTarget,
    eosBlockId: b.eosBlockId,
    battleSeed: b.battleSeed,
    createdAt: b.createdAt,
    startedAt: b.startedAt,
    completedAt: b.completedAt,
    winningSlots: [...b.winningSlots].sort((a, c) => a - c),
    players: b.players.map((p) => {
      const gross = b.payoutBySlot.get(p.slot) ?? 0;
      const payoutAmount =
        b.winningSlots.includes(p.slot) && !p.isBot
          ? Math.round(gross * keepMult * 100) / 100
          : 0;
      return {
        slot: p.slot,
        userId: p.userId,
        isBot: p.isBot,
        username: p.username,
        avatarSeed: p.avatarSeed,
        payoutAmount,
        claimedAt: b.claimed.has(p.slot) ? new Date().toISOString() : null,
      };
    }),
    drops: b.drops.map((d) => ({
      slot: d.slot, round: d.round, caseId: d.caseId, itemId: d.itemId,
      itemName: d.itemName, itemValue: d.itemValue, itemRarity: d.itemRarity,
    })),
    playerCount: b.players.length,
  };
}

function parseBattle(row: Record<string, unknown>): CaseBattleView {
  return {
    battleId: String(row.id),
    creatorId: String(row.creator_id ?? ""),
    gamemode: normalizeGamemode(row.gamemode),
    crazy: Boolean(row.crazy),
    playerMode: String(row.player_mode),
    maxPlayers: Number(row.max_players),
    caseIds: (row.case_ids as string[]) ?? [],
    rounds: Number(row.rounds),
    entryCost: Number(row.entry_cost),
    coinType: (row.coin_type as "balance" | "sweeps_coins") ?? "balance",
    borrowPercent: Number(row.borrow_percent ?? 0),
    potTotal: Number(row.pot_total ?? 0),
    status: String(row.status) as CaseBattleView["status"],
    seedHash: (row.seed_hash as string) ?? null,
    eosBlockTarget: (row.eos_block_target as number) ?? null,
    eosBlockId: (row.eos_block_id as string) ?? null,
    battleSeed: (row.battle_seed as string) ?? null,
    createdAt: String(row.created_at),
    startedAt: (row.started_at as string) ?? null,
    completedAt: (row.completed_at as string) ?? null,
    players: [],
    drops: [],
    playerCount: 0,
  };
}

function parsePlayer(row: Record<string, unknown>): BattlePlayer {
  return {
    slot: Number(row.slot),
    userId: (row.user_id as string) ?? null,
    isBot: Boolean(row.is_bot),
    username: String(row.username ?? "Player"),
    avatarSeed: (row.avatar_seed as string) ?? null,
    payoutAmount: Number(row.payout_amount ?? row.payoutAmount ?? 0),
    claimedAt: (row.claimed_at as string) ?? (row.claimedAt as string) ?? null,
  };
}

function parseDrop(row: Record<string, unknown>): BattleDrop {
  return {
    slot: Number(row.slot),
    round: Number(row.round),
    caseId: String(row.case_id),
    itemId: String(row.item_id),
    itemName: String(row.item_name),
    itemValue: Number(row.item_value),
    itemRarity: String(row.item_rarity),
  };
}

const LOBBY_BATTLE_COLUMNS =
  "id, creator_id, gamemode, crazy, player_mode, max_players, case_ids, " +
  "rounds, entry_cost, coin_type, borrow_percent, pot_total, status, " +
  "seed_hash, created_at, started_at, completed_at";

const ROOM_BATTLE_COLUMNS =
  "id, creator_id, gamemode, crazy, player_mode, max_players, case_ids, " +
  "rounds, entry_cost, coin_type, borrow_percent, pot_total, status, " +
  "seed_hash, eos_block_target, eos_block_id, battle_seed, created_at, " +
  "started_at, completed_at";

const PLAYER_COLUMNS = "slot, user_id, is_bot, username, avatar_seed, payout_amount, claimed_at";
const DROP_COLUMNS =
  "slot, round, case_id, item_id, item_name, item_value, item_rarity";

const DROPS_LIMIT = 3600;

export type PlayerCountMap = Map<string, number>;

async function supabasePlayerCounts(battleIds: string[]): Promise<PlayerCountMap> {
  const map: PlayerCountMap = new Map();
  if (battleIds.length === 0) return map;
  const { data, error } = await supabase
    .from("case_battle_players")
    .select("battle_id")
    .in("battle_id", battleIds);
  if (error || !data) return map;
  for (const row of data as unknown as Record<string, unknown>[]) {
    const id = String(row.battle_id ?? "");
    if (!id) continue;
    map.set(id, (map.get(id) ?? 0) + 1);
  }
  return map;
}

export async function listOpenBattles(options?: {
  coinType?: "balance" | "sweeps_coins";
}): Promise<{ data: CaseBattleView[] | null; error: string | null }> {
  if (!isSupabaseConfigured) {
    const all = localListOpenBattles().map(localToView);
    const filtered = options?.coinType
      ? all.filter((b) => b.coinType === options.coinType)
      : all;
    return { data: filtered, error: null };
  }

  let query = supabase
    .from("case_battles_safe")
    .select(LOBBY_BATTLE_COLUMNS)
    .in("status", ["waiting", "committing", "running"])
    .order("created_at", { ascending: false })
    .limit(50);
  if (options?.coinType) {
    query = query.eq("coin_type", options.coinType);
  }
  const { data, error } = await query;
  if (error) {
    return { data: null, error: error.message };
  }
  const battles = ((data ?? []) as unknown as Record<string, unknown>[]).map(parseBattle);

  const counts = await supabasePlayerCounts(battles.map((b) => b.battleId));
  for (const b of battles) {
    b.playerCount = counts.get(b.battleId) ?? 0;
  }
  return { data: battles, error: null };
}

export async function viewCaseBattle(battleId: string): Promise<{
  data: CaseBattleView | null;
  error: string | null;
}> {
  const local = localViewCaseBattle(battleId);
  if (local) return { data: localToView(local), error: null };
  if (!isSupabaseConfigured) return { data: null, error: "Battle not found." };

  const [{ data: battleRow, error: battleErr }, { data: playerRows }, { data: dropRows }] =
    await Promise.all([
      supabase
        .from("case_battles_safe")
        .select(ROOM_BATTLE_COLUMNS)
        .eq("id", battleId)
        .maybeSingle(),
      supabase
        .from("case_battle_players")
        .select(PLAYER_COLUMNS)
        .eq("battle_id", battleId)
        .order("slot"),
      supabase
        .from("case_battle_drops")
        .select(DROP_COLUMNS)
        .eq("battle_id", battleId)
        .order("round, slot")
        .limit(DROPS_LIMIT),
    ]);

  if (battleErr) return { data: null, error: battleErr.message };
  if (!battleRow) return { data: null, error: "Battle not found." };

  const battle = parseBattle(battleRow as unknown as Record<string, unknown>);
  battle.players = (playerRows ?? []).map((p) =>
    parsePlayer(p as unknown as Record<string, unknown>)
  );
  battle.drops = (dropRows ?? []).map((d) =>
    parseDrop(d as unknown as Record<string, unknown>)
  );
  battle.playerCount = battle.players.length;
  if (battle.status === "completed") {
    battle.winningSlots = battle.players
      .filter((p) => p.payoutAmount > 0 && !p.isBot)
      .map((p) => p.slot)
      .sort((a, c) => a - c);
  }
  return { data: battle, error: null };
}

export async function createCaseBattle(params: {
  gamemode: BattleGamemode;
  crazy: boolean;
  playerMode: string;
  caseIds: string[];
  entryCost: number;
  coinType: "balance" | "sweeps_coins";
  borrowPercent: number;
}): Promise<{ data: string | null; error: string | null }> {
  if (!isSupabaseConfigured) {
    const local = localCreateBattle(params);
    return { data: local.battleId, error: local.error };
  }
  const { data, error } = await supabase.rpc("cb_create_battle", {
    p_gamemode: params.gamemode,
    p_crazy: params.crazy,
    p_player_mode: params.playerMode,
    p_case_ids: params.caseIds,
    p_entry_cost: params.entryCost,
    p_coin_type: params.coinType,
    p_borrow_percent: params.borrowPercent,
  });
  if (error) {
    return { data: null, error: error.message };
  }
  const battleId = Array.isArray(data) ? data[0] : data;
  return { data: battleId ? String(battleId) : null, error: null };
}

export async function joinCaseBattle(battleId: string): Promise<{ error: string | null }> {
  const local = localViewCaseBattle(battleId);
  if (local) return { error: null };
  if (!isSupabaseConfigured) return { error: null };
  const { error } = await supabase.rpc("cb_join_battle", { p_battle_id: battleId });
  return { error: error?.message ?? null };
}

export async function addBotToBattle(
  battleId: string,
  slotIndex?: number,
): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured) return localAddBot(battleId, slotIndex);
  if (localViewCaseBattle(battleId)) return localAddBot(battleId, slotIndex);
  const { error } = await supabase.rpc("cb_add_bot", {
    p_battle_id: battleId,
    p_slot_index: slotIndex ?? null,
  });
  return { error: error?.message ?? null };
}

export async function leaveBattle(battleId: string): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured) return localLeaveBattle(battleId);
  if (localViewCaseBattle(battleId)) return localLeaveBattle(battleId);
  const { error } = await supabase.rpc("cb_leave_battle", { p_battle_id: battleId });
  return { error: error?.message ?? null };
}

export async function startCaseBattle(battleId: string): Promise<{
  data: { seedHash: string; eosBlockTarget: number } | null;
  error: string | null;
}> {
  if (localViewCaseBattle(battleId)) return localStartBattle(battleId);
  if (!isSupabaseConfigured) return { data: null, error: "Supabase is not configured." };
  const { data, error } = await invokeEdgeFunction<{
    seedHash: string;
    eosBlockTarget: number;
  }>("case-battle-v2", { action: "start", battleId });
  return { data, error };
}

export async function checkEosBlock(battleId: string): Promise<{
  data: { ready: boolean; status?: string } | null;
  error: string | null;
}> {
  if (localViewCaseBattle(battleId)) return localCheckEos(battleId);
  if (!isSupabaseConfigured) return { data: null, error: "Supabase is not configured." };
  const { data, error } = await invokeEdgeFunction<{ ready: boolean; status?: string }>(
    "case-battle-v2",
    { action: "check_eos", battleId },
  );
  return { data, error };
}

export async function claimPayout(
  battleId: string,
  slot: number,
): Promise<{ data: { balance: number } | null; error: string | null }> {
  if (localViewCaseBattle(battleId)) return localClaimPayout(battleId, slot);
  if (!isSupabaseConfigured) return { data: null, error: "Supabase is not configured." };
  const { data, error } = await invokeEdgeFunction<{ balance: number }>("case-battle-v2", {
    action: "claim",
    battleId,
    slot,
  });
  return { data, error };
}

export function playerTotalValue(drops: BattleDrop[], slot: number): number {
  return drops.filter((d) => d.slot === slot).reduce((sum, d) => sum + d.itemValue, 0);
}

export function dropsForRound(drops: BattleDrop[], round: number): BattleDrop[] {
  return drops.filter((d) => d.round === round).sort((a, b) => a.slot - b.slot);
}

export function isPlayerSlot(battle: CaseBattleView, slot: number, userId?: string): boolean {
  const player = battle.players.find((p) => p.slot === slot);
  return player?.userId === userId;
}

export function calculatePayoutForSlot(
  battle: CaseBattleView,
  slot: number,
): number {
  if (battle.status !== "completed") return 0;

  const player = battle.players.find((p) => p.slot === slot);
  if (player && player.payoutAmount > 0) {
    return player.payoutAmount;
  }

  const keepMult = (100 - Math.max(0, Math.min(80, battle.borrowPercent))) / 100;
  const pot = Math.round(battle.potTotal * keepMult * 100) / 100;

  if (battle.gamemode === "group") {
    if (player?.isBot) return 0;
    const humans = battle.players.filter((p) => !p.isBot);
    if (humans.length === 0) return 0;
    return Math.round((pot / Math.max(1, humans.length)) * 100) / 100;
  }

  const isTeam = battle.playerMode === "2v2" || battle.playerMode === "2v2v2" || battle.playerMode === "3v3";
  const scoreOf = (s: number) =>
    battle.gamemode === "terminal"
      ? (battle.drops.find((d) => d.slot === s && d.round === battle.rounds - 1)?.itemValue ?? 0)
      : playerTotalValue(battle.drops, s);
  const better = (a: number, b: number) => (battle.crazy ? a < b : a > b);

  if (isTeam) {
    const teamTotalsBySlot = (s: number): number => {
      const teamOfSlot =
        battle.playerMode === "2v2" ? (s < 2 ? 0 : 1)
          : battle.playerMode === "2v2v2" ? Math.floor(s / 2)
          : (s < 3 ? 0 : 1);
      let total = 0;
      for (const p of battle.players) {
        const t =
          battle.playerMode === "2v2" ? (p.slot < 2 ? 0 : 1)
            : battle.playerMode === "2v2v2" ? Math.floor(p.slot / 2)
            : (p.slot < 3 ? 0 : 1);
        if (t === teamOfSlot) total += scoreOf(p.slot);
      }
      return total;
    };
    const teamOfThisSlot =
      battle.playerMode === "2v2" ? (slot < 2 ? 0 : 1)
        : battle.playerMode === "2v2v2" ? Math.floor(slot / 2)
        : (slot < 3 ? 0 : 1);
    const winningTeams = new Set<number>();
    let bestTeamScore = teamTotalsBySlot(0);
    for (let t = 0; t < battle.maxPlayers; t++) {
      const s = teamTotalsBySlot(t);
      if (better(s, bestTeamScore)) bestTeamScore = s;
    }
    for (let t = 0; t < battle.maxPlayers; t++) {
      if (teamTotalsBySlot(t) === bestTeamScore) winningTeams.add(t);
    }
    if (!winningTeams.has(teamOfThisSlot)) return 0;
    const teamSlice = Math.round((pot / winningTeams.size) * 100) / 100;
    const humansOnTeam = battle.players.filter((p) => {
      const t =
        battle.playerMode === "2v2" ? (p.slot < 2 ? 0 : 1)
          : battle.playerMode === "2v2v2" ? Math.floor(p.slot / 2)
          : (p.slot < 3 ? 0 : 1);
      return t === teamOfThisSlot && !p.isBot;
    });
    if (humansOnTeam.length === 0) return 0;
    return Math.round((teamSlice / humansOnTeam.length) * 100) / 100;
  }

  const scores = battle.players.map((p) => scoreOf(p.slot));
  let bestScore = scores[0] ?? 0;
  for (const s of scores) {
    if (better(s, bestScore)) bestScore = s;
  }
  const tiedSlots = battle.players
    .filter((_, i) => scores[i] === bestScore)
    .map((p) => p.slot)
    .sort((a, c) => a - c);
  if (!tiedSlots.includes(slot)) return 0;
  const share = Math.round((pot / tiedSlots.length) * 100) / 100;
  const lastIdx = tiedSlots.length - 1;
  if (slot === tiedSlots[lastIdx]) {
    return Math.round(pot - share * lastIdx * 100) / 100;
  }
  return share;
}

/** @deprecated Prefer calculatePayoutForSlot */
export function calculateWinner(
  battle: CaseBattleView,
): { slot: number; amount: number } | null {
  if (battle.status !== "completed" || battle.players.length === 0) return null;
  const paid = battle.players
    .map((p) => ({ slot: p.slot, amount: calculatePayoutForSlot(battle, p.slot) }))
    .filter((p) => p.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  if (paid.length === 0) return null;
  return paid[0]!;
}
