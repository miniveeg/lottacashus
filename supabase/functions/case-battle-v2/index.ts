/**
 * Case Battles v2 — Supabase Edge Function
 * ─────────────────────────────────────────────────────────────────────────────
 * Implements the v2 Case Battles game mode against the schema in
 * `supabase/case-battles-v2-setup.sql`.
 *
 * Actions (routed via `body.action`):
 *   - `start`     : creator commits the battle to an EOS block (commit phase)
 *   - `check_eos` : frontend polls while status='committing'; resolves the
 *                   battle once the target EOS block is mined
 *   - `claim`     : a winner calls to credit their payout to their balance
 *
 * Provably-fair algorithm (per round × slot):
 *   hash      = HMAC-SHA256(key=battle_seed,
 *                            msg=`${clientSeed}:${nonce}:${round}:${slot}:${eosBlockId}`)
 *   float01   = first 4 bytes of hash → [0, 1)
 *   biased    = biasCaseRollFloat(float01)            // house edge
 *   item      = pickWeightedItem(case, biased)
 *
 * where:
 *   - `battle_seed` = SHA-256(`${internal_seed}:${eos_block_id}`) — same for
 *     every roll in the battle (revealed only after the EOS block is mined).
 *   - `clientSeed`  = the player's `game_pf_seeds.client_seed` (shared across
 *     all games). Bots use the constant `BOT_CLIENT_SEED`.
 *   - `nonce`       = the player's starting `game_pf_seeds.next_nonce`, then
 *     +0, +1, … for each round. Bots use `slot * 1000 + round`.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { getEosBlock, getEosHead, waitForEosBlock } from "../_shared/eos.ts";
import {
  BOT_CLIENT_SEED,
  CASE_CATALOG,
  deriveBattleSeedFromEos,
  generateBattleSeed,
  getCaseById,
  hashSeed,
  payoutKeepMultiplier,
  type CaseItem,
  type LootCase,
} from "../_shared/caseBattles.ts";
import { biasCaseRollFloat } from "../_shared/rtp.ts";

// ─── Types ──────────────────────────────────────────────────────────────────

type Gamemode = "standard" | "group" | "terminal" | "jackpot";
type BattleStatus =
  | "waiting"
  | "committing"
  | "running"
  | "completed"
  | "cancelled";

type BattleRow = {
  id: string;
  creator_id: string;
  gamemode: Gamemode;
  player_mode: string;
  max_players: number;
  case_ids: string[];
  rounds: number;
  entry_cost: number;
  borrow_percent: number;
  pot_total: number;
  status: BattleStatus;
  internal_seed: string | null;
  seed_hash: string | null;
  eos_block_target: number | null;
  eos_block_id: string | null;
  battle_seed: string | null;
  started_at: string | null;
  completed_at: string | null;
};

type PlayerRow = {
  id: string;
  battle_id: string;
  user_id: string | null;
  slot: number;
  is_bot: boolean;
  username: string;
  avatar_seed: string | null;
};

type DropRow = {
  id: string;
  battle_id: string;
  slot: number;
  round: number;
  case_id: string;
  item_id: string;
  item_name: string;
  item_value: number;
  item_rarity: string;
};

type SeedInfo = {
  server_seed: string;
  client_seed: string;
  /** Starting nonce — the player's `next_nonce` BEFORE this battle consumed
   *  `rounds` nonces. Round `r` uses `startNonce + r`. */
  nonce: number;
};

type RoundDrop = {
  round: number;
  caseId: string;
  itemId: string;
  name: string;
  value: number;
  rarity: string;
};

type PlayerRoll = {
  slot: number;
  userId: string | null;
  isBot: boolean;
  displayName: string;
  clientSeed: string;
  startNonce: number;
  totalValue: number;
  lastRoundValue: number;
  drops: RoundDrop[];
};

type PayoutEntry = { slot: number; userId: string | null; amount: number };
type PayoutResult = {
  winnerSlots: number[];
  payouts: PayoutEntry[];
};

type ResolvedBattle = {
  rolls: PlayerRoll[];
  payouts: PayoutResult;
  battleSeed: string;
  eosBlockId: string;
};

// ─── Crypto / provably-fair helpers ─────────────────────────────────────────

