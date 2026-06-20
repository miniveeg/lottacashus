import { useState } from "react";
import { CheckCircle } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { useProfile } from "../../contexts/ProfileContext";
import { isSupabaseConfigured, supabase } from "../../lib/supabase";
import "./Redeem.css";

const MIN_REDEMPTION_SC = 100;
const SC_USD_RATE = 0.1;

export default function Redeem() {
  const { user } = useAuth();
  const { profile, refreshProfile } = useProfile();
  const [scAmount, setScAmount] = useState("");
  const [paypalEmail, setPaypalEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const sweepsCoins = profile?.sweepsCoins ?? 0;
  const usdValue = sweepsCoins * SC_USD_RATE;
  const parsedAmount = parseFloat(scAmount);
  const isValid = Number.isFinite(parsedAmount) && parsedAmount >= MIN_REDEMPTION_SC && parsedAmount <= sweepsCoins && paypalEmail.includes("@");

  async function handleRedeem() {
    setError(null);
    setSuccess(false);

    if (!user) {
      setError("Log in to redeem.");
      return;
    }

    if (!isValid) {
      setError("Enter a valid amount (min 100 SC).");
      return;
    }

    if (!isSupabaseConfigured) {
      setError("Supabase is not configured.");
      return;
    }

    setSubmitting(true);

    const { error: rpcError } = await supabase.rpc("request_sc_redemption", {
      p_user_id: user.id,
      p_sc_amount: parsedAmount,
      p_paypal_email: paypalEmail.trim(),
    });

    setSubmitting(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    setSuccess(true);
    refreshProfile();
  }

  if (!user) {
    return (
      <div className="redeem lc-page lc-page--narrow">
        <header className="lc-page__header">
          <h1 className="lc-page__title">Redeem</h1>
          <p className="lc-page__subtitle">Log in to cash out your Sweeps Coins.</p>
        </header>
      </div>
    );
  }

  return (
    <div className="redeem lc-page lc-page--narrow">
      <header className="lc-page__header">
        <h1 className="lc-page__title">Redeem Sweeps Coins</h1>
        <p className="lc-page__subtitle">Cash out your SC for real money via PayPal.</p>
      </header>

      {success ? (
        <div className="redeem__success">
          <div className="redeem__success-icon" aria-hidden><CheckCircle size={48} /></div>
          <p className="redeem__success-title">Redemption Requested!</p>
          <p className="redeem__success-desc">
            Your request to redeem {parsedAmount} SC (${(parsedAmount * SC_USD_RATE).toFixed(2)}) has
            been submitted. Our team will review and process it within 3&ndash;5 business days.
          </p>
        </div>
      ) : (
        <div className="redeem__card">
          <div className="redeem__balance">
            <p className="redeem__balance-label">Available Sweeps Coins</p>
            <p className="redeem__balance-value">{sweepsCoins.toFixed(2)} SC</p>
            <p className="redeem__rate">
              = ${usdValue.toFixed(2)} USD &middot; 1 SC = ${SC_USD_RATE.toFixed(2)}
            </p>
          </div>

          {error && <p className="redeem__error" role="alert">{error}</p>}

          <div className="redeem__field">
            <label className="redeem__label" htmlFor="sc-amount">
              SC amount
            </label>
            <input
              id="sc-amount"
              className="redeem__input"
              type="number"
              min={MIN_REDEMPTION_SC}
              max={sweepsCoins}
              step="1"
              value={scAmount}
              onChange={(e) => setScAmount(e.target.value)}
              disabled={submitting}
              placeholder="100"
            />
            <p className="redeem__info">Minimum {MIN_REDEMPTION_SC} SC (${(MIN_REDEMPTION_SC * SC_USD_RATE).toFixed(2)})</p>
          </div>

          <div className="redeem__field">
            <label className="redeem__label" htmlFor="paypal-email">
              PayPal email
            </label>
            <input
              id="paypal-email"
              className="redeem__input"
              type="email"
              value={paypalEmail}
              onChange={(e) => setPaypalEmail(e.target.value)}
              disabled={submitting}
              placeholder="you@example.com"
            />
            <p className="redeem__info">Enter the email address linked to your PayPal account.</p>
          </div>

          {scAmount && Number.isFinite(parsedAmount) && parsedAmount >= MIN_REDEMPTION_SC && (
            <p className="redeem__info redeem__info--payout">
              You will receive ${(parsedAmount * SC_USD_RATE).toFixed(2)} USD
            </p>
          )}

          <button
            type="button"
            className="redeem__submit"
            disabled={!isValid || submitting}
            onClick={handleRedeem}
          >
            {submitting && <span className="redeem__submit-spinner" aria-hidden="true" />}
            {submitting ? "Submitting\u2026" : `Redeem SC for $${(parsedAmount * SC_USD_RATE).toFixed(2)}`}
          </button>
        </div>
      )}
    </div>
  );
}
