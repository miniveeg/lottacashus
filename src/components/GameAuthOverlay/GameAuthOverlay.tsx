import { useEffect, useId, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { loginUrl, signupUrl } from "../../lib/authRedirect";
import "./GameAuthOverlay.css";

interface GameAuthOverlayProps {
  /** Called when the user dismisses the overlay (Esc, backdrop click, or
   *  close button). When omitted, the overlay renders as a non-dismissable
   *  inline card (no backdrop, no close button, no Esc handler) — useful
   *  for static page sections. When provided, the overlay renders as a
   *  full modal dialog with focus trap, restore-focus, and aria-modal. */
  onClose?: () => void;
  /** Accessible label for the close button. Defaults to "Close". */
  closeLabel?: string;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function GameAuthOverlay({
  onClose,
  closeLabel = "Close",
}: GameAuthOverlayProps) {
  const { pathname } = useLocation();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const isModal = Boolean(onClose);

  // Keep the latest `onClose` in a ref so the modal lifecycle effect can
  // depend on `[isModal]` only. Without this, parents that pass an inline
  // (non-`useCallback`-memoized) `onClose` would cause the effect to
  // re-run on every parent render — the cleanup would restore focus to
  // the trigger, then the effect would immediately re-stash that element
  // and move focus back into the dialog, producing a visible focus
  // flicker (trigger → dialog) on every parent state change.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Modal lifecycle: focus the dialog on mount, trap Tab, restore focus on
  // unmount. The inline (non-modal) variant skips all of this. Runs once
  // per `isModal` transition (mount/unmount) — `onClose` is read via ref
  // so a new callback identity doesn't tear down focus management.
  useEffect(() => {
    if (!isModal) return;

    previouslyFocused.current = (document.activeElement as HTMLElement) ?? null;

    // Move focus into the dialog.
    const dialog = dialogRef.current;
    if (dialog) {
      const focusables = Array.from(
        dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      );
      (focusables[0] ?? dialog).focus();
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current?.();
        return;
      }
      if (e.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      );
      if (focusables.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !root.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !root.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      const prev = previouslyFocused.current;
      if (prev && typeof prev.focus === "function") {
        prev.focus();
      }
      previouslyFocused.current = null;
    };
  }, [isModal]);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isModal) return;
    // Only close when the click landed on the backdrop itself, not on the
    // card or its descendants.
    if (e.target === e.currentTarget) onCloseRef.current?.();
  };

  const card = (
    <div
      className="game-auth-overlay__card"
      ref={dialogRef}
      role="dialog"
      aria-modal={isModal ? "true" : undefined}
      aria-labelledby={titleId}
      tabIndex={-1}
    >
      {isModal && (
        <button
          type="button"
          className="game-auth-overlay__close"
          aria-label={closeLabel}
          onClick={onClose}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M6 6l12 12M18 6L6 18"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}
      <div className="game-auth-overlay__icon" aria-hidden="true">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="9" stroke="var(--lc-crimson-soft)" strokeWidth="1.5" />
          <path
            d="M12 7v5l3 3"
            stroke="var(--lc-crimson-soft)"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <h2 id={titleId} className="game-auth-overlay__title">
        Log in to play
      </h2>
      <p className="game-auth-overlay__text">
        You can browse the game board, but you need an account to place bets and win real balance.
      </p>
      <ul className="game-auth-overlay__perks">
        <li>Play all 8 original games</li>
        <li>Provably fair — verify every round</li>
        <li>Instant crypto deposits &amp; withdrawals</li>
        <li>Exclusive promotions &amp; affiliate rewards</li>
      </ul>
      <div className="game-auth-overlay__actions">
        <Link
          to={loginUrl(pathname)}
          className="game-auth-overlay__btn game-auth-overlay__btn--primary"
        >
          Log in
        </Link>
        <Link
          to={signupUrl(pathname)}
          className="game-auth-overlay__btn game-auth-overlay__btn--outline"
        >
          Create account
        </Link>
      </div>
    </div>
  );

  if (!isModal) {
    // Inline (non-modal) variant: render the card inside the existing
    // relative-positioned container. Used for static page sections.
    return <div className="game-auth-overlay">{card}</div>;
  }

  // Modal variant: full-screen backdrop + centered card. Click on the
  // backdrop (but not the card) dismisses.
  return (
    <div
      className="game-auth-overlay game-auth-overlay--modal"
      onClick={handleBackdropClick}
    >
      {card}
    </div>
  );
}