/** Decode 4 bytes (little-endian) starting at `offset` into a float in [0,1). */
function bytesToFloat(bytes: Uint8Array, offset: number): number {
  let value = 0;
  for (let i = 0; i < 4; i++) {
    value += bytes[offset + i]! / Math.pow(256, i + 1);
  }
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

function pickWeightedItem(lootCase: LootCase, float01: number): CaseItem {
  const total = lootCase.items.reduce((s, i) => s + i.weight, 0);
  let cursor = float01 * total;
  for (const item of lootCase.items) {
    cursor -= item.weight;
    if (cursor < 0) return item;
  }
  return lootCase.items[lootCase.items.length - 1]!;
}

/**
 * Roll a single case item using the v2 provably-fair algorithm.
 *
 *   hash = HMAC-SHA256(battle_seed, `${clientSeed}:${nonce}:${round}:${slot}:${eosBlockId}`)
 *   f    = bytesToFloat(hash, 0)
 *   f'   = biasCaseRollFloat(f)         // house edge
 *   item = pickWeightedItem(case, f')
 */
async function rollItem(
  lootCase: LootCase,
  battleSeed: string,
  clientSeed: string,
  nonce: number,
  round: number,
  slot: number,
  eosBlockId: string
): Promise<CaseItem> {
  const hash = await hmacSha256(
    battleSeed,
    `${clientSeed}:${nonce}:${round}:${slot}:${eosBlockId}`
  );
  const f = biasCaseRollFloat(bytesToFloat(hash, 0));
  return pickWeightedItem(lootCase, f);
}

/** Pick a weighted-random index using a deterministic HMAC draw. */
async function pickWeightedIndex(
  weights: number[],
  seed: string,
  message: string
): Promise<number> {
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

// ─── Seed / DB helpers ──────────────────────────────────────────────────────

function parseSeedInfo(data: unknown): SeedInfo | null {
  const raw = (Array.isArray(data) ? data[0] : data) as
    | Record<string, unknown>
    | undefined;
  if (!raw) return null;
  const serverSeed = raw.server_seed ?? raw.serverSeed;
  if (typeof serverSeed !== "string" || !serverSeed) return null;
  return {
    server_seed: serverSeed,
    client_seed: String(raw.client_seed ?? raw.clientSeed ?? "default"),
    nonce: Number(raw.nonce ?? 0),
  };
}

/**
 * Consume `advance` nonces for the user and return their seed info.
 *
 * The RPC atomically advances `game_pf_seeds.next_nonce` by `advance` and
 * returns the row as it was BEFORE the advance — so the returned `nonce` is
 * the starting nonce for the next `advance` rolls.
 */
async function consumeNonce(
  admin: ReturnType<typeof createClient>,
  userId: string,
  advance: number
): Promise<SeedInfo> {
  const { data, error } = await admin.rpc("consume_keno_nonce", {
    p_user_id: userId,
    p_advance: advance,
  });
  if (error) throw new Error(`consume_keno_nonce: ${error.message}`);
  const info = parseSeedInfo(data);
  if (!info) throw new Error("Could not load provably-fair seeds.");
  return info;
}

async function loadBattle(
  admin: ReturnType<typeof createClient>,
  battleId: string
): Promise<{ battle: BattleRow; players: PlayerRow[] } | null> {
  const { data: battle, error } = await admin
    .from("case_battles")
    .select("*")
    .eq("id", battleId)
    .maybeSingle();
  if (error || !battle) return null;
  const { data: players, error: pErr } = await admin
    .from("case_battle_players")
    .select("*")
    .eq("battle_id", battleId)
    .order("slot", { ascending: true });
  if (pErr) {
    console.warn("[case-battle-v2] loadBattle players error:", pErr.message);
  }
  return {
    battle: battle as BattleRow,
    players: (players ?? []) as PlayerRow[],
  };
}

async function loadDrops(
  admin: ReturnType<typeof createClient>,
  battleId: string
): Promise<DropRow[]> {
  const { data, error } = await admin
    .from("case_battle_drops")
    .select("*")
    .eq("battle_id", battleId)
    .order("slot", { ascending: true })
    .order("round", { ascending: true });
  if (error) throw new Error(`loadDrops: ${error.message}`);
  return (data ?? []) as DropRow[];
}

/** Normalise `case_ids` from the DB row into a clean string array. */
function readCaseIds(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw === "string" && raw.length > 0) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch {
      /* fall through */
    }
  }
  return [];
}

