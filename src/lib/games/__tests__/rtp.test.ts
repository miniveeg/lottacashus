import { describe, it, expect } from "vitest";
import {
  GAME_RTP,
  STAKE_STYLE_BASE_RTP,
  STAKE_STYLE_WIN_RETENTION,
  ROULETTE_FAIR_RTP,
  ROULETTE_WIN_RETENTION,
  CASE_BATTLES_RTP,
  CASE_CATALOG_BASE_RTP,
  CASE_ROLL_BIAS_EXPONENT,
  retainStakeStyleWin,
  retainRouletteWin,
  biasCaseRollFloat,
} from "../rtp";

describe("RTP constants", () => {
  it("GAME_RTP is 96.5%", () => {
    expect(GAME_RTP).toBe(0.965);
  });

  it("stake-style retention maps 99% → 96.5%", () => {
    expect(STAKE_STYLE_WIN_RETENTION).toBeCloseTo(GAME_RTP / STAKE_STYLE_BASE_RTP, 10);
  });

  it("roulette retention maps European fair RTP → 96.5%", () => {
    expect(ROULETTE_WIN_RETENTION).toBeCloseTo(GAME_RTP / ROULETTE_FAIR_RTP, 10);
  });

  it("case battles target 86.5% with corresponding bias exponent", () => {
    expect(CASE_BATTLES_RTP).toBe(0.865);
    expect(CASE_ROLL_BIAS_EXPONENT).toBeCloseTo(CASE_CATALOG_BASE_RTP / CASE_BATTLES_RTP, 10);
  });
});

describe("retainStakeStyleWin", () => {
  it("keeps wins below the retention threshold", () => {
    expect(retainStakeStyleWin(0)).toBe(true);
    expect(retainStakeStyleWin(STAKE_STYLE_WIN_RETENTION - 1e-12)).toBe(true);
  });
  it("rejects wins at or above the retention threshold", () => {
    expect(retainStakeStyleWin(STAKE_STYLE_WIN_RETENTION)).toBe(false);
    expect(retainStakeStyleWin(1)).toBe(false);
  });
});

describe("retainRouletteWin", () => {
  it("keeps wins below the retention threshold", () => {
    expect(retainRouletteWin(0)).toBe(true);
    expect(retainRouletteWin(ROULETTE_WIN_RETENTION - 1e-12)).toBe(true);
  });
  it("rejects at or above threshold", () => {
    expect(retainRouletteWin(ROULETTE_WIN_RETENTION)).toBe(false);
  });
});

describe("biasCaseRollFloat", () => {
  it("maps 0 → 0 and 1 → 1", () => {
    expect(biasCaseRollFloat(0)).toBe(0);
    expect(biasCaseRollFloat(1)).toBe(1);
  });
  it("is monotonic increasing", () => {
    const a = biasCaseRollFloat(0.2);
    const b = biasCaseRollFloat(0.5);
    const c = biasCaseRollFloat(0.8);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
  });
  it("applies the expected bias direction (exponent > 1 pushes mass toward 1)", () => {
    expect(CASE_ROLL_BIAS_EXPONENT).toBeGreaterThan(1);
    expect(biasCaseRollFloat(0.5)).toBeGreaterThan(0.5);
  });
});
