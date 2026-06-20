import { supabase, isSupabaseConfigured } from "./supabase";

let sessionStart: number | null = null;

export async function trackSessionActivity(): Promise<void> {
  if (sessionStart === null) {
    sessionStart = Date.now();
  }
}

export async function getSessionDuration(_userId?: string): Promise<number> {
  if (sessionStart === null) {
    return 0;
  }
  return Date.now() - sessionStart;
}

export function resetSessionTracking(): void {
  sessionStart = null;
}

export type SelfExclusion = {
  expiresAt: string;
  remainingDays: number;
};

export type DepositLimits = {
  daily: number | null;
  weekly: number | null;
  dailyUsed: number;
  weeklyUsed: number;
};

export async function fetchSelfExclusion(): Promise<SelfExclusion | null> {
  if (!isSupabaseConfigured) return null;

  const { data, error } = await supabase.rpc("check_self_exclusion");
  if (error) {
    console.error("check_self_exclusion:", error);
    return null;
  }

  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
  if (!row?.excluded) return null;

  return {
    expiresAt: String(row.excluded_until ?? ""),
    remainingDays: Number(row.remaining_days ?? 0),
  };
}

export async function createSelfExclusion(
  days: 30 | 90 | 180,
  reason?: string
): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured) return { error: "Supabase is not configured." };
  void reason; // Reason is captured client-side for future use; server RPC currently only takes days.

  const { error } = await supabase.rpc("self_exclude", { p_days: days });
  return { error: error?.message ?? null };
}

export async function cancelSelfExclusion(): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured) return { error: "Supabase is not configured." };

  const { error } = await supabase.rpc("cancel_self_exclusion");
  return { error: error?.message ?? null };
}

export async function fetchDepositLimits(): Promise<DepositLimits | null> {
  if (!isSupabaseConfigured) return null;

  const { data, error } = await supabase.rpc("get_deposit_limits");
  if (error) {
    console.error("get_deposit_limits:", error);
    return null;
  }

  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
  if (!row) return null;

  return {
    daily: (row.daily_limit as number | null) ?? null,
    weekly: (row.weekly_limit as number | null) ?? null,
    dailyUsed: Number(row.daily_used ?? 0),
    weeklyUsed: Number(row.weekly_used ?? 0),
  };
}

export async function setDepositLimits(
  daily: number | null,
  weekly: number | null
): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured) return { error: "Supabase is not configured." };

  const { error } = await supabase.rpc("set_deposit_limits", {
    p_daily_limit: daily,
    p_weekly_limit: weekly,
  });
  return { error: error?.message ?? null };
}