// ─── Payout calculation ─────────────────────────────────────────────────────

/**
 * Compute payouts for a completed battle.
 *
 * Gamemodes + Crazy toggle:
 *   - standard (no crazy):  highest total item value wins the entire pot
 *   - standard + crazy:     LOWEST total item value wins (reversed)
 *   - group:                pot split equally among all HUMAN players (crazy N/A)
 *   - terminal (no crazy):  highest value in the LAST round only wins
 *   - terminal + crazy:     LOWEST value in the last round wins
 *   - jackpot (no crazy):   one weighted-random roll — odds ∝ each player's total value
 *   - jackpot + crazy:      odds REVERSED — lowest total has the HIGHEST chance
 *
 * `borrow_percent` is applied to every payout via `payoutKeepMultiplier`; the
 * borrowed portion is not returned (the house keeps it).
 */
async function computePayouts(
  params: {
    gamemode: Gamemode;
    crazy: boolean;
    potTotal: number;
    borrowPercent: number;
    battleSeed: string;
  },
  rolls: PlayerRoll[]
): Promise<PayoutResult> {
  const pot = Math.round(params.potTotal * 100) / 100;
  const keepMult = payoutKeepMultiplier(params.borrowPercent);

  if (rolls.length === 0 || pot <= 0) {
    return { winnerSlots: [], payouts: [] };
  }

  const applyKeep = (amount: number): number =>
    Math.round(amount * keepMult * 100) / 100;

  // ── Group: split the pot equally among all human players ─────────────────
  if (params.gamemode === "group") {
    const humans = rolls
      .filter((r) => !r.isBot && r.userId)
      .sort((a, b) => a.slot - b.slot);
    if (humans.length === 0) {
      return { winnerSlots: [], payouts: [] };
    }
    const each = Math.round((pot / humans.length) * 100) / 100;
    let distributed = 0;
    const payouts: PayoutEntry[] = [];
    for (let i = 0; i < humans.length; i++) {
      const h = humans[i]!;
      const share =
        i === humans.length - 1
          ? Math.round((pot - distributed) * 100) / 100
          : each;
      distributed += share;
      payouts.push({ slot: h.slot, userId: h.userId, amount: applyKeep(share) });
    }
    return {
      winnerSlots: humans.map((h) => h.slot),
      payouts,
    };
  }

  // ── Pick a single winner for non-group modes ─────────────────────────────
  let winnerSlot: number;

  if (params.gamemode === "jackpot") {
    // Weighted random — odds ∝ each player's total value (min tiny weight
    // so all-zero battles still resolve deterministically).
    // Crazy jackpot: REVERSED — lowest total gets the HIGHEST weight.
    // We invert by using 1/totalValue as the weight instead of totalValue.
    const weights = rolls.map((r) => {
      const v = Math.max(0.0001, r.totalValue);
      return params.crazy ? 1 / v : v;
    });
    const idx = await pickWeightedIndex(
      weights,
      params.battleSeed,
      "case-battle-v2-jackpot-winner"
    );
    winnerSlot = rolls[idx]!.slot;
  } else {
    const scoreOf =
      params.gamemode === "terminal"
        ? (r: PlayerRoll) => r.lastRoundValue
        : (r: PlayerRoll) => r.totalValue;
    // Crazy = pick min; normal = pick max
    const pickMax = !params.crazy;

    let bestIdx = 0;
    for (let i = 1; i < rolls.length; i++) {
      const a = scoreOf(rolls[i]!);
      const b = scoreOf(rolls[bestIdx]!);
      const better = pickMax ? a > b : a < b;
      // Tie → lower slot wins (deterministic).
      const tie = a === b && rolls[i]!.slot < rolls[bestIdx]!.slot;
      if (better || tie) bestIdx = i;
    }
    winnerSlot = rolls[bestIdx]!.slot;
  }

  const winner = rolls.find((r) => r.slot === winnerSlot)!;
  const payouts: PayoutEntry[] =
    !winner.isBot && winner.userId
      ? [{ slot: winnerSlot, userId: winner.userId, amount: applyKeep(pot) }]
      : [];
  return { winnerSlots: [winnerSlot], payouts };
}

// ─── Resolution ─────────────────────────────────────────────────────────────

