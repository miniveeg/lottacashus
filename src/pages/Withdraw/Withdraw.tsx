import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { Banknote } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { loginUrl } from "../../lib/authRedirect";
import { useProfile } from "../../contexts/ProfileContext";
import { useToast } from "../../contexts/ToastContext";
import { fetchMyWithdrawals, requestWithdrawal, validateCryptoAddress } from "../../lib/crypto";
import { formatUsd } from "../../lib/format";
import { analytics } from "../../lib/analytics";
import { CRYPTO_CHAINS, type CryptoChain } from "../../types/crypto";
import "../Wallet/Wallet.css";

export function Withdraw() {
  const { user, loading: authLoading } = useAuth();
  const { pathname } = useLocation();
  const { profile, refreshProfile } = useProfile();
  const toast = useToast();
  const [chain, setChain] = useState<CryptoChain>("sol");
  const [destination, setDestination] = useState("");
  const [usdAmount, setUsdAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [withdrawals, setWithdrawals] = useState<
    {
      id: string;
      chain: string;
      destination_address: string;
      usd_amount: number;
      status: string;
      created_at: string;
    }[]
  >([]);

  const loadWithdrawals = useCallback(async () => {
    const { data } = await fetchMyWithdrawals();
    if (data) setWithdrawals(data);
  }, []);

  useEffect(() => {
    if (user) loadWithdrawals();
  }, [user, loadWithdrawals]);

  if (!authLoading && !user) {
    return <Navigate to={loginUrl(pathname)} replace />;
  }

  if (authLoading) {
    return (
      <div className="wallet lc-page lc-page--narrow">
        <div className="lc-loading">
          <div className="lc-loading__pulse" aria-hidden />
          <p>Loading…</p>
        </div>
      </div>
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const amount = parseFloat(usdAmount);
    if (!Number.isFinite(amount) || amount < 10) {
      setError("Minimum withdrawal is $10.");
      return;
    }

    if ((profile?.balance ?? 0) < amount) {
      setError("Insufficient balance.");
      return;
    }

    if (!validateCryptoAddress(chain, destination)) {
      setError(`Enter a valid ${chain.toUpperCase()} address.`);
      return;
    }

    setSubmitting(true);
    const { error: reqError } = await requestWithdrawal(chain, destination, amount);
    setSubmitting(false);

    if (reqError) {
      setError(reqError);
      toast.error(reqError);
      analytics.networkError("Withdraw.requestWithdrawal", reqError);
      return;
    }

    analytics.wallet.withdrawInitiated(chain, amount);
    await refreshProfile();
    setSuccess("Withdrawal submitted. It will be processed from our treasury wallets.");
    toast.success("Withdrawal request submitted!");
    setUsdAmount("");
    setDestination("");
    loadWithdrawals();
  }

  return (
    <div className="wallet lc-page lc-page--narrow">
      <header className="lc-page__header">
        <h1 className="lc-page__title wallet__title">Withdraw</h1>
        <p className="lc-page__subtitle wallet__subtitle">
          Request a payout in SOL, LTC, or ETH to your external wallet.
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

      <p className="wallet__hint wallet__hint--balance">
        Available balance: <strong>{formatUsd(profile?.balance ?? 0)}</strong>
      </p>

      <section className="wallet__section">
        {error && <p className="wallet__error" role="alert">{error}</p>}
        {success && <p className="wallet__success" role="status">{success}</p>}

        <form onSubmit={handleSubmit} noValidate>
          <div className="wallet__chain-picker">
            {CRYPTO_CHAINS.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`wallet__chain-btn${chain === c.id ? " wallet__chain-btn--active" : ""}`}
                onClick={() => setChain(c.id)}
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
              onChange={(e) => setDestination(e.target.value)}
              placeholder="Your external wallet address"
              required
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div className="wallet__field">
            <label htmlFor="withdraw-amount">Amount (USD)</label>
            <input
              id="withdraw-amount"
              type="number"
              min={10}
              step="0.01"
              value={usdAmount}
              onChange={(e) => setUsdAmount(e.target.value)}
              placeholder="Min $10"
              required
            />
          </div>

          <button type="submit" className="wallet__btn" disabled={submitting}>
            {submitting && <span className="wallet__btn__spinner" aria-hidden="true" />}
            {submitting ? "Submitting…" : "Request withdrawal"}
          </button>
        </form>

        <p className="wallet__hint wallet__hint--note">
          Withdrawals are queued and sent manually or automatically from treasury wallets. Processing
          times vary by network.
        </p>
      </section>

      <section className="wallet__section">
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
              <p className="wallet__hint wallet__hint--meta">
                {w.destination_address}
              </p>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
