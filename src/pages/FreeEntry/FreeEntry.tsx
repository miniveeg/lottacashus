import { Link } from "react-router-dom";
import { signupUrl } from "../../lib/authRedirect";
import "./FreeEntry.css";

export function FreeEntry() {
  return (
    <div className="free-entry lc-page lc-page--narrow">
      <header className="lc-page__header free-entry__header">
        <h1 className="lc-page__title free-entry__title">Free Sweeps Coins Entry</h1>
        <p className="lc-page__subtitle free-entry__subtitle">
          No purchase necessary. You can obtain Sweeps Coins (SC) free of charge by mail as
          required by sweepstakes law.
        </p>
      </header>

      <section className="free-entry__section lc-panel">
        <h2 className="free-entry__section-title">How it works</h2>
        <ol className="free-entry__steps">
          <li>
            <strong>Write a letter</strong> — Handwrite a physical letter that includes your
            LottaCash username, the email address associated with your account, and your return
            address.
          </li>
          <li>
            <strong>Mail it</strong> — Send your letter to the address below. Use a standard
            envelope with sufficient postage.
          </li>
          <li>
            <strong>Get credited</strong> — We will credit <strong>10 Sweeps Coins (SC)</strong>{" "}
            to your account within 14 business days of receiving your request.
          </li>
        </ol>
        <p className="free-entry__note">
          Limit one request per household per calendar month. Bulk or machine-generated requests
          will not be honored.
        </p>
      </section>

      <section className="free-entry__section lc-panel">
        <h2 className="free-entry__section-title">Mailing address</h2>
        <div className="free-entry__address">
          <p>LottaCash Sweepstakes</p>
          <p>[Address Line 1]</p>
          <p>[City, State ZIP]</p>
        </div>
        <p className="free-entry__note">
          We are currently setting up our mailing address. Check back soon or contact us at{" "}
          <a href="mailto:support@lottacash.us">support@lottacash.us</a> with questions.
        </p>
      </section>

      <section className="free-entry__section lc-panel">
        <h2 className="free-entry__section-title">Already have an account?</h2>
        <p className="free-entry__text">
          If you already have a LottaCash account, just include your username in your letter and
          we will credit the SC to your account.
        </p>
        <p className="free-entry__text">
          Dont have an account yet?{" "}
          <Link to={signupUrl("/free-entry")} className="free-entry__link">
            Sign up first
          </Link>{" "}
          so you have a username to include in your letter.
        </p>
      </section>

      <section className="free-entry__section lc-panel">
        <h2 className="free-entry__section-title">Why free entry?</h2>
        <p className="free-entry__text">
          Sweepstakes law requires that all participants have a method of entry that does not
          require any purchase or payment. Offering free Sweeps Coins by mail satisfies this
          requirement and ensures our platform operates legally. Every SC obtained through this
          method is fully redeemable on the same terms as SC obtained through purchases.
        </p>
        <p className="free-entry__text">
          For full details, see our{" "}
          <Link to="/sweepstakes" className="free-entry__link">
            Sweepstakes Rules
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
