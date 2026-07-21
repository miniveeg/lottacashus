import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import {
  clientHandPayload,
  dealNewHand,
  doubleHand,
  handsToJson,
  hitCard,
  insuranceAmount,
  resolveInsurance,
  splitHand,
  standHand,
  stateFromRow,
  validateWager,
} from "../_shared/blackjack.ts";
import { rtpBiasFloat } from "../_shared/rtpBias.ts";

type HandRow = {
  id: string;
  shoe: number[];
  shoe_index: number;
  player_cards: number[];
  dealer_cards: number[];
  wager: number;
  total_wager: number;
  doubled: boolean;
  dealer_revealed: boolean;
  phase?: string;
  insurance_wager?: number;
  insurance_taken?: boolean;
  insurance_decided?: boolean;
  is_split?: boolean;
  player_hands?: unknown;
  active_hand_index?: number;
  nonce: number;
};

async function handRtpBiasFn(
  admin: ReturnType<typeof createClient>,
  userId: string,
  handId: string,
  nonce: number,
  handCount: number
): Promise<(handIndex: number) => number | undefined> {
  const { data: pf } = await admin
    .from("game_pf_seeds")
    .select("server_seed, client_seed")
    .eq("user_id", userId)
    .maybeSingle();
  const serverSeed = pf?.server_seed;
  const clientSeed = String(pf?.client_seed ?? "default");
  if (typeof serverSeed !== "string" || !serverSeed) {
    return () => undefined;
  }
  const biases = await Promise.all(
    Array.from({ length: handCount }, (_, i) =>
      rtpBiasFloat(serverSeed, clientSeed, nonce, `bj-${handId}-${i}`)
    )
  );
  return (i: number) => biases[i];
}

async function loadHand(
  admin: ReturnType<typeof createClient>,
  userId: string,
  handId: string
): Promise<HandRow | null> {
  const { data, error } = await admin
    .from("blackjack_hands")
    .select(
      "id, shoe, shoe_index, player_cards, dealer_cards, wager, total_wager, doubled, dealer_revealed, phase, insurance_wager, insurance_taken, insurance_decided, is_split, player_hands, active_hand_index, nonce"
    )
    .eq("id", handId)
    .eq("user_id", userId)
    .eq("status", "player_turn")
    .maybeSingle();

  if (error || !data) return null;
  return data as HandRow;
}

async function saveProgress(
  admin: ReturnType<typeof createClient>,
  userId: string,
  handId: string,
  state: ReturnType<typeof stateFromRow>
) {
  return admin.rpc("blackjack_update_active", {
    p_user_id: userId,
    p_hand_id: handId,
    p_player_cards: state.playerCards,
    p_shoe_index: state.shoeIndex,
    p_player_hands: handsToJson(state.playerHands),
    p_active_hand_index: state.activeHandIndex,
    p_is_split: state.isSplit,
    p_phase: state.phase,
    p_total_wager: state.totalWager,
    p_doubled: state.doubled,
    p_insurance_wager: state.insuranceWager,
    p_insurance_taken: state.insuranceTaken,
    p_insurance_decided: state.insuranceDecided,
  });
}

