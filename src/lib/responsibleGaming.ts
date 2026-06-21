import { supabase, isSupabaseConfigured } from "./supabase";

const NOT_CONFIGURED_ERROR = "Supabase is not configured. Add your keys to .env.";

/**
 *  Per-user session-time tracking.
 *
 *  The previous implementation used a single module-level `sessionStart`
 *  shared across all users — so if user A signed out and user B signed in on
 *  the same browser (without a full page reload), user B inherited user A's
 *  session-start timestamp. The 1-hour responsible-gaming reminder would then
 *  fire at the wrong time for user B (or never fire, if user A had already
 *  passed the 1-hour mark).
 *
 *  We now key the session start by `userId`. `trackSessionActivity(userId)`
 *  sets the start on first sight of a given user; `getSessionDuration(userId)`
 *  reads it. Switching users resets the tracked start automatically.
 */
const sessionStartByUser = new Map<string, number>();

/** Record that the given user is actively in a session. Sets the session
 *  start timestamp on first sight of `userId`; subsequent calls are no-ops
 *  (the start is preserved so the duration grows over time). If `userId`
 *  differs from any previously-tracked user, the new user's start is set
 *  independently (other users' entries are left intact for possible
 *  re-sign-in). */
export async function trackSessionActivity(userId?: string): Promise<void> {
  if (!userId) return;
  if (!sessionStartByUser.has(userId)) {
    sessionStartByUser.set(userId, Date.now());
  }
}

/** Returns the elapsed session duration in milliseconds for `userId`, or 0
 *  if the user has no active tracked session. */
export async function getSessionDuration(userId?: string): Promise<number> {
  if (!userId) return 0;
  const start = sessionStartByUser.get(userId);
  if (start === undefined) return 0;
  return Date.now() - start;
}

/** Clear the session-start tracking for `userId` (or all users if omitted).
 *  Should be called on sign-out so a subsequent sign-in as the same user
 *  starts a fresh session. */
export function resetSessionTracking(userId?: string): void {
  if (userId === undefined) {
    sessionStartByUser.clear();
    return;
  }
  sessionStartByUser.delete(userId);
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

/** Coerce an unknown RPC row into a `SelfExclusion | null`. Returns null if
 *  the row is missing, the `excluded` flag is falsy, or the shape is wrong. */
function mapSelfExclusion(row: unknown): SelfExclusion | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  if (!r.excluded) return null;
  const remaining = Number(r.remaining_days ?? 0);
  return {
    expiresAt: String(r.excluded_until ?? ""),
    remainingDays: Number.isFinite(remaining) ? remaining : 0,
  };
}

export async function fetchSelfExclusion(): Promise<SelfExclusion | null> {
  if (!isSupabaseConfigured) return null;

  const { data, error } = await supabase.rpc("check_self_exclusion");
  if (error) {
    console.error("check_self_exclusion:", error);
    return null;
  }

  const row = (Array.isArray(data) ? data[0] : data) as unknown;
  return mapSelfExclusion(row);
}

export async function createSelfExclusion(
  days: 30 | 90 | 180,
  reason?: string
): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured) return { error: NOT_CONFIGURED_ERROR };
  void reason; // Reason is captured client-side for future use; server RPC currently only takes days.

  const { error } = await supabase.rpc("self_exclude", { p_days: days });
  return { error: error?.message ?? null };
}

export async function cancelSelfExclusion(): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured) return { error: NOT_CONFIGURED_ERROR };

  const { error } = await supabase.rpc("cancel_self_exclusion");
  return { error: error?.message ?? null };
}

/** Coerce an unknown RPC row into a `DepositLimits | null`. Returns null if
 *  the row is missing or the shape is wrong. Numeric fields are
 *  `Number()`-coerced with a finite-check fallback to 0. */
function mapDepositLimits(row: unknown): DepositLimits | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const daily = r.daily_limit;
  const weekly = r.weekly_limit;
  const dailyUsed = Number(r.daily_used ?? 0);
  const weeklyUsed = Number(r.weekly_used ?? 0);
  return {
    daily: typeof daily === "number" && Number.isFinite(daily) ? daily : null,
    weekly: typeof weekly === "number" && Number.isFinite(weekly) ? weekly : null,
    dailyUsed: Number.isFinite(dailyUsed) ? dailyUsed : 0,
    weeklyUsed: Number.isFinite(weeklyUsed) ? weeklyUsed : 0,
  };
}

export async function fetchDepositLimits(): Promise<DepositLimits | null> {
  if (!isSupabaseConfigured) return null;

  const { data, error } = await supabase.rpc("get_deposit_limits");
  if (error) {
    console.error("get_deposit_limits:", error);
    return null;
  }

  const row = (Array.isArray(data) ? data[0] : data) as unknown;
  return mapDepositLimits(row);
}

export async function setDepositLimits(
  daily: number | null,
  weekly: number | null
): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured) return { error: NOT_CONFIGURED_ERROR };

  // Reject NaN early — `set_deposit_limits` would otherwise store a NULL
  // (or fail with a confusing Postgres error) when the user pasted
  // non-numeric text into the form.
  if (daily !== null && !Number.isFinite(daily)) {
    return { error: "Daily limit must be a number." };
  }
  if (weekly !== null && !Number.isFinite(weekly)) {
    return { error: "Weekly limit must be a number." };
  }

  const { error } = await supabase.rpc("set_deposit_limits", {
    p_daily_limit: daily,
    p_weekly_limit: weekly,
  });
  return { error: error?.message ?? null };
}
