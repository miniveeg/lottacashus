import { Link } from "react-router-dom";
import "./NeedFundsHint.css";

interface NeedFundsHintProps {
  /**
   * Optional className passed through to the container so a page can apply
   * page-specific spacing/color modifiers without redefining the component.
   */
  className?: string;
  /**
   * Override the helper message. Default: "Need funds? Deposit".
   */
  message?: string;
  /**
   * Show a "free SC mail-in" alternate link alongside deposit. Defaults to
   * true — promoting free entry lowers the barrier for users who haven't
   * completed KYC or want to test the platform risk-free.
   */
  showFreeEntry?: boolean;
}

/**
 * Canonical "Need funds? Deposit" footer used in every betting surface.
 *
 * Audit finding (L9): the "Need funds? Deposit" link was copy-pasted into 7
 * game pages with slightly varied markup (`<p className="slots__hint">`,
 * `<p className="mines__hint">`, `<p className="bj__hint">`, ...) — every page
 * also had its own matching CSS. This component collapses all of that
 * into one shared element so any future copy/CTA change ships from one place.
 *
 * Accessibility:
 *  - Container is a `<p>` with no special role (it's hint copy, not an alert).
 *  - The Deposit link is keyboard-reachable and uses the site's standard
 *    Link component so a11y attributes stay consistent.
 *  - The optional Free Entry link points to /free-entry so users who can't
 *    or don't want to deposit can still play via the AMOE path.
 */
export function NeedFundsHint({
  className,
  message = "Need funds?",
  showFreeEntry = true,
}: NeedFundsHintProps) {
  const cls = ["need-funds-hint", className].filter(Boolean).join(" ");
  return (
    <p className={cls}>
      {message}{" "}
      <Link to="/deposit" className="need-funds-hint__link">
        Deposit
      </Link>
      {showFreeEntry && (
        <>
          {" · "}
          <Link to="/free-entry" className="need-funds-hint__link">
            or free SC entry
          </Link>
        </>
      )}
    </p>
  );
}
