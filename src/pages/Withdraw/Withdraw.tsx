import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";
import { Banknote } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { loginUrl } from "../../lib/authRedirect";
import { useProfile } from "../../contexts/ProfileContext";
import { useToast } from "../../contexts/ToastContext";
import { isSupabaseConfigured } from "../../lib/supabase";
import {
  fetchMyWithdrawals,
  requestWithdrawal,
  validateCryptoAddress,
  type CryptoWithdrawalRow,
} from "../../lib/crypto";
import {
  coinsToUsd,
  formatCoins,
  formatCoinsWithUsd,
  formatUsd,
  SC_PER_USD,
} from "../../lib/format";
import { analytics } from "../../lib/analytics";
import { CRYPTO_CHAINS, type CryptoChain } from "../../types/crypto";
import "../Wallet/Wallet.css";

/** Minimum withdrawal in SC. 10 SC = $0.10 USD. */
const MIN_WITHDRAW_SC = 10;

export function Withdraw() {
  const { user, loading: authLoading, configured } = useAuth();
  const { profile, refreshProfile } = useProfile();
  const toast = useToast();
  const [chain, setChain] = useState<CryptoChain>("sol");
  const [destination, setDestination] = useState("");
  const [scAmount, setScAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [withdrawals, setWithdrawals] = useState<CryptoWithdrawalRow[]>([]);

  const loadWithdrawals = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const { data } = await fetchMyWithdrawals();
    if (data) setWithdrawals(data);
  }, []);

  useEffect(() => {
    if (user) loadWithdrawals();
  }, [user, loadWithdrawals]);

  // 🔴 Same redirect-to-self bug as Settings.tsx (ACCOUNT agent's finding #9):
  // hardcode the redirect path instead of reading `useLocation().pathname`.
  if (!authLoading && !user) {
    return <Navigate to={loginUrl("/withdraw")} replace />;
  }

  if (authLoading) {
    return (
      <div className="wallet lc-page lc-page--medium">
        <div className="lc-loading" role="status" aria-live="polite">
          <div className="lc-loading__pulse" aria-hidden />
          <p>Loading…</p>
        </div>
      </div>
    );
  }

  const scBalance = profile?.sweepsCoins ?? 0;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!isSupabaseConfigured) {
      setError("Supabase is not configured. Add your keys to .env.");
      return;
    }

    const trimmedDestination = destination.trim();
    const scValue = parseFloat(scAmount);
    if (!Number.isFinite(scValue) || scValue < MIN_WITHDRAW_SC) {
      setError(
        `Minimum withdrawal is ${MIN_WITHDRAW_SC} SC (${formatUsd(MIN_WITHDRAW_SC / SC_PER_USD)}).`,
      );
      return;
    }

    if (scValue > scBalance) {
      setError("Insufficient Sweeps Coins balance.");
      return;
    }

    if (!validateCryptoAddress(chain, trimmedDestination)) {
      setError(`Enter a valid ${chain.toUpperCase()} address.`);
      return;
    }

    // Convert SC to USD before calling the RPC (which expects a USD amount).
    // 100 SC = $1 USD, so usdAmount = scValue / 100.
    const usdAmount = coinsToUsd(scValue, "sweeps_coins");

    setSubmitting(true);
    const { error: reqError } = await requestWithdrawal(chain, trimmedDestination, usdAmount);
    setSubmitting(false);

    if (reqError) {
      setError(reqError);
      toast.error(reqError);
      analytics.networkError("Withdraw.requestWithdrawal", reqError);
      return;
    }

    analytics.wallet.withdrawInitiated(chain, usdAmount);
    await refreshProfile();
    setSuccess("Withdrawal submitted. It will be processed from our treasury wallets.");
    toast.success("Withdrawal request submitted!");
    setScAmount("");
    setDestination("");
    loadWithdrawals();
  }

  // Live preview of the SC → USD conversion as the user types.
  const parsedSc = parseFloat(scAmount);
  const previewUsd =
    Number.isFinite(parsedSc) && parsedSc > 0 ? coinsToUsd(parsedSc, "sweeps_coins") : 0;

  return (
    <div className="wallet lc-page lc-page--narrow">
      <header className="lc-page__header">
        <h1 className="lc-page__title wallet__title">Withdraw</h1>
        <p className="lc-page__subtitle wallet__subtitle">
          Withdraw your Sweeps Coins (SC) as cryptocurrency. 100 SC = $1 USD. Minimum withdrawal: 10 SC
          ($0.10).
        </p>
      </header>

      <div className="wallet__tabs">
        <Link to="/deposit" className="wallet__tab">
          Deposit
        </Link>
        <Link to="/withdraw" className="wallet__tab wallet__tab--active">
          Withdraw
        </Link>
      </div>

      <section className="wallet__balance-panel" aria-label="Available Sweeps Coins">
        <p className="wallet__balance-label">Available Sweeps Coins (SC)</p>
        <p className="wallet__balance-value">{formatCoins(scBalance, "sweeps_coins")}</p>
        <p className="wallet__balance-usd">&asymp; {formatUsd(coinsToUsd(scBalance, "sweeps_coins"))}</p>
      </section>

      <p className="wallet__hint wallet__hint--balance">
        Sweeps Coins (SC) are redeemable for cash. Gold Coins (GC) are play money and cannot be
        withdrawn. Current GC balance:{" "}
        <strong>{formatCoinsWithUsd(profile?.balance ?? 0, "balance")}</strong>.
      </p>

      {!configured && (
        <p className="wallet__error" role="note">
          Supabase is not configured. Add your project URL and anon key to the <code>.env</code> file
          to enable withdrawals. The form below is non-functional until keys are provided.
        </p>
      )}

      <section className="wallet__section">
        {error && <p className="wallet__error" role="alert" id="withdraw-error">{error}</p>}
        {success && <p className="wallet__success" role="status" id="withdraw-success">{success}</p>}

        <form onSubmit={handleSubmit} noValidate>
          <div className="wallet__chain-picker" role="group" aria-label="Select withdrawal chain">
            {CRYPTO_CHAINS.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`wallet__chain-btn${chain === c.id ? " wallet__chain-btn--active" : ""}`}
                onClick={() => setChain(c.id)}
                aria-pressed={chain === c.id}
                aria-label={`Withdraw to ${c.label} (${c.symbol})`}
              >
                {c.symbol}
              </button>
            ))}
          </div>

          <div className="wallet__field">
            <label htmlFor="withdraw-address">Destination {chain.toUpperCase()} address</label>
            <input
              id="withdraw-address"
              value={destination}
              onChange={(e) => {
                setDestination(e.target.value);
                if (error) setError(null);
                if (success) setSuccess(null);
              }}
              placeholder="Your external wallet address"
              required
              autoComplete="off"
              spellCheck={false}
              aria-invalid={Boolean(error) || undefined}
              aria-describedby={error ? "withdraw-error" : undefined}
            />
          </div>

          <div className="wallet__field">
            <label htmlFor="withdraw-amount">Amount (SC)</label>
            <input
              id="withdraw-amount"
              type="number"
              min={MIN_WITHDRAW_SC}
              step="0.01"
              value={scAmount}
              onChange={(e) => {
                setScAmount(e.target.value);
                if (error) setError(null);
                if (success) setSuccess(null);
              }}
              placeholder={`Min ${MIN_WITHDRAW_SC} SC`}
              required
              inputMode="decimal"
              aria-invalid={Boolean(error) || undefined}
              aria-describedby={error ? "withdraw-error" : undefined}
            />
            <p className="wallet__hint wallet__hint--meta">
              {Number.isFinite(parsedSc) && parsedSc > 0
                ? `${formatCoins(parsedSc, "sweeps_coins")} = ${formatUsd(previewUsd)}`
                : `100 SC = ${formatUsd(1)} · 10 SC = ${formatUsd(0.1)}`}
            </p>
          </div>

          <button
            type="submit"
            className="wallet__btn"
            disabled={submitting || !configured}
            aria-disabled={submitting || !configured}
          >
            {submitting && <span className="wallet__btn__spinner" aria-hidden="true" />}
            {submitting ? "Submitting…" : "Request withdrawal"}
          </button>
        </form>

        <p className="wallet__hint wallet__hint--note">
          Withdrawals are queued and sent manually or automatically from treasury wallets. Processing
          times vary by network.
        </p>
      </section>

      <section className="wallet__section" aria-label="Recent withdrawals">
        <h2 className="wallet__list-title">Recent withdrawals</h2>
        {withdrawals.length === 0 ? (
          <div className="wallet__empty">
            <Banknote size={28} aria-hidden="true" />
            <p>No withdrawals yet</p>
            <p className="wallet__empty-hint">Your withdrawal history will appear here once you cash out.</p>
          </div>
        ) : (
          withdrawals.map((w) => (
            <div key={w.id} className="wallet__deposit-item">
              <div className="wallet__deposit-row">
                <span>
                  <strong>{w.chain.toUpperCase()}</strong> · {formatUsd(w.usd_amount)}
                </span>
                <span className={`wallet__status wallet__status--${w.status}`}>{w.status}</span>
              </div>
              <p className="wallet__hint wallet__hint--meta" title={w.destination_address}>
                {w.destination_address}
              </p>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
