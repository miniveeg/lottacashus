import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import {
  applyBorrowToPayouts,
  battleEntryCostFromCaseIds,
  CASE_CATALOG,
  deriveBattleSeedFromEos,
  finalizeJackpotOutcome,
  generateBattleSeed,
  hashSeed,
  maxPlayersForMode,
  parseCaseIds,
  resolveBattle,
  entryAfterBorrow,
  validateCreateParams,
  type BattlePlayerResult,
} from "../_shared/caseBattles.ts";
import { getEosBlock, getEosHead, waitForEosBlock } from "../_shared/eos.ts";

type SeedRow = {
  server_seed: string;
  client_seed: string;
  nonce: number;
};

function rpcBalance(data: unknown): number {
  const row = (Array.isArray(data) ? data[0] : data) as { out_balance?: number } | null;
  return Number(row?.out_balance ?? 0);
}

function rpcBalanceOptional(data: unknown): number | undefined {
  const row = (Array.isArray(data) ? data[0] : data) as { out_balance?: number } | null;
  if (!row || row.out_balance == null) return undefined;
  return Number(row.out_balance);
}

function parseSeed(data: unknown): SeedRow | null {
  const raw = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
  if (!raw) return null;
  const serverSeed = raw.server_seed ?? raw.serverSeed;
  if (typeof serverSeed !== "string" || !serverSeed) return null;
  return {
    server_seed: serverSeed,
    client_seed: String(raw.client_seed ?? raw.clientSeed ?? "default"),
    nonce: Number(raw.nonce ?? 0),
  };
}

async function consumeNonce(
  admin: ReturnType<typeof createClient>,
  userId: string,
  advance = 1
) {
  const { data, error } = await admin.rpc("consume_keno_nonce", {
    p_user_id: userId,
    p_advance: advance,
  });
  if (error) throw new Error(error.message);
  const row = parseSeed(data);
  if (!row) throw new Error("Could not load seeds.");
  return row;
}

async function loadBattle(admin: ReturnType<typeof createClient>, battleId: string) {
  const { data: battle, error } = await admin
    .from("case_battles")
    .select("*")
    .eq("id", battleId)
    .maybeSingle();
  if (error || !battle) return null;

  const { data: players } = await admin
    .from("case_battle_players")
    .select("*")
    .eq("battle_id", battleId)
    .order("slot_index", { ascending: true });

  return { battle, players: players ?? [] };
}

function battlePayload(
  battle: Record<string, unknown>,
  players: Record<string, unknown>[],
  extra: Record<string, unknown> = {}
) {
  const caseIds = parseCaseIds(battle.case_ids, String(battle.case_id ?? ""));
  const results = battle.results as Record<string, unknown> | null;
  const winningSlots = Array.isArray(results?.winningSlots)
    ? (results!.winningSlots as number[])
    : battle.winner_slot != null
      ? [Number(battle.winner_slot)]
      : [];
  return {
    battleId: battle.id,
    creatorId: battle.creator_id,
    status: battle.status,
    caseId: battle.case_id,
    caseIds,
    rounds: Number(battle.rounds),
    maxPlayers: Number(battle.max_players),
    playerMode: battle.player_mode ?? "1v1",
    gamemode: battle.gamemode ?? "normal",
    crazyMode: Boolean(battle.crazy_mode),
    fastSpin: Boolean(battle.fast_spin),
    entryCost: Number(battle.entry_cost),
    potTotal: Number(battle.pot_total),
    winnerId: battle.winner_id ?? null,
    winnerSlot: battle.winner_slot ?? null,
    winningSlots,
    winnerPayout: Number(battle.winner_payout ?? 0),
    payoutsCredited: Boolean(battle.payouts_credited),
    battleSeedHash: battle.battle_seed_hash ?? null,
    battleSeed: battle.status === "completed" ? battle.battle_seed : null,
    internalBattleSeed: battle.status === "completed" ? battle.internal_battle_seed : null,
    eosCommitBlockNum: battle.eos_commit_block_num != null ? Number(battle.eos_commit_block_num) : null,
    eosTargetBlockNum: battle.eos_target_block_num != null ? Number(battle.eos_target_block_num) : null,
    eosBlockNum: battle.eos_block_num != null ? Number(battle.eos_block_num) : null,
    eosBlockId: battle.eos_block_id ?? null,
    jackpotEosCommitBlockNum:
      battle.jackpot_eos_commit_block_num != null ? Number(battle.jackpot_eos_commit_block_num) : null,
    jackpotEosTargetBlockNum:
      battle.jackpot_eos_target_block_num != null ? Number(battle.jackpot_eos_target_block_num) : null,
    jackpotEosBlockNum:
      battle.jackpot_eos_block_num != null ? Number(battle.jackpot_eos_block_num) : null,
    jackpotEosBlockId: battle.jackpot_eos_block_id ?? null,
    results: battle.results ?? null,
    players: players.map((p) => ({
      slot: p.slot_index,
      userId: p.user_id,
      isBot: p.is_bot,
      displayName: p.display_name,
      totalValue: Number(p.total_value),
      drops: p.round_drops ?? [],
      borrowPercent: Number(p.borrow_percent ?? 0),
      entryPaid: p.entry_paid != null ? Number(p.entry_paid) : undefined,
    })),
    ...extra,
  };
}

