import type { ButtonHTMLAttributes } from "react";
import { useCanPlay } from "../../lib/canPlay";
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
   * alongside the `busy`/`exceedsCap` auto-states and login requirement.
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
 * Guests / logged-out users always see a disabled control (no popup).
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
  onClick,
  ...rest
}: BetButtonProps) {
  const canPlay = useCanPlay();

  const effectiveDisabled = busy || exceedsCap || callerDisabled || !canPlay;
  const effectiveLabel = !canPlay
    ? "Log in to play"
    : busy
      ? busyLabel
      : exceedsCap
        ? exceedsCapLabel
        : (children ?? label);

  const cls = [
    "bet-btn",
    `bet-btn--${variant}`,
    busy && "bet-btn--busy",
    !canPlay && "bet-btn--guest",
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
      title={!canPlay ? "Log in to place bets" : rest.title}
      onClick={(e) => {
        if (!canPlay) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
      {...rest}
    >
      {busy && <span className="bet-btn__spinner" aria-hidden="true" />}
      <span className="bet-btn__label">{effectiveLabel}</span>
    </button>
  );
}
