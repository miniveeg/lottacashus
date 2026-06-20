import { motion } from "framer-motion";
import { Mail, MapPin, Info, ShieldCheck, Coins } from "lucide-react";
import { Link } from "react-router-dom";
import { signupUrl } from "../../lib/authRedirect";
import { ScrollReveal } from "../../components/ui/ScrollReveal";
import { MotionLink } from "../../components/ui/MotionLink";
import { fadeUpVariants, staggerContainer } from "../../lib/motion";
import "./FreeEntry.css";

const steps = [
  {
    title: "Write a letter",
    body: "Handwrite a physical letter that includes your LottaCash username, the email address associated with your account, and your return address.",
  },
  {
    title: "Mail it",
    body: "Send your letter to the address below. Use a standard envelope with sufficient postage. One request per household per calendar month.",
  },
  {
    title: "Get credited",
    body: "We will credit 10 Sweeps Coins (SC) to your account within 14 business days of receiving your request. No purchase necessary.",
  },
];

export function FreeEntry() {
  return (
    <div className="free-entry-page lc-page lc-page--narrow">
      {/* ── Header ── */}
      <motion.header
        className="free-entry-page__header"
        initial="hidden"
        animate="visible"
        variants={staggerContainer}
      >
        <motion.span className="free-entry-page__eyebrow" variants={fadeUpVariants}>
          <Coins size={12} strokeWidth={2.4} />
          No purchase necessary
        </motion.span>
        <motion.h1 className="free-entry-page__title" variants={fadeUpVariants}>
          Free Sweeps Coins entry
        </motion.h1>
        <motion.p className="free-entry-page__subtitle" variants={fadeUpVariants}>
          You can obtain Sweeps Coins (SC) free of charge by mail, as required by sweepstakes law.
          Every SC earned this way is fully redeemable on the same terms as purchased SC.
        </motion.p>
      </motion.header>

      {/* ── Steps with gold numbered circles ── */}
      <ScrollReveal className="free-entry-panel" as="section">
        <h2 className="free-entry-panel__title">How it works</h2>
        <ol className="free-entry-steps">
          {steps.map((step, i) => (
            <li key={step.title} className="free-entry-steps__item">
              <span className="free-entry-steps__num" aria-hidden="true">
                {i + 1}
              </span>
              <div className="free-entry-steps__body">
                <strong>{step.title}</strong>
                <p>{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="free-entry-note">
          <Info size={14} strokeWidth={2.2} aria-hidden="true" />
          <span>
            Limit one request per household per calendar month. Bulk or machine-generated requests
            will not be honored.
          </span>
        </p>
      </ScrollReveal>

      {/* ── Mailing address card ── */}
      <ScrollReveal className="free-entry-panel" as="section">
        <h2 className="free-entry-panel__title">Mailing address</h2>
        <div className="free-entry-address">
          <span className="free-entry-address__icon" aria-hidden="true">
            <MapPin size={22} strokeWidth={1.8} />
          </span>
          <div className="free-entry-address__body">
            <p className="free-entry-address__line">LottaCash Sweepstakes</p>
            <p className="free-entry-address__line free-entry-address__line--muted">[Address Line 1]</p>
            <p className="free-entry-address__line free-entry-address__line--muted">[City, State ZIP]</p>
          </div>
        </div>
        <p className="free-entry-note">
          <Mail size={14} strokeWidth={2.2} aria-hidden="true" />
          <span>
            We are currently setting up our mailing address. Check back soon or contact us at{" "}
            <a href="mailto:support@lottacash.us">support@lottacash.us</a> with questions.
          </span>
        </p>
      </ScrollReveal>

      {/* ── Already have an account? ── */}
      <ScrollReveal className="free-entry-panel" as="section">
        <h2 className="free-entry-panel__title">Already have an account?</h2>
        <p className="free-entry-text">
          If you already have a LottaCash account, just include your username in your letter and we
          will credit the SC to your account.
        </p>
        <p className="free-entry-text">
          Don&rsquo;t have an account yet?{" "}
          <Link to={signupUrl("/free-entry")} className="free-entry-link">
            Sign up first
          </Link>{" "}
          so you have a username to include in your letter.
        </p>
      </ScrollReveal>

      {/* ── Why free entry? ── */}
      <ScrollReveal className="free-entry-panel" as="section">
        <h2 className="free-entry-panel__title">Why free entry?</h2>
        <div className="free-entry-why">
          <span className="free-entry-why__icon" aria-hidden="true">
            <ShieldCheck size={22} strokeWidth={1.8} />
          </span>
          <div>
            <p className="free-entry-text">
              Sweepstakes law requires that all participants have a method of entry that does not
              require any purchase or payment. Offering free Sweeps Coins by mail satisfies this
              requirement and ensures our platform operates legally. Every SC obtained through this
              method is fully redeemable on the same terms as SC obtained through purchases.
            </p>
            <p className="free-entry-text">
              For full details, see our{" "}
              <Link to="/sweepstakes" className="free-entry-link">
                Sweepstakes Rules
              </Link>
              .
            </p>
          </div>
        </div>
      </ScrollReveal>

      {/* ── CTA ── */}
      <ScrollReveal className="free-entry-cta" as="div">
        <MotionLink to="/signup" variant="primary" glow className="free-entry-btn--gold">
          Create your account
        </MotionLink>
        <MotionLink to="/help" variant="secondary" className="free-entry-btn--outline">
          Read the FAQ
        </MotionLink>
      </ScrollReveal>
    </div>
  );
}
