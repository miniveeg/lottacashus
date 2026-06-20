// ── Dual-currency constants ────────────────────────────────────────────────
// 100 SC = $1 USD  →  1 SC = $0.01
// 100 GC = $1 USD  →  1 GC = $0.01  (display only; GC has no redemption value)
export const SC_PER_USD = 100;
export const GC_PER_USD = 100;
export const SC_USD_RATE = 1 / SC_PER_USD; // 0.01
export const GC_USD_RATE = 1 / GC_PER_USD; // 0.01

export type CoinType = "balance" | "sweeps_coins";

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

// ── Coin helpers ───────────────────────────────────────────────────────────

/** Convert a coin amount to its USD equivalent. */
export function coinsToUsd(amount: number, coinType: CoinType): number {
  const rate = coinType === "sweeps_coins" ? SC_USD_RATE : GC_USD_RATE;
  return amount * rate;
}

/** Convert a USD amount to coins. */
export function usdToCoins(usd: number, coinType: CoinType): number {
  const perUsd = coinType === "sweeps_coins" ? SC_PER_USD : GC_PER_USD;
  return usd * perUsd;
}

/** Format a coin amount with its symbol, e.g. "1,234.56 GC". */
export function formatCoins(amount: number, coinType: CoinType): string {
  const symbol = coinType === "sweeps_coins" ? "SC" : "GC";
  return `${formatNumber(amount)} ${symbol}`;
}

/** Format a coin amount with its USD equivalent, e.g. "1,234.56 GC ($12.35)". */
export function formatCoinsWithUsd(amount: number, coinType: CoinType): string {
  const usd = coinsToUsd(amount, coinType);
  return `${formatCoins(amount, coinType)} (${formatUsd(usd)})`;
}

/** Plain number formatting with 2 decimals and thousands separators. */
export function formatNumber(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** The bonus SC a user receives for a given USD deposit (1 SC per $1). */
export function depositBonusSc(usdAmount: number): number {
  return Math.floor(usdAmount);
}

/** The GC a user receives for a given USD deposit (100 GC per $1). */
export function depositGc(usdAmount: number): number {
  return Math.floor(usdAmount * GC_PER_USD);
}
