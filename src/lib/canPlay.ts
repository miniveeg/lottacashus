import { useAuth } from "../contexts/AuthContext";

/**
 * Real logged-in user only — not guest / not offline synthetic.
 * Guests may browse game UIs but must not place bets.
 */
export function useCanPlay(): boolean {
  const { user, isGuest, loading } = useAuth();
  return Boolean(user) && !isGuest && !loading;
}
