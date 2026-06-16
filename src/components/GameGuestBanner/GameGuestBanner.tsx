import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { loginUrl, signupUrl } from "../../lib/authRedirect";
import "./GameGuestBanner.css";

/** Shown on game pages when the visitor is not logged in (browse-only). */
export function GameGuestBanner() {
  const { user, loading } = useAuth();
  const { pathname } = useLocation();

  if (loading || user) return null;

  return (
    <div className="game-guest-banner" role="status">
      <p className="game-guest-banner__text">
        You&apos;re browsing as a guest. Log in or create an account to play for real balance.
      </p>
      <div className="game-guest-banner__actions">
        <Link to={loginUrl(pathname)} className="game-guest-banner__btn game-guest-banner__btn--primary">
          Log in
        </Link>
        <Link to={signupUrl(pathname)} className="game-guest-banner__btn game-guest-banner__btn--ghost">
          Sign up
        </Link>
      </div>
    </div>
  );
}
