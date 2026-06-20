import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  Gift,
  Handshake,
  Copy,
  Check,
  Sparkles,
  TrendingUp,
  Users,
  ArrowRight,
} from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { useAuth } from "../../contexts/AuthContext";
import { loginUrl, signupUrl } from "../../lib/authRedirect";
import { useProfile } from "../../contexts/ProfileContext";
import {
  claimAffiliateEarnings,
  fetchAffiliateStats,
  submitAffiliateReferralCode,
  type AffiliateStats,
} from "../../lib/affiliate";
import { buildAffiliateSignupUrl, normalizeAffiliateCode } from "../../lib/affiliateRef";
import { formatUsd } from "../../lib/format";
import { MotionLink } from "../../components/ui/MotionLink";
import { ScrollReveal } from "../../components/ui/ScrollReveal";
import { fadeUpVariants, staggerContainer } from "../../lib/motion";
import "./Promotions.css";

const upcoming = [
  {
    title: "Wager milestones",
    desc: "Bonus rewards tied to your level and lifetime wager volume — the more you play, the more you unlock.",
    tag: "Planned",
  },
  {
    title: "Discord perks",
    desc: "Exclusive roles and giveaways for linked LottaCash accounts when the community launches.",
    tag: "Planned",
  },
  {
    title: "Deposit boosts",
    desc: "Limited-time match offers on crypto deposits. Stack them with affiliate earnings for bigger rolls.",
    tag: "Planned",
  },
];