/**
 * Resolve the entire battle: consume nonces for every human, roll every
 * (round, slot), insert drops, and transition running → completed.
 *
 * Caller MUST have already atomically transitioned the battle to `running`
 * (acting as a resolution lock). On failure we revert to `committing` so the
 * frontend can retry.
 */
async function resolveBattle(
  admin: ReturnType<typeof createClient>,
  battle: BattleRow,
  players: PlayerRow[],
  eosBlockId: string
): Promise<ResolvedBattle> {
  const internalSeed = battle.internal_seed;
  if (!internalSeed) throw new Error("Missing internal_seed");
  if (!eosBlockId) throw new Error("Missing eos_block_id");

  const battleSeed = await deriveBattleSeedFromEos(internalSeed, eosBlockId);
  const caseIds = readCaseIds(battle.case_ids);
  const rounds = Number(battle.rounds) || caseIds.length;

  if (caseIds.length === 0) throw new Error("Battle has no cases");
  if (caseIds.length !== rounds) {
    throw new Error(
      `case_ids length (${caseIds.length}) ≠ rounds (${rounds})`
    );
  }

  // Verify every case exists in the catalog before we touch any nonces.
  for (const id of caseIds) {
    if (!getCaseById(id)) throw new Error(`Unknown case: ${id}`);
  }

  // Consume `rounds` nonces for each human player. Bots skip this.
  const seedBySlot = new Map<number, SeedInfo>();
  for (const p of players) {
    if (!p.is_bot && p.user_id) {
      seedBySlot.set(p.slot, await consumeNonce(admin, p.user_id, rounds));
    }
  }

  // Roll every (round, slot).
  const rolls: PlayerRoll[] = [];
  for (const p of players) {
    const info = seedBySlot.get(p.slot);
    const clientSeed = info?.client_seed ?? BOT_CLIENT_SEED;
    const startNonce = info ? info.nonce : p.slot * 1000;

    const drops: RoundDrop[] = [];
    let total = 0;
    let lastValue = 0;
    for (let r = 0; r < rounds; r++) {
      const lootCase = getCaseById(caseIds[r]!)!;
      // Bots use a synthetic deterministic nonce; humans use startNonce + r.
      const nonce = info ? info.nonce + r : p.slot * 1000 + r;
      const item = await rollItem(
        lootCase,
        battleSeed,
        clientSeed,
        nonce,
        r,
        p.slot,
        eosBlockId
      );
      drops.push({
        round: r,
        caseId: caseIds[r]!,
        itemId: item.id,
        name: item.name,
        value: item.value,
        rarity: item.rarity,
      });
      total += item.value;
      lastValue = item.value;
    }

    rolls.push({
      slot: p.slot,
      userId: p.user_id,
      isBot: p.is_bot,
      displayName: p.username,
      clientSeed,
      startNonce,
      totalValue: Math.round(total * 100) / 100,
      lastRoundValue: Math.round(lastValue * 100) / 100,
      drops,
    });
  }
  rolls.sort((a, b) => a.slot - b.slot);

  // Insert drops in one batch. The unique(battle_id, slot, round) constraint
  // protects against duplicate inserts if two callers race here.
  const dropInserts = rolls.flatMap((r) =>
    r.drops.map((d) => ({
      battle_id: battle.id,
      slot: r.slot,
      round: d.round,
      case_id: d.caseId,
      item_id: d.itemId,
      item_name: d.name,
      item_value: d.value,
      item_rarity: d.rarity,
    }))
  );
  if (dropInserts.length > 0) {
    const { error: insErr } = await admin
      .from("case_battle_drops")
      .insert(dropInserts);
    if (insErr) {
      // 23505 = unique_violation — another caller already inserted these
      // drops. Treat as a successful resolve (the drops exist).
      if (insErr.code !== "23505") {
        throw new Error(`Insert drops: ${insErr.message}`);
      }
      console.warn(
        `[case-battle-v2] drops already inserted for battle=${battle.id} (race); continuing`
      );
    }
  }

  // Compute payouts.
  const payouts = await computePayouts(
    {
      gamemode: battle.gamemode,
      crazy: Boolean(battle.crazy),
      potTotal: Number(battle.pot_total),
      borrowPercent: Number(battle.borrow_percent),
      battleSeed,
    },
    rolls
  );

  // Finalise: running → completed. We hold the resolution lock (status=
  // running), so this should always update exactly one row. If it updates
  // zero rows, something else mutated the status mid-resolution — bail so
  // the caller can revert the lock and retry.
  const { data: completed, error: updErr } = await admin
    .from("case_battles")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      battle_seed: battleSeed,
      eos_block_id: eosBlockId,
    })
    .eq("id", battle.id)
    .eq("status", "running")
    .select("id")
    .maybeSingle();
  if (updErr) {
    throw new Error(`Mark completed: ${updErr.message}`);
  }
  if (!completed) {
    throw new Error(
      "Could not mark battle completed — status changed mid-resolution."
    );
  }

  return { rolls, payouts, battleSeed, eosBlockId };
}

