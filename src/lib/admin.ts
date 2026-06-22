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

/** Wrap a Supabase call in try/catch so thrown exceptions (network errors,
 *  realtime conflicts, etc.) are returned as AdminResult errors instead of
 *  becoming unhandled promise rejections that silently break the UI. */
async function safeCall<T>(
  fn: () => PromiseLike<{ data: T | null; error: PostgrestError | null }>
): Promise<AdminResult<T>> {
  try {
    const { data, error } = await fn();
    return fromPostgrest(data, error);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error("[admin] call failed:", message);
    return { data: null, error: { message, code: "EXCEPTION" } };
  }
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

// ── Stats ───────────────────────────────────────────────────────────────────

export async function fetchAdminStats(): Promise<AdminResult<AdminStats>> {
  if (!isSupabaseConfigured) return notConfigured<AdminStats>();

  const res = await safeCall(() => supabase.rpc("admin_get_stats"));
  if (res.error) return res;

  const row = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!row) {
    return {
      data: null,
      error: {
        message: "Stats RPC returned no data. Check that admin_get_stats exists and your user has admin access (is_admin = true in profiles).",
        code: "NO_DATA",
      },
    };
  }
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

// ── Withdrawals ──────────────────────────────────────────────────────────────

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

  // Try the RPC first.
  const res = await safeCall(() =>
    supabase.rpc("admin_list_withdrawals", { p_status: status })
  );

  if (!res.error && res.data) {
    const rows = res.data as Record<string, unknown>[];
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

  // Fallback: direct query on crypto_withdrawals. This works if RLS allows
  // the admin to read all rows, or at least their own.
  const statusFilter = status === "pending"
    ? ["pending", "processing"]
    : status === "all"
      ? undefined
      : [status];

  let query = supabase
    .from("crypto_withdrawals")
    .select("id, user_id, chain, destination_address, usd_amount, status, tx_hash, error_message, created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  if (statusFilter) {
    query = query.in("status", statusFilter);
  }

  const fallbackRes = await safeCall(() => query);
  if (fallbackRes.error || !fallbackRes.data) {
    return {
      data: null,
      error: res.error ?? fallbackRes.error ?? {
        message: "Failed to fetch withdrawals. Ensure admin_list_withdrawals RPC exists and your user has admin access.",
        code: "FETCH_FAILED",
      },
    };
  }

  // Fetch profiles for the withdrawal user_ids
  const userIds = [...new Set(fallbackRes.data.map((w) => w.user_id))] as string[];
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, username, email, balance")
    .in("id", userIds);

  const profileMap = new Map<string, { username: string | null; email: string | null; balance: number }>(
    (profiles ?? []).map((p) => [p.id as string, {
      username: (p.username as string | null) ?? null,
      email: (p.email as string | null) ?? null,
      balance: parseNum(p.balance),
    }])
  );

  return {
    data: fallbackRes.data.map((r) => {
      const profile = profileMap.get(r.user_id as string);
      return {
        id: r.id as string,
        userId: r.user_id as string,
        username: profile?.username ?? null,
        email: profile?.email ?? null,
        userBalance: profile?.balance ?? 0,
        chain: r.chain as string,
        destinationAddress: r.destination_address as string,
        usdAmount: parseNum(r.usd_amount),
        status: r.status as string,
        txHash: (r.tx_hash as string | null) ?? null,
        errorMessage: (r.error_message as string | null) ?? null,
        createdAt: r.created_at as string,
      };
    }),
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
  return safeCall(() =>
    supabase.rpc("admin_complete_crypto_withdrawal", {
      p_withdrawal_id: withdrawalId,
      p_tx_hash: trimmedHash,
    })
  );
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
  return safeCall(() =>
    supabase.rpc("admin_fail_crypto_withdrawal", {
      p_withdrawal_id: withdrawalId,
      p_error_message: trimmedErr || undefined,
    })
  );
}

// ── Deposits ────────────────────────────────────────────────────────────────

export async function fetchAdminRecentDeposits(): Promise<AdminResult<AdminDeposit[]>> {
  if (!isSupabaseConfigured) return notConfigured<AdminDeposit[]>();
  const res = await safeCall(() =>
    supabase.rpc("admin_list_recent_deposits", { p_limit: 15 })
  );
  if (res.error) return res;
  const rows = (res.data ?? []) as Record<string, unknown>[];
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

// ── Users ────────────────────────────────────────────────────────────────────

export async function searchAdminUsers(query: string): Promise<AdminResult<AdminUserResult[]>> {
  if (!isSupabaseConfigured) return notConfigured<AdminUserResult[]>();
  const trimmed = query?.trim();
  if (!isNonEmptyString(trimmed) || trimmed.length < 2) {
    return {
      data: null,
      error: { message: "Enter at least 2 characters to search.", code: "INVALID_INPUT" },
    };
  }
  const res = await safeCall(() =>
    supabase.rpc("admin_search_users", { p_query: trimmed })
  );
  if (res.error) return res;
  const rows = (res.data ?? []) as Record<string, unknown>[];
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
  return safeCall(() =>
    supabase.rpc("admin_set_user_admin", {
      p_user_id: userId,
      p_is_admin: isAdmin,
    })
  );
}

// ── Redemptions ──────────────────────────────────────────────────────────────

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
  const res = await safeCall(() =>
    supabase.rpc("admin_list_redemptions", { p_status: status })
  );
  if (res.error) return res;
  const rows = (res.data ?? []) as Record<string, unknown>[];
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
  return safeCall(() =>
    supabase.rpc("admin_process_redemption", {
      p_redemption_id: redemptionId,
      p_action: action,
      p_notes: trimmedNotes ?? null,
    })
  );
}

// ── Credit ──────────────────────────────────────────────────────────────────

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
  return safeCall(() =>
    supabase.rpc("admin_credit_user", {
      p_user_id: userId,
      p_amount: amount,
      p_note: trimmedNote,
      p_coin_type: coinType,
    })
  );
}
