import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { rowToNotification } from "../lib/notifications";
import { isSupabaseConfigured, supabase } from "../lib/supabase";
import type { UserNotification } from "../types/notification";
import { useAuth } from "./AuthContext";

type NotificationsContextValue = {
  notifications: UserNotification[];
  loading: boolean;
  unreadCount: number;
  refresh: () => Promise<void>;
  markAllRead: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
};

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user, session } = useAuth();
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchNotifications = useCallback(async () => {
    if (!isSupabaseConfigured || !user) {
      setNotifications([]);
      return;
    }

    const { data, error } = await supabase
      .from("user_notifications")
      .select("id, type, title, body, metadata, read_at, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (!error && data) {
      setNotifications(data.map((row) => rowToNotification(row as Record<string, unknown>)));
    }
  }, [user]);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    await fetchNotifications();
    setLoading(false);
  }, [user, fetchNotifications]);

  const markAllRead = useCallback(async () => {
    if (!user) return;
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("user_notifications")
      .update({ read_at: now })
      .eq("user_id", user.id)
      .is("read_at", null);

    if (!error) {
      setNotifications((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? now })));
    }
  }, [user]);

  const markRead = useCallback(
    async (id: string) => {
      if (!user) return;
      const now = new Date().toISOString();
      const { error } = await supabase
        .from("user_notifications")
        .update({ read_at: now })
        .eq("id", id)
        .eq("user_id", user.id);

      if (!error) {
        setNotifications((prev) =>
          prev.map((n) => (n.id === id ? { ...n, read_at: n.read_at ?? now } : n))
        );
      }
    },
    [user]
  );

  useEffect(() => {
    if (!user?.id || !session?.access_token) {
      setNotifications([]);
      return;
    }

    const userId = user.id;
    const accessToken = session.access_token;
    let cancelled = false;
    let channel: RealtimeChannel | null = null;

    async function start() {
      await supabase.realtime.setAuth(accessToken);
      if (cancelled) return;
      await fetchNotifications();

      channel = supabase
        .channel(`notifications-${userId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "user_notifications",
            filter: `user_id=eq.${userId}`,
          },
          (payload) => {
            if (payload.new) {
              const item = rowToNotification(payload.new as Record<string, unknown>);
              setNotifications((prev) => {
                if (prev.some((n) => n.id === item.id)) return prev;
                return [item, ...prev].slice(0, 50);
              });
            }
          }
        )
        .subscribe();
    }

    start();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [user?.id, session?.access_token, fetchNotifications]);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read_at).length,
    [notifications]
  );

  const value = useMemo(
    () => ({ notifications, loading, unreadCount, refresh, markAllRead, markRead }),
    [notifications, loading, unreadCount, refresh, markAllRead, markRead]
  );

  return (
    <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error("useNotifications must be used within NotificationsProvider");
  return ctx;
}
