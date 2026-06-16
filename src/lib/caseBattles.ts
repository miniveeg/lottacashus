import { invokeEdgeFunction } from "./edgeFunctions";
import { supabase, isSupabaseConfigured } from "./supabase";
import { CASE_CATALOG, type LootCase } from "./games/case-battles";

export type CaseBattleDrop = {
  round: number;
  caseId?: string;
  itemId: string;
  name: string;
  value: number;
  rarity: string;
};

export type CaseBattlePlayer = {
  slot: number;
  userId: string | null;
  isBot: boolean;
  displayName: string;
  totalValue: number;
  drops: CaseBattleDrop[];
  borrowPercent?: number;
  entryPaid?: number;
};

export type CaseBattleView = {
  battleId: string;
  creatorId: string;
  status: string;
  caseId: string;
  caseIds: string[];
  rounds: number;
  maxPlayers: number;
  playerMode: string;
  gamemode: string;
  crazyMode: boolean;
  fastSpin: boolean;
  entryCost: number;
  potTotal: number;
  winnerId: string | null;
  winnerSlot: number | null;
  winningSlots: number[];
  winnerPayout: number;
  payoutsCredited?: boolean;
  battleSeedHash: string | null;
  battleSeed: string | null;
  internalBattleSeed?: string | null;
  eosCommitBlockNum?: number | null;
  eosTargetBlockNum?: number | null;
  eosBlockNum?: number | null;
  eosBlockId?: string | null;
  jackpotEosCommitBlockNum?: number | null;
  jackpotEosTargetBlockNum?: number | null;
  jackpotEosBlockNum?: number | null;
  jackpotEosBlockId?: string | null;
  results: unknown;
  players: CaseBattlePlayer[];
  balance?: number;
};

export type OpenBattleRow = {
  battle_id: string;
  creator_id: string;
  case_id: string;
  case_ids: string[] | null;
  rounds: number;
  max_players: number;
  player_mode: string;
  gamemode: string;
  crazy_mode?: boolean;
  fast_spin?: boolean;
  entry_cost: number;
  pot_total: number;
  player_count: number;
  status: string;
  completed_at: string | null;
  created_at: string;
};

/** Completed battles stay on the list for 10 minutes after ending. */
export const BATTLE_LIST_COMPLETED_TTL_MS = 10 * 60 * 1000;

export function filterListedBattles(rows: OpenBattleRow[]): OpenBattleRow[] {
  const now = Date.now();
  return rows.filter((row) => {
    if (
      row.status === "waiting" ||
      row.status === "running" ||
      row.status === "pending_eos" ||
      row.status === "pending_jackpot_eos"
    ) {
      return true;
    }
    if (row.status === "completed" && row.completed_at) {
      return now - new Date(row.completed_at).getTime() < BATTLE_LIST_COMPLETED_TTL_MS;
    }
    return false;
  });
}

export type CaseBattlePfState = {
  serverSeedHash: string;
  clientSeed: string;
  nextNonce: number;
};

export { CASE_CATALOG, type LootCase };

function parseCaseIdsField(raw: unknown, fallback?: string): string[] {
  if (Array.isArray(raw) && raw.length > 0) return raw.map(String);
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed) && parsed.length > 0) return parsed.map(String);
    } catch {
      /* ignore */
    }
  }
  return fallback ? [fallback] : [];
}

function mapBattle(data: Record<string, unknown>): CaseBattleView {
  const caseIds = parseCaseIdsField(data.caseIds, data.caseId ? String(data.caseId) : undefined);
  const results = data.results as Record<string, unknown> | null;
  const winningSlots = Array.isArray(data.winningSlots)
    ? (data.winningSlots as number[])
    : Array.isArray(results?.winningSlots)
      ? (results!.winningSlots as number[])
      : data.winnerSlot != null
        ? [Number(data.winnerSlot)]
        : [];
  return {
    battleId: String(data.battleId ?? ""),
    creatorId: String(data.creatorId ?? ""),
    status: String(data.status ?? ""),
    caseId: String(data.caseId ?? caseIds[0] ?? ""),
    caseIds,
    rounds: Number(data.rounds ?? caseIds.length),
    maxPlayers: Number(data.maxPlayers ?? 2),
    playerMode: String(data.playerMode ?? "1v1"),
    gamemode: String(data.gamemode ?? "normal"),
    crazyMode: Boolean(data.crazyMode),
    fastSpin: Boolean(data.fastSpin),
    entryCost: Number(data.entryCost ?? 0),
    potTotal: Number(data.potTotal ?? 0),
    winnerId: (data.winnerId as string | null) ?? null,
    winnerSlot: data.winnerSlot != null ? Number(data.winnerSlot) : null,
    winningSlots,
    winnerPayout: Number(data.winnerPayout ?? 0),
    payoutsCredited: Boolean(data.payoutsCredited),
    battleSeedHash: (data.battleSeedHash as string | null) ?? null,
    battleSeed: (data.battleSeed as string | null) ?? null,
    internalBattleSeed: (data.internalBattleSeed as string | null) ?? null,
    eosCommitBlockNum: data.eosCommitBlockNum != null ? Number(data.eosCommitBlockNum) : null,
    eosTargetBlockNum: data.eosTargetBlockNum != null ? Number(data.eosTargetBlockNum) : null,
    eosBlockNum: data.eosBlockNum != null ? Number(data.eosBlockNum) : null,
    eosBlockId: (data.eosBlockId as string | null) ?? null,
    jackpotEosCommitBlockNum:
      data.jackpotEosCommitBlockNum != null ? Number(data.jackpotEosCommitBlockNum) : null,
    jackpotEosTargetBlockNum:
      data.jackpotEosTargetBlockNum != null ? Number(data.jackpotEosTargetBlockNum) : null,
    jackpotEosBlockNum: data.jackpotEosBlockNum != null ? Number(data.jackpotEosBlockNum) : null,
    jackpotEosBlockId: (data.jackpotEosBlockId as string | null) ?? null,
    results: data.results ?? null,
    players: (data.players as CaseBattlePlayer[]) ?? [],
    balance: data.balance != null ? Number(data.balance) : undefined,
  };
}

