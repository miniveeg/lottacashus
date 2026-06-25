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

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Convert a local in-memory battle to the CaseBattleView shape. */
function localToView(b: LocalBattle): CaseBattleView {
  return {
    battleId: b.id,
    creatorId: b.creatorId,
    gamemode: b.gamemode as BattleGamemode,
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
    players: b.players.map((p) => ({
      slot: p.slot, userId: p.userId, isBot: p.isBot,
      username: p.username, avatarSeed: p.avatarSeed,
    })),
    drops: b.drops.map((d) => ({
      slot: d.slot, round: d.round, caseId: d.caseId, itemId: d.itemId,
      itemName: d.itemName, itemValue: d.itemValue, itemRarity: d.itemRarity,
    })),
  };
}

function parseBattle(row: Record<string, unknown>): CaseBattleView {
  return {
    battleId: String(row.id),
    creatorId: String(row.creator_id ?? ""),
    gamemode: String(row.gamemode) as BattleGamemode,
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
  };
}

function parsePlayer(row: Record<string, unknown>): BattlePlayer {
  return {
    slot: Number(row.slot),
    userId: (row.user_id as string) ?? null,
    isBot: Boolean(row.is_bot),
    username: String(row.username ?? "Player"),
    avatarSeed: (row.avatar_seed as string) ?? null,
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

// ─── Public API ──────────────────────────────────────────────────────────────

export async function listOpenBattles(): Promise<{
  data: CaseBattleView[] | null;
  error: string | null;
}> {
  if (!isSupabaseConfigured) return { data: localListOpenBattles().map(localToView), error: null };
  const { data, error } = await supabase
    .from("case_battles")
    .select("*")
    .in("status", ["waiting", "committing", "running"])
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    // Fallback to local battles on error.
    return { data: localListOpenBattles().map(localToView), error: null };
  }
  const battles = (data ?? []).map(parseBattle);
  return { data: battles, error: null };
}

export async function viewCaseBattle(battleId: string): Promise<{
  data: CaseBattleView | null;
  error: string | null;
}> {
  // Check local battles first (covers the local-play case).
  const local = localViewCaseBattle(battleId);
  if (local) return { data: localToView(local), error: null };
  if (!isSupabaseConfigured) return { data: null, error: "Battle not found." };

  const [{ data: battleRow, error: battleErr }, { data: playerRows }, { data: dropRows }] =
    await Promise.all([
      supabase.from("case_battles").select("*").eq("id", battleId).maybeSingle(),
      supabase.from("case_battle_players").select("*").eq("battle_id", battleId).order("slot"),
      supabase.from("case_battle_drops").select("*").eq("battle_id", battleId).order("round, slot"),
    ]);

  if (battleErr) return { data: null, error: battleErr.message };
  if (!battleRow) return { data: null, error: "Battle not found." };

  const battle = parseBattle(battleRow as Record<string, unknown>);
  battle.players = (playerRows ?? []).map((p) => {
    const parsed = parsePlayer(p as Record<string, unknown>);
    return parsed;
  });
  battle.drops = (dropRows ?? []).map((d) => parseDrop(d as Record<string, unknown>));
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
    const local = localCreateBattle(params);
    return { data: local.battleId, error: local.error };
  }
  const battleId = Array.isArray(data) ? data[0] : data;
  return { data: battleId ? String(battleId) : null, error: null };
}

export async function joinCaseBattle(battleId: string): Promise<{ error: string | null }> {
  // Local battles: creator is already slot 0, so "join" is a no-op.
  const local = localViewCaseBattle(battleId);
  if (local) return { error: null };
  if (!isSupabaseConfigured) return { error: null };
  const { error } = await supabase.rpc("cb_join_battle", { p_battle_id: battleId });
  return { error: error?.message ?? null };
}

export async function addBotToBattle(battleId: string): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured) return localAddBot(battleId);
  const { error } = await supabase.rpc("cb_add_bot", { p_battle_id: battleId });
  if (error) return localAddBot(battleId);
  return { error: null };
}

export async function leaveBattle(battleId: string): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured) return localLeaveBattle(battleId);
  const { error } = await supabase.rpc("cb_leave_battle", { p_battle_id: battleId });
  if (error) return localLeaveBattle(battleId);
  return { error: null };
}

