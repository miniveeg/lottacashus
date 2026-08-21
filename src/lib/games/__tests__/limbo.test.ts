import { describe, it, expect } from "vitest";
import {
  limboResultFromSeeds,
  truncateLimboMultiplier,
} from "../limbo/provablyFair";

describe("truncateLimboMultiplier", () => {
  it("truncates toward zero to 2 decimals", () => {
    expect(truncateLimboMultiplier(1.999)).toBe(1.99);
    expect(truncateLimboMultiplier(2.001)).toBe(2);
  });
});

describe("limboResultFromSeeds", () => {
  it("returns a finite multiplier >= ~1", async () => {
    const r = await limboResultFromSeeds("server", "client", 0);
    expect(Number.isFinite(r)).toBe(true);
    expect(r).toBeGreaterThanOrEqual(1);
  });

  it("is deterministic", async () => {
    const a = await limboResultFromSeeds("s", "c", 3);
    const b = await limboResultFromSeeds("s", "c", 3);
    expect(a).toBe(b);
  });
});