export async function caseBattleAction(
  body: Record<string, unknown>
): Promise<{ data: CaseBattleView | null; error: string | null }> {
  const { data, error } = await invokeEdgeFunction<Record<string, unknown>>("case-battle", body);
  if (error) return { data: null, error };
  if (!data) return { data: null, error: "No response from server." };
  return { data: mapBattle(data), error: null };
}

export async function listOpenCaseBattles(limit = 20) {
  const { data, error } = await invokeEdgeFunction<Record<string, unknown>>("case-battle", {
    action: "list",
    limit,
  });
  if (error) return { battles: [] as OpenBattleRow[], error };
  const raw = (data?.battles as OpenBattleRow[] | undefined) ?? [];
  const battles = filterListedBattles(
    raw.map((row) => ({
      ...row,
      case_ids: parseCaseIdsField(row.case_ids, row.case_id),
      player_count: Number(row.player_count),
      max_players: Number(row.max_players),
      entry_cost: Number(row.entry_cost),
      pot_total: Number(row.pot_total),
      status: String(row.status ?? "waiting"),
      completed_at: row.completed_at != null ? String(row.completed_at) : null,
    }))
  );
  return { battles, error: null };
}

export function viewCaseBattle(battleId: string) {
  return caseBattleAction({ action: "view", battleId });
}

export async function claimCaseBattlePayout(battleId: string) {
  const { data, error } = await invokeEdgeFunction<{
    balance?: number;
    credited?: boolean;
  }>("case-battle", { action: "claim", battleId });
  if (error) return { data: null, error };
  return {
    data: {
      balance: data?.balance != null ? Number(data.balance) : undefined,
      credited: Boolean(data?.credited),
    },
    error: null,
  };
}

export function createCaseBattle(params: {
  caseIds: string[];
  playerMode: string;
  gamemode: string;
  crazyMode?: boolean;
  fastSpin?: boolean;
  borrowPercent?: number;
}) {
  return caseBattleAction({ action: "create", ...params });
}

export function joinCaseBattle(battleId: string, borrowPercent = 0) {
  return caseBattleAction({
    action: "join",
    battleId,
    borrowPercent: Math.min(80, Math.max(0, Math.round(borrowPercent))),
  });
}

export function addBotToCaseBattle(battleId: string, slotIndex?: number) {
  return caseBattleAction({
    action: "add_bot",
    battleId,
    ...(slotIndex != null ? { slotIndex } : {}),
  });
}

export async function fetchCaseBattlePfState() {
  if (!isSupabaseConfigured) {
    return { data: null as CaseBattlePfState | null, error: "Supabase is not configured." };
  }
  const { data, error } = await supabase.rpc("get_case_battle_pf_state");
  if (error) {
    const msg = error.message ?? "Could not load seed state.";
    if (msg.includes("get_case_battle_pf_state") && msg.includes("does not exist")) {
      return {
        data: null,
        error: "Case Battles is not set up. Run migrations 20250521800000 and 20250521900000.",
      };
    }
    return { data: null, error: msg };
  }
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
  if (!row) return { data: null, error: "No seed state returned." };
  return {
    data: {
      serverSeedHash: String(row.server_seed_hash ?? row.serverSeedHash ?? ""),
      clientSeed: String(row.client_seed ?? row.clientSeed ?? "default"),
      nextNonce: Number(row.next_nonce ?? row.nextNonce ?? 0),
    },
    error: null,
  };
}

export async function setCaseBattleClientSeed(clientSeed: string) {
  const { error } = await supabase.rpc("set_case_battle_client_seed", {
    p_client_seed: clientSeed,
  });
  return { error: error?.message ?? null };
}