// ─── Drop reconstruction (for `claim`) ──────────────────────────────────────

/** Reconstruct PlayerRoll[] from stored drops (no re-rolling — for payouts). */
function reconstructRolls(
  players: PlayerRow[],
  drops: DropRow[]
): PlayerRoll[] {
  const rolls: PlayerRoll[] = [];
  for (const p of players) {
    const playerDrops = drops
      .filter((d) => d.slot === p.slot)
      .sort((a, b) => a.round - b.round);
    const total = playerDrops.reduce((s, d) => s + Number(d.item_value), 0);
    const last =
      playerDrops.length > 0
        ? Number(playerDrops[playerDrops.length - 1]!.item_value)
        : 0;
    rolls.push({
      slot: p.slot,
      userId: p.user_id,
      isBot: p.is_bot,
      displayName: p.username,
      clientSeed: p.is_bot ? BOT_CLIENT_SEED : "",
      startNonce: 0,
      totalValue: Math.round(total * 100) / 100,
      lastRoundValue: Math.round(last * 100) / 100,
      drops: playerDrops.map((d) => ({
        round: d.round,
        caseId: d.case_id,
        itemId: d.item_id,
        name: d.item_name,
        value: Number(d.item_value),
        rarity: d.item_rarity,
      })),
    });
  }
  return rolls;
}

// ─── Action handlers ────────────────────────────────────────────────────────

/**
 * `start` — the creator commits the battle to an upcoming EOS block.
 *
 * 1. Verify caller is the creator.
 * 2. Generate `internal_seed` (32 random bytes hex).
 * 3. `seed_hash` = SHA-256(internal_seed).
 * 4. Fetch EOS head; `eos_block_target` = head + 2.
 * 5. Transition status `waiting` → `committing`.
 * 6. Verify the pot (entry_cost × num_players) — debits are expected to have
 *    happened in `cb_create_battle` / `cb_join_battle`.
 * 7. Return `{ seedHash, eosBlockTarget }`.
 */
