import { invokeEdgeFunction } from "./edgeFunctions";
import { supabase, isSupabaseConfigured } from "./supabase";

export type MinesPfState = {
  serverSeedHash: string;
  clientSeed: string;
  nextNonce: number;
};

export type MinesActiveGame = {
  gameId: string;
  wager: number;
  mineCount: number;
  revealedTiles: number[];
  gemsRevealed: number;
  multiplier: number;
  status: string;
  /** Coin type locked when the game started (authoritative for cashout). */
  coinType: string;
};

export type MinesStartResult = {
  gameId: string;
  balance: number;
  mineCount: number;
  wager: number;
  maxGems: number;
  nonce: number;
  coinType: string;
};

export type MinesRevealResult = {
  gameId: string;
  tile: number;
  isMine: boolean;
  gemsRevealed: number;
  multiplier: number;
  status: string;
  balance: number;
  payout: number;
  mineTiles?: number[];
};

export type MinesCashoutResult = {
  gameId: string;
  status: string;
  payout: number;
  multiplier: number;
  gemsRevealed: number;
  balance: number;
};

function parsePfRow(data: unknown): MinesPfState | null {
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!row) return null;
  return {
    serverSeedHash: String(row.server_seed_hash ?? row.serverSeedHash ?? ""),
    clientSeed: String(row.client_seed ?? row.clientSeed ?? "default"),
    nextNonce: Number(row.next_nonce ?? row.nextNonce ?? 0),
  };
}

export async function fetchMinesPfState(): Promise<{
  data: MinesPfState | null;
  error: string | null;
}> {
  if (!isSupabaseConfigured) {
    return { data: null, error: "Supabase is not configured." };
  }

  const { data, error } = await supabase.rpc("get_mines_pf_state");
  if (error) {
    const msg = error.message ?? "Could not load seed state.";
    if (msg.includes("get_mines_pf_state") && msg.includes("does not exist")) {
      return {
        data: null,
        error: "Mines is not set up in the database yet. Run migration 20250521400000_mines_game.sql.",
      };
    }
    return { data: null, error: msg };
  }

  const parsed = parsePfRow(data);
  if (!parsed) return { data: null, error: "No seed state returned." };
  return { data: parsed, error: null };
}

export async function setMinesClientSeed(clientSeed: string): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured) {
    return { error: "Supabase is not configured." };
  }

  const { error } = await supabase.rpc("set_mines_client_seed", {
    p_client_seed: clientSeed,
  });
  return { error: error?.message ?? null };
}

export async function fetchActiveMinesGame(): Promise<{
  data: MinesActiveGame | null;
  error: string | null;
}> {
  const { data, error } = await invokeEdgeFunction<{
    active: boolean;
    gameId?: string;
    wager?: number;
    mineCount?: number;
    revealedTiles?: number[];
    gemsRevealed?: number;
    multiplier?: number;
    status?: string;
    coinType?: string;
  }>("mines-game", { action: "active" });

  if (error) return { data: null, error };
  if (!data?.active || !data.gameId) return { data: null, error: null };

  return {
    data: {
      gameId: data.gameId,
      wager: Number(data.wager),
      mineCount: Number(data.mineCount),
      revealedTiles: data.revealedTiles ?? [],
      gemsRevealed: Number(data.gemsRevealed ?? 0),
      multiplier: Number(data.multiplier ?? 1),
      status: String(data.status),
      coinType: String(data.coinType ?? "balance"),
    },
    error: null,
  };
}

export async function startMinesGame(params: {
  wager: number;
  mineCount: number;
  coinType?: string;
}): Promise<{ data: MinesStartResult | null; error: string | null }> {
  const {
    getOrCreateRequestId,
    clearRequestId,
    IDEM_KEY_MINES_START,
  } = await import("./idempotency");
  const clientRequestId = getOrCreateRequestId(IDEM_KEY_MINES_START);
  const { data, error } = await invokeEdgeFunction<MinesStartResult>("mines-game", {
    action: "start",
    wager: params.wager,
    mineCount: params.mineCount,
    coinType: params.coinType ?? "balance",
    clientRequestId,
  });
  if (data) clearRequestId(IDEM_KEY_MINES_START);
  return { data, error };
}

export async function revealMinesTile(params: {
  gameId: string;
  tile: number;
  mineCount?: number;
  coinType?: string;
}): Promise<{ data: MinesRevealResult | null; error: string | null }> {
  return invokeEdgeFunction<MinesRevealResult>("mines-game", {
    action: "reveal",
    gameId: params.gameId,
    tile: params.tile,
    mineCount: params.mineCount,
    coinType: params.coinType ?? "balance",
  });
}

export async function cashoutMinesGame(
  params: { gameId: string; coinType?: string }
): Promise<{ data: MinesCashoutResult | null; error: string | null }> {
  return invokeEdgeFunction<MinesCashoutResult>("mines-game", {
    action: "cashout",
    gameId: params.gameId,
    coinType: params.coinType ?? "balance",
  });
}

export async function fetchMyActiveMinesGame(): Promise<{
  data: MinesActiveGame | null;
  error: string | null;
}> {
  if (!isSupabaseConfigured) {
    return { data: null, error: "Supabase is not configured." };
  }

  const { data, error } = await supabase.rpc("get_my_active_mines_game");
  if (error) return { data: null, error: error.message };
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
  if (!row?.game_id) return { data: null, error: null };

  return {
    data: {
      gameId: row.game_id as string,
      wager: Number(row.wager),
      mineCount: Number(row.mine_count),
      revealedTiles: (row.revealed_tiles as number[]) ?? [],
      gemsRevealed: Number(row.gems_revealed ?? 0),
      multiplier: Number(row.multiplier ?? 1),
      status: String(row.status),
      coinType: String(row.coin_type ?? row.coinType ?? "balance"),
    },
    error: null,
  };
}
