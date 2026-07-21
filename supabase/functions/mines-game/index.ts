import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import {
  generateMinesBoard,
  getMinesMultiplier,
  getMaxGems,
  validateMinesStart,
  validateMinesTile,
} from "../_shared/mines.ts";
import { extractClientRequestId } from "../_shared/hardened.ts";

type MinesAction = "start" | "reveal" | "cashout" | "active";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(req) });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, req);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "Log in required." }, 401, req);

    const body = await req.json();
    const action = String(body?.action ?? "") as MinesAction;
    const coinType = String(body?.coinType ?? "balance");
    const clientRequestId = extractClientRequestId(body ?? null);

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

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Self-exclusion check is now enforced inside every placer SQL function
    // via reject_if_self_excluded (defense-in-depth). The redundant edge-side
    // exclusion check was removed; balance is no longer read here either —
    // SQL debits atomically with SELECT FOR UPDATE.

    if (action === "active") {
      const { data, error } = await supabaseAdmin.rpc("get_active_mines_game", {
        p_user_id: user.id,
      });
      if (error) return jsonResponse({ error: error.message }, 400, req);
      const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
      if (!row?.game_id) {
        return jsonResponse({ active: false });
      }
      return jsonResponse({
        active: true,
        gameId: row.game_id,
        wager: Number(row.wager),
        mineCount: Number(row.mine_count),
        revealedTiles: (row.revealed_tiles as number[]) ?? [],
        gemsRevealed: Number(row.gems_revealed ?? 0),
        multiplier: Number(row.multiplier ?? 1),
        status: String(row.status),
        coinType: String(row.coin_type ?? "balance"),
      });
    }

    if (action === "start") {
      const wager = Number(body?.wager);
      const mineCount = Number(body?.mineCount ?? body?.mine_count);

      const validationError = validateMinesStart(mineCount, wager);
      if (validationError) return jsonResponse({ error: validationError }, 400, req);

      // Edge-side balance read removed — place_mines_bet does the atomic
      // check + debit (with stale-game auto-cancel + ON CONFLICT idempotency).
      const { data: seedData, error: seedError } = await supabaseAdmin.rpc(
        "consume_keno_nonce",
        { p_user_id: user.id, p_advance: 1 }
      );

      if (seedError) {
        console.error("consume_keno_nonce:", seedError);
        return jsonResponse({ error: seedError.message ?? "Could not load game seeds." }, 500, req);
      }

      const raw = (Array.isArray(seedData) ? seedData[0] : seedData) as
        | Record<string, unknown>
        | undefined;
      const serverSeed = raw?.server_seed ?? raw?.serverSeed;
      const clientSeed = raw?.client_seed ?? raw?.clientSeed ?? "default";
      const nonce = Number(raw?.nonce ?? raw?.next_nonce ?? 0);

      if (typeof serverSeed !== "string" || !serverSeed) {
        return jsonResponse({ error: "Could not load game seeds." }, 500, req);
      }

      const mineTiles = await generateMinesBoard({
        serverSeed,
        clientSeed: String(clientSeed),
        nonce,
        mineCount,
      });

      const { data: placed, error: placeError } = await supabaseAdmin.rpc(
        "place_mines_bet",
        {
          p_user_id: user.id,
          p_wager: wager,
          p_mine_count: mineCount,
          p_mine_tiles: mineTiles,
          p_nonce: nonce,
          p_coin_type: coinType,
          p_client_request_id: clientRequestId,
        }
      );

      if (placeError) {
        console.error("place_mines_bet:", placeError);
        return jsonResponse({ error: placeError.message }, 400, req);
      }

      const result = (Array.isArray(placed) ? placed[0] : placed) as
        | Record<string, unknown>
        | undefined;

      return jsonResponse({
        gameId: result?.game_id ?? result?.bet_id,
        balance: Number(result?.out_balance ?? 0),
        coinType,
        mineCount,
        wager,
        maxGems: getMaxGems(mineCount),
        nonce,
      });
    }

    if (action === "reveal") {
      const gameId = String(body?.gameId ?? body?.game_id ?? "");
      const tile = Number(body?.tile);

      const tileError = validateMinesTile(tile);
      if (tileError) return jsonResponse({ error: tileError }, 400, req);
      if (!gameId) return jsonResponse({ error: "Game id required." }, 400, req);

      // RTP is baked into the multiplier formula (MINES_HOUSE_EDGE = 0.965
      // in _shared/mines.ts and the mines_reveal_tile SQL function) — reveal
      // is fair, no per-tile or resolution-time bias roll is needed.
      const { data: revealed, error: revealError } = await supabaseAdmin.rpc(
        "mines_reveal_tile",
        {
          p_user_id: user.id,
          p_game_id: gameId,
          p_tile: tile,
          p_force_mine: false,
        }
      );

      if (revealError) {
        console.error("mines_reveal_tile:", revealError);
        return jsonResponse({ error: revealError.message }, 400, req);
      }

      const row = (Array.isArray(revealed) ? revealed[0] : revealed) as
        | Record<string, unknown>
        | undefined;

      const isMine = Boolean(row?.is_mine);
      const gemsRevealed = Number(row?.gems_revealed ?? 0);
      const multiplier = Number(row?.multiplier ?? 1);
      const status = String(row?.status ?? "active");
      const resultMineTiles = (row?.mine_tiles as number[] | null) ?? [];
      const gameMineCount = Number(row?.mine_count ?? body?.mineCount ?? 0);

      return jsonResponse({
        gameId,
        tile,
        isMine,
        gemsRevealed,
        multiplier,
        status,
        balance: Number(row?.out_balance ?? 0),
        coinType,
        payout: Number(row?.payout ?? 0),
        mineTiles: isMine ? resultMineTiles : undefined,
        nextMultiplier:
          status === "active" && gameMineCount > 0
            ? getMinesMultiplier(gameMineCount, gemsRevealed + 1)
            : undefined,
      });
    }

    if (action === "cashout") {
      const gameId = String(body?.gameId ?? body?.game_id ?? "");
      if (!gameId) return jsonResponse({ error: "Game id required." }, 400, req);

      // RTP is baked into the multiplier formula (MINES_HOUSE_EDGE = 0.965
      // in _shared/mines.ts and the mines_reveal_tile SQL function). Cashout
      // is a straight payout of wager × stored multiplier — no separate
      // resolution-time bias roll. Matches local-play (`binomial(25,g)/binomial(25-m,g) * GAME_RTP`).
      const { data: cashed, error: cashError } = await supabaseAdmin.rpc(
        "mines_cashout",
        {
          p_user_id: user.id,
          p_game_id: gameId,
          p_coin_type: coinType,
        }
      );

      if (cashError) {
        console.error("mines_cashout:", cashError);
        return jsonResponse({ error: cashError.message }, 400, req);
      }

      const row = (Array.isArray(cashed) ? cashed[0] : cashed) as
        | Record<string, unknown>
        | undefined;

      const payout = Number(row?.payout ?? 0);
      const multiplier = Number(row?.multiplier ?? 1);

      const wager = Number(row?.wager ?? 0);

      return jsonResponse({
        gameId,
        status: "cashed_out",
        payout,
        multiplier,
        gemsRevealed: Number(row?.gems_revealed ?? 0),
        balance: Number(row?.out_balance ?? 0),
        coinType,
        wager,
        profit: payout - wager,
      });
    }

    return jsonResponse({ error: "Unknown action." }, 400, req);
  } catch (err) {
    console.error("mines-game:", err);
    return jsonResponse({ error: "Server error." }, 500, req);
  }
});
