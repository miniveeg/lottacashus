import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { REQUIRED_CONFIRMATIONS, assertCronAuth } from "../_shared/config.ts";
import { scanIncomingTransactions } from "../_shared/chain-scan.ts";
import { fetchUsdPrices, cryptoToUsd } from "../_shared/rates.ts";
import { runHealthCheck } from "../_shared/health.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST" && req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    assertCronAuth(req);
  } catch {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const url = new URL(req.url);
  if (url.searchParams.get("health") === "1") {
    const checks = await runHealthCheck();
    return jsonResponse({ ok: true, checks });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceKey) {
      return jsonResponse({
        error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in Edge Function env. Re-link and redeploy.",
      }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: addresses, error: addrError } = await supabase
      .from("user_deposit_addresses")
      .select("user_id, chain, address");

    if (addrError) {
      return jsonResponse({
        error: "Database error loading deposit addresses",
        detail: addrError.message,
        hint: "Run supabase/migrations/20250520610000_grant_crypto_tables_service_role.sql in SQL Editor",
      }, 500);
    }

    const prices = await fetchUsdPrices();
    let credited = 0;
    let detected = 0;
    const scanErrors: string[] = [];

    for (const row of addresses ?? []) {
      const chain = row.chain as "sol" | "ltc" | "eth";

      let incoming: Awaited<ReturnType<typeof scanIncomingTransactions>> = [];
      try {
        incoming = await scanIncomingTransactions(chain, row.address);
      } catch (scanErr) {
        scanErrors.push(
          `${chain}:${scanErr instanceof Error ? scanErr.message : "scan failed"}`
        );
        continue;
      }

      for (const tx of incoming) {
        detected++;
        const required = REQUIRED_CONFIRMATIONS[chain];
        const status = tx.confirmations >= required ? "confirmed" : "pending";

        const { data: existing } = await supabase
          .from("crypto_deposits")
          .select("id, status")
          .eq("chain", chain)
          .eq("tx_hash", tx.txHash)
          .maybeSingle();

        if (existing) {
          if (existing.status === "pending" && status === "confirmed") {
            await supabase
              .from("crypto_deposits")
              .update({ confirmations: tx.confirmations, status: "confirmed" })
              .eq("id", existing.id);
          }
          if (existing.status === "credited" || existing.status === "swept") continue;
        } else {
          const usd = cryptoToUsd(tx.amount, chain, prices);
          const { data: inserted, error: insertError } = await supabase
            .from("crypto_deposits")
            .insert({
              user_id: row.user_id,
              chain,
              tx_hash: tx.txHash,
              address: row.address,
              crypto_amount: tx.amount,
              usd_amount: usd,
              exchange_rate: prices[chain],
              confirmations: tx.confirmations,
              required_confirmations: required,
              status,
            })
            .select("id, status, usd_amount, crypto_amount, exchange_rate")
            .single();

          if (insertError) {
            if (!insertError.message.includes("duplicate")) {
              scanErrors.push(`insert:${insertError.message}`);
            }
            continue;
          }

          if (inserted?.status === "confirmed") {
            const { error: creditError } = await supabase.rpc("credit_crypto_deposit", {
              p_user_id: row.user_id,
              p_usd_amount: inserted.usd_amount,
              p_chain: chain,
              p_tx_hash: tx.txHash,
              p_crypto_amount: inserted.crypto_amount,
              p_exchange_rate: inserted.exchange_rate,
              p_deposit_id: inserted.id,
            });
            if (creditError) {
              scanErrors.push(`credit:${creditError.message}`);
            } else {
              credited++;
            }
          }
        }

        if (existing && tx.confirmations >= required) {
          const { data: dep } = await supabase
            .from("crypto_deposits")
            .select("id, status, usd_amount, crypto_amount, exchange_rate")
            .eq("chain", chain)
            .eq("tx_hash", tx.txHash)
            .maybeSingle();

          if (dep?.status === "confirmed") {
            const { error: creditError } = await supabase.rpc("credit_crypto_deposit", {
              p_user_id: row.user_id,
              p_usd_amount: dep.usd_amount,
              p_chain: chain,
              p_tx_hash: tx.txHash,
              p_crypto_amount: dep.crypto_amount,
              p_exchange_rate: dep.exchange_rate,
              p_deposit_id: dep.id,
            });
            if (!creditError) credited++;
          }
        }
      }
    }

    return jsonResponse({
      success: true,
      addressCount: addresses?.length ?? 0,
      detected,
      credited,
      scanErrors: scanErrors.length ? scanErrors : undefined,
    });
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    return jsonResponse({ error: "Poll failed", detail: message, stack }, 500);
  }
});
