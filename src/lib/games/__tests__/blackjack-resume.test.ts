import { describe, expect, it } from "vitest";
import {
  isActiveBlackjackConflict,
  isPlayableBlackjackStatus,
  isSettledBlackjackStatus,
  mapBlackjackHand,
  normalizeResumedBlackjack,
} from "../../blackjackMap";

describe("blackjack resume helpers", () => {
  it("detects the live active-hand conflict error", () => {
    expect(isActiveBlackjackConflict("You already have an active blackjack hand.")).toBe(true);
    expect(isActiveBlackjackConflict("Finish your current Blackjack hand first")).toBe(true);
    expect(isActiveBlackjackConflict("Insufficient balance.")).toBe(false);
    expect(isActiveBlackjackConflict(null)).toBe(false);
  });

  it("treats player_turn and insurance_offer as playable", () => {
    expect(isPlayableBlackjackStatus("player_turn")).toBe(true);
    expect(isPlayableBlackjackStatus("", "insurance_offer")).toBe(true);
    expect(isPlayableBlackjackStatus("settled")).toBe(false);
  });

  it("treats finished outcomes as settled so Deal can start a new hand", () => {
    expect(isSettledBlackjackStatus("settled")).toBe(true);
    expect(isSettledBlackjackStatus("win")).toBe(true);
    expect(isSettledBlackjackStatus("player_turn")).toBe(false);
  });

  it("maps an active camelCase payload onto a playable hand", () => {
    const hand = mapBlackjackHand(
      {
        active: true,
        handId: "abc",
        status: "player_turn",
        phase: "player_turn",
        playerCards: [12, 25],
        dealerCards: [4],
        canDouble: true,
        canSplit: false,
        wager: 5,
        coinType: "sweeps_coins",
      },
      { assumeInProgress: true }
    );
    expect(hand.handId).toBe("abc");
    expect(hand.status).toBe("player_turn");
    expect(hand.playerCards).toEqual([12, 25]);
    expect(hand.dealerCards).toEqual([4]);
    expect(hand.canDouble).toBe(true);
    expect(hand.coinType).toBe("sweeps_coins");
  });

  it("maps snake_case restore payloads and fills missing status from phase", () => {
    const hand = mapBlackjackHand(
      {
        active: true,
        hand_id: "hid-1",
        phase: "player_turn",
        player_cards: [0, 13],
        dealer_cards: [8],
        can_double: true,
        can_split: true,
        total_wager: 10,
        coin_type: "balance",
      },
      { assumeInProgress: true }
    );
    expect(hand.handId).toBe("hid-1");
    expect(hand.status).toBe("player_turn");
    expect(hand.playerCards).toEqual([0, 13]);
    expect(hand.canSplit).toBe(true);
    expect(hand.totalWager).toBe(10);
  });

  it("keeps insurance_offer so the insurance chrome shows after restore", () => {
    const hand = mapBlackjackHand(
      {
        handId: "ins",
        phase: "insurance_offer",
        playerCards: [1, 2],
        dealerCards: [0],
      },
      { assumeInProgress: true }
    );
    const resumed = normalizeResumedBlackjack(hand);
    expect(resumed.status).toBe("insurance_offer");
    expect(isPlayableBlackjackStatus(resumed.status, resumed.phase)).toBe(true);
  });

  it("maps a raw row id onto handId and hides the hole card by default", () => {
    const hand = mapBlackjackHand(
      {
        id: "row-9",
        player_cards: [1, 2],
        dealer_cards: [3],
        phase: "player_turn",
      },
      { assumeInProgress: true }
    );
    expect(hand.handId).toBe("row-9");
    expect(hand.dealerRevealed).toBe(false);
    expect(hand.status).toBe("player_turn");
  });

  it("does not treat a finished hand as playable after normalize", () => {
    const hand = mapBlackjackHand({
      handId: "done",
      status: "settled",
      phase: "settled",
      playerCards: [1, 2],
      dealerCards: [3, 4],
      outcome: "win",
    });
    const resumed = normalizeResumedBlackjack(hand);
    expect(resumed.status).toBe("settled");
    expect(isPlayableBlackjackStatus(resumed.status, resumed.phase)).toBe(false);
  });
});