async function handleStart(
  admin: ReturnType<typeof createClient>,
  user: { id: string },
  body: { battleId?: unknown }
) {
  const battleId = String(body.battleId ?? "");
  if (!battleId) return jsonResponse({ error: "Battle id required." }, 400);

  const loaded = await loadBattle(admin, battleId);
  if (!loaded) return jsonResponse({ error: "Battle not found." }, 404);
  const { battle, players } = loaded;

  // ── Authorization ──────────────────────────────────────────────────────
  if (battle.creator_id !== user.id) {
    return jsonResponse(
      { error: "Only the creator can start the battle." },
      403
    );
  }

  if (battle.status !== "waiting") {
    return jsonResponse(
      { error: `Battle is already ${battle.status}.` },
      400
    );
  }

  if (players.length < 2) {
    return jsonResponse(
      { error: "Need at least 2 players to start." },
      400
    );
  }

  // ── Verify the pot reflects every player's entry fee ───────────────────
  const expectedPot =
    Math.round(Number(battle.entry_cost) * players.length * 100) / 100;
  const actualPot = Math.round(Number(battle.pot_total) * 100) / 100;
  if (expectedPot !== actualPot) {
    console.warn(
      `[case-battle-v2] pot mismatch battle=${battleId} expected=${expectedPot} actual=${actualPot}`
    );
    return jsonResponse(
      {
        error:
          "Pot total does not match entry fees. Refusing to start — please retry.",
      },
      400
    );
  }

  // ── Generate seed commitment ───────────────────────────────────────────
  const internalSeed = generateBattleSeed();
  const seedHash = await hashSeed(internalSeed);

  // ── Fetch EOS head block ───────────────────────────────────────────────
  let head;
  try {
    head = await getEosHead();
  } catch (err) {
    console.error("[case-battle-v2] EOS head fetch failed:", err);
    return jsonResponse(
      { error: "Could not reach EOS RPC. Please retry." },
      502
    );
  }
  const eosBlockTarget = head.blockNum + 2;

  // ── Persist commitment ─────────────────────────────────────────────────
  const { data: updated, error: updErr } = await admin
    .from("case_battles")
    .update({
      internal_seed: internalSeed,
      seed_hash: seedHash,
      eos_block_target: eosBlockTarget,
      status: "committing",
      started_at: new Date().toISOString(),
    })
    .eq("id", battleId)
    .eq("status", "waiting")
    .select("id")
    .maybeSingle();

  if (updErr) {
    console.error("[case-battle-v2] start update failed:", updErr);
    return jsonResponse({ error: updErr.message }, 500);
  }
  if (!updated) {
    // Lost a race with another `start` caller — reload and respond.
    const fresh = await loadBattle(admin, battleId);
    if (fresh?.battle.status === "committing") {
      return jsonResponse({
        battleId,
        seedHash: fresh.battle.seed_hash,
        eosBlockTarget: fresh.battle.eos_block_target,
        status: "committing",
      });
    }
    return jsonResponse(
      { error: `Battle is no longer waiting (status=${fresh?.battle.status}).` },
      409
    );
  }

  console.log(
    `[case-battle-v2] started battle=${battleId} eosTarget=${eosBlockTarget} seedHash=${seedHash.slice(0, 16)}…`
  );

  return jsonResponse({
    battleId,
    seedHash,
    eosBlockTarget,
    status: "committing",
  });
}

/**
 * `check_eos` — frontend polls while status='committing'.
 *
 * 1. If status is 'completed', short-circuit `{ready:true}`.
 * 2. Fetch the EOS block at `eos_block_target`. If not mined yet, return
 *    `{ready:false}`.
 * 3. Atomically transition `committing` → `running` (acts as a resolution
 *    lock so concurrent callers can't double-resolve).
 * 4. Resolve every round × slot, insert drops, compute payouts.
 * 5. Transition `running` → `completed`.
 * 6. Return `{ready:true, status:'completed', drops, payouts, ...}`.
 *
 * On any failure during resolution we revert `running` → `committing` so the
 * frontend can retry on the next poll.
 */
