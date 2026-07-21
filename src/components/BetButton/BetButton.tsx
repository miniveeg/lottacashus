import type { ButtonHTMLAttributes } from "react";
import "./BetButton.css";

type Variant = "primary" | "secondary" | "win" | "danger";

interface BetButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "disabled"> {
  /** What the button says when ready. e.g. "Bet", "Spin", "Deal". */
  label: string;
  /**
   * When true the button shows a spinner and is disabled. Used by every
   * game to show in-flight RPC activity on the primary action. Default: false.
   */
  busy?: boolean;
  /**
   * When true the button shows a blocked state and is disabled. Optional;
   * games may use this for other soft gates. Default: false.
   */
  exceedsCap?: boolean;
  /**
   * Caller-controlled disabled flag — AND-gated into `effectiveDisabled`
   * alongside the `busy`/`exceedsCap` auto-states. Use for game-logic
   * gates (e.g. Mines cashout when no gems revealed; Keno bet when user
   * picked zero numbers). Default: false.
   */
  disabled?: boolean;
  /** Override busy / blocked button labels. */
  busyLabel?: string;
  exceedsCapLabel?: string;
  /** Alternative action color set. Default: "primary" (crimson brand). */
  variant?: Variant;
}

/**
 * Canonical primary action button for every game page.
 *
 * Audit finding (Tier 1 #4): each of the 7 games had its own bet-button
 * implementation with parallel logic — `disabled = busy || exceedsCap`,
 * `aria-disabled`, copy line "{busyLabel ?? exceedsCapLabel ?? label}",
 * and an `aria-busy` flag for screen readers. Plus each game kept its
 * own CSS class (`.bj__deal-btn`, `.keno__bet-btn`, etc.) that re-derived
 * the same crimson gradient pattern. This component produces all that
 * behavior from a single 7-line call site.
 *
 * Design choice: this component renders a plain `<button>` (not a React
 * abstract) so any caller can drop in custom click handlers / event
 * listeners / refs without rebuilding the abstraction. The "shape" of a
 * bet button is consistent; the behavior is always page-specific.
 */
export function BetButton({
  label,
  busy = false,
  exceedsCap = false,
  disabled: callerDisabled = false,
  busyLabel = "Working…",
  exceedsCapLabel = "Payout exceeds cap",
  variant = "primary",
  className,
  children,
  ...rest
}: BetButtonProps) {
  // AND-gate the caller-provided `disabled` flag with the auto-states so
  // game-logic gates (no picks, no gems) compose cleanly with busy/cap.
  const effectiveDisabled = busy || exceedsCap || callerDisabled;
  const effectiveLabel = busy
    ? busyLabel
    : exceedsCap
      ? exceedsCapLabel
      : children ?? label;

  const cls = [
    "bet-btn",
    `bet-btn--${variant}`,
    busy && "bet-btn--busy",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={cls}
      disabled={effectiveDisabled}
      aria-busy={busy || undefined}
      aria-disabled={effectiveDisabled || undefined}
      {...rest}
    >
      {busy && <span className="bet-btn__spinner" aria-hidden="true" />}
      <span className="bet-btn__label">{effectiveLabel}</span>
    </button>
  );
}
