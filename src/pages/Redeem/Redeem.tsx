import { useState } from "react";
import { CheckCircle } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { useProfile } from "../../contexts/ProfileContext";
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
  const { user } = useAuth();
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
      setError("Supabase is not configured.");
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

  if (!user) {
    return (
      <div className="redeem lc-page lc-page--narrow">
        <header className="lc-page__header">
          <h1 className="lc-page__title">Redeem Sweeps Coins</h1>
          <p className="lc-page__subtitle">Log in to cash out your Sweeps Coins for real money.</p>
        </header>
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

      {success ? (
        <div className="redeem__success">
          <div className="redeem__success-icon" aria-hidden><CheckCircle size={48} /></div>
          <p className="redeem__success-title">Redemption Requested</p>
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
            <p className="redeem__info">
              Minimum {MIN_REDEMPTION_SC} SC ({formatUsd(minUsd)}).
            </p>
          </div>

          <div className="redeem__field">
            <span className="redeem__label">Payout chain</span>
            <div className="redeem__chain-picker">
              {CRYPTO_CHAINS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`redeem__chain-btn${chain === c.id ? " redeem__chain-btn--active" : ""}`}
                  onClick={() => setChain(c.id)}
                  disabled={submitting}
                >
                  {c.symbol}
                </button>
              ))}
            </div>
          </div>

          <div className="redeem__field">
            <label className="redeem__label" htmlFor="redeem-destination">
              Destination {chain.toUpperCase()} address
            </label>
            <input
              id="redeem-destination"
              className="redeem__input"
              type="text"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              disabled={submitting}
              placeholder={`Your ${chain.toUpperCase()} wallet address`}
              autoComplete="off"
              spellCheck={false}
            />
            <p className="redeem__info">
              Enter the external wallet address that will receive your payout.
            </p>
          </div>

          {amountValid && addressValid && (
            <div className="redeem__summary">
              <div className="redeem__summary-row">
                <span className="redeem__summary-label">Redeeming</span>
                <span className="redeem__summary-value redeem__summary-value--sc">
                  {formatCoins(parsedAmount, "sweeps_coins")}
                </span>
              </div>
              <div className="redeem__summary-arrow" aria-hidden="true">↓</div>
              <div className="redeem__summary-row">
                <span className="redeem__summary-label">You receive</span>
                <span className="redeem__summary-value redeem__summary-value--usd">
                  {formatUsd(usdValue)} USD
                </span>
              </div>
              <p className="redeem__summary-dest">
                To {chain.toUpperCase()}: <code>{destination.trim()}</code>
              </p>
            </div>
          )}

          <button
            type="button"
            className="redeem__submit"
            disabled={!isValid || submitting}
            onClick={handleRedeem}
          >
            {submitting && <span className="redeem__submit-spinner" aria-hidden="true" />}
            {submitting
              ? "Submitting…"
              : `Redeem ${formatCoins(safeAmount, "sweeps_coins")} for ${formatUsd(usdValue)}`}
          </button>
        </div>
      )}
    </div>
  );
}