async function runBattleResolution(
  admin: ReturnType<typeof createClient>,
  battleId: string,
  battle: Record<string, unknown>,
  players: Record<string, unknown>[],
  eosBlockId: string
) {
  const existing = await loadBattle(admin, battleId);
  if (existing?.battle.status === "completed") {
    return {
      ...battlePayload(existing.battle, existing.players),
      balance: undefined,
    };
  }

  const caseIds = parseCaseIds(battle.case_ids, String(battle.case_id ?? ""));
  const potTotal = Number(battle.pot_total);
  const playerMode = String(battle.player_mode ?? "1v1");
  const gamemode = String(battle.gamemode ?? "normal");
  const crazyMode = Boolean(battle.crazy_mode);
  const internalSeed = String(battle.internal_battle_seed ?? battle.battle_seed ?? "");
  if (!internalSeed) throw new Error("Missing battle seed");
  if (!eosBlockId) throw new Error("Missing EOS block");

  const battleSeed = await deriveBattleSeedFromEos(internalSeed, eosBlockId);
  const battleSeedHash = String(battle.battle_seed_hash ?? (await hashSeed(internalSeed)));

  await admin.rpc("mark_case_battle_running", {
    p_battle_id: battleId,
    p_battle_seed_hash: battleSeedHash,
  });

  const rounds = caseIds.length;

  const participants: {
    slot: number;
    userId: string | null;
    isBot: boolean;
    displayName: string;
    serverSeed: string;
    clientSeed: string;
    startNonce: number;
  }[] = [];

  for (const p of players) {
    if (p.is_bot) {
      participants.push({
        slot: Number(p.slot_index),
        userId: null,
        isBot: true,
        displayName: String(p.display_name ?? "Bot"),
        serverSeed: battleSeed,
        clientSeed: "case-battle-bot",
        startNonce: 0,
      });
      continue;
    }
    const uid = String(p.user_id);
    const first = await consumeNonce(admin, uid, rounds);
    const startNonce = first.nonce;
    participants.push({
      slot: Number(p.slot_index),
      userId: uid,
      isBot: false,
      displayName: String(p.display_name ?? "Player"),
      serverSeed: first.server_seed,
      clientSeed: first.client_seed,
      startNonce,
    });
  }

  const isJackpot = gamemode === "jackpot";

  const resolved = await resolveBattle({
    caseIds,
    battleSeed,
    participants,
    potTotal,
    playerMode,
    gamemode,
    crazyMode,
    eosBlockId,
    deferJackpot: isJackpot,
  });

  if (isJackpot) {
    await stageJackpotRounds(admin, battleId, resolved, battleSeed, eosBlockId, battleSeedHash, internalSeed);
    await commitJackpotToEos(admin, battleId);

    const jackpotDone = await tryFinalizeJackpotEos(admin, battleId);
    if (jackpotDone) {
      return {
        ...jackpotDone.payload,
        balance: jackpotDone.balance,
      };
    }

    const staged = await loadBattle(admin, battleId);
    return {
      ...battlePayload(staged!.battle, staged!.players),
      balance: undefined,
    };
  }

  const borrowByUser = new Map<string, number>();
  for (const p of players) {
    if (p.user_id && !p.is_bot) {
      borrowByUser.set(String(p.user_id), Number(p.borrow_percent ?? 0));
    }
  }
  resolved.winnerPayouts = applyBorrowToPayouts(resolved.winnerPayouts, borrowByUser);
  resolved.winnerPayout = Math.round(
    resolved.winnerPayouts.reduce((s, p) => s + p.amount, 0) * 100
  ) / 100;

  const { data: fin, error: finErr } = await admin.rpc("complete_case_battle", {
    p_battle_id: battleId,
    p_winner_id: resolved.winnerUserId,
    p_winner_slot: resolved.winnerSlot,
    p_winner_payout: resolved.winnerPayout,
    p_pot_total: resolved.potTotal,
    p_battle_seed: battleSeed,
    p_results: {
      ...resolved,
      eosBlockId,
      internalSeedHash: battleSeedHash,
      playbackAnchorAt: new Date().toISOString(),
    },
    p_winner_payouts: resolved.winnerPayouts,
    p_players: resolved.players.map((pl: BattlePlayerResult) => ({
      slot: pl.slot,
      totalValue: pl.totalValue,
      drops: pl.drops,
    })),
  });

  await admin
    .from("case_battles")
    .update({
      internal_battle_seed: internalSeed,
      battle_seed: battleSeed,
      eos_block_id: eosBlockId,
      eos_block_num: battle.eos_block_num ?? battle.eos_target_block_num,
    })
    .eq("id", battleId);

  if (finErr) {
    const refreshed = await loadBattle(admin, battleId);
    if (refreshed?.battle.status === "completed") {
      return {
        ...battlePayload(refreshed.battle, refreshed.players),
        balance: rpcBalanceOptional(fin),
        resolved,
      };
    }
    throw new Error(finErr.message);
  }

  const refreshed = await loadBattle(admin, battleId);
  const finBal = rpcBalanceOptional(fin);

  return {
    ...battlePayload(refreshed!.battle, refreshed!.players),
    balance: finBal,
    resolved,
  };
}

