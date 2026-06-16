import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export async function runHealthCheck(): Promise<Record<string, unknown>> {
  const checks: Record<string, unknown> = {
    supabaseUrl: !!Deno.env.get("SUPABASE_URL"),
    serviceRoleKey: !!Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    cronSecret: !!Deno.env.get("CRON_SECRET"),
    cryptoMnemonic: !!Deno.env.get("CRYPTO_MASTER_MNEMONIC"),
    etherscanKey: !!Deno.env.get("ETHERSCAN_API_KEY"),
    blockcypherToken: !!Deno.env.get("BLOCKCYPHER_TOKEN"),
  };

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const url = Deno.env.get("SUPABASE_URL");

  if (!serviceKey || !url) {
    checks.database = "skip — missing URL or service role key";
    return checks;
  }

  const supabase = createClient(url, serviceKey);

  const tables = ["user_deposit_addresses", "crypto_deposits", "profiles"] as const;
  for (const table of tables) {
    const { error } = await supabase.from(table).select("*", { count: "exact", head: true });
    checks[`table_${table}`] = error ? `MISSING or error: ${error.message}` : "ok";
  }

  const { error: rpcError } = await supabase.rpc("credit_crypto_deposit", {
    p_user_id: "00000000-0000-0000-0000-000000000000",
    p_usd_amount: 0,
    p_chain: "sol",
    p_tx_hash: "health-check",
    p_crypto_amount: 0,
    p_exchange_rate: 0,
    p_deposit_id: "00000000-0000-0000-0000-000000000000",
  });
  checks.credit_crypto_deposit_rpc = rpcError
    ? `exists (dry-run may fail: ${rpcError.message})`
    : "ok";

  return checks;
}
