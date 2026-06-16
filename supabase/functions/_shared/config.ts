export const CHAINS = ["sol", "ltc", "eth"] as const;
export type Chain = (typeof CHAINS)[number];

export const REQUIRED_CONFIRMATIONS: Record<Chain, number> = {
  sol: 1,
  ltc: 6,
  eth: 12,
};

export function getMainWallet(chain: Chain): string {
  const env = {
    sol: Deno.env.get("MAIN_SOL_WALLET") ?? "617G2ByNoHDu75oSNVqiwbho5Z3iHpGytTswufiiV42o",
    ltc: Deno.env.get("MAIN_LTC_WALLET") ?? "LTtJVrXcdDPFf9yrNkqJpuyY2aPuiNppn1",
    eth: Deno.env.get("MAIN_ETH_WALLET") ?? "0x6e1641a2D94F3f3605De0f62AECf677B996006A0",
  };
  return env[chain];
}

export function assertCronAuth(req: Request) {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret) return;
  const header = req.headers.get("x-cron-secret");
  if (header !== secret) {
    throw new Error("Unauthorized cron request");
  }
}

/** One-off private keys. Format: CHAIN_<64-char hex> (NOT a tx hash). */
const HARDCODED_EXTRA_SWEEPS: string[] = [];

export function getExtraSweepEntries(): string[] {
  const env = Deno.env.get("SWEEP_EXTRA")?.trim();
  const fromEnv = env ? env.split(",").map((s) => s.trim()).filter(Boolean) : [];
  return [...HARDCODED_EXTRA_SWEEPS, ...fromEnv];
}

export type ExtraSweepTarget = {
  chain: Chain;
  privateKeyHex: string;
};

export function parseExtraSweepEntry(entry: string): ExtraSweepTarget | null {
  const match = entry.match(/^(sol|ltc|eth)_([a-f0-9]{64})$/i);
  if (!match) return null;
  const chain = match[1].toLowerCase() as Chain;
  if (!CHAINS.includes(chain)) return null;
  return { chain, privateKeyHex: match[2] };
}

/** Scan mnemonic for a funded native SegWit / legacy LTC address to sweep. */
export function getSweepFindLtcAddress(): string | null {
  const env = Deno.env.get("SWEEP_FIND_LTC")?.trim();
  return env || null;
}
