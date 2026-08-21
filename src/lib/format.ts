// ── Single-currency constants (SC only) ────────────────────────────────────
// 100 SC = $1 USD  →  1 SC = $0.01
export const SC_PER_USD = 100;
export const SC_USD_RATE = 1 / SC_PER_USD; // 0.01

/** @deprecated GC removed — kept only so old imports do not break during transition. */
export const GC_PER_USD = SC_PER_USD;
/** @deprecated GC removed */
export const GC_USD_RATE = SC_USD_RATE;

export type CoinType = "sweeps_coins";

export function formatUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** Signed cash-flow tally: withdrawn − deposited */
export function formatSignedUsd(amount: number): string {
  const formatted = formatUsd(Math.abs(amount));
  if (amount > 0) return `+${formatted}`;
  if (amount < 0) return `-${formatted}`;
  return formatted;
}

export function getCashFlowTally(deposited: number, withdrawn: number) {
  const net = withdrawn - deposited;
  let label = "Even — deposited and withdrawn match";
  if (net > 0) label = "Withdrew more than deposited";
  if (net < 0) label = "Deposited more than withdrawn";
  return { net, label, formatted: formatSignedUsd(net) };
}

// ── Coin helpers (SC only) ─────────────────────────────────────────────────

/** Convert SC amount to its USD equivalent. */
export function coinsToUsd(amount: number, _coinType?: CoinType | string): number {
  return amount * SC_USD_RATE;
}

/** Convert a USD amount to SC. */
export function usdToCoins(usd: number, _coinType?: CoinType | string): number {
  return usd * SC_PER_USD;
}

/** Format a coin amount with SC symbol, e.g. "1,234.56 SC". */
export function formatCoins(amount: number, _coinType?: CoinType | string): string {
  return `${formatNumber(amount)} SC`;
}

/** Format a coin amount with its USD equivalent, e.g. "1,234.56 SC ($12.35)". */
export function formatCoinsWithUsd(amount: number, _coinType?: CoinType | string): string {
  const usd = coinsToUsd(amount);
  return `${formatCoins(amount)} (${formatUsd(usd)})`;
}

/** Plain number formatting with 2 decimals and thousands separators. */
export function formatNumber(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** SC credited for a given USD deposit (100 SC per $1). */
export function depositSc(usdAmount: number): number {
  return Math.floor(usdAmount * SC_PER_USD);
}

/** @deprecated Use depositSc — GC removed. */
export function depositBonusSc(usdAmount: number): number {
  return depositSc(usdAmount);
}

/** @deprecated GC removed — returns 0. */
export function depositGc(_usdAmount: number): number {
  return 0;
}
