/**
 * Single-currency (SC) wallet helpers shared by every Originals game.
 * Gold Coins are gone — all balance/max-bet logic resolves to SC only.
 */

export const SC_MAX_WAGER = 100_000;
export const SC_MIN_WAGER = 0.01;

export type ProfileBalance = {
  sweepsCoins?: number | null;
  /** @deprecated GC removed — ignored */
  balance?: number | null;
} | null | undefined;

/** Active playable balance — always SC. */
export function getActiveBalance(profile: ProfileBalance): number {
  return profile?.sweepsCoins ?? 0;
}

/** Clamp a wager into the legal SC range and optional balance cap. */
export function clampWager(value: number, balance?: number): number {
  if (!Number.isFinite(value)) return SC_MIN_WAGER;
  const rounded = Math.round(value * 100) / 100;
  const cap = balance != null ? Math.min(SC_MAX_WAGER, Math.max(0, balance)) : SC_MAX_WAGER;
  return Math.max(SC_MIN_WAGER, Math.min(cap, rounded));
}

/** Always "sweeps_coins" — kept as a function so call sites stay explicit. */
export function playCoinType(): "sweeps_coins" {
  return "sweeps_coins";
}
