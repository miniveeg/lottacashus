import { describe, expect, it } from "vitest";
import { extractCrashBetId } from "../../wireIds";
import { extractDepositAddress } from "../../wireIds";
import { mapBlackjackHand } from "../../blackjackMap";

describe("extractCrashBetId", () => {
  it("prefers betId then bet_id then out_bet_id", () => {
    expect(extractCrashBetId({ betId: "aaa", bet_id: "bbb" })).toBe("aaa");
    expect(extractCrashBetId({ bet_id: "bbb" })).toBe("bbb");
    expect(extractCrashBetId({ out_bet_id: "ccc" })).toBe("ccc");
  });

  it("rejects empty and dummy strings", () => {
    expect(extractCrashBetId({ betId: "" })).toBe("");
    expect(extractCrashBetId({ betId: "undefined" })).toBe("");
    expect(extractCrashBetId({ bet_id: null })).toBe("");
    expect(extractCrashBetId(null)).toBe("");
  });
});

describe("extractDepositAddress", () => {
  it("reads address aliases and nested payloads", () => {
    expect(extractDepositAddress({ address: "SoLaddr111" })).toBe("SoLaddr111");
    expect(extractDepositAddress({ deposit_address: "SoLaddr222" })).toBe("SoLaddr222");
    expect(extractDepositAddress({ data: { address: "SoLaddr333" } })).toBe("SoLaddr333");
  });

  it("returns null when missing", () => {
    expect(extractDepositAddress({})).toBeNull();
    expect(extractDepositAddress({ address: "  " })).toBeNull();
  });
});

describe("mapBlackjackHand empty handId", () => {
  it("skips empty camelCase handId and uses snake_case hand_id", () => {
    const hand = mapBlackjackHand(
      {
        handId: "",
        hand_id: "hid-restored",
        phase: "player_turn",
        player_cards: [1, 2],
      },
      { assumeInProgress: true }
    );
    expect(hand.handId).toBe("hid-restored");
  });
});