async function stageJackpotRounds(
  admin: ReturnType<typeof createClient>,
  battleId: string,
  resolved: Awaited<ReturnType<typeof resolveBattle>>,
  battleSeed: string,
  eosBlockId: string,
  battleSeedHash: string,
  internalSeed: string
) {
  for (const pl of resolved.players) {
    await admin
      .from("case_battle_players")
      .update({
        total_value: pl.totalValue,
        round_drops: pl.drops,
      })
      .eq("battle_id", battleId)
      .eq("slot_index", pl.slot);
  }

  const { data: existing } = await admin
    .from("case_battles")
    .select("results")
    .eq("id", battleId)
    .maybeSingle();
  const prevResults = (existing?.results as Record<string, unknown> | null) ?? {};
  const playbackAnchorAt =
    typeof prevResults.playbackAnchorAt === "string"
      ? prevResults.playbackAnchorAt
      : new Date().toISOString();

  await admin
    .from("case_battles")
    .update({
      battle_seed: battleSeed,
      internal_battle_seed: internalSeed,
      eos_block_id: eosBlockId,
      results: {
        ...prevResults,
        phase: "rounds_done",
        jackpotWeights: resolved.jackpotWeights,
        eosBlockId,
        internalSeedHash: battleSeedHash,
        playbackAnchorAt,
      },
    })
    .eq("id", battleId);
}

async function commitJackpotToEos(admin: ReturnType<typeof createClient>, battleId: string) {
  const head = await getEosHead();
  const targetBlockNum = head.blockNum + 2;

  await admin
    .from("case_battles")
    .update({
      status: "pending_jackpot_eos",
      jackpot_eos_commit_block_num: head.blockNum,
      jackpot_eos_target_block_num: targetBlockNum,
    })
    .eq("id", battleId)
    .in("status", ["running", "pending_eos"]);
}

