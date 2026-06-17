import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { loginUrl } from "../../lib/authRedirect";
import { useProfile } from "../../contexts/ProfileContext";
import { useToast } from "../../contexts/ToastContext";
import { fetchDepositAddress, fetchMyDeposits } from "../../lib/crypto";
import { formatUsd } from "../../lib/format";
import { analytics } from "../../lib/analytics";
import {
  CONFIRMATIONS_LABEL,
  CRYPTO_CHAINS,
  type CryptoChain,
  type CryptoDepositRow,
} from "../../types/crypto";
import "../Wallet/Wallet.css";

export function Deposit() {
  const { user, loading: authLoading } = useAuth();
  const { pathname } = useLocation();
  const { profile } = useProfile();
  const toast = useToast();
  const [chain, setChain] = useState<CryptoChain>("sol");
  const [address, setAddress] = useState<string | null>(null);
  const [loadingAddr, setLoadingAddr] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [deposits, setDeposits] = useState<CryptoDepositRow[]>([]);
  // Track known deposit IDs to fire toast only on new ones
  const knownDepositIds = useRef<Set<string>>(new Set());

  const loadAddress = useCallback(async (c: CryptoChain) => {
    setLoadingAddr(true);
    setError(null);
    analytics.wallet.depositInitiated(c);
    const { data, error: err } = await fetchDepositAddress(c);
    setLoadingAddr(false);
    if (err) {
      setError(err);
      setAddress(null);
      analytics.networkError("Deposit.loadAddress", err);
      return;
    }
    setAddress(data?.address ?? null);
  }, []);

  const loadDeposits = useCallback(async () => {
    const { data } = await fetchMyDeposits();
    if (!data) return;
    const rows = data as CryptoDepositRow[];
    setDeposits(rows);
    // Toast for newly-detected deposits
    rows.forEach((d) => {
      if (!knownDepositIds.current.has(d.id) && knownDepositIds.current.size > 0) {
        toast.success(`Deposit detected: ${formatUsd(d.usd_amount)} ${d.chain.toUpperCase()}`);
        analytics.wallet.depositDetected(d.chain, d.usd_amount);
      }
      knownDepositIds.current.add(d.id);
    });
  }, [toast]);

  useEffect(() => {
    if (user) {
      analytics.wallet.opened("deposit");
      loadAddress(chain);
    }
  }, [user, chain, loadAddress]);

  useEffect(() => {
    if (!user) return;
    loadDeposits();
    const t = setInterval(loadDeposits, 15000);
    return () => clearInterval(t);
  }, [user, loadDeposits]);

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

  async function handleCopy() {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success("Address copied to clipboard");
    analytics.clipboard("deposit_address");
  }

  return (
    <div className="wallet lc-page lc-page--narrow">
      <header className="lc-page__header">
        <h1 className="lc-page__title wallet__title">Deposit</h1>
        <p className="lc-page__subtitle wallet__subtitle">
          Send crypto to your personal address. Balance updates after standard confirmations.
        </p>
      </header>

      <div className="wallet__tabs">
        <Link to="/deposit" className="wallet__tab wallet__tab--active">
          Deposit
        </Link>
        <Link to="/withdraw" className="wallet__tab">
          Withdraw
        </Link>
      </div>

      <p className="wallet__hint wallet__hint--balance">
        Gold Coins (GC): <strong>{formatUsd(profile?.balance ?? 0)}</strong>
        &ensp;Sweeps Coins (SC): <strong>{(profile?.sweepsCoins ?? 0).toFixed(2)}</strong>
      </p>
      <p className="wallet__hint wallet__hint--bonus">
        Deposits credit GC + 1% bonus SC!
      </p>

      <section className="wallet__section">
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

        {error && <p className="wallet__error" role="alert">{error}</p>}

        <p className="wallet__hint">{CONFIRMATIONS_LABEL[chain]}</p>

        <div className="wallet__address-box">
          {loadingAddr ? (
            <p className="wallet__hint">Generating your {chain.toUpperCase()} address…</p>
          ) : address ? (
            <>
              <p className="wallet__hint">Your unique {chain.toUpperCase()} deposit address</p>
              <p className="wallet__address">{address}</p>
              <div className="wallet__copy-row">
                <button type="button" className="wallet__btn" onClick={handleCopy}>
                  {copied ? "Copied!" : "Copy address"}
                </button>
              </div>
            </>
          ) : (
            <p className="wallet__hint">Could not load address.</p>
          )}
        </div>

        <p className="wallet__hint">
          Only send <strong>{chain.toUpperCase()}</strong> on the correct network to this address.
          Other assets may be lost. Funds are swept to treasury wallets on a schedule after credit.
        </p>
      </section>

      <section className="wallet__section">
        <h2 className="wallet__list-title">Recent deposits</h2>
        {deposits.length === 0 ? (
          <div className="lc-empty">
            <p>No deposits detected yet</p>
          </div>
        ) : (
          deposits.map((d) => (
            <div key={d.id} className="wallet__deposit-item">
              <div className="wallet__deposit-row">
                <span>
                  <strong>{d.chain.toUpperCase()}</strong> · {formatUsd(d.usd_amount)}
                </span>
                <span className={`wallet__status wallet__status--${d.status}`}>{d.status}</span>
              </div>
              <p className="wallet__hint wallet__hint--meta">
                {d.confirmations}/{d.required_confirmations} confirmations ·{" "}
                {d.crypto_amount} {d.chain.toUpperCase()}
              </p>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
