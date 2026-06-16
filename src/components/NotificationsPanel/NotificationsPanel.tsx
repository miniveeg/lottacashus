import { useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { loginUrl } from "../../lib/authRedirect";
import { useNotifications } from "../../contexts/NotificationsContext";
import { NOTIFICATION_ICONS, type NotificationType } from "../../types/notification";
import "./NotificationsPanel.css";

function formatRelativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(
    new Date(iso)
  );
}

type Props = {
  open: boolean;
  onClose: () => void;
};

export function NotificationsPanel({ open, onClose }: Props) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const { notifications, loading, markAllRead, refresh } = useNotifications();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    void refresh().then(() => markAllRead());
  }, [open, refresh, markAllRead]);

  useEffect(() => {
    if (!open) return;

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }

    function onPointer(e: MouseEvent) {
      const target = e.target as Node;
      if (panelRef.current && !panelRef.current.contains(target)) {
        const btn = document.querySelector(".topbar__notif-wrap");
        if (btn?.contains(target)) return;
        onClose();
      }
    }

    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="notifications-panel__backdrop" aria-hidden="true" />
      <div
        ref={panelRef}
        className="notifications-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="notifications-panel-title"
      >
        <header className="notifications-panel__header">
          <h2 id="notifications-panel-title" className="notifications-panel__title">
            Notifications
          </h2>
          <button
            type="button"
            className="notifications-panel__close"
            onClick={onClose}
            aria-label="Close notifications"
          >
            ×
          </button>
        </header>

        <div className="notifications-panel__body">
          {!user ? (
            <p className="notifications-panel__empty">
              <Link to={loginUrl(pathname)} onClick={onClose}>
                Log in
              </Link>{" "}
              to see activity notifications.
            </p>
          ) : loading && notifications.length === 0 ? (
            <p className="notifications-panel__empty">Loading…</p>
          ) : notifications.length === 0 ? (
            <p className="notifications-panel__empty">
              No notifications yet. Deposits, withdrawals, and Discord activity will show up here.
            </p>
          ) : (
            <ul className="notifications-panel__list">
              {notifications.map((item) => {
                const type = item.type as NotificationType;
                const icon = NOTIFICATION_ICONS[type] ?? "•";
                const isUnread = !item.read_at;

                return (
                  <li
                    key={item.id}
                    className={`notifications-panel__item${isUnread ? " notifications-panel__item--unread" : ""}`}
                  >
                    <span className={`notifications-panel__icon notifications-panel__icon--${type}`}>
                      {icon}
                    </span>
                    <div className="notifications-panel__content">
                      <p className="notifications-panel__item-title">{item.title}</p>
                      <p className="notifications-panel__item-body">{item.body}</p>
                      <time className="notifications-panel__time" dateTime={item.created_at}>
                        {formatRelativeTime(item.created_at)}
                      </time>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
