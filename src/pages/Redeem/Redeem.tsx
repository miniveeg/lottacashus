import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { useProfile } from "../../contexts/ProfileContext";
import { loginUrl } from "../../lib/authRedirect";
import { isSupabaseConfigured, supabase } from "../../lib/supabase";
import {
  formatCoins,
  formatCoinsWithUsd,
  coinsToUsd,
  formatUsd,
  SC_USD_RATE,
} from "../../lib/format";
import { validateCryptoAddress } from "../../lib/crypto";
import { CRYPTO_CHAINS, type CryptoChain } from "../../types/crypto";
import "./Redeem.css";

const MIN_REDEMPTION_SC = 100;

export default function Redeem() {
  const { user, loading: authLoading, configured } = useAuth();
  const { profile, refreshProfile } = useProfile();
  const [scAmount, setScAmount] = useState("");
  const [chain, setChain] = useState<CryptoChain>("sol");
  const [destination, setDestination] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const sweepsCoins = profile?.sweepsCoins ?? 0;
  const parsedAmount = parseFloat(scAmount);
  const amountValid =
    Number.isFinite(parsedAmount) &&
    parsedAmount >= MIN_REDEMPTION_SC &&
    parsedAmount <= sweepsCoins;
  const addressValid = validateCryptoAddress(chain, destination.trim());
  const isValid = amountValid && addressValid;

  const safeAmount = Number.isFinite(parsedAmount) ? parsedAmount : 0;
  const usdValue = coinsToUsd(safeAmount, "sweeps_coins");
  const balanceUsd = coinsToUsd(sweepsCoins, "sweeps_coins");
  const minUsd = coinsToUsd(MIN_REDEMPTION_SC, "sweeps_coins");

  async function handleRedeem() {
    setError(null);
    setSuccess(false);

    if (!user) {
      setError("Log in to redeem.");
      return;
    }

    if (!isValid) {
      setError(`Enter a valid amount (min ${MIN_REDEMPTION_SC} SC) and a valid ${chain.toUpperCase()} address.`);
      return;
    }

    if (!isSupabaseConfigured) {
      setError("Supabase is not configured. Add your keys to .env.");
      return;
    }

    setSubmitting(true);

    const { error: rpcError } = await supabase.rpc("request_sc_redemption", {
      p_sc_amount: parsedAmount,
      p_chain: chain,
      p_destination: destination.trim(),
    });

    setSubmitting(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    setSuccess(true);
    refreshProfile();
  }

  if (authLoading) {
    return (
      <div className="redeem lc-page lc-page--medium">
        <div className="lc-loading" role="status" aria-live="polite">
          <div className="lc-loading__pulse" aria-hidden />
          <p>Loading…</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="redeem lc-page lc-page--medium">
        <header className="lc-page__header">
          <h1 className="lc-page__title">Redeem</h1>
          <p className="lc-page__subtitle">
            Log in to cash out your Sweeps Coins for cryptocurrency.
          </p>
        </header>
        <p className="redeem__login-hint">
          <Link to={loginUrl("/redeem")} className="redeem__login-link">
            Log in
          </Link>{" "}
          or{" "}
          <Link to="/signup" className="redeem__login-link">
            sign up
          </Link>{" "}
          to continue.
        </p>
      </div>
    );
  }

  return (
    <div className="redeem lc-page lc-page--narrow">
      <header className="lc-page__header">
        <h1 className="lc-page__title">Redeem Sweeps Coins</h1>
        <p className="lc-page__subtitle">
          Cash out your SC for real money via crypto (SOL, LTC, or ETH) to your external wallet.
        </p>
      </header>

      {!configured && (
        <p className="redeem__error" role="note">
          Supabase is not configured. Add your project URL and anon key to the <code>.env</code> file
          to enable redemptions. The form below is non-functional until keys are provided.
        </p>
      )}

      {success ? (
        <div className="redeem__success" role="status" aria-live="polite">
          <div className="redeem__success-icon" aria-hidden><CheckCircle size={48} /></div>
          <p className="redeem__success-title">Redemption Requested!</p>
          <p className="redeem__success-desc">
            Your request to redeem {formatCoinsWithUsd(parsedAmount, "sweeps_coins")} to your{" "}
            {chain.toUpperCase()} address has been submitted. Our team will review and process it
            within 3&ndash;5 business days.
          </p>
        </div>
      ) : (
        <div className="redeem__card">
          <div className="redeem__balance">
            <p className="redeem__balance-label">Available</p>
            <p className="redeem__balance-value">
              {formatCoins(sweepsCoins, "sweeps_coins")}
            </p>
            <p className="redeem__rate">
              {formatUsd(balanceUsd)} USD &middot; 100 SC = {formatUsd(1)} &middot; 1 SC = {formatUsd(SC_USD_RATE)}
            </p>
          </div>

          {error && <p className="redeem__error" role="alert" id="redeem-error">{error}</p>}

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
              onChange={(e) => {
                setScAmount(e.target.value);
                if (error) setError(null);
              }}
              disabled={submitting}
              placeholder="100"
              inputMode="numeric"
              aria-invalid={Boolean(error) || undefined}
              aria-describedby={error ? "redeem-error" : undefined}
            />
            <p className="redeem__info">
              Minimum {MIN_REDEMPTION_SC} SC ({formatUsd(minUsd)}).
            </p>
          </div>

          <fieldset className="redeem__field redeem__chain-fieldset">
            <legend className="redeem__label">Payout chain</legend>
            <div className="redeem__chain-picker" role="group" aria-label="Select payout chain">
              {CRYPTO_CHAINS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`redeem__chain-btn${chain === c.id ? " redeem__chain-btn--active" : ""}`}
                  onClick={() => setChain(c.id)}
                  disabled={submitting}
                  aria-pressed={chain === c.id}
                  aria-label={`Redeem to ${c.label} (${c.symbol})`}
                >
                  {c.symbol}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="redeem__field">
            <label className="redeem__label" htmlFor="redeem-destination">
              Destination {chain.toUpperCase()} address
            </label>
            <input
              id="redeem-destination"
              className="redeem__input"
              type="text"
              value={destination}
              onChange={(e) => {
                setDestination(e.target.value);
                if (error) setError(null);
              }}
              disabled={submitting}
              placeholder={`Your ${chain.toUpperCase()} wallet address`}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={Boolean(error) || undefined}
              aria-describedby={error ? "redeem-error" : undefined}
            />
            <p className="redeem__info">
              Enter the external wallet address that will receive your payout.
            </p>
          </div>

          {amountValid && addressValid && (
            <p className="redeem__info redeem__info--payout">
              Redeeming {formatCoins(parsedAmount, "sweeps_coins")} = {formatUsd(usdValue)} USD to your{" "}
              {chain.toUpperCase()} address: {destination.trim()}
            </p>
          )}

          <button
            type="button"
            className="redeem__submit"
            disabled={!isValid || submitting || !configured}
            onClick={handleRedeem}
          >
            {submitting && <span className="redeem__submit-spinner" aria-hidden="true" />}
            {submitting
              ? "Submitting\u2026"
              : `Redeem ${formatCoins(safeAmount, "sweeps_coins")} for ${formatUsd(usdValue)}`}
          </button>
        </div>
      )}
    </div>
  );
}
