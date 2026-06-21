import type { PostgrestError } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "./supabase";

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

/**
 * Public error shape returned by every admin helper. Mirrors the subset of
 * `PostgrestError` that callers actually read (`.message`). Synthesized when
 * Supabase is unconfigured or input validation fails so callers never see a
 * confusing network/CORS error against the placeholder Supabase host.
 */
export type AdminError = { message: string; code?: string };
export type AdminResult<T> = { data: T | null; error: AdminError | null };

const NOT_CONFIGURED_MESSAGE =
  "Admin tools are unavailable — Supabase is not configured. Add your project URL and anon key to .env.";

function notConfigured<T>(): AdminResult<T> {
  return { data: null, error: { message: NOT_CONFIGURED_MESSAGE, code: "NOT_CONFIGURED" } };
}

function fromPostgrest<T>(data: T | null, error: PostgrestError | null): AdminResult<T> {
  if (error) return { data: null, error: { message: error.message, code: error.code } };
  return { data, error: null };
}

function parseNum(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

const VALID_WITHDRAWAL_STATUSES = ["pending", "all", "completed", "failed"] as const;
type WithdrawalStatus = (typeof VALID_WITHDRAWAL_STATUSES)[number];

const VALID_REDEMPTION_STATUSES = ["pending", "all"] as const;
type RedemptionStatus = (typeof VALID_REDEMPTION_STATUSES)[number];

const VALID_COIN_TYPES = ["balance", "sweeps_coins"] as const;
type CoinType = (typeof VALID_COIN_TYPES)[number];

export async function fetchAdminStats(): Promise<AdminResult<AdminStats>> {
  if (!isSupabaseConfigured) return notConfigured<AdminStats>();
  const { data, error } = await supabase.rpc("admin_get_stats");
  if (error) return fromPostgrest<AdminStats>(null, error);
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

export async function fetchAdminWithdrawals(
  status: WithdrawalStatus = "pending"
): Promise<AdminResult<AdminWithdrawal[]>> {
  if (!isSupabaseConfigured) return notConfigured<AdminWithdrawal[]>();
  if (!VALID_WITHDRAWAL_STATUSES.includes(status)) {
    return {
      data: null,
      error: { message: `Invalid withdrawal status: ${status}`, code: "INVALID_INPUT" },
    };
  }
  const { data, error } = await supabase.rpc("admin_list_withdrawals", { p_status: status });
  if (error) return fromPostgrest<AdminWithdrawal[]>(null, error);
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

export async function fetchAdminRecentDeposits(): Promise<AdminResult<AdminDeposit[]>> {
  if (!isSupabaseConfigured) return notConfigured<AdminDeposit[]>();
  const { data, error } = await supabase.rpc("admin_list_recent_deposits", { p_limit: 15 });
  if (error) return fromPostgrest<AdminDeposit[]>(null, error);
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

export async function completeAdminWithdrawal(
  withdrawalId: string,
  txHash: string
): Promise<AdminResult<unknown>> {
  if (!isSupabaseConfigured) return notConfigured<unknown>();
  if (!isNonEmptyString(withdrawalId)) {
    return { data: null, error: { message: "Withdrawal ID is required.", code: "INVALID_INPUT" } };
  }
  const trimmedHash = txHash?.trim();
  if (!isNonEmptyString(trimmedHash)) {
    return { data: null, error: { message: "Transaction hash is required.", code: "INVALID_INPUT" } };
  }
  const { data, error } = await supabase.rpc("admin_complete_crypto_withdrawal", {
    p_withdrawal_id: withdrawalId,
    p_tx_hash: trimmedHash,
  });
  return fromPostgrest(data, error);
}

export async function failAdminWithdrawal(
  withdrawalId: string,
  errorMessage?: string
): Promise<AdminResult<unknown>> {
  if (!isSupabaseConfigured) return notConfigured<unknown>();
  if (!isNonEmptyString(withdrawalId)) {
    return { data: null, error: { message: "Withdrawal ID is required.", code: "INVALID_INPUT" } };
  }
  const trimmedErr = errorMessage?.trim();
  const { data, error } = await supabase.rpc("admin_fail_crypto_withdrawal", {
    p_withdrawal_id: withdrawalId,
    p_error_message: trimmedErr || undefined,
  });
  return fromPostgrest(data, error);
}

export async function searchAdminUsers(query: string): Promise<AdminResult<AdminUserResult[]>> {
  if (!isSupabaseConfigured) return notConfigured<AdminUserResult[]>();
  const trimmed = query?.trim();
  if (!isNonEmptyString(trimmed) || trimmed.length < 2) {
    return {
      data: null,
      error: { message: "Enter at least 2 characters to search.", code: "INVALID_INPUT" },
    };
  }
  const { data, error } = await supabase.rpc("admin_search_users", { p_query: trimmed });
  if (error) return fromPostgrest<AdminUserResult[]>(null, error);
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

export async function setUserAdmin(
  userId: string,
  isAdmin: boolean
): Promise<AdminResult<unknown>> {
  if (!isSupabaseConfigured) return notConfigured<unknown>();
  if (!isNonEmptyString(userId)) {
    return { data: null, error: { message: "User ID is required.", code: "INVALID_INPUT" } };
  }
  const { data, error } = await supabase.rpc("admin_set_user_admin", {
    p_user_id: userId,
    p_is_admin: isAdmin,
  });
  return fromPostgrest(data, error);
}

export async function fetchAdminRedemptions(
  status: RedemptionStatus = "pending"
): Promise<AdminResult<AdminRedemption[]>> {
  if (!isSupabaseConfigured) return notConfigured<AdminRedemption[]>();
  if (!VALID_REDEMPTION_STATUSES.includes(status)) {
    return {
      data: null,
      error: { message: `Invalid redemption status: ${status}`, code: "INVALID_INPUT" },
    };
  }
  const { data, error } = await supabase.rpc("admin_list_redemptions", { p_status: status });
  if (error) return fromPostgrest<AdminRedemption[]>(null, error);
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
): Promise<AdminResult<unknown>> {
  if (!isSupabaseConfigured) return notConfigured<unknown>();
  if (!isNonEmptyString(redemptionId)) {
    return { data: null, error: { message: "Redemption ID is required.", code: "INVALID_INPUT" } };
  }
  if (action !== "approve" && action !== "reject") {
    return { data: null, error: { message: `Invalid action: ${action}`, code: "INVALID_INPUT" } };
  }
  const trimmedNotes = notes?.trim() || undefined;
  const { data, error } = await supabase.rpc("admin_process_redemption", {
    p_redemption_id: redemptionId,
    p_action: action,
    p_notes: trimmedNotes ?? null,
  });
  return fromPostgrest(data, error);
}

export async function adminCreditUser(
  userId: string,
  amount: number,
  note: string,
  coinType: CoinType = "balance"
): Promise<AdminResult<unknown>> {
  if (!isSupabaseConfigured) return notConfigured<unknown>();
  if (!isNonEmptyString(userId)) {
    return { data: null, error: { message: "User ID is required.", code: "INVALID_INPUT" } };
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      data: null,
      error: { message: "Amount must be a positive number.", code: "INVALID_INPUT" },
    };
  }
  if (!VALID_COIN_TYPES.includes(coinType)) {
    return { data: null, error: { message: `Invalid coin type: ${coinType}`, code: "INVALID_INPUT" } };
  }
  const trimmedNote = note?.trim() || "Admin credit";
  const { data, error } = await supabase.rpc("admin_credit_user", {
    p_user_id: userId,
    p_amount: amount,
    p_note: trimmedNote,
    p_coin_type: coinType,
  });
  return fromPostgrest(data, error);
}
