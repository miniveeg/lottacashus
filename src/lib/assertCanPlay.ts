import type { User } from "@supabase/supabase-js";
import { isSupabaseConfigured } from "./supabase";

/**
 * Real-money path guard. Returns an error message when the caller must not
 * place a bet / start a hand against the live backend.
 *
 * Local-play (isSupabaseConfigured === false) intentionally allows guests.
 */
export function realMoneyBetError(
  user: User | null | undefined,
  isGuest: boolean
): string | null {
  if (!isSupabaseConfigured) return null;
  if (!user || isGuest || user.id === "guest") {
    return "Sign in to place real bets.";
  }
  return null;
}
