import { Link } from "react-router-dom";
import "./NeedFundsHint.css";

interface NeedFundsHintProps {
  /**
   * Optional className passed through to the container so a page can apply
   * page-specific spacing/color modifiers without redefining the component.
   */
  className?: string;
  /**
   * Override the helper message. Default: "Need funds?".
   */
  message?: string;
}

/**
 * Canonical "Need funds? Deposit" footer used in every betting surface.
 *
 * Audit finding (L9): the "Need funds? Deposit" link was copy-pasted into 7
 * game pages with slightly varied markup — this component is the single source.
 */
export function NeedFundsHint({
  className,
  message = "Need funds?",
}: NeedFundsHintProps) {
  const cls = ["need-funds-hint", className].filter(Boolean).join(" ");
  return (
    <p className={cls}>
      {message}{" "}
      <Link to="/deposit" className="need-funds-hint__link">
        Deposit
      </Link>
    </p>
  );
}
