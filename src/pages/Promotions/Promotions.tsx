import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Gift, Handshake } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
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
import "./Promotions.css";

const upcoming = [
  {
    title: "Wager milestones",
    desc: "Bonus rewards tied to your level and lifetime wager volume.",
  },
  {
    title: "Discord perks",
    desc: "Exclusive roles and giveaways for linked LottaCash accounts.",
  },
  {
    title: "Deposit boosts",
    desc: "Limited-time match offers on crypto deposits.",
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
        : "Referral code applied to your account."
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
      setAffiliateError("Claim did not credit your balance. Refresh and try again, or contact support.");
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
    <div className="promos lc-page">
      <header className="lc-page__header promos__header">
        <p className="lc-page__eyebrow">Rewards</p>
        <h1 className="lc-page__title">Promotions</h1>
        <p className="lc-page__subtitle">
          Earn from referrals and watch for seasonal offers. Claim affiliate earnings on this page
          when you are ready.
        </p>
      </header>

      <section className="promos__affiliate lc-panel" aria-labelledby="affiliate-heading">
        <div className="promos__affiliate-head">
          <div className="promos__hero-icon promos__affiliate-icon" aria-hidden="true">
            <Handshake size={32} />
          </div>
          <div>
            <h2 id="affiliate-heading" className="promos__hero-title">
              Affiliates
            </h2>
            <p className="promos__hero-text promos__affiliate-intro">
              Share your link. When someone signs up and plays, you earn{" "}
              <strong>5% of every deposit</strong> they make, plus{" "}
              <strong>$1 for every $100 wagered</strong> (paid proportionally on each bet). Earnings
              build up here until you claim them.
            </p>
          </div>
        </div>

        <ul className="promos__rate-list">
          <li>
            <span className="promos__rate-label">Deposits</span>
            <span className="promos__rate-value">5% commission</span>
          </li>
          <li>
            <span className="promos__rate-label">Wagers</span>
            <span className="promos__rate-value">$1 per $100 wagered</span>
          </li>
        </ul>

        {loading ? (
          <p className="promos__affiliate-muted">Loading…</p>
        ) : !user ? (
          <>
            <div className="promos__affiliate-referral">
              <h3 className="promos__affiliate-referral-title">Have a referral code?</h3>
              <p className="promos__affiliate-referral-text">
                Enter your friend&apos;s code when you create an account. You can only set it once.
              </p>
              <Link to={signupUrl(pathname)} className="promos__btn promos__btn--gold">
                Sign up with a code
              </Link>
            </div>
            <div className="promos__hero-cta">
              <Link to={signupUrl(pathname)} className="promos__btn promos__btn--gold">
                Sign up to get your link
              </Link>
              <Link to={loginUrl(pathname)} className="promos__btn promos__btn--ghost">
                Log in
              </Link>
            </div>
          </>
        ) : affiliateLoading ? (
          <p className="promos__affiliate-muted">Loading your affiliate stats…</p>
        ) : affiliateError ? (
          <p className="promos__affiliate-error" role="alert">
            {affiliateError}
          </p>
        ) : affiliate ? (
          <>
            {affiliate.has_referrer ? (
              <p className="promos__affiliate-referrer-set">
                Referred by{" "}
                <strong>{affiliate.referrer_code ?? "a friend"}</strong>
                {" — "}this can only be set once.
              </p>
            ) : (
              <form className="promos__affiliate-referral" onSubmit={(e) => void handleApplyReferral(e)}>
                <h3 className="promos__affiliate-referral-title">Add a referral code</h3>
                <p className="promos__affiliate-referral-text">
                  Were you invited by someone? Enter their code here. You can only do this once.
                </p>
                <div className="promos__affiliate-referral-row">
                  <input
                    className="promos__affiliate-link-input"
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
                    className="promos__btn promos__btn--gold"
                    disabled={referralSubmitting || !referralInput.trim()}
                  >
                    {referralSubmitting ? "Applying…" : "Apply code"}
                  </button>
                </div>
              </form>
            )}

            {referralSuccess ? (
              <p className="promos__affiliate-success" role="status">
                {referralSuccess}
              </p>
            ) : null}

            <div className="promos__affiliate-code-row">
              <div>
                <p className="promos__affiliate-label">Your code</p>
                <p className="promos__affiliate-code">{affiliate.affiliate_code}</p>
              </div>
              <button
                type="button"
                className="promos__btn promos__btn--ghost"
                onClick={() => copyText(affiliate.affiliate_code, "code")}
              >
                {copied === "code" ? "Copied!" : "Copy code"}
              </button>
            </div>

            <div className="promos__affiliate-link-row">
              <label className="promos__affiliate-label" htmlFor="affiliate-link">
                Referral link
              </label>
              <div className="promos__affiliate-link-wrap">
                <input
                  id="affiliate-link"
                  className="promos__affiliate-link-input"
                  type="text"
                  readOnly
                  value={signupLink}
                />
                <button
                  type="button"
                  className="promos__btn promos__btn--gold"
                  onClick={() => copyText(signupLink, "link")}
                >
                  {copied === "link" ? "Copied!" : "Copy link"}
                </button>
              </div>
            </div>

            <div className="promos__affiliate-claim">
              <div className="promos__affiliate-claim-main">
                <p className="promos__affiliate-label">Available to claim</p>
                <p className="promos__affiliate-claim-amount">
                  {formatUsd(affiliate.claimable_balance)}
                </p>
                {affiliate.total_claimed > 0 ? (
                  <p className="promos__affiliate-claim-hint">
                    {formatUsd(affiliate.total_claimed)} claimed to balance so far
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                className="promos__btn promos__btn--gold promos__affiliate-claim-btn"
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
              <p className="promos__affiliate-success" role="status">
                {claimSuccess}
              </p>
            ) : null}

            <div className="promos__affiliate-stats">
              <div className="promos__affiliate-stat">
                <span className="promos__affiliate-stat-value">{affiliate.referred_count}</span>
                <span className="promos__affiliate-stat-label">Referrals</span>
              </div>
              <div className="promos__affiliate-stat">
                <span className="promos__affiliate-stat-value">
                  {formatUsd(affiliate.total_earned)}
                </span>
                <span className="promos__affiliate-stat-label">Lifetime earned</span>
              </div>
              <div className="promos__affiliate-stat">
                <span className="promos__affiliate-stat-value">
                  {formatUsd(affiliate.earned_from_deposits)}
                </span>
                <span className="promos__affiliate-stat-label">Pending · deposits</span>
              </div>
              <div className="promos__affiliate-stat">
                <span className="promos__affiliate-stat-value">
                  {formatUsd(affiliate.earned_from_wagers)}
                </span>
                <span className="promos__affiliate-stat-label">Pending · wagers</span>
              </div>
            </div>

            {affiliate.recent_commissions.length > 0 ? (
              <div className="promos__affiliate-recent">
                <h3 className="promos__affiliate-recent-title">Pending earnings</h3>
                <ul className="promos__affiliate-recent-list">
                  {affiliate.recent_commissions.map((row) => (
                    <li key={row.id} className="promos__affiliate-recent-item">
                      <span>
                        {row.kind === "deposit" ? "Deposit commission" : "Wager commission"}
                        <span className="promos__affiliate-recent-meta">
                          {" "}
                          on {formatUsd(row.base_amount)} volume
                        </span>
                      </span>
                      <span className="promos__affiliate-recent-right">
                        <span className="promos__affiliate-recent-amount">
                          +{formatUsd(row.commission_amount)}
                        </span>
                        <time className="promos__affiliate-recent-date" dateTime={row.created_at}>
                          {formatCommissionDate(row.created_at)}
                        </time>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="promos__affiliate-muted">
                No earnings yet — share your link to start collecting commissions.
              </p>
            )}
          </>
        ) : null}
      </section>

      <section className="promos__hero lc-panel">
        <div className="promos__hero-icon" aria-hidden="true">
          <Gift size={32} />
        </div>
        <div>
          <h2 className="promos__hero-title">More rewards coming</h2>
          <p className="promos__hero-text">
            Your account, leveling, and Discord link are already in place. When new campaigns launch,
            they&apos;ll show here and in notifications.
          </p>
          {!loading && user && (
            <div className="promos__hero-cta">
              <Link to="/settings" className="promos__btn promos__btn--gold">
                View your account
              </Link>
              <Link to="/help" className="promos__btn promos__btn--ghost">
                FAQ & Terms
              </Link>
            </div>
          )}
        </div>
      </section>

      <section className="promos__grid" aria-label="Planned promotions">
        <h2 className="promos__section-title">On the roadmap</h2>
        <div className="promos__cards">
          {upcoming.map((item) => (
            <article key={item.title} className="promos__card">
              <h3 className="promos__card-title">{item.title}</h3>
              <p className="promos__card-desc">{item.desc}</p>
              <span className="promos__card-badge">Planned</span>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
