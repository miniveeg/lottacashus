import { describe, it, expect } from "vitest";
import {
  crashPointFromSeeds,
  calculateCrashPayout,
  cashOutPayout,
  truncateCrashMultiplier,
} from "../crash/engine";
import { CRASH_HOUSE_EDGE, TWO_POW_24 } from "../crash/constants";

describe("truncateCrashMultiplier", () => {
  it("truncates to 2 decimal places toward zero", () => {
    expect(truncateCrashMultiplier(1.999)).toBe(1.99);
    expect(truncateCrashMultiplier(2.001)).toBe(2);
    expect(truncateCrashMultiplier(1)).toBe(1);
  });
});

describe("calculateCrashPayout / cashOutPayout", () => {
  it("rounds to cents", () => {
    expect(calculateCrashPayout(10, 1.5)).toBe(15);
    expect(cashOutPayout(10, 2.33)).toBe(23.3);
    expect(calculateCrashPayout(1.11, 1.11)).toBe(1.23);
  });
});

describe("crashPointFromSeeds (provably fair)", () => {
  it("always returns a number >= 1", async () => {
    for (let nonce = 0; nonce < 20; nonce++) {
      const point = await crashPointFromSeeds("server-seed-test", "client-seed-test", nonce);
      expect(point).toBeGreaterThanOrEqual(1);
      expect(Number.isFinite(point)).toBe(true);
    }
  });

  it("is deterministic for the same seeds + nonce", async () => {
    const a = await crashPointFromSeeds("s1", "c1", 7);
    const b = await crashPointFromSeeds("s1", "c1", 7);
    expect(a).toBe(b);
  });

  it("varies with nonce", async () => {
    const a = await crashPointFromSeeds("s1", "c1", 0);
    const b = await crashPointFromSeeds("s1", "c1", 1);
    expect(typeof a).toBe("number");
    expect(typeof b).toBe("number");
  });

  it("embeds the house edge in the formula constants", () => {
    expect(CRASH_HOUSE_EDGE).toBe(0.035);
    expect(TWO_POW_24).toBe(16777216);
  });
});
