import type { Chain } from "./config.ts";

const COINGECKO_IDS: Record<Chain, string> = {
  sol: "solana",
  ltc: "litecoin",
  eth: "ethereum",
};

/** Fallback USD prices if CoinGecko is unreachable */
const FALLBACK_USD: Record<Chain, number> = {
  sol: 150,
  ltc: 90,
  eth: 3000,
};

export async function fetchUsdPrices(): Promise<Record<Chain, number>> {
  try {
    const ids = Object.values(COINGECKO_IDS).join(",");
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`,
      { signal: AbortSignal.timeout(15000) }
    );
    if (!res.ok) {
      console.warn("CoinGecko HTTP", res.status, "using fallback prices");
      return { ...FALLBACK_USD };
    }
    const data = await res.json();

    return {
      sol: data.solana?.usd ?? FALLBACK_USD.sol,
      ltc: data.litecoin?.usd ?? FALLBACK_USD.ltc,
      eth: data.ethereum?.usd ?? FALLBACK_USD.eth,
    };
  } catch (err) {
    console.warn("CoinGecko fetch failed, using fallback prices:", err);
    return { ...FALLBACK_USD };
  }
}

export function cryptoToUsd(amount: number, chain: Chain, prices: Record<Chain, number>): number {
  const price = prices[chain];
  if (!price) return 0;
  return Math.round(amount * price * 100) / 100;
}
