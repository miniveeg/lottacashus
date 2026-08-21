import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { Inbox } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { loginUrl } from "../../lib/authRedirect";
import { useProfile } from "../../contexts/ProfileContext";
import { useToast } from "../../contexts/ToastContext";
import { isSupabaseConfigured } from "../../lib/supabase";
import { fetchDepositAddress, fetchMyDeposits } from "../../lib/crypto";
import {
  depositSc,
  formatCoins,
  formatCoinsWithUsd,
  formatUsd,
} from "../../lib/format";
import { analytics } from "../../lib/analytics";
import {
  CONFIRMATIONS_LABEL,
  CRYPTO_CHAINS,
  type CryptoChain,
  type CryptoDepositRow,
} from "../../types/crypto";
import { Seo } from "../../components/Seo/Seo";
import "../Wallet/Wallet.css";

export function Deposit() {
  const { user, loading: authLoading, configured, isGuest } = useAuth();
  const { profile } = useProfile();
  const toast = useToast();
  const [chain, setChain] = useState<CryptoChain>("sol");
  const [address, setAddress] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [loadingAddr, setLoadingAddr] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [deposits, setDeposits] = useState<CryptoDepositRow[]>([]);
  const knownDepositIds = useRef<Set<string>>(new Set());

  const loadAddress = useCallback(async (c: CryptoChain) => {
    setLoadingAddr(true);
    setError(null);
    setQrDataUrl(null);
    analytics.wallet.depositInitiated(c);
    const { data, error: err } = await fetchDepositAddress(c);
    setLoadingAddr(false);
    if (err) {
      setError(err);
      setAddress(null);
      analytics.networkError("Deposit.loadAddress", err);
      return;
    }
    const addr = data?.address ?? null;
    setAddress(addr);
    if (addr) {
      try {
        const QRCode = (await import("qrcode")).default;
        const url = await QRCode.toDataURL(addr, {
          width: 180,
          margin: 1,
          color: { dark: "#040406", light: "#ffffff" },
          errorCorrectionLevel: "M",
        });
        setQrDataUrl(url);
      } catch {
        // QR generation is a nice-to-have
      }
    }
  }, []);

  const toastRef = useRef(toast);
  toastRef.current = toast;

  const loadDeposits = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const { data } = await fetchMyDeposits();
    if (!data) return;
    const rows = data;
    setDeposits(rows);
    rows.forEach((d) => {
      if (!knownDepositIds.current.has(d.id) && knownDepositIds.current.size > 0) {
        toastRef.current.success(`Deposit detected: ${formatUsd(d.usd_amount)} ${d.chain.toUpperCase()}`);
        analytics.wallet.depositDetected(d.chain, d.usd_amount);
      }
      knownDepositIds.current.add(d.id);
    });
  }, []);

  useEffect(() => {
    if (user) {
      analytics.wallet.opened("deposit");
      loadAddress(chain);
    }
  }, [user, chain, loadAddress]);

  useEffect(() => {
    if (!user) return;
    loadDeposits();
    if (!isSupabaseConfigured) return;
    const t = setInterval(loadDeposits, 15000);
    return () => clearInterval(t);
  }, [user, loadDeposits]);

  if (!authLoading && (!user || isGuest)) {
    return <Navigate to={loginUrl("/deposit")} replace />;
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

  async function handleCopy() {
    if (!address) return;
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(address);
        ok = true;
      } else if (document.execCommand) {
        const ta = document.createElement("textarea");
        ta.value = address;
        ta.setAttribute("readonly", "");
        ta.style.position = "absolute";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand("copy");
        document.body.removeChild(ta);
      }
    } catch {
      ok = false;
    }

    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success("Address copied to clipboard");
      analytics.clipboard("deposit_address");
    } else {
      toast.error("Could not copy address — please copy it manually.");
    }
  }

  return (
    <div className="wallet lc-page lc-page--narrow">
      <Seo title="Deposit" path="/deposit" noindex />
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

      <section className="wallet__info-panel" aria-label="How deposits work">
        <p className="wallet__info-text">
          Deposit crypto to fund your account. You'll receive Sweeps Coins (SC) that you can use to
          play and redeem for real crypto.
        </p>
        <p className="wallet__info-rate">
          <strong>100 SC = $1 USD</strong>
        </p>
        <p className="wallet__info-example">
          <span className="wallet__info-example-input">$10</span>
          <span className="wallet__info-example-arrow" aria-hidden="true">&rarr;</span>
          <span className="wallet__info-example-output">
            {formatCoins(depositSc(10))}
          </span>
        </p>
      </section>

      <p className="wallet__hint wallet__hint--balance">
        Balance (SC): <strong>{formatCoinsWithUsd(profile?.sweepsCoins ?? 0)}</strong>
      </p>

      {!configured && (
        <p className="wallet__error" role="note">
          Supabase is not configured. Add your project URL and anon key to the <code>.env</code> file
          to enable deposits. The UI below is non-functional until keys are provided.
        </p>
      )}

      <section className="wallet__section" aria-label="Deposit address">
        <div className="wallet__chain-picker" role="group" aria-label="Select deposit chain">
          {CRYPTO_CHAINS.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`wallet__chain-btn${chain === c.id ? " wallet__chain-btn--active" : ""}`}
              onClick={() => setChain(c.id)}
              aria-pressed={chain === c.id}
              aria-label={`Deposit with ${c.label} (${c.symbol})`}
            >
              {c.symbol}
            </button>
          ))}
        </div>

        {error && <p className="wallet__error" role="alert">{error}</p>}

        <p className="wallet__hint">{CONFIRMATIONS_LABEL[chain]}</p>

        <div className="wallet__address-box">
          {loadingAddr ? (
            <p className="wallet__hint" role="status" aria-live="polite">
              Generating your {chain.toUpperCase()} address…
            </p>
          ) : address ? (
            <>
              <div className="wallet__address-qr-row">
                <div className="wallet__address-text">
                  <p className="wallet__hint" id="deposit-address-label">
                    Your unique {chain.toUpperCase()} deposit address
                  </p>
                  <p
                    className="wallet__address"
                    aria-labelledby="deposit-address-label"
                    title={address}
                  >
                    {address}
                  </p>
                  <div className="wallet__copy-row">
                    <button
                      type="button"
                      className="wallet__btn"
                      onClick={handleCopy}
                      aria-label={copied ? "Deposit address copied to clipboard" : `Copy ${chain.toUpperCase()} deposit address to clipboard`}
                    >
                      {copied ? "Copied!" : "Copy address"}
                    </button>
                  </div>
                </div>
                {qrDataUrl && (
                  <div className="wallet__qr" aria-label="QR code for deposit address">
                    <img src={qrDataUrl} alt={`QR code for ${chain.toUpperCase()} deposit address`} width={140} height={140} />
                    <p className="wallet__qr-hint">Scan to deposit</p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="wallet__error-row" role="alert">
              <p className="wallet__hint">
                Could not load address. {configured ? "Please try again later." : "Supabase is not configured."}
              </p>
              {configured && (
                <button
                  type="button"
                  className="wallet__btn"
                  onClick={() => loadAddress(chain)}
                >
                  Retry
                </button>
              )}
            </div>
          )}
        </div>

        <p className="wallet__hint">
          Only send <strong>{chain.toUpperCase()}</strong> on the correct network to this address.
          Other assets may be lost. Funds are swept to treasury wallets on a schedule after credit.
        </p>
      </section>

      <section className="wallet__section" aria-label="Recent deposits">
        <h2 className="wallet__list-title">Recent deposits</h2>
        {deposits.length === 0 ? (
          <div className="wallet__empty">
            <Inbox size={28} aria-hidden="true" />
            <p>No deposits detected yet</p>
            <p className="wallet__empty-hint">Send crypto to your address above to see it here.</p>
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
              <p className="wallet__hint wallet__hint--meta wallet__hint--yield">
                Yields: {formatCoins(depositSc(d.usd_amount))}
              </p>
            </div>
          ))
        )}
      </section>

      {address && (
        <p className="lc-hotkey-hint" role="note">
          <span className="lc-hotkey-hint__combo">
            <kbd>{typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl"}</kbd>
            <kbd>C</kbd>
          </span>
          <span>copy address</span>
        </p>
      )}
    </div>
  );
}