async function handleCheckEos(
  admin: ReturnType<typeof createClient>,
  body: { battleId?: unknown }
) {
  const battleId = String(body.battleId ?? "");
  if (!battleId) return jsonResponse({ error: "Battle id required." }, 400);

  const loaded = await loadBattle(admin, battleId);
  if (!loaded) return jsonResponse({ error: "Battle not found." }, 404);
  const { battle, players } = loaded;

  // ── Idempotency: already completed ─────────────────────────────────────
  if (battle.status === "completed") {
    const drops = await loadDrops(admin, battleId);
    return jsonResponse({
      ready: true,
      status: "completed",
      battleId,
      eosBlockId: battle.eos_block_id,
      drops: drops.map((d) => ({
        slot: d.slot,
        round: d.round,
        caseId: d.case_id,
        itemId: d.item_id,
        itemName: d.item_name,
        itemValue: Number(d.item_value),
        itemRarity: d.item_rarity,
      })),
    });
  }

  if (battle.status !== "committing" && battle.status !== "running") {
    return jsonResponse(
      {
        error: `Battle status is '${battle.status}', expected 'committing'.`,
      },
      400
    );
  }

  // If another caller is mid-resolution, tell the frontend to keep polling.
  if (battle.status === "running") {
    return jsonResponse({ ready: false, status: "running", battleId });
  }

  const targetBlock = battle.eos_block_target;
  if (!targetBlock || !Number.isFinite(targetBlock)) {
    return jsonResponse(
      { error: "No EOS target block set — call `start` first." },
      400
    );
  }

  // ── Check EOS head ─────────────────────────────────────────────────────
  let head;
  try {
    head = await getEosHead();
  } catch (err) {
    console.error("[case-battle-v2] EOS head fetch failed:", err);
    return jsonResponse({
      ready: false,
      status: "committing",
      battleId,
      eosBlockTarget: targetBlock,
    });
  }

  if (head.blockNum < targetBlock) {
    return jsonResponse({
      ready: false,
      status: "committing",
      battleId,
      eosBlockTarget: targetBlock,
      eosHead: head.blockNum,
    });
  }

  // ── Fetch the target block ─────────────────────────────────────────────
  let block;
  try {
    block = await getEosBlock(targetBlock);
  } catch (err) {
    console.warn("[case-battle-v2] getEosBlock failed, retrying:", err);
    try {
      block = await waitForEosBlock(targetBlock, 4000);
    } catch (err2) {
      console.error("[case-battle-v2] waitForEosBlock failed:", err2);
    }
  }
  if (!block) {
    return jsonResponse({
      ready: false,
      status: "committing",
      battleId,
      eosBlockTarget: targetBlock,
    });
  }
  const eosBlockId = block.id;

  // ── Acquire the resolution lock (committing → running) ─────────────────
  const { data: locked, error: lockErr } = await admin
    .from("case_battles")
    .update({ status: "running" })
    .eq("id", battleId)
    .eq("status", "committing")
    .select("id")
    .maybeSingle();

  if (lockErr) {
    console.error("[case-battle-v2] lock update failed:", lockErr);
    return jsonResponse({ error: lockErr.message }, 500);
  }
  if (!locked) {
    // Another caller beat us — either they're resolving or already done.
    const fresh = await loadBattle(admin, battleId);
    if (fresh?.battle.status === "completed") {
      return jsonResponse({
        ready: true,
        status: "completed",
        battleId,
        eosBlockId: fresh.battle.eos_block_id,
      });
    }
    // Still resolving — ask the frontend to retry shortly.
    return jsonResponse({ ready: false, status: "running", battleId });
  }

  // ── Resolve ────────────────────────────────────────────────────────────
  let resolved: ResolvedBattle;
  try {
    // Re-load to pick up internal_seed (it's already on `battle`, but be
    // explicit about which row we're resolving).
    resolved = await resolveBattle(admin, battle, players, eosBlockId);
  } catch (err) {
    console.error(
      `[case-battle-v2] resolveBattle failed battle=${battleId}:`,
      err
    );
    // Release the lock so the next poll can retry.
    await admin
      .from("case_battles")
      .update({ status: "committing" })
      .eq("id", battleId)
      .eq("status", "running");
    return jsonResponse(
      {
        error:
          err instanceof Error
            ? err.message
            : "Battle resolution failed — please retry.",
      },
      500
    );
  }

  const { rolls, payouts, battleSeed } = resolved;

  console.log(
    `[case-battle-v2] resolved battle=${battleId} gamemode=${battle.gamemode} winners=[${payouts.winnerSlots.join(",")}] payouts=${payouts.payouts.length}`
  );

  return jsonResponse({
    ready: true,
    status: "completed",
    battleId,
    eosBlockId,
    battleSeed,
    drops: rolls.flatMap((r) =>
      r.drops.map((d) => ({
        slot: r.slot,
        round: d.round,
        caseId: d.caseId,
        itemId: d.itemId,
        itemName: d.name,
        itemValue: d.value,
        itemRarity: d.rarity,
      }))
    ),
    players: rolls.map((r) => ({
      slot: r.slot,
      userId: r.userId,
      isBot: r.isBot,
      displayName: r.displayName,
      totalValue: r.totalValue,
      lastRoundValue: r.lastRoundValue,
    })),
    winnerSlots: payouts.winnerSlots,
    payouts: payouts.payouts,
  });
}

/**
 * `claim` — a winner credits their payout to their balance.
 *
 * 1. Verify the caller owns the slot they're claiming.
 * 2. Recompute payouts from the stored drops (v2 schema has no payouts column
 *    — payouts are deterministic from the drops + battle config).
 * 3. Call `cb_claim_payout(battle_id, slot, amount)` RPC.
 * 4. Return `{ balance: newBalance }`.
 *
 * NOTE: the v2 `cb_claim_payout` SQL doesn't track "already claimed" state,
 * so a duplicate claim would double-credit. The frontend must guard against
 * this (e.g. disable the claim button after success). The RPC itself enforces
 * only that the caller owns the slot.
 */
