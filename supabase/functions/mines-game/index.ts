import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import {
  generateMinesBoard,
  getMinesMultiplier,
  getMaxGems,
  validateMinesStart,
  validateMinesTile,
} from "../_shared/mines.ts";
import { retainStakeStyleWin } from "../_shared/rtp.ts";
import { rtpBiasFloat } from "../_shared/rtpBias.ts";

type MinesAction = "start" | "reveal" | "cashout" | "active";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "Log in required." }, 401);

    const body = await req.json();
    const action = String(body?.action ?? "") as MinesAction;
    const coinType = String(body?.coinType ?? "balance");

    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const {
      data: { user },
      error: userError,
    } = await supabaseUser.auth.getUser();

    if (userError || !user) return jsonResponse({ error: "Invalid session." }, 401);

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: excluded } = await supabaseAdmin.rpc("check_user_self_exclusion", {
      p_user_id: user.id,
    });
    if (excluded) {
      return jsonResponse({ error: "Your account is self-excluded." }, 403);
    }

    const coinColumn = coinType === "sweeps_coins" ? "sweeps_coins" : "balance";

    if (action === "active") {
      const { data, error } = await supabaseAdmin.rpc("get_active_mines_game", {
        p_user_id: user.id,
      });
      if (error) return jsonResponse({ error: error.message }, 400);
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
      });
    }

    if (action === "start") {
      const wager = Number(body?.wager);
      const mineCount = Number(body?.mineCount ?? body?.mine_count);

      const validationError = validateMinesStart(mineCount, wager);
      if (validationError) return jsonResponse({ error: validationError }, 400);

      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select(coinColumn)
        .eq("id", user.id)
        .maybeSingle();

      const balance = Number(profile?.[coinColumn as keyof typeof profile] ?? 0);
      if (balance < wager) {
        return jsonResponse({ error: "Insufficient balance" }, 400);
      }

      const { data: seedData, error: seedError } = await supabaseAdmin.rpc(
        "consume_keno_nonce",
        { p_user_id: user.id, p_advance: 1 }
      );

      if (seedError) {
        console.error("consume_keno_nonce:", seedError);
        return jsonResponse({ error: seedError.message ?? "Could not load game seeds." }, 500);
      }

      const raw = (Array.isArray(seedData) ? seedData[0] : seedData) as
        | Record<string, unknown>
        | undefined;
      const serverSeed = raw?.server_seed ?? raw?.serverSeed;
      const clientSeed = raw?.client_seed ?? raw?.clientSeed ?? "default";
      const nonce = Number(raw?.nonce ?? raw?.next_nonce ?? 0);

      if (typeof serverSeed !== "string" || !serverSeed) {
        return jsonResponse({ error: "Could not load game seeds." }, 500);
      }

      const mineTiles = await generateMinesBoard({
        serverSeed,
        clientSeed: String(clientSeed),
        nonce,
        mineCount,
      });

      const { data: started, error: startError } = await supabaseAdmin.rpc(
        "start_mines_game",
        {
          p_user_id: user.id,
          p_wager: wager,
          p_mine_count: mineCount,
          p_mine_tiles: mineTiles,
          p_nonce: nonce,
          p_coin_type: coinType,
        }
      );

      if (startError) {
        console.error("start_mines_game:", startError);
        return jsonResponse({ error: startError.message }, 400);
      }

      const result = (Array.isArray(started) ? started[0] : started) as
        | Record<string, unknown>
        | undefined;

      return jsonResponse({
        gameId: result?.game_id,
        balance: Number(result?.out_balance ?? balance - wager),
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
      if (tileError) return jsonResponse({ error: tileError }, 400);
      if (!gameId) return jsonResponse({ error: "Game id required." }, 400);

      const { data: gameRow } = await supabaseAdmin
        .from("mines_games")
        .select("mine_tiles, revealed_tiles, nonce")
        .eq("id", gameId)
        .eq("user_id", user.id)
        .eq("status", "active")
        .maybeSingle();

      if (!gameRow) return jsonResponse({ error: "Active game not found." }, 400);

      const mineTiles = (gameRow.mine_tiles as number[]) ?? [];
      const fairMine = mineTiles.includes(tile);
      let forceMine = false;

      if (!fairMine) {
        const { data: pf } = await supabaseAdmin
          .from("game_pf_seeds")
          .select("server_seed, client_seed")
          .eq("user_id", user.id)
          .maybeSingle();
        const serverSeed = pf?.server_seed;
        const clientSeed = String(pf?.client_seed ?? "default");
        const revealed = (gameRow.revealed_tiles as number[]) ?? [];
        if (typeof serverSeed === "string" && serverSeed) {
          const bias = await rtpBiasFloat(
            serverSeed,
            clientSeed,
            Number(gameRow.nonce ?? 0),
            `mines-${gameId}-${revealed.length}-${tile}`
          );
          forceMine = !retainStakeStyleWin(bias);
        }
      }

      const { data: revealed, error: revealError } = await supabaseAdmin.rpc(
        "mines_reveal_tile",
        {
          p_user_id: user.id,
          p_game_id: gameId,
          p_tile: tile,
          p_force_mine: forceMine,
        }
      );

      if (revealError) {
        console.error("mines_reveal_tile:", revealError);
        return jsonResponse({ error: revealError.message }, 400);
      }

      const row = (Array.isArray(revealed) ? revealed[0] : revealed) as
        | Record<string, unknown>
        | undefined;

      const isMine = Boolean(row?.is_mine);
      const gemsRevealed = Number(row?.gems_revealed ?? 0);
      const multiplier = Number(row?.multiplier ?? 1);
      const status = String(row?.status ?? "active");
      const mineTiles = (row?.mine_tiles as number[] | null) ?? [];
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
        mineTiles: isMine ? mineTiles : undefined,
        nextMultiplier:
          status === "active" && gameMineCount > 0
            ? getMinesMultiplier(gameMineCount, gemsRevealed + 1)
            : undefined,
      });
    }

    if (action === "cashout") {
      const gameId = String(body?.gameId ?? body?.game_id ?? "");
      if (!gameId) return jsonResponse({ error: "Game id required." }, 400);

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
        return jsonResponse({ error: cashError.message }, 400);
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

    return jsonResponse({ error: "Unknown action." }, 400);
  } catch (err) {
    console.error("mines-game:", err);
    return jsonResponse({ error: "Server error." }, 500);
  }
});
