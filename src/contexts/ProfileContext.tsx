import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "../lib/supabase";
import { normalizeUsername, validateUsername } from "../lib/username";
import { useAuth } from "./AuthContext";

export type UserProfile = {
  username: string | null;
  email: string | null;
  isAdmin: boolean;
  balance: number;
  sweepsCoins: number;
  totalWagered: number;
  totalDeposited: number;
  totalWithdrawn: number;
  totalWins: number;
  totalLosses: number;
  discordId: string | null;
  discordUsername: string | null;
  discordAvatar: string | null;
  discordLinkedAt: string | null;
};

type ProfileContextValue = {
  profile: UserProfile | null;
  profileLoading: boolean;
  updateUsername: (username: string) => Promise<{ error: string | null }>;
  refreshProfile: () => Promise<void>;
};

const ProfileContext = createContext<ProfileContextValue | null>(null);

const BALANCE_POLL_MS = 1500;

const PROFILE_SELECT =
  "username, email, is_admin, balance, sweeps_coins, total_wagered, total_deposited, total_withdrawn, total_wins, total_losses, discord_id, discord_username, discord_avatar, discord_linked_at";

function parseNum(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeProfileRow(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== "object") return null;
  if (Array.isArray(data)) return (data[0] as Record<string, unknown>) ?? null;
  return data as Record<string, unknown>;
}