async function tryFinalizeJackpotEos(
  admin: ReturnType<typeof createClient>,
  battleId: string,
  balanceHint?: number
) {
  const loaded = await loadBattle(admin, battleId);
  if (!loaded) return null;
  if (loaded.battle.status === "completed") {
    return { payload: battlePayload(loaded.battle, loaded.players), balance: balanceHint };
  }
  if (loaded.battle.status !== "pending_jackpot_eos") return null;

  const targetNum = Number(loaded.battle.jackpot_eos_target_block_num);
  if (!Number.isFinite(targetNum) || targetNum <= 0) return null;

  const head = await getEosHead();
  if (head.blockNum < targetNum) return null;

  let block;
  try {
    block = await getEosBlock(targetNum);
  } catch {
    block = await waitForEosBlock(targetNum, 4000);
  }
  if (!block) return null;

  const jackpotEosBlockId = block.id;

  await admin
    .from("case_battles")
    .update({
      jackpot_eos_block_id: jackpotEosBlockId,
      jackpot_eos_block_num: block.blockNum,
    })
    .eq("id", battleId)
    .eq("status", "pending_jackpot_eos");

  const fresh = await loadBattle(admin, battleId);
  if (!fresh || fresh.battle.status !== "pending_jackpot_eos") return null;

  const battleSeed = String(fresh.battle.battle_seed ?? "");
  if (!battleSeed) throw new Error("Missing battle seed for jackpot");

  const caseIds = parseCaseIds(fresh.battle.case_ids, String(fresh.battle.case_id ?? ""));
  const potTotal = Number(fresh.battle.pot_total);
  const playerMode = String(fresh.battle.player_mode ?? "1v1");
  const crazyMode = Boolean(fresh.battle.crazy_mode);
  const battleSeedHash = String(fresh.battle.battle_seed_hash ?? "");
  const internalSeed = String(fresh.battle.internal_battle_seed ?? "");
  const eosBlockId = String(fresh.battle.eos_block_id ?? "");

  const players: BattlePlayerResult[] = fresh.players.map((p) => ({
    slot: Number(p.slot_index),
    userId: p.user_id ? String(p.user_id) : null,
    isBot: Boolean(p.is_bot),
    displayName: String(p.display_name ?? "Player"),
    totalValue: Number(p.total_value),
    drops: (p.round_drops as BattlePlayerResult["drops"]) ?? [],
    nonces: [],
  }));

  const outcome = await finalizeJackpotOutcome({
    players,
    playerMode,
    potTotal,
    battleSeed,
    jackpotEosBlockId,
    crazyMode,
  });

  const borrowByUser = new Map<string, number>();
  for (const p of fresh.players) {
    if (p.user_id && !p.is_bot) {
      borrowByUser.set(String(p.user_id), Number(p.borrow_percent ?? 0));
    }
  }
  const winnerPayouts = applyBorrowToPayouts(outcome.winnerPayouts, borrowByUser);
  const winnerPayout = Math.round(
    winnerPayouts.reduce((s, p) => s + p.amount, 0) * 100
  ) / 100;

  const stagedResults = (fresh.battle.results as Record<string, unknown> | null) ?? {};
  const results = {
    caseIds,
    rounds: caseIds.length,
    gamemode: "jackpot",
    players,
    winnerSlot: outcome.winnerSlot,
    winnerUserId: outcome.winnerUserId,
    winningSlots: outcome.winningSlots,
    potTotal,
    winnerPayout,
    winnerPayouts,
    battleSeed,
    jackpotWeights: outcome.jackpotWeights,
    jackpotReelSlot: outcome.jackpotReelSlot,
    eosBlockId,
    jackpotEosBlockId,
    internalSeedHash: battleSeedHash,
    playbackAnchorAt: stagedResults.playbackAnchorAt ?? new Date().toISOString(),
    phase: "completed",
  };

  const { data: fin, error: finErr } = await admin.rpc("complete_case_battle", {
    p_battle_id: battleId,
    p_winner_id: outcome.winnerUserId,
    p_winner_slot: outcome.winnerSlot,
    p_winner_payout: winnerPayout,
    p_pot_total: potTotal,
    p_battle_seed: battleSeed,
    p_results: results,
    p_winner_payouts: winnerPayouts,
    p_players: players.map((pl) => ({
      slot: pl.slot,
      totalValue: pl.totalValue,
      drops: pl.drops,
    })),
  });

  if (finErr) {
    const again = await loadBattle(admin, battleId);
    if (again?.battle.status === "completed") {
      return {
        payload: battlePayload(again.battle, again.players),
        balance: rpcBalanceOptional(fin) ?? balanceHint,
      };
    }
    throw new Error(finErr.message);
  }

  const refreshed = await loadBattle(admin, battleId);
  return {
    payload: battlePayload(refreshed!.battle, refreshed!.players),
    balance: rpcBalanceOptional(fin) ?? balanceHint,
  };
}

