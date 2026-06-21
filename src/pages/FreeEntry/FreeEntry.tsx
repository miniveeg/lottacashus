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

      <section className="free-entry__section lc-panel" aria-label="Sign up bonus">
        <h2 className="free-entry__section-title">Sign up bonus — 10,000 GC + 100 SC Free</h2>
        <p className="free-entry__text">
          Every new player receives <strong>10,000 Gold Coins (GC)</strong> and{" "}
          <strong>100 Sweeps Coins (SC)</strong> just for creating an account — no purchase
          necessary. Use your GC for fun play across all games, and your free SC to play for a
          chance to win real money. Any winnings from SC are yours to redeem.
        </p>
        <p className="free-entry__text">
          Simply{" "}
          <Link to={signupUrl("/free-entry")} className="free-entry__link">
            sign up
          </Link>
          , verify your email, and the 10,000 GC and 100 SC will be credited to your account
          automatically.
        </p>
      </section>

      <section className="free-entry__section lc-panel" aria-label="Mail-in free entry">
        <h2 className="free-entry__section-title">Mail-in free entry</h2>
        <p className="free-entry__text">
          To request free Sweeps Coins by mail — no purchase necessary — handwrite a letter
          containing <strong>all</strong> of the following information and mail it to the address
          below. Requests missing any required field, or any request that is not handwritten, will
          not be honored.
        </p>
        <ul className="free-entry__checklist">
          <li>Your <strong>full legal name</strong></li>
          <li>Your <strong>return mailing address</strong> (street, city, state, ZIP/postal code, country)</li>
          <li>Your <strong>email address</strong></li>
          <li>Your <strong>LottaCash username</strong> (sign up first if you don&apos;t have one)</li>
          <li>Your <strong>date of birth</strong> (you must be 18+ to participate)</li>
          <li>The <strong>date</strong> of your request</li>
          <li>A <strong>handwritten signature</strong></li>
          <li>
            A brief handwritten statement that you have read and agree to the{" "}
            <Link to="/sweepstakes" className="free-entry__link">Official Sweepstakes Rules</Link>
          </li>
        </ul>
        <ol className="free-entry__steps">
          <li>
            <strong>Write a letter</strong> — Handwrite a physical letter that includes every
            item listed above. Typed, printed, photocopied, or machine-generated entries will not
            be accepted.
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
        <p className="free-entry__note" role="note">
          Limit one request per household per calendar month. Bulk or machine-generated requests
          will not be honored. SC obtained via mail-in entry are redeemable on the same terms as SC
          obtained through any other method.
        </p>
      </section>

      <section className="free-entry__section lc-panel" aria-label="Mailing address">
        <h2 className="free-entry__section-title">Mailing address</h2>
        <div className="free-entry__address">
          <p>LottaCash Sweepstakes — Free Entry Request</p>
          <p className="free-entry__address-placeholder">[Address Line 1]</p>
          <p className="free-entry__address-placeholder">[City, State ZIP]</p>
          <p className="free-entry__address-placeholder">[Country]</p>
        </div>
        <p className="free-entry__note" role="note">
          We are currently setting up our mailing address. Check back soon or contact us at{" "}
          <a href="mailto:support@lottacash.us">support@lottacash.us</a> with questions.
        </p>
      </section>

      <section className="free-entry__section lc-panel" aria-label="Already have an account?">
        <h2 className="free-entry__section-title">Already have an account?</h2>
        <p className="free-entry__text">
          If you already have a LottaCash account, just include your username in your letter and
          we will credit the SC to your account.
        </p>
        <p className="free-entry__text">
          Don&apos;t have an account yet?{" "}
          <Link to={signupUrl("/free-entry")} className="free-entry__link">
            Sign up first
          </Link>{" "}
          so you have a username to include in your letter.
        </p>
      </section>

      <section className="free-entry__section lc-panel" aria-label="Why free entry?">
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
