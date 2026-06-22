import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useAuth } from "../../contexts/AuthContext";
import { loginUrl } from "../../lib/authRedirect";
import { useProfile } from "../../contexts/ProfileContext";
import { fetchRecentChatMessages, rowToChatMessage, sendChatMessage, enrichChatMessagesWithLevels } from "../../lib/chat";
import { levelFromWagered } from "../../lib/leveling";
import { LevelBadge } from "../Level/LevelBadge";
import { supabase } from "../../lib/supabase";
import { MAX_CHAT_MESSAGE_LENGTH, type ChatMessage } from "../../types/chat";

function formatChatTime(iso: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function SidebarChat() {
  const { user, session, configured } = useAuth();
  const { pathname } = useLocation();
  const { profile } = useProfile();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Early exit when Supabase isn't configured. This prevents the loadMessages
  // and realtime-subscribe effects below from running fetches / channel
  // subscriptions against an unconfigured client, which would log errors on
  // every render in dev environments without env vars.
  if (!configured) {
    return (
      <div className="sidebar-chat">
        <p className="sidebar-chat__notice">Chat is unavailable — Supabase is not configured.</p>
      </div>
    );
  }

  const displayName =
    profile?.username ?? user?.user_metadata?.username ?? user?.email?.split("@")[0] ?? "Player";

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const loadMessages = useCallback(async () => {
    if (!configured || !user) {
      setMessages([]);
      setLoading(false);
      return;
    }

    const { data, error: loadError } = await fetchRecentChatMessages();
    if (loadError) setError(loadError);
    else setError(null);
    setMessages(data);
    setLoading(false);
  }, [configured, user]);

  useEffect(() => {
    loadMessages().then(() => scrollToBottom());
  }, [loadMessages, scrollToBottom]);

  useEffect(() => {
    if (!user?.id || !session?.access_token || !configured) return;

    const accessToken = session.access_token;
    let channel: RealtimeChannel | null = null;
    let cancelled = false;

    async function subscribe() {
      const token = accessToken;
      await supabase.realtime.setAuth(token);
      if (cancelled) return;

      channel = supabase
        .channel("site-chat")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "chat_messages" },
          (payload) => {
            if (!payload.new) return;
            const msg = rowToChatMessage(payload.new as Record<string, unknown>);
            void enrichChatMessagesWithLevels([msg]).then(([enriched]) => {
              setMessages((prev) => {
                if (prev.some((m) => m.id === enriched.id)) return prev;
                return [...prev, enriched];
              });
              requestAnimationFrame(() => scrollToBottom());
            });
          }
        )
        .subscribe();
    }

    subscribe();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [user?.id, session?.access_token, configured, scrollToBottom]);

  useEffect(() => {
    scrollToBottom();
  }, [messages.length, scrollToBottom]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSending(true);
    const { data, error: sendError } = await sendChatMessage(draft, displayName);
    setSending(false);

    if (sendError) {
      setError(sendError);
      return;
    }

    setDraft("");
    if (data) {
      const level = levelFromWagered(profile?.totalWagered ?? 0);
      setMessages((prev) =>
        prev.some((m) => m.id === data.id) ? prev : [...prev, { ...data, level }]
      );
    }
  }

  if (!user) {
    return (
      <div className="sidebar-chat">
        <p className="sidebar-chat__notice">
          <Link to={loginUrl(pathname)}>Log in</Link> to join the live chat with other players.
        </p>
      </div>
    );
  }

  return (
    <div className="sidebar-chat">
      <div className="sidebar-chat__header">
        <p className="sidebar-chat__title">Live chat</p>
        <p className="sidebar-chat__subtitle">Everyone on the site</p>
      </div>

      <div className="sidebar-chat__messages" ref={listRef} aria-live="polite" aria-relevant="additions">
        {loading ? (
          <div className="lc-loading sidebar-chat__loading">
            <div className="lc-loading__pulse" aria-hidden />
            <p>Loading messages…</p>
          </div>
        ) : messages.length === 0 ? (
          <p className="sidebar-chat__empty">No messages yet. Say hello!</p>
        ) : (
          <ul className="sidebar-chat__list">
            {messages.map((msg) => {
              const isOwn = msg.user_id === user.id;
              return (
                <li
                  key={msg.id}
                  className={`sidebar-chat__msg${isOwn ? " sidebar-chat__msg--own" : ""}`}
                >
                  <div className="sidebar-chat__msg-meta">
                    <span className="sidebar-chat__msg-user-row">
                      {msg.level != null && (
                        <LevelBadge level={msg.level} size="sm" title={`Level ${msg.level}`} />
                      )}
                      <span className="sidebar-chat__msg-user">{msg.username}</span>
                    </span>
                    <time className="sidebar-chat__msg-time" dateTime={msg.created_at}>
                      {formatChatTime(msg.created_at)}
                    </time>
                  </div>
                  <p className="sidebar-chat__msg-body">{msg.body}</p>
                </li>
              );
            })}
          </ul>
        )}
        <div ref={bottomRef} />
      </div>

      <form className="sidebar-chat__form" onSubmit={handleSubmit}>
        {error && (
          <p className="sidebar-chat__error" role="alert">
            {error}
          </p>
        )}
        <div className="sidebar-chat__input-row">
          <input
            type="text"
            className="sidebar-chat__input"
            placeholder="Type a message…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={MAX_CHAT_MESSAGE_LENGTH}
            disabled={sending}
            aria-label="Chat message"
          />
          <button type="submit" className="sidebar-chat__send" disabled={sending || !draft.trim()}>
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