async function finishHand(
  admin: ReturnType<typeof createClient>,
  userId: string,
  handId: string,
  state: ReturnType<typeof stateFromRow>,
  outcome: string | null,
  payout: number,
  extraWager = 0,
  coinType = "balance"
) {
  return admin.rpc("blackjack_finish_hand", {
    p_user_id: userId,
    p_hand_id: handId,
    p_player_cards: state.playerCards,
    p_dealer_cards: state.dealerCards,
    p_shoe_index: state.shoeIndex,
    p_doubled: state.doubled,
    p_total_wager: state.totalWager,
    p_dealer_revealed: state.dealerRevealed,
    p_outcome: outcome,
    p_payout: payout,
    p_extra_wager: extraWager,
    p_phase: "settled",
    p_player_hands: handsToJson(state.playerHands),
    p_is_split: state.isSplit,
    p_active_hand_index: state.activeHandIndex,
    p_insurance_wager: state.insuranceWager,
    p_insurance_taken: state.insuranceTaken,
    p_coin_type: coinType,
  });
}

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
    const action = String(body?.action ?? "");
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

    if (userError || !user) return jsonResponse({ error: "Invalid session." }, 401, req);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: excluded } = await admin.rpc("check_user_self_exclusion", {
      p_user_id: user.id,
    });
    if (excluded) {
      return jsonResponse({ error: "Your account is self-excluded." }, 403, req);
    }

    const coinColumn = coinType === "sweeps_coins" ? "sweeps_coins" : "balance";

    if (action === "active") {
      const { data: row, error } = await admin
        .from("blackjack_hands")
        .select(
          "id, wager, total_wager, doubled, player_cards, dealer_cards, dealer_revealed, phase, insurance_wager, insurance_taken, insurance_decided, is_split, player_hands, active_hand_index"
        )
        .eq("user_id", user.id)
        .eq("status", "player_turn")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) return jsonResponse({ error: error.message }, 400, req);
      if (!row) return jsonResponse({ active: false });

      const state = stateFromRow({
        shoe: [],
        shoe_index: 0,
        player_cards: row.player_cards,
        dealer_cards: row.dealer_cards,
        wager: Number(row.wager),
        total_wager: Number(row.total_wager),
        doubled: Boolean(row.doubled),
        dealer_revealed: Boolean(row.dealer_revealed),
        phase: row.phase,
        insurance_wager: row.insurance_wager,
        insurance_taken: row.insurance_taken,
        insurance_decided: row.insurance_decided,
        is_split: row.is_split,
        player_hands: row.player_hands,
        active_hand_index: row.active_hand_index,
      });

      return jsonResponse({
        active: true,
        handId: row.id,
        wager: Number(row.wager),
        status: row.phase === "insurance_offer" ? "insurance_offer" : "player_turn",
        ...clientHandPayload(state),
      });
    }

    if (action === "start") {
      const wager = Number(body?.wager);
      const err = validateWager(wager);
      if (err) return jsonResponse({ error: err }, 400, req);

      const { data: profile } = await admin
        .from("profiles")
        .select("balance, sweeps_coins")
        .eq("id", user.id)
        .maybeSingle();

      const bal = coinType === "sweeps_coins" ? Number(profile?.sweeps_coins ?? 0) : Number(profile?.balance ?? 0);
      if (bal < wager) {
        return jsonResponse({ error: "Insufficient balance" }, 400, req);
      }

      const { data: seedData, error: seedError } = await admin.rpc("consume_keno_nonce", {
        p_user_id: user.id,
        p_advance: 1,
      });

      if (seedError) return jsonResponse({ error: seedError.message }, 500, req);

      const raw = (Array.isArray(seedData) ? seedData[0] : seedData) as
        | Record<string, unknown>
        | undefined;
      const serverSeed = raw?.server_seed ?? raw?.serverSeed;
      const clientSeed = String(raw?.client_seed ?? raw?.clientSeed ?? "default");
      const nonce = Number(raw?.nonce ?? 0);

      if (typeof serverSeed !== "string" || !serverSeed) {
        return jsonResponse({ error: "Could not load game seeds." }, 500, req);
      }

      const dealt = await dealNewHand(serverSeed, clientSeed, nonce, wager);
      const s = dealt.state;
      const status = dealt.instantSettle ? "settled" : "player_turn";

      const { data: started, error: startError } = await admin.rpc("start_blackjack_hand", {
        p_user_id: user.id,
        p_wager: wager,
        p_total_wager: s.totalWager,
        p_shoe: s.shoe,
        p_shoe_index: s.shoeIndex,
        p_player_cards: s.playerCards,
        p_dealer_cards: s.dealerCards,
        p_doubled: s.doubled,
        p_dealer_revealed: s.dealerRevealed,
        p_status: status,
        p_outcome: dealt.outcome,
        p_payout: dealt.payout,
        p_nonce: nonce,
        p_phase: s.phase,
        p_insurance_wager: s.insuranceWager,
        p_insurance_taken: s.insuranceTaken,
        p_insurance_decided: s.insuranceDecided,
        p_is_split: s.isSplit,
        p_player_hands: handsToJson(s.playerHands),
        p_active_hand_index: s.activeHandIndex,
        p_coin_type: coinType,
      });

      if (startError) return jsonResponse({ error: startError.message }, 400, req);

      const row = (Array.isArray(started) ? started[0] : started) as
        | Record<string, unknown>
        | undefined;

      const responseStatus = dealt.instantSettle
        ? "settled"
        : s.phase === "insurance_offer"
          ? "insurance_offer"
          : "player_turn";

      return jsonResponse({
        handId: row?.hand_id,
        balance: Number(row?.out_balance ?? 0),
        coinType,
        status: responseStatus,
        outcome: dealt.outcome,
        payout: dealt.payout,
        nonce,
        wager,
        ...clientHandPayload(s),
      });
    }

    const handId = String(body?.handId ?? body?.hand_id ?? "");
    if (!handId) return jsonResponse({ error: "Hand id required." }, 400, req);

    const row = await loadHand(admin, user.id, handId);
    if (!row) return jsonResponse({ error: "Active hand not found." }, 400, req);

    const state = stateFromRow(row);

    if (action === "insurance") {
      const take = Boolean(body?.take);
      const insCost = take ? insuranceAmount(state.wager) : 0;

      if (take) {
        const { data: profile } = await admin
          .from("profiles")
          .select("balance, sweeps_coins")
          .eq("id", user.id)
          .maybeSingle();
        const insBal = coinType === "sweeps_coins" ? Number(profile?.sweeps_coins ?? 0) : Number(profile?.balance ?? 0);
        if (insBal < insCost) {
          return jsonResponse({ error: "Insufficient balance for insurance." }, 400, req);
        }
      }

      // Pre-compute the deal-time RTP bias so `resolveInsurance` can apply
      // it when the player has BJ and the dealer doesn't (settle as 3:2
      // blackjack win, downgraded ~2.5% of the time to a loss). Matches the
      // bias tag used by `dealNewHand` ("bj-deal") on the same seeds+nonce.
      const { data: pfIns } = await admin
        .from("game_pf_seeds")
        .select("server_seed, client_seed")
        .eq("user_id", user.id)
        .maybeSingle();
      let dealBias: number | undefined;
      if (typeof pfIns?.server_seed === "string" && pfIns.server_seed) {
        dealBias = await rtpBiasFloat(
          pfIns.server_seed,
          String(pfIns.client_seed ?? "default"),
          Number(row.nonce),
          "bj-deal"
        );
      }

      const result = resolveInsurance(state, take, dealBias);

      if (result.insuranceDebit > 0) {
        const { error: debitErr } = await admin.rpc("blackjack_debit_extra", {
          p_user_id: user.id,
          p_hand_id: handId,
          p_extra_wager: result.insuranceDebit,
          p_coin_type: coinType,
          p_description: "Blackjack insurance",
        });
        if (debitErr) return jsonResponse({ error: debitErr.message }, 400, req);
      }

      if (result.instantSettle) {
        const { data: fin, error: finErr } = await finishHand(
          admin,
          user.id,
          handId,
          result.state,
          result.outcome,
          result.payout,
          0,
          coinType
        );
        if (finErr) return jsonResponse({ error: finErr.message }, 400, req);
        const bal = (Array.isArray(fin) ? fin[0] : fin) as Record<string, unknown> | undefined;
        return jsonResponse({
          handId,
          status: "settled",
          outcome: result.outcome,
          payout: result.payout,
          balance: Number(bal?.out_balance ?? 0),
          coinType,
          wager: state.wager,
          ...clientHandPayload(result.state),
        });
      }

      const { error: upErr } = await saveProgress(admin, user.id, handId, result.state);
      if (upErr) return jsonResponse({ error: upErr.message }, 400, req);

      const { data: prof } = await admin
        .from("profiles")
        .select("balance, sweeps_coins")
        .eq("id", user.id)
        .maybeSingle();

      const profBal = coinType === "sweeps_coins" ? Number(prof?.sweeps_coins ?? 0) : Number(prof?.balance ?? 0);

      return jsonResponse({
        handId,
        status: "player_turn",
        balance: profBal,
        coinType,
        wager: state.wager,
        ...clientHandPayload(result.state),
      });
    }

    if (action === "split") {
      const { data: profile } = await admin
        .from("profiles")
        .select("balance, sweeps_coins")
        .eq("id", user.id)
        .maybeSingle();

      const extra = state.wager;
      const splitBal = coinType === "sweeps_coins" ? Number(profile?.sweeps_coins ?? 0) : Number(profile?.balance ?? 0);
      if (splitBal < extra) {
        return jsonResponse({ error: "Insufficient balance to split." }, 400, req);
      }

      let result;
      try {
        const handBias = await handRtpBiasFn(
          admin,
          user.id,
          handId,
          Number(row.nonce),
          2
        );
        result = splitHand(state, handBias);
      } catch {
        return jsonResponse({ error: "Cannot split this hand." }, 400, req);
      }

      const { error: debitErr } = await admin.rpc("blackjack_debit_extra", {
        p_user_id: user.id,
        p_hand_id: handId,
        p_extra_wager: result.extraWager,
        p_coin_type: coinType,
        p_description: "Blackjack split",
      });
      if (debitErr) return jsonResponse({ error: debitErr.message }, 400, req);

      if (result.instantSettle) {
        const { data: fin, error: finErr } = await finishHand(
          admin,
          user.id,
          handId,
          result.state,
          result.outcome,
          result.payout,
          0,
          coinType
        );
        if (finErr) return jsonResponse({ error: finErr.message }, 400, req);
        const bal = (Array.isArray(fin) ? fin[0] : fin) as Record<string, unknown> | undefined;
        return jsonResponse({
          handId,
          status: "settled",
          outcome: result.outcome,
          payout: result.payout,
          balance: Number(bal?.out_balance ?? 0),
          coinType,
          wager: state.wager,
          ...clientHandPayload(result.state),
        });
      }

      const { error: upErr } = await saveProgress(admin, user.id, handId, result.state);
      if (upErr) return jsonResponse({ error: upErr.message }, 400, req);

      const { data: prof } = await admin
        .from("profiles")
        .select("balance, sweeps_coins")
        .eq("id", user.id)
        .maybeSingle();

      const profBal = coinType === "sweeps_coins" ? Number(prof?.sweeps_coins ?? 0) : Number(prof?.balance ?? 0);

      return jsonResponse({
        handId,
        status: "player_turn",
        balance: profBal,
        coinType,
        wager: state.wager,
        ...clientHandPayload(result.state),
      });
    }

    function getBal(prof: Record<string, unknown> | null): number {
      return coinType === "sweeps_coins" ? Number(prof?.sweeps_coins ?? 0) : Number(prof?.balance ?? 0);
    }

    if (action === "hit") {
      const handBias = await handRtpBiasFn(
        admin,
        user.id,
        handId,
        Number(row.nonce),
        state.playerHands.length
      );
      const result = hitCard(state, handBias);
      if (!result.done) {
        const { error: upErr } = await saveProgress(admin, user.id, handId, result.state);
        if (upErr) return jsonResponse({ error: upErr.message }, 400, req);

        const { data: prof } = await admin
          .from("profiles")
          .select("balance, sweeps_coins")
          .eq("id", user.id)
          .maybeSingle();

        return jsonResponse({
          handId,
          status: "player_turn",
          balance: getBal(prof as Record<string, unknown> | null),
          coinType,
          wager: state.wager,
          ...clientHandPayload(result.state),
        });
      }

      const { data: fin, error: finErr } = await finishHand(
        admin,
        user.id,
        handId,
        result.state,
        result.outcome,
        result.payout,
        0,
        coinType
      );
      if (finErr) return jsonResponse({ error: finErr.message }, 400, req);
      const bal = (Array.isArray(fin) ? fin[0] : fin) as Record<string, unknown> | undefined;

      return jsonResponse({
        handId,
        status: "settled",
        outcome: result.outcome,
        payout: result.payout,
        balance: Number(bal?.out_balance ?? 0),
        coinType,
        wager: state.wager,
        ...clientHandPayload(result.state),
      });
    }

    if (action === "stand") {
      const handBias = await handRtpBiasFn(
        admin,
        user.id,
        handId,
        Number(row.nonce),
        state.playerHands.length
      );
      const result = standHand(state, handBias);
      if (!result.done) {
        const { error: upErr } = await saveProgress(admin, user.id, handId, result.state);
        if (upErr) return jsonResponse({ error: upErr.message }, 400, req);

        const { data: prof } = await admin
          .from("profiles")
          .select("balance, sweeps_coins")
          .eq("id", user.id)
          .maybeSingle();

        return jsonResponse({
          handId,
          status: "player_turn",
          balance: getBal(prof as Record<string, unknown> | null),
          coinType,
          wager: state.wager,
          ...clientHandPayload(result.state),
        });
      }

      const { data: fin, error: finErr } = await finishHand(
        admin,
        user.id,
        handId,
        result.state,
        result.outcome,
        result.payout,
        0,
        coinType
      );
      if (finErr) return jsonResponse({ error: finErr.message }, 400, req);
      const bal = (Array.isArray(fin) ? fin[0] : fin) as Record<string, unknown> | undefined;

      return jsonResponse({
        handId,
        status: "settled",
        outcome: result.outcome,
        payout: result.payout,
        balance: Number(bal?.out_balance ?? 0),
        coinType,
        wager: state.wager,
        ...clientHandPayload(result.state),
      });
    }

    if (action === "double") {
      const hand = state.playerHands[state.activeHandIndex]!;
      const extra = hand.wager;
      const { data: profile } = await admin
        .from("profiles")
        .select("balance, sweeps_coins")
        .eq("id", user.id)
        .maybeSingle();

      if (getBal(profile as Record<string, unknown> | null) < extra) {
        return jsonResponse({ error: "Insufficient balance to double." }, 400, req);
      }

      const handBias = await handRtpBiasFn(
        admin,
        user.id,
        handId,
        Number(row.nonce),
        state.playerHands.length
      );
      const result = doubleHand(state, handBias);

      if (!result.done) {
        const { error: debitErr } = await admin.rpc("blackjack_debit_extra", {
          p_user_id: user.id,
          p_hand_id: handId,
          p_extra_wager: result.extraWager,
          p_coin_type: coinType,
          p_description: "Blackjack double",
        });
        if (debitErr) return jsonResponse({ error: debitErr.message }, 400, req);

        const { error: upErr } = await saveProgress(admin, user.id, handId, result.state);
        if (upErr) return jsonResponse({ error: upErr.message }, 400, req);

        const { data: prof } = await admin
          .from("profiles")
          .select("balance, sweeps_coins")
          .eq("id", user.id)
          .maybeSingle();

        return jsonResponse({
          handId,
          status: "player_turn",
          balance: getBal(prof as Record<string, unknown> | null),
          coinType,
          wager: state.wager,
          ...clientHandPayload(result.state),
        });
      }

      const { data: fin, error: finErr } = await finishHand(
        admin,
        user.id,
        handId,
        result.state,
        result.outcome,
        result.payout,
        result.extraWager,
        coinType
      );
      if (finErr) return jsonResponse({ error: finErr.message }, 400, req);
      const bal = (Array.isArray(fin) ? fin[0] : fin) as Record<string, unknown> | undefined;

      return jsonResponse({
        handId,
        status: "settled",
        outcome: result.outcome,
        payout: result.payout,
        balance: Number(bal?.out_balance ?? 0),
        coinType,
        wager: state.wager,
        ...clientHandPayload(result.state),
      });
    }

    return jsonResponse({ error: "Unknown action." }, 400, req);
  } catch (err) {
    console.error("blackjack-game:", err);
    return jsonResponse({ error: "Server error." }, 500, req);
  }
});
