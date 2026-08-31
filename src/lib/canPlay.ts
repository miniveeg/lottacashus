import { useAuth } from "../contexts/AuthContext";

/**
 * True when the current visitor may place a bet in this session.
 *
 * Local/demo play (Supabase unconfigured) synthesizes a guest and runs
 * client-side — those bets are allowed. Real-money bets still require a
 * logged-in, non-guest user. Game handlers also call `realMoneyBetError`
 * on the bet path so the live backend cannot be charged as a guest.
 */
export function useCanPlay(): boolean {
  const { user, isGuest, loading, configured } = useAuth();
  if (loading) return false;
  if (!configured) return true;
  return Boolean(user) && !isGuest;
}
