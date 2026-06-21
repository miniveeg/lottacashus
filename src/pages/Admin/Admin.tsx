import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  adminCreditUser,
  completeAdminWithdrawal,
  failAdminWithdrawal,
  fetchAdminRecentDeposits,
  fetchAdminStats,
  fetchAdminWithdrawals,
  fetchAdminRedemptions,
  processAdminRedemption,
  searchAdminUsers,
  setUserAdmin,
  type AdminDeposit,
  type AdminRedemption,
  type AdminStats,
  type AdminUserResult,
  type AdminWithdrawal,
} from "../../lib/admin";
import { useAuth } from "../../contexts/AuthContext";
import { formatUsd } from "../../lib/format";
import "./Admin.css";

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function displayUser(username: string | null, email: string | null) {
  return username ?? email ?? "Unknown user";
}

export function Admin() {
  const { user: currentUser } = useAuth();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [withdrawals, setWithdrawals] = useState<AdminWithdrawal[]>([]);
  const [deposits, setDeposits] = useState<AdminDeposit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [txHashes, setTxHashes] = useState<Record<string, string>>({});

  const [userQuery, setUserQuery] = useState("");
  const [userResults, setUserResults] = useState<AdminUserResult[]>([]);
  const [userSearchError, setUserSearchError] = useState<string | null>(null);
  const [userSearching, setUserSearching] = useState(false);
  const [redemptions, setRedemptions] = useState<AdminRedemption[]>([]);
  const [redemptionsLoading, setRedemptionsLoading] = useState(true);
  const [redemptionsError, setRedemptionsError] = useState<string | null>(null);
  const [fundingApproveBusy, setFundingApproveBusy] = useState<string | null>(null);
  const [fundingRejectBusy, setFundingRejectBusy] = useState<string | null>(null);

  const [creditUserId, setCreditUserId] = useState("");
  const [creditAmount, setCreditAmount] = useState("");
  const [creditCoinType, setCreditCoinType] = useState<"balance" | "sweeps_coins">("balance");
  const [creditNote, setCreditNote] = useState("");
  const [creditStatus, setCreditStatus] = useState<string | null>(null);
  const [creditIsError, setCreditIsError] = useState(false);
  const [creditBusy, setCreditBusy] = useState(false);

  const loadRedemptions = useCallback(async () => {
    setRedemptionsLoading(true);
    setRedemptionsError(null);
    const { data, error: err } = await fetchAdminRedemptions("pending");
    setRedemptionsLoading(false);
    if (err) {
      setRedemptionsError(err.message);
      return;
    }
    setRedemptions(data ?? []);
  }, []);

  useEffect(() => {
    loadRedemptions();
  }, [loadRedemptions]);

  const loadDashboard = useCallback(async () => {
    setError(null);
    setLoading(true);
    const [statsRes, withdrawalsRes, depositsRes] = await Promise.all([
      fetchAdminStats(),
      fetchAdminWithdrawals("pending"),
      fetchAdminRecentDeposits(),
    ]);

    if (statsRes.error) setError(statsRes.error.message);
    else setStats(statsRes.data);

    if (withdrawalsRes.error) setError(withdrawalsRes.error.message);
    else setWithdrawals(withdrawalsRes.data ?? []);

    if (depositsRes.error) setError(depositsRes.error.message);
    else setDeposits(depositsRes.data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  async function handleComplete(w: AdminWithdrawal) {
    const txHash = txHashes[w.id]?.trim();
    if (!txHash) {
      setActionError("Enter the on-chain transaction hash before marking complete.");
      return;
    }
    setActionError(null);
    setBusyId(w.id);
    const { error: err } = await completeAdminWithdrawal(w.id, txHash);
    setBusyId(null);
    if (err) {
      setActionError(err.message);
      return;
    }
    setTxHashes((prev) => {
      if (!prev[w.id]) return prev;
      const next = { ...prev };
      delete next[w.id];
      return next;
    });
    await loadDashboard();
  }

  async function handleFail(w: AdminWithdrawal) {
    const confirmed = window.confirm(
      `Fail this ${formatUsd(w.usdAmount)} ${w.chain.toUpperCase()} withdrawal? Funds will be refunded to the user's balance.`
    );
    if (!confirmed) return;

    setActionError(null);
    setBusyId(w.id);
    const { error: err } = await failAdminWithdrawal(w.id);
    setBusyId(null);
    if (err) {
      setActionError(err.message);
      return;
    }
    await loadDashboard();
  }

  async function handleUserSearch(e: FormEvent) {
    e.preventDefault();
    setUserSearchError(null);
    setUserResults([]);
    const q = userQuery.trim();
    if (q.length < 2) {
      setUserSearchError("Enter at least 2 characters.");
      return;
    }
    setUserSearching(true);
    const { data, error: err } = await searchAdminUsers(q);
    setUserSearching(false);
    if (err) setUserSearchError(err.message);
    else setUserResults(data ?? []);
  }

  async function toggleAdmin(u: AdminUserResult) {
    // Defense-in-depth: the server MUST also enforce this (RLS / RPC check),
    // but blocking it client-side prevents accidental self-lockout/self-escalation.
    if (currentUser && u.id === currentUser.id) {
      setUserSearchError("You cannot change your own admin status.");
      return;
    }
    const next = !u.isAdmin;
    const confirmed = window.confirm(
      next
        ? `Grant admin access to ${displayUser(u.username, u.email)}?`
        : `Remove admin access from ${displayUser(u.username, u.email)}?`
    );
    if (!confirmed) return;

    setUserSearchError(null);
    const { error: err } = await setUserAdmin(u.id, next);
    if (err) {
      setUserSearchError(err.message);
      return;
    }
    setUserResults((prev) =>
      prev.map((row) => (row.id === u.id ? { ...row, isAdmin: next } : row))
    );
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API can reject in non-secure contexts or when permissions
      // are denied; the destination address is still visible in the <code>
      // element so the user can manually select-and-copy. Silently no-op.
    }
  }

  async function handleCredit(e: FormEvent) {
    e.preventDefault();
    setCreditStatus(null);
    setCreditIsError(false);
    const uid = creditUserId.trim();
    const amount = parseFloat(creditAmount);
    if (!uid || !Number.isFinite(amount) || amount <= 0) {
      setCreditStatus("Enter a valid user ID and amount.");
      setCreditIsError(true);
      return;
    }
    const coinLabel = creditCoinType === "sweeps_coins" ? "SC" : "GC";
    const confirmed = window.confirm(
      `Credit ${amount.toFixed(2)} ${coinLabel} to user ${uid}?`
    );
    if (!confirmed) return;
    setCreditBusy(true);
    const { error: err } = await adminCreditUser(
      uid,
      amount,
      creditNote.trim() || "Admin credit",
      creditCoinType
    );
    setCreditBusy(false);
    if (err) {
      setCreditStatus(err.message);
      setCreditIsError(true);
      return;
    }
    setCreditStatus(`Credited ${amount.toFixed(2)} ${coinLabel} to user.`);
    setCreditIsError(false);
    setCreditAmount("");
    setCreditNote("");
    setCreditUserId("");
  }

  async function handleRedemptionAction(
    r: AdminRedemption,
    action: "approve" | "reject"
  ) {
    const verb = action === "approve" ? "Approve" : "Reject";
    const detail =
      action === "approve"
        ? "The user's PayPal will be paid out."
        : "The user's SC will be refunded.";
    const confirmed = window.confirm(
      `${verb} ${r.scAmount} SC redemption for ${displayUser(r.username, r.email)}? ${detail}`
    );
    if (!confirmed) return;

    setActionError(null);
    if (action === "approve") setFundingApproveBusy(r.id);
    else setFundingRejectBusy(r.id);
    const { error: err } = await processAdminRedemption(r.id, action);
    if (action === "approve") setFundingApproveBusy(null);
    else setFundingRejectBusy(null);
    if (err) {
      setActionError(err.message);
      return;
    }
    // Refresh both lists so the stats (pending count) and the redemptions
    // list stay in sync after an action.
    await Promise.all([loadRedemptions(), loadDashboard()]);
  }

  return (
    <div className="admin lc-page lc-page--wide">
      <header className="lc-page__header admin__header">
        <h1 className="lc-page__title admin__title">Admin</h1>
        <p className="lc-page__subtitle admin__subtitle">Manage withdrawals, review deposits, and assign admin access.</p>
      </header>

      {error && (
        <p className="admin__banner admin__banner--error" role="alert">
          {error}
        </p>
      )}
      {actionError && (
        <p className="admin__banner admin__banner--error" role="alert">
          {actionError}
        </p>
      )}

      <section className="admin__stats" aria-label="Overview">
        <div className="admin__stat">
          <span className="admin__stat-label">Pending withdrawals</span>
          <span className="admin__stat-value">
            {loading ? "…" : (stats?.pendingWithdrawals ?? 0)}
          </span>
        </div>
        <div className="admin__stat">
          <span className="admin__stat-label">Pending volume</span>
          <span className="admin__stat-value admin__stat-value--gold">
            {loading ? "…" : formatUsd(stats?.pendingWithdrawalsUsd ?? 0)}
          </span>
        </div>
        <div className="admin__stat">
          <span className="admin__stat-label">Total users</span>
          <span className="admin__stat-value">{loading ? "…" : (stats?.totalUsers ?? 0)}</span>
        </div>
        <div className="admin__stat">
          <span className="admin__stat-label">Deposits (24h)</span>
          <span className="admin__stat-value">{loading ? "…" : (stats?.creditedDeposits24h ?? 0)}</span>
        </div>
      </section>

      <section className="admin__section" aria-labelledby="admin-withdrawals-title">
        <div className="admin__section-head">
          <h2 className="admin__section-title" id="admin-withdrawals-title">Pending withdrawals</h2>
          <button
            type="button"
            className="admin__refresh"
            onClick={() => loadDashboard()}
            disabled={loading}
          >
            Refresh
          </button>
        </div>
        <p className="admin__section-desc">
          Send crypto from treasury wallets, then mark complete with the tx hash. Fail refunds the user&apos;s balance.
        </p>

        {loading ? (
          <div className="lc-loading admin__loading" role="status" aria-live="polite">
            <div className="lc-loading__pulse" aria-hidden />
            <p>Loading withdrawals…</p>
          </div>
        ) : withdrawals.length === 0 ? (
          <p className="admin__empty">No pending withdrawals.</p>
        ) : (
          <div className="admin__withdrawals">
            {withdrawals.map((w) => (
              <article key={w.id} className="admin__withdrawal-card" aria-label={`Withdrawal for ${displayUser(w.username, w.email)}`}>
                <div className="admin__withdrawal-top">
                  <div>
                    <p className="admin__withdrawal-user">{displayUser(w.username, w.email)}</p>
                    <p className="admin__withdrawal-meta">
                      {formatUsd(w.usdAmount)} · {w.chain.toUpperCase()} · {formatDate(w.createdAt)}
                    </p>
                  </div>
                  <span className="admin__badge admin__badge--pending">{w.status}</span>
                </div>

                <div className="admin__field-row">
                  <span className="admin__field-label">Destination</span>
                  <code className="admin__mono">{w.destinationAddress}</code>
                  <button
                    type="button"
                    className="admin__copy"
                    onClick={() => copyText(w.destinationAddress)}
                    aria-label="Copy destination address"
                  >
                    Copy
                  </button>
                </div>

                <div className="admin__field-row">
                  <span className="admin__field-label">User balance</span>
                  <span>{formatUsd(w.userBalance)}</span>
                </div>

                <label className="admin__tx-label" htmlFor={`tx-${w.id}`}>
                  Transaction hash (required to complete)
                </label>
                <input
                  id={`tx-${w.id}`}
                  className="admin__input"
                  type="text"
                  placeholder="Paste on-chain tx hash"
                  value={txHashes[w.id] ?? ""}
                  onChange={(e) =>
                    setTxHashes((prev) => ({ ...prev, [w.id]: e.target.value }))
                  }
                  disabled={busyId === w.id}
                />

                <div className="admin__actions">
                  <button
                    type="button"
                    className="admin__btn admin__btn--primary"
                    disabled={busyId === w.id}
                    onClick={() => handleComplete(w)}
                  >
                    {busyId === w.id ? "Processing…" : "Mark completed"}
                  </button>
                  <button
                    type="button"
                    className="admin__btn admin__btn--danger"
                    disabled={busyId === w.id}
                    onClick={() => handleFail(w)}
                  >
                    Fail &amp; refund
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="admin__section" aria-labelledby="admin-deposits-title">
        <h2 className="admin__section-title" id="admin-deposits-title">Recent deposits</h2>
        <p className="admin__section-desc">Last credited on-chain deposits.</p>
        {loading ? (
          <div className="lc-loading admin__loading" role="status" aria-live="polite">
            <div className="lc-loading__pulse" aria-hidden />
            <p>Loading deposits…</p>
          </div>
        ) : deposits.length === 0 ? (
          <p className="admin__empty">No credited deposits yet.</p>
        ) : (
          <div className="admin__table-wrap">
            <table className="admin__table" aria-label="Recent deposits">
              <thead>
                <tr>
                  <th scope="col">User</th>
                  <th scope="col">Chain</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Credited</th>
                </tr>
              </thead>
              <tbody>
                {deposits.map((d) => (
                  <tr key={d.id}>
                    <td>{displayUser(d.username, null)}</td>
                    <td>{d.chain.toUpperCase()}</td>
                    <td>{formatUsd(d.usdAmount)}</td>
                    <td>{formatDate(d.creditedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="admin__section" aria-labelledby="admin-users-title">
        <h2 className="admin__section-title" id="admin-users-title">User access</h2>
        <p className="admin__section-desc">
          Search by username, email, or user ID to grant or revoke admin. You cannot change your own admin status here.
        </p>
        <form className="admin__search" onSubmit={handleUserSearch} role="search">
          <input
            className="admin__input"
            type="search"
            placeholder="Search users…"
            value={userQuery}
            onChange={(e) => setUserQuery(e.target.value)}
            aria-label="Search users by username, email, or ID"
          />
          <button type="submit" className="admin__btn admin__btn--primary" disabled={userSearching}>
            {userSearching ? "Searching…" : "Search"}
          </button>
        </form>
        {userSearchError && (
          <p className="admin__banner admin__banner--error" role="alert">
            {userSearchError}
          </p>
        )}
        {userResults.length > 0 && (
          <ul className="admin__user-list">
            {userResults.map((u) => {
              const isSelf = Boolean(currentUser && u.id === currentUser.id);
              return (
                <li key={u.id} className="admin__user-row">
                  <div>
                    <p className="admin__user-name">
                      {displayUser(u.username, u.email)}
                      {isSelf && <span className="admin__self-tag"> (you)</span>}
                    </p>
                    <p className="admin__user-meta">
                      GC {formatUsd(u.balance)} · SC {(u.sweepsCoins ?? 0).toFixed(2)} · {u.isAdmin ? "Admin" : "Member"}
                    </p>
                  </div>
                  <button
                    type="button"
                    className={`admin__btn${u.isAdmin ? " admin__btn--danger" : " admin__btn--secondary"}`}
                    onClick={() => toggleAdmin(u)}
                    disabled={isSelf}
                    title={isSelf ? "You cannot change your own admin status" : undefined}
                  >
                    {u.isAdmin ? "Revoke admin" : "Make admin"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="admin__section" aria-labelledby="admin-redemptions-title">
        <h2 className="admin__section-title" id="admin-redemptions-title">Redemption requests</h2>
        <p className="admin__section-desc">
          Pending Sweeps Coins redemption requests. Approve to process payout or reject to refund the user&apos;s SC.
        </p>
        {redemptionsLoading ? (
          <div className="lc-loading admin__loading" role="status" aria-live="polite">
            <div className="lc-loading__pulse" aria-hidden />
            <p>Loading redemptions…</p>
          </div>
        ) : redemptionsError ? (
          <p className="admin__banner admin__banner--error" role="alert">
            {redemptionsError}
          </p>
        ) : redemptions.length === 0 ? (
          <p className="admin__hint">No pending redemptions.</p>
        ) : (
          <ul className="admin__user-list">
            {redemptions.map((r) => (
              <li key={r.id} className="admin__user-row">
                <div>
                  <p className="admin__user-name">{displayUser(r.username, r.email)}</p>
                  <p className="admin__user-meta">
                    {r.scAmount} SC &middot; PayPal: {r.paypalEmail} &middot;{" "}
                    {new Date(r.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="admin__btn-group">
                  <button
                    type="button"
                    className="admin__btn admin__btn--primary"
                    disabled={fundingApproveBusy === r.id || fundingRejectBusy === r.id}
                    onClick={() => handleRedemptionAction(r, "approve")}
                  >
                    {fundingApproveBusy === r.id ? "Approving…" : "Approve"}
                  </button>
                  <button
                    type="button"
                    className="admin__btn admin__btn--danger"
                    disabled={fundingApproveBusy === r.id || fundingRejectBusy === r.id}
                    onClick={() => handleRedemptionAction(r, "reject")}
                  >
                    {fundingRejectBusy === r.id ? "Rejecting…" : "Reject"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="admin__section" aria-labelledby="admin-credit-title">
        <h2 className="admin__section-title" id="admin-credit-title">Credit user balance</h2>
        <p className="admin__section-desc">
          Credit funds to a user&apos;s account. Used for manual sweepstakes mail-in entry
          fulfillment and promotions. Enter the user&apos;s UUID.
        </p>
        <form className="admin__credit-form" onSubmit={handleCredit}>
          <div className="admin__credit-row">
            <input
              className="admin__input admin__credit-input"
              type="text"
              placeholder="User ID (uuid)"
              value={creditUserId}
              onChange={(e) => setCreditUserId(e.target.value)}
              disabled={creditBusy}
              aria-label="User ID (UUID) to credit"
            />
            <input
              className="admin__input admin__credit-amount"
              type="number"
              step="0.01"
              min="0"
              placeholder="Amount"
              value={creditAmount}
              onChange={(e) => setCreditAmount(e.target.value)}
              disabled={creditBusy}
              aria-label="Amount to credit"
            />
            <select
              className="admin__input admin__select-coin"
              value={creditCoinType}
              onChange={(e) => setCreditCoinType(e.target.value as "balance" | "sweeps_coins")}
              disabled={creditBusy}
              aria-label="Coin type"
            >
              <option value="balance">GC</option>
              <option value="sweeps_coins">SC</option>
            </select>
            <input
              className="admin__input admin__credit-note"
              type="text"
              placeholder="Note (optional)"
              value={creditNote}
              onChange={(e) => setCreditNote(e.target.value)}
              disabled={creditBusy}
              aria-label="Optional note for the credit"
            />
            <button
              type="submit"
              className="admin__btn admin__btn--primary"
              disabled={creditBusy}
            >
              {creditBusy ? "Crediting…" : "Credit"}
            </button>
          </div>
          {creditStatus && (
            <p
              className={`admin__banner${creditIsError ? " admin__banner--error" : ""}`}
              role={creditIsError ? "alert" : "status"}
              aria-live={creditIsError ? "assertive" : "polite"}
            >
              {creditStatus}
            </p>
          )}
        </form>
      </section>
    </div>
  );
}
