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
import { localBalance } from "../lib/local-play";

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
  createdAt: string | null;
};

type ProfileContextValue = {
  profile: UserProfile | null;
  profileLoading: boolean;
  updateUsername: (username: string) => Promise<{ error: string | null }>;
  refreshProfile: () => Promise<void>;
};

const ProfileContext = createContext<ProfileContextValue | null>(null);

const PROFILE_SELECT =
  "username, email, is_admin, balance, sweeps_coins, total_wagered, total_deposited, total_withdrawn, total_wins, total_losses, discord_id, discord_username, discord_avatar, discord_linked_at, created_at";

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
    balance: parseNum(row.sweeps_coins),
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
    createdAt: (row.created_at as string | null) ?? null,
  };
}

const AUDIT_BYPASS = import.meta.env.VITE_AUDIT_BYPASS === "1";
const AUDIT_PROFILE: UserProfile | null = AUDIT_BYPASS
  ? {
      username: "AuditViewer",
      email: "auditor@lottacash.local",
      isAdmin: true,
      balance: 42.5,
      sweepsCoins: 42.5,
      totalWagered: 84210.5,
      totalDeposited: 1500.0,
      totalWithdrawn: 320.0,
      totalWins: 41200.0,
      totalLosses: 43010.5,
      discordId: null,
      discordUsername: null,
      discordAvatar: null,
      discordLinkedAt: null,
      createdAt: new Date(Date.now() - 90 * 86400000).toISOString(),
    }
  : null;

function makeThrottledApply(applyFn: (row: Record<string, unknown>, isAdmin: boolean | undefined) => void) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastAppliedAt = 0;
  let pendingRow: Record<string, unknown> | null = null;
  let pendingAdmin: boolean | undefined = undefined;
  const flush = () => {
    timer = null;
    if (!pendingRow) return;
    lastAppliedAt = Date.now();
    applyFn(pendingRow, pendingAdmin);
    pendingRow = null;
  };
  return {
    schedule(row: Record<string, unknown>, isAdmin: boolean | undefined) {
      pendingRow = row;
      pendingAdmin = isAdmin;
      const since = Date.now() - lastAppliedAt;
      if (since >= 200) {
        flush();
        return;
      }
      if (timer !== null) return;
      timer = setTimeout(flush, 200 - since);
    },
    cancel() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      pendingRow = null;
    },
  };
}

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { user, session, isGuest } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(AUDIT_PROFILE);
  const [profileLoading, setProfileLoading] = useState(AUDIT_BYPASS ? false : true);
  const profileRef = useRef<UserProfile | null>(null);
  profileRef.current = profile;

  const applyProfile = useCallback((row: Record<string, unknown> | null, isAdminOverride?: boolean) => {
    if (!row) return;
    setProfile((prev) => {
      const next = rowToProfile(row, isAdminOverride);
      void prev;
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
            createdAt: null,
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
    if (!isSupabaseConfigured || (user?.id === "guest" && !session?.access_token)) {
      setProfile((prev) =>
        prev
          ? { ...prev, balance: localBalance("sweeps_coins"), sweepsCoins: localBalance("sweeps_coins") }
          : prev
      );
      return;
    }
    await fetchProfile({ silent: true });
  }, [fetchProfile, user?.id, session?.access_token]);

  useEffect(() => {
    if (AUDIT_BYPASS) return;
    if (user?.id === "guest" || !session?.access_token) {
      const localProfile: UserProfile = {
        username: "Guest",
        email: null,
        isAdmin: false,
        balance: localBalance("sweeps_coins"),
        sweepsCoins: localBalance("sweeps_coins"),
        totalWagered: 0,
        totalDeposited: 0,
        totalWithdrawn: 0,
        totalWins: 0,
        totalLosses: 0,
        discordId: null,
        discordUsername: null,
        discordAvatar: null,
        discordLinkedAt: null,
        createdAt: null,
      };
      setProfile(localProfile);
      setProfileLoading(false);
      return;
    }
  }, [user?.id, session?.access_token]);

  useEffect(() => {
    if (isSupabaseConfigured && user?.id !== "guest") return;
    if (user?.id !== "guest" && isSupabaseConfigured) return;

    const syncLocal = () => {
      setProfile((prev) => {
        if (!prev) return prev;
        const sweepsCoins = localBalance("sweeps_coins");
        if (prev.balance === sweepsCoins && prev.sweepsCoins === sweepsCoins) return prev;
        return { ...prev, balance: sweepsCoins, sweepsCoins };
      });
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") syncLocal();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    const id = window.setInterval(syncLocal, 400);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.clearInterval(id);
    };
  }, [user?.id]);

  useEffect(() => {
    if (AUDIT_BYPASS) return;
    if (!user?.id || !session?.access_token) {
      if (user?.id !== "guest") {
        setProfile(null);
        setProfileLoading(false);
      }
      return;
    }

    const userId = user.id;
    const accessToken = session.access_token;
    let cancelled = false;
    let channel: RealtimeChannel | null = null;
    const throttle = makeThrottledApply((row, isAdmin) => applyProfile(row, isAdmin));

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
              throttle.cancel();
              setProfile(null);
              return;
            }
            if (payload.new) {
              const row = payload.new as Record<string, unknown>;
              throttle.schedule(row, Boolean(row.is_admin));
            }
          }
        )
        .subscribe();
    }

    start();

    const onVisible = () => {
      if (document.visibilityState === "visible") fetchProfile({ silent: true });
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    return () => {
      cancelled = true;
      throttle.cancel();
      if (channel) supabase.removeChannel(channel);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [user?.id, session?.access_token, fetchProfile, applyProfile]);

  const updateUsername = useCallback(
    async (username: string): Promise<{ error: string | null }> => {
      if (!user || isGuest || user.id === "guest") return { error: "You must be logged in." };
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
              createdAt: null,
            }
      );

      await supabase.auth.updateUser({ data: { username: trimmed } });
      return { error: null };
    },
    [user, isGuest]
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