function formatCommissionDate(iso: string) {
  if (!iso) return "";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

export function Promotions() {
  const { user, loading } = useAuth();
  const { pathname } = useLocation();
  const { refreshProfile } = useProfile();
  const [affiliate, setAffiliate] = useState<AffiliateStats | null>(null);
  const [affiliateLoading, setAffiliateLoading] = useState(false);
  const [affiliateError, setAffiliateError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimSuccess, setClaimSuccess] = useState<string | null>(null);
  const [copied, setCopied] = useState<"link" | "code" | null>(null);
  const [referralInput, setReferralInput] = useState("");
  const [referralSubmitting, setReferralSubmitting] = useState(false);
  const [referralSuccess, setReferralSuccess] = useState<string | null>(null);

  const loadAffiliate = useCallback(async () => {
    if (!user) {
      setAffiliate(null);
      return;
    }
    setAffiliateLoading(true);
    setAffiliateError(null);
    const { stats, error } = await fetchAffiliateStats();
    setAffiliateLoading(false);
    if (error) setAffiliateError(error);
    else setAffiliate(stats);
  }, [user]);

  useEffect(() => {
    loadAffiliate();
  }, [loadAffiliate]);

  const signupLink =
    affiliate?.affiliate_code && typeof window !== "undefined"
      ? buildAffiliateSignupUrl(window.location.origin, affiliate.affiliate_code)
      : "";

  async function handleApplyReferral(e: FormEvent) {
    e.preventDefault();
    const code = normalizeAffiliateCode(referralInput);
    if (!code) {
      setAffiliateError("Enter a referral code.");
      return;
    }
    setReferralSubmitting(true);
    setAffiliateError(null);
    setReferralSuccess(null);
    const { success, referrer_code, error } = await submitAffiliateReferralCode(code);
    setReferralSubmitting(false);
    if (error || !success) {
      setAffiliateError(error ?? "Could not apply referral code.");
      return;
    }
    setReferralSuccess(
      referrer_code
        ? `Referral code "${referrer_code}" applied to your account.`
        : "Referral code applied to your account.",
    );
    setReferralInput("");
    await loadAffiliate();
  }

  async function handleClaim() {
    if (!affiliate || affiliate.claimable_balance <= 0) return;
    setClaiming(true);
    setAffiliateError(null);
    setClaimSuccess(null);
    const { result, error } = await claimAffiliateEarnings();
    setClaiming(false);
    if (error) {
      setAffiliateError(error);
      return;
    }
    if (result && result.claimed_amount > 0) {
      setClaimSuccess(`Claimed ${formatUsd(result.claimed_amount)} to your balance.`);
      await refreshProfile();
      await loadAffiliate();
      return;
    }
    if (affiliate.claimable_balance > 0) {
      setAffiliateError(
        "Claim did not credit your balance. Refresh and try again, or contact support.",
      );
      await loadAffiliate();
    }
  }

  async function copyText(text: string, kind: "link" | "code") {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      setAffiliateError("Could not copy — select and copy manually.");
    }
  }

  return (
    <div className="promotions-page lc-page lc-page--wide">
      {/* ── Header ── */}
      <motion.header
        className="promotions-page__header"
        initial="hidden"
        animate="visible"
        variants={staggerContainer}
      >
        <motion.span className="promotions-page__eyebrow" variants={fadeUpVariants}>
          <Sparkles size={12} strokeWidth={2.4} />
          Rewards
        </motion.span>
        <motion.h1 className="promotions-page__title" variants={fadeUpVariants}>
          Promotions
        </motion.h1>
        <motion.p className="promotions-page__subtitle" variants={fadeUpVariants}>
          Earn from referrals and watch for seasonal offers. Claim affiliate earnings here when
          you&rsquo;re ready.
        </motion.p>
      </motion.header>

      {/* ── Affiliate hero panel ── */}
      <ScrollReveal className="promotions-affiliate" as="section">
        <div className="promotions-affiliate__head">
          <div className="promotions-affiliate__icon" aria-hidden="true">
            <Handshake size={28} strokeWidth={1.7} />
          </div>
          <div>
            <h2 className="promotions-affiliate__title">Affiliates</h2>
            <p className="promotions-affiliate__intro">
              Share your link. When someone signs up and plays, you earn{" "}
              <strong>5% of every deposit</strong> they make, plus{" "}
              <strong>$1 for every $100 wagered</strong> (paid proportionally on each bet). Earnings
              build up here until you claim them.
            </p>
          </div>
        </div>

        <ul className="promotions-affiliate__rates">
          <li>
            <span className="promotions-affiliate__rate-label">Deposits</span>
            <span className="promotions-affiliate__rate-value">5% commission</span>
          </li>
          <li>
            <span className="promotions-affiliate__rate-label">Wagers</span>
            <span className="promotions-affiliate__rate-value">$1 per $100 wagered</span>
          </li>
        </ul>

        {loading ? (
          <p className="promotions-affiliate__muted">Loading…</p>
        ) : !user ? (
          <>
            <div className="promotions-affiliate__referral-box">
              <h3 className="promotions-affiliate__referral-title">Have a referral code?</h3>
              <p className="promotions-affiliate__referral-text">
                Enter your friend&rsquo;s code when you create an account. You can only set it once.
              </p>
              <MotionLink
                to={signupUrl(pathname)}
                variant="primary"
                className="promotions-btn--gold"
              >
                Sign up with a code
              </MotionLink>
            </div>
            <div className="promotions-affiliate__cta-row">
              <MotionLink
                to={signupUrl(pathname)}
                variant="primary"
                glow
                className="promotions-btn--gold"
              >
                Sign up to get your link
              </MotionLink>
              <MotionLink to={loginUrl(pathname)} variant="secondary" className="promotions-btn--outline">
                Log in
              </MotionLink>
            </div>
          </>
        ) : affiliateLoading ? (
          <p className="promotions-affiliate__muted">Loading your affiliate stats…</p>
        ) : affiliateError ? (
          <p className="promotions-affiliate__error" role="alert">
            {affiliateError}
          </p>
        ) : affiliate ? (
          <>
            {affiliate.has_referrer ? (
              <p className="promotions-affiliate__referrer-set">
                Referred by <strong>{affiliate.referrer_code ?? "a friend"}</strong>
                {" — "}this can only be set once.
              </p>
            ) : (
              <form
                className="promotions-affiliate__referral-box"
                onSubmit={(e) => void handleApplyReferral(e)}
              >
                <h3 className="promotions-affiliate__referral-title">Add a referral code</h3>
                <p className="promotions-affiliate__referral-text">
                  Were you invited by someone? Enter their code here. You can only do this once.
                </p>
                <div className="promotions-affiliate__referral-row">
                  <input
                    className="promotions-affiliate__input"
                    type="text"
                    autoComplete="off"
                    placeholder="Friend's code"
                    value={referralInput}
                    onChange={(e) => setReferralInput(normalizeAffiliateCode(e.target.value))}
                    maxLength={32}
                    disabled={referralSubmitting}
                  />
                  <button
                    type="submit"
                    className="promotions-btn promotions-btn--gold"
                    disabled={referralSubmitting || !referralInput.trim()}
                  >
                    {referralSubmitting ? "Applying…" : "Apply code"}
                  </button>
                </div>
              </form>
            )}

            {referralSuccess ? (
              <p className="promotions-affiliate__success" role="status">
                {referralSuccess}
              </p>
            ) : null}

            {/* ── Referral code + copy ── */}
            <div className="promotions-affiliate__code-row">
              <div>
                <p className="promotions-affiliate__label">Your code</p>
                <p className="promotions-affiliate__code">{affiliate.affiliate_code}</p>
              </div>
              <button
                type="button"
                className="promotions-btn promotions-btn--ghost"
                onClick={() => copyText(affiliate.affiliate_code, "code")}
              >
                {copied === "code" ? <Check size={14} strokeWidth={2.4} /> : <Copy size={14} strokeWidth={2.2} />}
                {copied === "code" ? "Copied" : "Copy code"}
              </button>
            </div>

            <div className="promotions-affiliate__link-row">
              <label className="promotions-affiliate__label" htmlFor="affiliate-link">
                Referral link
              </label>
              <div className="promotions-affiliate__link-wrap">
                <input
                  id="affiliate-link"
                  className="promotions-affiliate__input"
                  type="text"
                  readOnly
                  value={signupLink}
                />
                <button
                  type="button"
                  className="promotions-btn promotions-btn--gold"
                  onClick={() => copyText(signupLink, "link")}
                >
                  {copied === "link" ? <Check size={14} strokeWidth={2.4} /> : <Copy size={14} strokeWidth={2.2} />}
                  {copied === "link" ? "Copied" : "Copy link"}
                </button>
              </div>
            </div>

            {/* ── Claim card ── */}
            <div className="promotions-affiliate__claim">
              <div className="promotions-affiliate__claim-main">
                <p className="promotions-affiliate__label">Available to claim</p>
                <p className="promotions-affiliate__claim-amount">
                  {formatUsd(affiliate.claimable_balance)}
                </p>
                {affiliate.total_claimed > 0 ? (
                  <p className="promotions-affiliate__claim-hint">
                    {formatUsd(affiliate.total_claimed)} claimed to balance so far
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                className="promotions-btn promotions-btn--gold promotions-affiliate__claim-btn"
                onClick={() => void handleClaim()}
                disabled={claiming || affiliate.claimable_balance <= 0}
              >
                {claiming
                  ? "Claiming…"
                  : affiliate.claimable_balance > 0
                    ? "Claim to balance"
                    : "Nothing to claim"}
              </button>
            </div>

            {claimSuccess ? (
              <p className="promotions-affiliate__success" role="status">
                {claimSuccess}
              </p>
            ) : null}

            {/* ── Stats ── */}
            <div className="promotions-affiliate__stats">
              <div className="promotions-affiliate__stat">
                <Users size={14} strokeWidth={2.2} />
                <span className="promotions-affiliate__stat-value">{affiliate.referred_count}</span>
                <span className="promotions-affiliate__stat-label">Referrals</span>
              </div>
              <div className="promotions-affiliate__stat">
                <TrendingUp size={14} strokeWidth={2.2} />
                <span className="promotions-affiliate__stat-value">
                  {formatUsd(affiliate.total_earned)}
                </span>
                <span className="promotions-affiliate__stat-label">Lifetime earned</span>
              </div>
              <div className="promotions-affiliate__stat">
                <span className="promotions-affiliate__stat-value">
                  {formatUsd(affiliate.earned_from_deposits)}
                </span>
                <span className="promotions-affiliate__stat-label">Pending · deposits</span>
              </div>
              <div className="promotions-affiliate__stat">
                <span className="promotions-affiliate__stat-value">
                  {formatUsd(affiliate.earned_from_wagers)}
                </span>
                <span className="promotions-affiliate__stat-label">Pending · wagers</span>
              </div>
            </div>

            {/* ── Recent commissions ── */}
            {affiliate.recent_commissions.length > 0 ? (
              <div className="promotions-affiliate__recent">
                <h3 className="promotions-affiliate__recent-title">Pending earnings</h3>
                <ul className="promotions-affiliate__recent-list">
                  {affiliate.recent_commissions.map((row) => (
                    <li key={row.id} className="promotions-affiliate__recent-item">
                      <span>
                        {row.kind === "deposit" ? "Deposit commission" : "Wager commission"}
                        <span className="promotions-affiliate__recent-meta">
                          {" "}
                          on {formatUsd(row.base_amount)} volume
                        </span>
                      </span>
                      <span className="promotions-affiliate__recent-right">
                        <span className="promotions-affiliate__recent-amount">
                          +{formatUsd(row.commission_amount)}
                        </span>
                        <time
                          className="promotions-affiliate__recent-date"
                          dateTime={row.created_at}
                        >
                          {formatCommissionDate(row.created_at)}
                        </time>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="promotions-affiliate__muted">
                No earnings yet — share your link to start collecting commissions.
              </p>
            )}
          </>
        ) : null}
      </ScrollReveal>

      {/* ── More rewards banner ── */}
      <ScrollReveal className="promotions-banner" as="section">
        <div className="promotions-banner__icon" aria-hidden="true">
          <Gift size={28} strokeWidth={1.7} />
        </div>
        <div>
          <h2 className="promotions-banner__title">More rewards coming</h2>
          <p className="promotions-banner__text">
            Your account, leveling, and Discord link are already in place. When new campaigns
            launch, they&rsquo;ll show here and in notifications.
          </p>
          {!loading && user && (
            <div className="promotions-banner__cta">
              <MotionLink to="/settings" variant="secondary" className="promotions-btn--outline">
                View your account
              </MotionLink>
              <MotionLink to="/help" variant="ghost">
                FAQ &amp; Terms
              </MotionLink>
            </div>
          )}
        </div>
      </ScrollReveal>

      {/* ── Roadmap cards ── */}
      <section className="promotions-roadmap" aria-label="Planned promotions">
        <ScrollReveal className="promotions-roadmap__head" as="div">
          <span className="promotions-roadmap__kicker">On the roadmap</span>
          <h2 className="promotions-roadmap__title">What we&rsquo;re building next</h2>
        </ScrollReveal>
        <div className="promotions-roadmap__grid">
          {upcoming.map((item, i) => (
            <ScrollReveal key={item.title} delay={i} as="article" className="promotions-roadmap__card">
              <span className="promotions-roadmap__badge">{item.tag}</span>
              <h3 className="promotions-roadmap__card-title">{item.title}</h3>
              <p className="promotions-roadmap__card-desc">{item.desc}</p>
              <Link to="/sweepstakes" className="promotions-roadmap__card-link">
                Sweepstakes rules
                <ArrowRight size={12} strokeWidth={2.2} />
              </Link>
            </ScrollReveal>
          ))}
        </div>
      </section>
    </div>
  );
}
