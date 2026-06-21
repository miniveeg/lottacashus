import { useCallback, useEffect, useRef } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { loginUrl } from "../../lib/authRedirect";
import { useNotifications } from "../../contexts/NotificationsContext";
import {
  NOTIFICATION_ICONS,
  type NotificationType,
  type UserNotification,
} from "../../types/notification";
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

/**
 * Map a notification type to the route that shows its details. Clicking a
 * notification item navigates here (and closes the panel).
 */
function notificationRoute(type: NotificationType): string {
  switch (type) {
    case "deposit_detected":
    case "deposit_credited":
      return "/deposit";
    case "withdrawal_started":
    case "withdrawal_completed":
    case "withdrawal_failed":
      return "/withdraw";
    case "discord_linked":
    case "discord_link_failed":
      return "/settings";
  }
}

type Props = {
  open: boolean;
  onClose: () => void;
};

// Selector for focusable elements inside the panel (used by the Tab trap).
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function NotificationsPanel({ open, onClose }: Props) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { notifications, loading, markAllRead, refresh } = useNotifications();
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // Topbar passes an inline arrow for `onClose`, so its identity changes on
  // every parent render. Keep the latest value in a ref so the document
  // listener effect doesn't tear down and re-subscribe on every render (which
  // would happen if `onClose` were in the effect's dep array).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Refresh + mark-all-read whenever the panel opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void refresh()
      .then(() => {
        if (cancelled) return;
        // Mark all as read after a successful refresh. `markAllRead` no-ops
        // when there's no user, so this is safe for guests (who never see
        // the panel body anyway).
        return markAllRead();
      })
      .catch(() => {
        /* refresh() never throws — NotificationsContext swallows supabase
           errors internally. Defensive guard for future changes. */
      });
    return () => {
      cancelled = true;
    };
  }, [open, refresh, markAllRead]);

  // Escape (close), click-outside (close), focus trap (Tab/Shift+Tab wrap),
  // and focus management (move focus into the panel on open, restore to the
  // bell button on close). All in one effect keyed on `open` only.
  useEffect(() => {
    if (!open) return;

    // Stash the currently-focused element (the bell button) so we can restore
    // focus to it when the panel closes.
    previouslyFocusedRef.current = (document.activeElement as HTMLElement) ?? null;

    // Move focus into the panel after it mounts. Defer one rAF so the panel's
    // CSS transition has started and the close button is measurable.
    const rafId = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const first = panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      if (first) {
        first.focus();
      } else {
        // No focusable child (e.g. empty state with just text) — focus the
        // panel itself so keyboard users can still Escape.
        panel.focus();
      }
    });

    function isInsidePanelOrTrigger(target: Node): boolean {
      const panel = panelRef.current;
      if (!panel) return false;
      if (panel.contains(target)) return true;
      // The bell button lives in `.topbar__notif-wrap`, which is also the
      // parent of the panel in the DOM (see Topbar.tsx). Clicks on the bell
      // button itself shouldn't close the panel here — the bell's onClick
      // toggles `notifOpen` and will close it.
      const wrap = (target as HTMLElement).closest?.(".topbar__notif-wrap");
      return Boolean(wrap && wrap.contains(panel));
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((el) => {
        // Skip elements hidden via display:none (offsetParent is null for
        // non-position:fixed hidden elements). `offsetParent` is null for
        // `display:none` elements and for `position:fixed` elements — the
        // panel itself isn't fixed, so this is a reliable visibility check
        // for its descendants.
        return el.offsetParent !== null || el === document.activeElement;
      });
      if (focusables.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !panel.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !panel.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    function onPointer(e: MouseEvent) {
      if (isInsidePanelOrTrigger(e.target as Node)) return;
      onCloseRef.current();
    }

    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      cancelAnimationFrame(rafId);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
      // Restore focus to the bell button (or whatever opened the panel).
      const prev = previouslyFocusedRef.current;
      if (prev && typeof prev.focus === "function") {
        prev.focus();
      }
      previouslyFocusedRef.current = null;
    };
  }, [open]);

  const handleItemClick = useCallback(
    (item: UserNotification) => {
      navigate(notificationRoute(item.type));
      onClose();
    },
    [navigate, onClose]
  );

  if (!open) return null;

  return (
    <>
      <div
        className="notifications-panel__backdrop"
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className="notifications-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="notifications-panel-title"
        tabIndex={-1}
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
            <p className="notifications-panel__empty" role="status" aria-live="polite">
              Loading…
            </p>
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
                    {/* The whole item is a button so it's keyboard-activatable
                        (Enter/Space) and announced as interactive by SRs.
                        Span wrappers render as block via CSS to preserve the
                        original visual layout (a <div>/<p> would be invalid
                        phrasing content inside a <button>). */}
                    <button
                      type="button"
                      className="notifications-panel__item-btn"
                      onClick={() => handleItemClick(item)}
                      aria-label={`${item.title}: ${item.body}. Open related page.`}
                    >
                      <span
                        className={`notifications-panel__icon notifications-panel__icon--${type}`}
                        aria-hidden="true"
                      >
                        {icon}
                      </span>
                      <span className="notifications-panel__content">
                        <span className="notifications-panel__item-title">{item.title}</span>
                        <span className="notifications-panel__item-body">{item.body}</span>
                        <time className="notifications-panel__time" dateTime={item.created_at}>
                          {formatRelativeTime(item.created_at)}
                        </time>
                      </span>
                    </button>
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
