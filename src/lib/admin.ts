import { supabase } from "./supabase";

export type AdminStats = {
  pendingWithdrawals: number;
  pendingWithdrawalsUsd: number;
  totalUsers: number;
  creditedDeposits24h: number;
};

export type AdminWithdrawal = {
  id: string;
  userId: string;
  username: string | null;
  email: string | null;
  userBalance: number;
  chain: string;
  destinationAddress: string;
  usdAmount: number;
  status: string;
  txHash: string | null;
  errorMessage: string | null;
  createdAt: string;
};

export type AdminDeposit = {
  id: string;
  userId: string;
  username: string | null;
  chain: string;
  usdAmount: number;
  txHash: string;
  creditedAt: string | null;
};

export type AdminUserResult = {
  id: string;
  username: string | null;
  email: string | null;
  balance: number;
  sweepsCoins: number;
  isAdmin: boolean;
  createdAt: string;
};

function parseNum(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export async function fetchAdminStats() {
  const { data, error } = await supabase.rpc("admin_get_stats");
  if (error) return { data: null as AdminStats | null, error };
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { data: null, error: null };
  return {
    data: {
      pendingWithdrawals: parseNum(row.pending_withdrawals),
      pendingWithdrawalsUsd: parseNum(row.pending_withdrawals_usd),
      totalUsers: parseNum(row.total_users),
      creditedDeposits24h: parseNum(row.credited_deposits_24h),
    },
    error: null,
  };
}

export async function fetchAdminWithdrawals(status: "pending" | "all" | "completed" | "failed" = "pending") {
  const { data, error } = await supabase.rpc("admin_list_withdrawals", { p_status: status });
  if (error) return { data: null as AdminWithdrawal[] | null, error };
  const rows = (data ?? []) as Record<string, unknown>[];
  return {
    data: rows.map((r) => ({
      id: r.id as string,
      userId: r.user_id as string,
      username: (r.username as string | null) ?? null,
      email: (r.email as string | null) ?? null,
      userBalance: parseNum(r.user_balance),
      chain: r.chain as string,
      destinationAddress: r.destination_address as string,
      usdAmount: parseNum(r.usd_amount),
      status: r.status as string,
      txHash: (r.tx_hash as string | null) ?? null,
      errorMessage: (r.error_message as string | null) ?? null,
      createdAt: r.created_at as string,
    })),
    error: null,
  };
}

export async function fetchAdminRecentDeposits() {
  const { data, error } = await supabase.rpc("admin_list_recent_deposits", { p_limit: 15 });
  if (error) return { data: null as AdminDeposit[] | null, error };
  const rows = (data ?? []) as Record<string, unknown>[];
  return {
    data: rows.map((r) => ({
      id: r.id as string,
      userId: r.user_id as string,
      username: (r.username as string | null) ?? null,
      chain: r.chain as string,
      usdAmount: parseNum(r.usd_amount),
      txHash: r.tx_hash as string,
      creditedAt: (r.credited_at as string | null) ?? null,
    })),
    error: null,
  };
}

export async function completeAdminWithdrawal(withdrawalId: string, txHash: string) {
  return supabase.rpc("admin_complete_crypto_withdrawal", {
    p_withdrawal_id: withdrawalId,
    p_tx_hash: txHash,
  });
}

export async function failAdminWithdrawal(withdrawalId: string, errorMessage?: string) {
  return supabase.rpc("admin_fail_crypto_withdrawal", {
    p_withdrawal_id: withdrawalId,
    p_error_message: errorMessage ?? undefined,
  });
}

export async function searchAdminUsers(query: string) {
  const { data, error } = await supabase.rpc("admin_search_users", { p_query: query });
  if (error) return { data: null as AdminUserResult[] | null, error };
  const rows = (data ?? []) as Record<string, unknown>[];
  return {
    data: rows.map((r) => ({
      id: r.id as string,
      username: (r.username as string | null) ?? null,
      email: (r.email as string | null) ?? null,
      balance: parseNum(r.balance),
      sweepsCoins: parseNum(r.sweeps_coins),
      isAdmin: Boolean(r.is_admin),
      createdAt: r.created_at as string,
    })),
    error: null,
  };
}

export async function setUserAdmin(userId: string, isAdmin: boolean) {
  return supabase.rpc("admin_set_user_admin", {
    p_user_id: userId,
    p_is_admin: isAdmin,
  });
}

export type AdminRedemption = {
  id: string;
  userId: string;
  username: string | null;
  email: string | null;
  scAmount: number;
  paypalEmail: string;
  status: string;
  reviewedBy: string | null;
  notes: string | null;
  createdAt: string;
};

export async function fetchAdminRedemptions(status: "pending" | "all" = "pending") {
  const { data, error } = await supabase.rpc("admin_list_redemptions", { p_status: status });
  if (error) return { data: null as AdminRedemption[] | null, error };
  const rows = (data ?? []) as Record<string, unknown>[];
  return {
    data: rows.map((r) => ({
      id: r.id as string,
      userId: r.user_id as string,
      username: (r.username as string | null) ?? null,
      email: (r.email as string | null) ?? null,
      scAmount: parseNum(r.sc_amount),
      paypalEmail: r.paypal_email as string,
      status: r.status as string,
      reviewedBy: (r.reviewed_by as string | null) ?? null,
      notes: (r.notes as string | null) ?? null,
      createdAt: r.created_at as string,
    })),
    error: null,
  };
}

export async function processAdminRedemption(
  redemptionId: string,
  action: "approve" | "reject",
  notes?: string
) {
  return supabase.rpc("admin_process_redemption", {
    p_redemption_id: redemptionId,
    p_action: action,
    p_notes: notes ?? null,
  });
}

export async function adminCreditUser(userId: string, amount: number, note: string, coinType = "balance") {
  return supabase.rpc("admin_credit_user", {
    p_user_id: userId,
    p_amount: amount,
    p_note: note,
    p_coin_type: coinType,
  });
}