function rowToProfile(row: Record<string, unknown>, isAdminOverride?: boolean): UserProfile {
  return {
    username: (row.username as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    isAdmin: isAdminOverride ?? Boolean(row.is_admin),
    balance: parseNum(row.balance),
    sweepsCoins: parseNum(row.sweeps_coins),
    totalWagered: parseNum(row.total_wagered),
    totalDeposited: parseNum(row.total_deposited),
    totalWithdrawn: parseNum(row.total_withdrawn),
    totalWins: parseNum(row.total_wins),
    totalLosses: parseNum(row.total_losses),
    discordId: (row.discord_id as string | null) ?? null,
    discordUsername: (row.discord_username as string | null) ?? null,
    discordAvatar: (row.discord_avatar as string | null) ?? null,
    discordLinkedAt: (row.discord_linked_at as string | null) ?? null,
  };
}

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { user, session } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  // Start `true` so that consumers (e.g. AdminRoute, ProtectedRoute) don't
  // briefly see `profileLoading=false` + `profile=null` on the very first
  // render after a user becomes available — that combination would cause a
  // flash-of-wrong-redirect (the route guard treats "no profile + not loading"
  // as "definitely not an admin" and bounces to `/`). The bootstrap effect
  // below will flip this to `false` once the profile fetch settles, or
  // immediately if there is no user.
  const [profileLoading, setProfileLoading] = useState(true);
  const profileRef = useRef<UserProfile | null>(null);
  profileRef.current = profile;

  const applyProfile = useCallback((row: Record<string, unknown> | null, isAdminOverride?: boolean) => {
    if (!row) return;
    setProfile((prev) => {
      const next = rowToProfile(row, isAdminOverride);
      if (isAdminOverride === undefined && prev?.isAdmin && !next.isAdmin) {
        return { ...next, isAdmin: true };
      }
      return next;
    });
  }, []);

  const fetchProfile = useCallback(
    async (opts?: { showLoading?: boolean; silent?: boolean }) => {
      if (!isSupabaseConfigured || !user) return;

      if (opts?.showLoading) setProfileLoading(true);

      const [{ data, error }, adminRes] = await Promise.all([
        supabase.rpc("ensure_user_profile"),
        supabase.rpc("is_current_user_admin"),
      ]);

      const isAdminFlag = adminRes.error ? undefined : adminRes.data === true;

      if (error) {
        const { data: row } = await supabase
          .from("profiles")
          .select(PROFILE_SELECT)
          .eq("id", user.id)
          .maybeSingle();

        if (row) applyProfile(row as Record<string, unknown>, isAdminFlag);
        else if (!opts?.silent) {
          setProfile({
            username: user.user_metadata?.username ?? null,
            email: user.email ?? null,
            isAdmin: false,
            balance: 0,
            sweepsCoins: 0,
            totalWagered: 0,
            totalDeposited: 0,
            totalWithdrawn: 0,
            totalWins: 0,
            totalLosses: 0,
            discordId: null,
            discordUsername: null,
            discordAvatar: null,
            discordLinkedAt: null,
          });
        }
      } else {
        const row = normalizeProfileRow(data);
        if (row) applyProfile(row, isAdminFlag);
        else if (!opts?.silent) {
          const { data: rowFallback } = await supabase
            .from("profiles")
            .select(PROFILE_SELECT)
            .eq("id", user.id)
            .maybeSingle();
          if (rowFallback) applyProfile(rowFallback as Record<string, unknown>, isAdminFlag);
        }
      }

      if (opts?.showLoading) setProfileLoading(false);
    },
    [user, applyProfile]
  );

  const refreshProfile = useCallback(async () => {
    await fetchProfile({ silent: true });
  }, [fetchProfile]);

  useEffect(() => {
    if (!user?.id || !session?.access_token) {
      setProfile(null);
      setProfileLoading(false);
      return;
    }

    const userId = user.id;
    const accessToken = session.access_token;
    let cancelled = false;
    let channel: RealtimeChannel | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    // Synchronously mark loading as soon as we know we have a user — this
    // closes the gap between the auth state flipping to "logged in" and the
    // async `start()` function reaching `fetchProfile({ showLoading: true })`.
    // Without this, route guards like AdminRoute see `profileLoading=false` +
    // `profile=null` for one render and bounce to `/`.
    setProfileLoading(true);

    async function start() {
      await supabase.realtime.setAuth(accessToken);
      if (cancelled) return;
      await fetchProfile({ showLoading: true });
      if (cancelled) return;

      channel = supabase
        .channel(`profile-${userId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "profiles", filter: `id=eq.${userId}` },
          (payload) => {
            if (payload.eventType === "DELETE") {
              setProfile(null);
              return;
            }
            if (payload.new) {
              const row = payload.new as Record<string, unknown>;
              applyProfile(row, Boolean(row.is_admin));
            }
          }
        )
        .subscribe();

      pollTimer = setInterval(() => {
        if (document.visibilityState === "visible") fetchProfile({ silent: true });
      }, BALANCE_POLL_MS);
    }

    start();

    const onVisible = () => {
      if (document.visibilityState === "visible") fetchProfile({ silent: true });
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
      if (pollTimer) clearInterval(pollTimer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [user?.id, session?.access_token, fetchProfile, applyProfile]);

  const updateUsername = useCallback(
    async (username: string): Promise<{ error: string | null }> => {
      if (!user) return { error: "You must be logged in." };
      const trimmed = normalizeUsername(username);
      const validationError = validateUsername(username);
      if (validationError) return { error: validationError };

      const { error } = await supabase.from("profiles").update({ username: trimmed }).eq("id", user.id);
      if (error) return { error: error.message };

      setProfile((prev) =>
        prev
          ? { ...prev, username: trimmed }
          : {
              username: trimmed,
              email: user.email ?? null,
              isAdmin: false,
              balance: 0,
              sweepsCoins: 0,
              totalWagered: 0,
              totalDeposited: 0,
              totalWithdrawn: 0,
              totalWins: 0,
              totalLosses: 0,
              discordId: null,
              discordUsername: null,
              discordAvatar: null,
              discordLinkedAt: null,
            }
      );

      await supabase.auth.updateUser({ data: { username: trimmed } });
      return { error: null };
    },
    [user]
  );

  const value = useMemo(
    () => ({ profile, profileLoading, updateUsername, refreshProfile }),
    [profile, profileLoading, updateUsername, refreshProfile]
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile() {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error("useProfile must be used within ProfileProvider");
  return ctx;
}