async function handleClaim(
  admin: ReturnType<typeof createClient>,
  user: { id: string },
  body: { battleId?: unknown; slot?: unknown }
) {
  const battleId = String(body.battleId ?? "");
  const slot = Number(body.slot);
  if (!battleId) return jsonResponse({ error: "Battle id required." }, 400);
  if (!Number.isInteger(slot) || slot < 0 || slot > 5) {
    return jsonResponse({ error: "Invalid slot." }, 400);
  }

  const loaded = await loadBattle(admin, battleId);
  if (!loaded) return jsonResponse({ error: "Battle not found." }, 404);
  const { battle, players } = loaded;

  if (battle.status !== "completed") {
    return jsonResponse({ error: "Battle not completed." }, 400);
  }

  // ── Caller must own this slot ──────────────────────────────────────────
  const player = players.find((p) => p.slot === slot);
  if (!player) {
    return jsonResponse({ error: "Player not found in this battle." }, 404);
  }
  if (player.is_bot || !player.user_id || player.user_id !== user.id) {
    return jsonResponse(
      { error: "You can only claim your own payout." },
      403
    );
  }

  // ── Recompute payouts from the stored drops ────────────────────────────
  if (!battle.battle_seed) {
    return jsonResponse(
      { error: "Battle seed not set — resolution incomplete." },
      400
    );
  }

  const drops = await loadDrops(admin, battleId);
  if (drops.length === 0) {
    return jsonResponse(
      { error: "No drops recorded for this battle." },
      400
    );
  }
  const rolls = reconstructRolls(players, drops);

  const payouts = await computePayouts(
    {
      gamemode: battle.gamemode,
      crazy: Boolean(battle.crazy),
      potTotal: Number(battle.pot_total),
      borrowPercent: Number(battle.borrow_percent),
      battleSeed: battle.battle_seed,
    },
    rolls
  );

  const payout = payouts.payouts.find((p) => p.slot === slot);
  if (!payout || payout.amount <= 0) {
    return jsonResponse(
      { error: "No payout available for this slot." },
      400
    );
  }

  // ── Call the payout RPC ────────────────────────────────────────────────
  const { data, error } = await admin.rpc("cb_claim_payout", {
    p_battle_id: battleId,
    p_slot: slot,
    p_amount: payout.amount,
  });

  if (error) {
    console.error(
      `[case-battle-v2] cb_claim_payout failed battle=${battleId} slot=${slot}:`,
      error
    );
    return jsonResponse({ error: error.message }, 400);
  }

  // RPC returns the new balance as a numeric.
  const row = (Array.isArray(data) ? data[0] : data) as
    | { cb_claim_payout?: number }
    | number
    | null;
  const newBalance =
    typeof row === "number"
      ? row
      : Number((row as { cb_claim_payout?: number })?.cb_claim_payout ?? 0);

  console.log(
    `[case-battle-v2] claim battle=${battleId} slot=${slot} amount=${payout.amount} newBalance=${newBalance}`
  );

  return jsonResponse({
    balance: newBalance,
    amount: payout.amount,
    slot,
    battleId,
  });
}

// ─── Public catalog action ──────────────────────────────────────────────────

function handleCatalog() {
  return jsonResponse({ cases: CASE_CATALOG });
}

// ─── Entry point ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(req) });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, req);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400, req);
  }

  const action = String(body?.action ?? "");

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // ── Public action: catalog (no auth needed) ─────────────────────────────
  if (action === "catalog") {
    return handleCatalog();
  }

  // ── Authenticate everything else ────────────────────────────────────────
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ error: "Log in required." }, 401, req);
  }

  const supabaseUser = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const {
    data: { user },
    error: userError,
  } = await supabaseUser.auth.getUser();
  if (userError || !user) {
    return jsonResponse({ error: "Invalid session." }, 401, req);
  }

  try {
    if (action === "start") {
      return await handleStart(admin, user, body);
    }
    if (action === "check_eos") {
      return await handleCheckEos(admin, body);
    }
    if (action === "claim") {
      return await handleClaim(admin, user, body);
    }
    return jsonResponse({ error: "Unknown action." }, 400, req);
  } catch (err) {
    console.error("[case-battle-v2] unhandled error:", err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Server error." },
      500,
      req
    );
  }
});
