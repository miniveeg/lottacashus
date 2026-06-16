import { invokeEdgeFunction } from "./edgeFunctions";
import { supabase } from "./supabase";
import type { CryptoChain, DepositAddressResponse } from "../types/crypto";

export async function fetchDepositAddress(chain: CryptoChain) {
  return invokeEdgeFunction<DepositAddressResponse>("get-deposit-address", { chain });
}

export async function fetchMyDeposits() {
  const { data, error } = await supabase
    .from("crypto_deposits")
    .select(
      "id, chain, tx_hash, crypto_amount, usd_amount, confirmations, required_confirmations, status, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) return { data: null, error: error.message };
  return { data, error: null };
}

export async function requestWithdrawal(chain: CryptoChain, destination: string, usdAmount: number) {
  const { data, error } = await supabase.rpc("request_crypto_withdrawal", {
    p_chain: chain,
    p_destination: destination.trim(),
    p_usd_amount: usdAmount,
  });

  if (error) return { error: error.message };
  return { data: data as string, error: null };
}

export async function fetchMyWithdrawals() {
  const { data, error } = await supabase
    .from("crypto_withdrawals")
    .select("id, chain, destination_address, usd_amount, status, created_at, completed_at")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) return { data: null, error: error.message };
  return { data, error: null };
}

export function validateCryptoAddress(chain: CryptoChain, address: string): boolean {
  const a = address.trim();
  if (chain === "sol") return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);
  if (chain === "ltc") return /^(ltc1|[LM])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(a);
  if (chain === "eth") return /^0x[a-fA-F0-9]{40}$/.test(a);
  return false;
}
