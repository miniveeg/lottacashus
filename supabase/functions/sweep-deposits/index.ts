import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import {
  assertCronAuth,
  getExtraSweepEntries,
  getSweepFindLtcAddress,
  parseExtraSweepEntry,
  type Chain,
} from "../_shared/config.ts";
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
    let getMnemonic: () => string;
    let deriveWallet: (chain: Chain, index: number) => Promise<{ chain: Chain; derivationIndex: number; address: string; privateKeyHex?: string; privateKeyEth?: string }>;
    let sweepAddress: (wallet: Awaited<ReturnType<typeof deriveWallet>>) => Promise<string | null>;
    let getOnChainBalance: (
      chain: Chain,
      address: string
    ) => Promise<number>;

    try {
      const walletMod = await import("../_shared/crypto-wallet.ts");
      const sweepMod = await import("../_shared/sweep.ts");
      getMnemonic = walletMod.getMnemonic;
      deriveWallet = walletMod.deriveWallet;
      sweepAddress = sweepMod.sweepAddress;
      getOnChainBalance = sweepMod.getOnChainBalance;
    } catch (importErr) {
      return jsonResponse({
        error: "Failed to load crypto modules",
        detail: importErr instanceof Error ? importErr.message : String(importErr),
        hint: "Check CRYPTO_MASTER_MNEMONIC is set and redeploy sweep-deposits",
      }, 500);
    }

    try {
      getMnemonic();
    } catch (mnemonicErr) {
      return jsonResponse({
        error: mnemonicErr instanceof Error ? mnemonicErr.message : "Mnemonic missing",
        hint: 'npx supabase secrets set CRYPTO_MASTER_MNEMONIC="word1 word2 ..."',
      }, 500);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceKey) {
      return jsonResponse({ error: "Missing Supabase env keys" }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: addresses, error: addrError } = await supabase
      .from("user_deposit_addresses")
      .select("chain, address, derivation_index");

    if (addrError) {
      return jsonResponse({
        error: "Failed to load addresses",
        detail: addrError.message,
        hint: "Run supabase/migrations/20250520610000_grant_crypto_tables_service_role.sql",
      }, 500);
    }

    let swept = 0;
    const sweepErrors: string[] = [];
    const blockcypherToken = !!Deno.env.get("BLOCKCYPHER_TOKEN");

    for (const row of addresses ?? []) {
      const chain = row.chain as Chain;
      try {
        const wallet = await deriveWallet(chain, row.derivation_index);
        if (chain === "ltc" && !blockcypherToken) {
          sweepErrors.push(`ltc ${wallet.address}: BLOCKCYPHER_TOKEN not set`);
          continue;
        }
        const txHash = await sweepAddress(wallet);

        if (txHash) {
          swept++;
          await supabase
            .from("crypto_deposits")
            .update({ status: "swept", swept_at: new Date().toISOString() })
            .eq("address", row.address)
            .eq("status", "credited");
        }
      } catch (rowErr) {
        const raw = rowErr instanceof Error ? rowErr.message : "failed";
        const short = raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
        sweepErrors.push(`${chain}: ${short}`);
      }
    }

    const {
      findLtcWalletForAddress,
      ltcWalletVariantsFromPrivateKeyHex,
    } = await import("../_shared/crypto-wallet.ts");
    const extraResults: Array<{
      entry: string;
      address: string;
      balance: number;
      swept: boolean;
      txHash?: string;
      note?: string;
    }> = [];

    for (const entry of getExtraSweepEntries()) {
      const target = parseExtraSweepEntry(entry);
      if (!target) {
        sweepErrors.push(`extra: invalid entry ${entry.slice(0, 12)}…`);
        extraResults.push({
          entry: entry.slice(0, 20) + "…",
          address: "?",
          balance: 0,
          swept: false,
          note: "invalid format (use CHAIN_<64 hex private key>)",
        });
        continue;
      }

      try {
        if (target.chain === "ltc") {
          const variants = await ltcWalletVariantsFromPrivateKeyHex(target.privateKeyHex);
          for (const wallet of variants) {
            const balance = await getOnChainBalance("ltc", wallet.address);
            if (!blockcypherToken) {
              sweepErrors.push(`extra ltc ${wallet.address}: BLOCKCYPHER_TOKEN not set`);
              extraResults.push({
                entry: `LTC_${target.privateKeyHex.slice(0, 8)}… (${wallet.ltcScriptType})`,
                address: wallet.address,
                balance,
                swept: false,
                note: "BLOCKCYPHER_TOKEN required for LTC sweep",
              });
              continue;
            }
            if (balance <= 0.0001) {
              extraResults.push({
                entry: `LTC_${target.privateKeyHex.slice(0, 8)}… (${wallet.ltcScriptType})`,
                address: wallet.address,
                balance,
                swept: false,
                note: "no spendable balance on this address type",
              });
              continue;
            }
            const txHash = await sweepAddress(wallet);
            extraResults.push({
              entry: `LTC_${target.privateKeyHex.slice(0, 8)}… (${wallet.ltcScriptType})`,
              address: wallet.address,
              balance,
              swept: !!txHash,
              txHash: txHash ?? undefined,
              note: txHash ? undefined : "sweep attempted but no tx (check function logs)",
            });
            if (txHash) {
              swept++;
              await supabase
                .from("crypto_deposits")
                .update({ status: "swept", swept_at: new Date().toISOString() })
                .eq("address", wallet.address)
                .eq("status", "credited");
            }
          }
        } else {
          sweepErrors.push(`extra: ${target.chain} private-key sweep not supported`);
        }
      } catch (extraErr) {
        const msg = extraErr instanceof Error ? extraErr.message : "failed";
        sweepErrors.push(`extra ${target.chain}: ${msg}`);
        extraResults.push({
          entry: entry.slice(0, 20) + "…",
          address: "?",
          balance: 0,
          swept: false,
          note: msg,
        });
      }
    }

    const findLtc = getSweepFindLtcAddress();
    let findLtcResult: Record<string, unknown> | undefined;
    if (findLtc) {
      const balance = await getOnChainBalance("ltc", findLtc);
      const matched = await findLtcWalletForAddress(findLtc);
      if (!matched) {
        findLtcResult = {
          address: findLtc,
          balance,
          found: false,
          note:
            "Address not derived from CRYPTO_MASTER_MNEMONIC (indices 0–250). Export the private key from the wallet that owns this ltc1 address.",
        };
      } else if (!blockcypherToken) {
        findLtcResult = {
          address: findLtc,
          balance,
          found: true,
          derivationIndex: matched.derivationIndex,
          ltcScriptType: matched.ltcScriptType,
          swept: false,
          note: "BLOCKCYPHER_TOKEN required",
        };
      } else if (balance <= 0.0001) {
        findLtcResult = {
          address: findLtc,
          balance,
          found: true,
          derivationIndex: matched.derivationIndex,
          swept: false,
          note: "no spendable balance",
        };
      } else {
        const txHash = await sweepAddress(matched);
        if (txHash) {
          swept++;
          await supabase
            .from("crypto_deposits")
            .update({ status: "swept", swept_at: new Date().toISOString() })
            .eq("address", matched.address)
            .eq("status", "credited");
        }
        findLtcResult = {
          address: findLtc,
          balance,
          found: true,
          derivationIndex: matched.derivationIndex,
          ltcScriptType: matched.ltcScriptType,
          swept: !!txHash,
          txHash: txHash ?? undefined,
        };
      }
    }

    return jsonResponse({
      success: true,
      addressCount: addresses?.length ?? 0,
      extraSweepCount: extraResults.length,
      extraResults: extraResults.length ? extraResults : undefined,
      findLtc: findLtcResult,
      swept,
      blockcypherToken,
      note: "LTC sweeps via BlockCypher when BLOCKCYPHER_TOKEN is set; SOL and ETH sweep when balance above dust",
      sweepErrors: sweepErrors.length ? sweepErrors : undefined,
    });
  } catch (err) {
    console.error(err);
    return jsonResponse({
      error: "Sweep failed",
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});