export async function startCaseBattle(battleId: string): Promise<{
  data: { seedHash: string; eosBlockTarget: number } | null;
  error: string | null;
}> {
  // Check local first.
  const local = localStartBattle(battleId);
  if (local.data) return local;
  const { data, error } = await invokeEdgeFunction<{
    seedHash: string;
    eosBlockTarget: number;
  }>("case-battle-v2", { action: "start", battleId });
  if (error) return local;
  return { data, error: null };
}

export async function checkEosBlock(battleId: string): Promise<{
  data: { ready: boolean; status?: string } | null;
  error: string | null;
}> {
  // Check local first.
  const local = localCheckEos(battleId);
  if (local.data) return local;
  const { data, error } = await invokeEdgeFunction<{ ready: boolean; status?: string }>(
    "case-battle-v2",
    { action: "check_eos", battleId },
  );
  if (error) return local;
  return { data, error: null };
}

export async function claimPayout(
  battleId: string,
  slot: number,
  _amount: number,
): Promise<{ data: { balance: number } | null; error: string | null }> {
  // Check local first.
  const local = localClaimPayout(battleId, slot);
  if (local.data) return local;
  const { data, error } = await invokeEdgeFunction<{ balance: number }>("case-battle-v2", {
    action: "claim",
    battleId,
    slot,
    amount: _amount,
  });
  if (error) return local;
  return { data, error: null };
}

// ─── Derived helpers ─────────────────────────────────────────────────────────

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

export function calculateWinner(
  battle: CaseBattleView,
): { slot: number; amount: number } | null {
  if (battle.status !== "completed" || battle.players.length === 0) return null;

  const totals = battle.players.map((p) => ({
    slot: p.slot,
    total: playerTotalValue(battle.drops, p.slot),
    isBot: p.isBot,
  }));

  if (totals.length === 0) return null;

  let winnerSlot: number;
  switch (battle.gamemode) {
    case "standard":
      // Highest total wins (normal) or lowest total wins (crazy)
      winnerSlot = totals.reduce((best, t) => {
        const better = battle.crazy ? t.total < best.total : t.total > best.total;
        const tie = t.total === best.total && t.slot < best.slot;
        return better || tie ? t : best;
      }).slot;
      break;
    case "terminal": {
      // Highest (or lowest if crazy) value in the LAST round only
      const lastRound = battle.rounds - 1;
      const lastDrops = battle.drops.filter((d) => d.round === lastRound);
      if (lastDrops.length === 0) return null;
      winnerSlot = lastDrops.reduce((best, d) => {
        const better = battle.crazy ? d.itemValue < best.itemValue : d.itemValue > best.itemValue;
        const tie = d.itemValue === best.itemValue && d.slot < best.slot;
        return better || tie ? d : best;
      }).slot;
      break;
    }
    case "group": {
      // Split among all humans (crazy N/A)
      const humans = totals.filter((t) => !t.isBot);
      if (humans.length === 0) return null;
      const share = battle.potTotal / humans.length;
      return { slot: humans[0]!.slot, amount: share };
    }
    case "jackpot": {
      // For client display: the edge function determines the winner
      // via weighted random. We can't recompute that client-side without
      // the battle seed, so we use the stored drops to find the winner
      // by checking which slot has a non-zero payout (edge function sets this).
      // Fallback: highest (or lowest if crazy) total
      winnerSlot = totals.reduce((best, t) => {
        const better = battle.crazy ? t.total < best.total : t.total > best.total;
        const tie = t.total === best.total && t.slot < best.slot;
        return better || tie ? t : best;
      }).slot;
      break;
    }
    default:
      winnerSlot = totals.reduce((max, t) => (t.total > max.total ? t : max)).slot;
      break;
  }

  const keepMult = (100 - battle.borrowPercent) / 100;
  const amount = battle.potTotal * keepMult;
  return { slot: winnerSlot, amount };
}

export function calculatePayoutForSlot(
  battle: CaseBattleView,
  slot: number,
): number {
  if (battle.status !== "completed") return 0;
  const winner = calculateWinner(battle);
  if (!winner) return 0;

  if (battle.gamemode === "group") {
    const player = battle.players.find((p) => p.slot === slot);
    if (player?.isBot) return 0;
    const humans = battle.players.filter((p) => !p.isBot);
    const keepMult = (100 - battle.borrowPercent) / 100;
    return (battle.potTotal * keepMult) / humans.length;
  }

  return winner.slot === slot ? winner.amount : 0;
}
