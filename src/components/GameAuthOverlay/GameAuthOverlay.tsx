import { Link } from "react-router-dom";
import { useLocation } from "react-router-dom";
import "./GameAuthOverlay.css";

export function GameAuthOverlay() {
  const { pathname } = useLocation();
  const redirect = encodeURIComponent(pathname);

  return (
    <div className="game-auth-overlay">
      <div className="game-auth-overlay__card">
        <div className="game-auth-overlay__icon" aria-hidden="true">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" stroke="var(--lc-crimson-soft)" strokeWidth="1.5" />
            <path d="M12 7v5l3 3" stroke="var(--lc-crimson-soft)" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
        <h2 className="game-auth-overlay__title">Log in to play</h2>
        <p className="game-auth-overlay__text">
          You can browse the game board, but you need an account to place bets and win real balance.
        </p>
        <ul className="game-auth-overlay__perks">
          <li>Play all 6 original games</li>
          <li>Provably fair — verify every round</li>
          <li>Instant crypto deposits & withdrawals</li>
          <li>Exclusive promotions & affiliate rewards</li>
        </ul>
        <div className="game-auth-overlay__actions">
          <Link
            to={`/login?redirect=${redirect}`}
            className="game-auth-overlay__btn game-auth-overlay__btn--primary"
          >
            Log in
          </Link>
          <Link
            to={`/signup?redirect=${redirect}`}
            className="game-auth-overlay__btn game-auth-overlay__btn--outline"
          >
            Create account
          </Link>
        </div>
      </div>
    </div>
  );
}
