import "./FormAlert.css";

type FormAlertKind = "error" | "success" | "warning" | "info";

interface FormAlertProps {
  /** The message to surface. */
  children: React.ReactNode;
  /** Visual variant. Default: "error". */
  kind?: FormAlertKind;
  /**
   * Accessibility role. Default: `"alert"` for errors, `"status"` for
   * everything else (matches the Toast component convention so screen reader
   * announcements are consistent across the site).
   */
  role?: "alert" | "status" | "note";
  /** Optional id for ARIA wiring (referenced by aria-describedby). */
  id?: string;
  /** Optional className for page-specific tweaks. */
  className?: string;
  /** Visually hidden icon. Show/hide on a per-page basis. */
  showIcon?: boolean;
}

/**
 * Canonical inline form alert.
 *
 * Audit finding (Tier 6): the codebase contained 12+ variants of the same
 * red-banner / green-banner markup — `.auth-error`, `.auth-success`,
 * `.auth-config-warning`, `.bj__error`, `.mines__error`, `.keno__error`,
 * `.limbo__error`, `.roulette__error`, `.slots__paytable-error`,
 * `.crash__error`, `.cb__error`, `.wallet__error`, `.wallet__success`,
 * `.settings__error`, `.settings__success`, `.promos__affiliate-error`,
 * `.profile-referral__msg`, `.auth-hint`, etc. — each with its own CSS
 * declaration that re-derived the same color triple from the (now-stable)
 * theme tokens. This component produces exactly the same visual outcome
 * via `lc-alert lc-alert--{kind}` (already in lc-pages.css) plus an opt-in
 * icon for prominence where the surrounding chrome allows.
 *
 * Usage:
 *   <FormAlert>{error}</FormAlert>
 *   <FormAlert kind="success" id="withdraw-success">{success}</FormAlert>
 *   <FormAlert kind="warning">{msg}</FormAlert>
 *
 * Design choice: this component does NOT introduce a new CSS class hierarchy.
 * It delegates to the existing `.lc-alert` + `.lc-alert--{kind}` system so
 * the visual identity stays single-sourced in lc-pages.css. Adding a
 * duplicate set of `.form-alert__*` rules would defeat the audit goal.
 */
export function FormAlert({
  children,
  kind = "error",
  role,
  id,
  className,
  showIcon = false,
}: FormAlertProps) {
  // Errors are announced assertively; everything else is announced politely.
  // Defaults match the legacy per-page alert class semantics:
  //  - `error`                       → assertive `alert`
  //  - `warning` (e.g. config-notice) → `note` (informational, not a status update)
  //  - `success` / `info`            → polite `status`
  const ariaRole =
    role ?? (kind === "error" ? "alert" : kind === "warning" ? "note" : "status");
  const cls = ["lc-alert", `lc-alert--${kind}`, className]
    .filter(Boolean)
    .join(" ");
  return (
    <p id={id} className={cls} role={ariaRole}>
      {showIcon && (
        <span className="form-alert__icon" aria-hidden="true">
          {kind === "error"
            ? "!"
            : kind === "success"
              ? "✓"
              : kind === "warning"
                ? "⚠"
                : "i"}
        </span>
      )}
      <span className="form-alert__body">{children}</span>
    </p>
  );
}