async function commitBattleToEos(
  admin: ReturnType<typeof createClient>,
  battleId: string,
  battle: Record<string, unknown>,
  players: Record<string, unknown>[],
  balanceHint?: number
) {
  const internalSeed = generateBattleSeed();
  const battleSeedHash = await hashSeed(internalSeed);
  const head = await getEosHead();
  const targetBlockNum = head.blockNum + 2;

  const { error: updErr } = await admin
    .from("case_battles")
    .update({
      status: "pending_eos",
      internal_battle_seed: internalSeed,
      battle_seed_hash: battleSeedHash,
      eos_commit_block_num: head.blockNum,
      eos_target_block_num: targetBlockNum,
    })
    .eq("id", battleId)
    .eq("status", "waiting");

  if (updErr) throw new Error(updErr.message);

  const loaded = await loadBattle(admin, battleId);
  if (!loaded) throw new Error("Battle not found");

  const finalized = await tryFinalizeEosBattle(admin, battleId, balanceHint);
  if (finalized) return finalized;

  return {
    payload: battlePayload(loaded.battle, loaded.players),
    balance: balanceHint,
  };
}

async function tryFinalizeEosBattle(
  admin: ReturnType<typeof createClient>,
  battleId: string,
  balanceHint?: number
) {
  const loaded = await loadBattle(admin, battleId);
  if (!loaded) return null;
  if (loaded.battle.status === "completed") {
    return { payload: battlePayload(loaded.battle, loaded.players), balance: balanceHint };
  }
  if (loaded.battle.status !== "pending_eos") return null;

  const targetNum = Number(loaded.battle.eos_target_block_num);
  if (!Number.isFinite(targetNum) || targetNum <= 0) return null;

  const head = await getEosHead();
  if (head.blockNum < targetNum) return null;

  let block;
  try {
    block = await getEosBlock(targetNum);
  } catch {
    block = await waitForEosBlock(targetNum, 4000);
  }
  if (!block) return null;

  const eosBlockId = block.id;

  await admin
    .from("case_battles")
    .update({
      eos_block_id: eosBlockId,
      eos_block_num: block.blockNum,
    })
    .eq("id", battleId)
    .eq("status", "pending_eos");

  const fresh = await loadBattle(admin, battleId);
  if (!fresh || fresh.battle.status !== "pending_eos") return null;

  try {
    const result = await runBattleResolution(
      admin,
      battleId,
      fresh.battle,
      fresh.players,
      eosBlockId
    );
    return { payload: result, balance: result.balance ?? balanceHint };
  } catch (err) {
    const again = await loadBattle(admin, battleId);
    if (again?.battle.status === "completed") {
      return { payload: battlePayload(again.battle, again.players), balance: balanceHint };
    }
    throw err;
  }
}

async function tryStartIfFull(
  admin: ReturnType<typeof createClient>,
  battleId: string,
  balanceHint?: number
) {
  const loaded = await loadBattle(admin, battleId);
  if (!loaded) throw new Error("Battle not found");

  if (loaded.battle.status === "pending_eos") {
    const finalized = await tryFinalizeEosBattle(admin, battleId, balanceHint);
    if (finalized) return finalized;
    return { payload: battlePayload(loaded.battle, loaded.players), balance: balanceHint };
  }

  if (loaded.battle.status === "pending_jackpot_eos") {
    const finalized = await tryFinalizeJackpotEos(admin, battleId, balanceHint);
    if (finalized) return finalized;
    return { payload: battlePayload(loaded.battle, loaded.players), balance: balanceHint };
  }

  if (loaded.battle.status !== "waiting") {
    return { payload: battlePayload(loaded.battle, loaded.players), balance: balanceHint };
  }

  const maxPlayers = Number(loaded.battle.max_players);
  if (loaded.players.length < maxPlayers) {
    return { payload: battlePayload(loaded.battle, loaded.players), balance: balanceHint };
  }

  return commitBattleToEos(admin, battleId, loaded.battle, loaded.players, balanceHint);
}

