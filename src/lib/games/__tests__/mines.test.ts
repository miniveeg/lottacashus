import { describe, it, expect } from "vitest";
import {
  getMinesMultiplier,
  getMaxGems,
  getNextMultiplier,
} from "../mines/multipliers";
import { MINES_GRID_SIZE } from "../mines/multipliers";

describe("Mines multipliers", () => {
  it("grid is 25 tiles", () => {
    expect(MINES_GRID_SIZE).toBe(25);
  });

  it("0 gems → 1.00x", () => {
    expect(getMinesMultiplier(3, 0)).toBe(1);
    expect(getMinesMultiplier(24, 0)).toBe(1);
  });

  it("max gems = 25 - mineCount", () => {
    expect(getMaxGems(1)).toBe(24);
    expect(getMaxGems(24)).toBe(1);
  });

  it("requesting more gems than safe tiles returns 0", () => {
    expect(getMinesMultiplier(5, 21)).toBe(0);
  });

  it("multiplier is non-decreasing as more gems are revealed (for fixed mines)", () => {
    let prev = 1;
    for (let g = 1; g <= 10; g++) {
      const m = getMinesMultiplier(3, g);
      expect(m).toBeGreaterThanOrEqual(prev);
      prev = m;
    }
  });

  it("higher mine count yields higher multiplier for same gems", () => {
    const low = getMinesMultiplier(1, 5);
    const high = getMinesMultiplier(10, 5);
    expect(high).toBeGreaterThan(low);
  });

  it("getNextMultiplier is getMinesMultiplier(mines, gems+1)", () => {
    expect(getNextMultiplier(5, 3)).toBe(getMinesMultiplier(5, 4));
  });

  it("produces the expected 2-decimal floor", () => {
    const m = getMinesMultiplier(5, 3);
    expect(m).toBe(Math.floor(m * 100) / 100);
  });
});
