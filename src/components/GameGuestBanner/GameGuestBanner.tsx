import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { loginUrl, signupUrl } from "../../lib/authRedirect";
import "./GameGuestBanner.css";

/** sessionStorage key used to remember that the user dismissed the guest
 *  banner during the current browser session. We use sessionStorage (not
 *  localStorage) so the banner reappears on the next visit — the goal is to
 *  suppress the nag WITHIN a single browsing session, not permanently hide
 *  the login CTA from a returning guest. */
const DISMISS_KEY = "lottacash_guest_banner_dismissed";

/** Read the dismiss flag from sessionStorage. Returns false on the server
 *  or when sessionStorage is unavailable (private mode / quota exceeded). */
function readDismissedFromStorage(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

/** Shown on game pages when the visitor is not logged in (browse-only). */
export function GameGuestBanner() {
  const { user, loading } = useAuth();
  const { pathname } = useLocation();
  // Lazy initializer reads sessionStorage once on first client render.
  // AppShell (which mounts this component) is dynamic-imported with
  // `ssr:false`, so this initializer only runs in the browser — no
  // hydration-mismatch risk.
  const [dismissed, setDismissed] = useState(readDismissedFromStorage);

  // Re-evaluate the dismiss flag whenever the auth state flips to
  // logged-in or back to guest, so a returning guest sees the banner fresh
  // (and a user who dismissed it in another tab in the same session sees
  // the dismissal honored). This is the standard "sync external storage
  // when deps change" pattern; the `set-state-in-effect` lint rule is a
  // false positive here because sessionStorage is an external source that
  // we must poll (it fires no same-tab events).
  useEffect(() => {
    if (loading) return;
    if (user) {
      // Logged-in users never see the banner; no need to manage state.
      return;
    }
    setDismissed(readDismissedFromStorage());
  }, [loading, user]);

  if (loading || user || dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    try {
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(DISMISS_KEY, "1");
      }
    } catch {
      /* sessionStorage unavailable — banner stays dismissed in-memory only */
    }
  };

  return (
    <div className="game-guest-banner" role="status">
      <p className="game-guest-banner__text">
        You&apos;re browsing as a guest. Log in or create an account to play for real balance.
      </p>
      <div className="game-guest-banner__actions">
        <Link
          to={loginUrl(pathname)}
          className="game-guest-banner__btn game-guest-banner__btn--primary"
        >
          Log in
        </Link>
        <Link
          to={signupUrl(pathname)}
          className="game-guest-banner__btn game-guest-banner__btn--ghost"
        >
          Sign up
        </Link>
        <button
          type="button"
          className="game-guest-banner__dismiss"
          aria-label="Dismiss guest banner (won't show again this session)"
          onClick={handleDismiss}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M6 6l12 12M18 6L6 18"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