function nextOpenSlot(players: Record<string, unknown>[], maxPlayers: number): number {
  const taken = new Set(players.map((p) => Number(p.slot_index)));
  for (let i = 0; i < maxPlayers; i++) {
    if (!taken.has(i)) return i;
  }
  return -1;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(req) });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, req);
  }

  try {
    const body = await req.json();
    const action = String(body?.action ?? "");

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    if (action === "catalog") {
      return jsonResponse({ cases: CASE_CATALOG });
    }

    if (action === "list") {
      const { data, error } = await admin.rpc("get_open_case_battles", {
        p_limit: Number(body?.limit ?? 20),
      });
      if (error) return jsonResponse({ error: error.message }, 400, req);
      return jsonResponse({ battles: data ?? [] });
    }

    if (action === "view") {
      const battleId = String(body?.battleId ?? "");
      if (!battleId) return jsonResponse({ error: "Battle id required." }, 400, req);
      const eosFinalized = await tryFinalizeEosBattle(admin, battleId);
      if (eosFinalized) {
        return jsonResponse(eosFinalized.payload);
      }
      const jackpotFinalized = await tryFinalizeJackpotEos(admin, battleId);
      if (jackpotFinalized) {
        return jsonResponse(jackpotFinalized.payload);
      }
      const loaded = await loadBattle(admin, battleId);
      if (!loaded) return jsonResponse({ error: "Battle not found." }, 404, req);
      return jsonResponse(battlePayload(loaded.battle, loaded.players));
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "Log in required." }, 401, req);

    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const {
      data: { user },
      error: userError,
    } = await supabaseUser.auth.getUser();

    if (userError || !user) return jsonResponse({ error: "Invalid session." }, 401, req);

    if (action === "claim") {
      const battleId = String(body?.battleId ?? "");
      if (!battleId) return jsonResponse({ error: "Battle id required." }, 400, req);

      const { data, error } = await admin.rpc("apply_case_battle_payouts", {
        p_battle_id: battleId,
        p_user_id: user.id,
      });

      if (error) return jsonResponse({ error: error.message }, 400, req);

      const row = (Array.isArray(data) ? data[0] : data) as {
        out_balance?: number;
        out_credited?: boolean;
      } | null;

      return jsonResponse({
        balance: row?.out_balance != null ? Number(row.out_balance) : undefined,
        credited: Boolean(row?.out_credited),
      });
    }

    if (action === "create") {
      const caseIds = (Array.isArray(body?.caseIds) ? body.caseIds : []).map(String);
      const playerMode = String(body?.playerMode ?? "1v1");
      const gamemode = String(body?.gamemode ?? "normal");
      const crazyMode = Boolean(body?.crazyMode);
      const fastSpin = Boolean(body?.fastSpin);
      const borrowPercent = Math.min(80, Math.max(0, Math.round(Number(body?.borrowPercent) || 0)));

      const err = validateCreateParams({ caseIds, playerMode, gamemode, crazyMode, borrowPercent });
      if (err) return jsonResponse({ error: err }, 400, req);

      const maxPlayers = maxPlayersForMode(playerMode);
      const entryCost = battleEntryCostFromCaseIds(caseIds);
      const primaryCaseId = caseIds[0]!;
      const upfrontCost =
        Math.round(entryCost * (1 - borrowPercent / 100) * 100) / 100;

      const { data: profile } = await admin
        .from("profiles")
        .select("balance, username")
        .eq("id", user.id)
        .maybeSingle();

      if (Number(profile?.balance ?? 0) < upfrontCost) {
        return jsonResponse({ error: "Insufficient balance" }, 400, req);
      }

      const { data: battle, error: insErr } = await admin
        .from("case_battles")
        .insert({
          creator_id: user.id,
          case_id: primaryCaseId,
          case_ids: caseIds,
          rounds: caseIds.length,
          max_players: maxPlayers,
          vs_bot: false,
          entry_cost: entryCost,
          status: "waiting",
          gamemode,
          player_mode: playerMode,
          crazy_mode: crazyMode,
          fast_spin: fastSpin,
        })
        .select()
        .single();

      if (insErr || !battle) return jsonResponse({ error: insErr?.message ?? "Create failed" }, 400, req);

      const { data: joined, error: joinErr } = await admin.rpc("create_case_battle_entry", {
        p_user_id: user.id,
        p_battle_id: battle.id,
        p_slot_index: 0,
        p_entry_cost: entryCost,
        p_display_name: String(profile?.username ?? "Player").slice(0, 32),
        p_borrow_percent: borrowPercent,
      });

      if (joinErr) {
        await admin.from("case_battles").delete().eq("id", battle.id);
        return jsonResponse({ error: joinErr.message }, 400, req);
      }

      const balance = rpcBalance(joined);

      const loaded = await loadBattle(admin, battle.id);
      return jsonResponse({
        ...battlePayload(loaded!.battle, loaded!.players),
        balance,
      });
    }

    if (action === "add_bot") {
      const battleId = String(body?.battleId ?? "");
      const slotIndex = body?.slotIndex != null ? Number(body.slotIndex) : -1;

      if (!battleId) return jsonResponse({ error: "Battle id required." }, 400, req);

      const loaded = await loadBattle(admin, battleId);
      if (!loaded) return jsonResponse({ error: "Battle not found." }, 404, req);

      const { battle, players } = loaded;

      if (battle.status !== "waiting") {
        return jsonResponse({ error: "Battle already started." }, 400, req);
      }
      if (battle.creator_id !== user.id) {
        return jsonResponse({ error: "Only the battle creator can add bots." }, 403, req);
      }

      const maxPlayers = Number(battle.max_players);
      const slot =
        slotIndex >= 0 && slotIndex < maxPlayers && !players.some((p) => Number(p.slot_index) === slotIndex)
          ? slotIndex
          : nextOpenSlot(players, maxPlayers);

      if (slot < 0) return jsonResponse({ error: "No empty slots." }, 400, req);

      await admin.rpc("insert_case_battle_bot", {
        p_battle_id: battleId,
        p_slot_index: slot,
      });

      const started = await tryStartIfFull(admin, battleId);
      return jsonResponse({ ...started.payload, balance: started.balance });
    }

    if (action === "join") {
      const battleId = String(body?.battleId ?? "");
      if (!battleId) return jsonResponse({ error: "Battle id required." }, 400, req);

      const loaded = await loadBattle(admin, battleId);
      if (!loaded) return jsonResponse({ error: "Battle not found." }, 404, req);

      const { battle, players } = loaded;

      if (battle.status !== "waiting") {
        return jsonResponse({ error: "Battle is no longer open." }, 400, req);
      }
      if (players.some((p) => p.user_id === user.id)) {
        return jsonResponse({ error: "You are already in this battle." }, 400, req);
      }

      const maxPlayers = Number(battle.max_players);
      const slot = nextOpenSlot(players, maxPlayers);
      if (slot < 0) return jsonResponse({ error: "Battle is full." }, 400, req);

      const entryCost = Number(battle.entry_cost);
      const borrowPercent = Math.min(80, Math.max(0, Math.round(Number(body?.borrowPercent) || 0)));
      const joinCost = entryAfterBorrow(entryCost, borrowPercent);

      const { data: profile } = await admin
        .from("profiles")
        .select("balance, username")
        .eq("id", user.id)
        .maybeSingle();

      if (Number(profile?.balance ?? 0) < joinCost) {
        return jsonResponse({ error: "Insufficient balance" }, 400, req);
      }

      const { data: joined, error: joinErr } = await admin.rpc("create_case_battle_entry", {
        p_user_id: user.id,
        p_battle_id: battleId,
        p_slot_index: slot,
        p_entry_cost: entryCost,
        p_display_name: String(profile?.username ?? "Player").slice(0, 32),
        p_borrow_percent: borrowPercent,
      });

      if (joinErr) return jsonResponse({ error: joinErr.message }, 400, req);

      const balance = rpcBalance(joined);

      const started = await tryStartIfFull(admin, battleId, balance);
      return jsonResponse({ ...started.payload, balance: started.balance ?? balance });
    }

    return jsonResponse({ error: "Unknown action." }, 400, req);
  } catch (err) {
    console.error("case-battle:", err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Server error." }, 500, req);
  }
});
