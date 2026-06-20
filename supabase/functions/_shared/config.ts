export const CHAINS = ["sol", "ltc", "eth"] as const;
export type Chain = (typeof CHAINS)[number];

export const REQUIRED_CONFIRMATIONS: Record<Chain, number> = {
  sol: 1,
  ltc: 6,
  eth: 12,
};

/**
 * Resolve the treasury wallet address for a chain from environment variables.
 *
 * SECURITY: Wallet addresses must NEVER be hardcoded as defaults — if a
 * deployment forgets to set the env var, deposits could be misrouted. We
 * throw instead of silently falling back so misconfiguration is loud.
 */
export function getMainWallet(chain: Chain): string {
  const envKey = `MAIN_${chain.toUpperCase()}_WALLET`;
  const value = Deno.env.get(envKey);
  if (!value || !value.trim()) {
    throw new Error(
      `${envKey} is not set. Configure it in Supabase → Edge Functions → Secrets before handling deposits.`
    );
  }
  return value.trim();
}

/**
 * Validate that a cron invocation is authorised.
 *
 * SECURITY: Previously this function silently passed when CRON_SECRET was
 * unset, which meant a misconfigured deployment left the cron endpoint open
 * to the public internet. We now require the secret to be set and to match.
 */
export function assertCronAuth(req: Request) {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret) {
    throw new Error(
      "CRON_SECRET is not set. Configure it in Supabase → Edge Functions → Secrets before invoking cron endpoints."
    );
  }
  const header = req.headers.get("x-cron-secret");
  if (header !== secret) {
    throw new Error("Unauthorized cron request");
  }
}

/** One-off private keys. Format: CHAIN_<64-char hex> (NOT a tx hash). */
export function getExtraSweepEntries(): string[] {
  const env = Deno.env.get("SWEEP_EXTRA")?.trim();
  return env ? env.split(",").map((s) => s.trim()).filter(Boolean) : [];
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
