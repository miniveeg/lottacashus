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
  const [fundingApproveBusy, setFundingApproveBusy] = useState<string | null>(null);
  const [fundingRejectBusy, setFundingRejectBusy] = useState<string | null>(null);

  const [creditUserId, setCreditUserId] = useState("");
  const [creditAmount, setCreditAmount] = useState("");
  const [creditCoinType, setCreditCoinType] = useState("balance");
  const [creditNote, setCreditNote] = useState("");
  const [creditStatus, setCreditStatus] = useState<string | null>(null);
  const [creditBusy, setCreditBusy] = useState(false);

  const loadRedemptions = useCallback(async () => {
    const { data, error: err } = await fetchAdminRedemptions("pending");
    if (!err && data) setRedemptions(data);
  }, []);

  useEffect(() => {
    loadRedemptions();
  }, [loadRedemptions]);

  const loadDashboard = useCallback(async () => {
    setError(null);
    const [statsRes, withdrawalsRes, depositsRes] = await Promise.all([
      fetchAdminStats(),
      fetchAdminWithdrawals("pending"),
      fetchAdminRecentDeposits(),
    ]);

    if (statsRes.error) setError(statsRes.error.message);
    else setStats(statsRes.data);

    if (withdrawalsRes.error) setError(withdrawalsRes.error.message);
    else setWithdrawals(withdrawalsRes.data ?? []);

    if (!depositsRes.error) setDeposits(depositsRes.data ?? []);
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
    await loadDashboard();
  }

  async function handleFail(w: AdminWithdrawal) {
    const confirmed = window.confirm(
      `Fail this $${w.usdAmount} ${w.chain.toUpperCase()} withdrawal? Funds will be refunded to the user's balance.`
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

  function copyText(text: string) {
    void navigator.clipboard.writeText(text);
  }

  async function handleCredit(e: FormEvent) {
    e.preventDefault();
    setCreditStatus(null);
    const uid = creditUserId.trim();
    const amount = parseFloat(creditAmount);
    if (!uid || !Number.isFinite(amount) || amount <= 0) {
      setCreditStatus("Enter a valid user ID and amount.");
      return;
    }
    setCreditBusy(true);
    const coinLabel = creditCoinType === "sweeps_coins" ? "SC" : "GC";
    const { error: err } = await adminCreditUser(uid, amount, creditNote.trim() || "Admin credit", creditCoinType);
    setCreditBusy(false);
    if (err) {
      setCreditStatus(err.message);
      return;
    }
    setCreditStatus(`Credited ${amount.toFixed(2)} ${coinLabel} to user.`);
    setCreditAmount("");
    setCreditNote("");
    setCreditUserId("");
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

      <section className="admin__section">
        <div className="admin__section-head">
          <h2 className="admin__section-title">Pending withdrawals</h2>
          <button type="button" className="admin__refresh" onClick={() => loadDashboard()} disabled={loading}>
            Refresh
          </button>
        </div>
        <p className="admin__section-desc">
          Send crypto from treasury wallets, then mark complete with the tx hash. Fail refunds the user&apos;s balance.
        </p>

        {loading ? (
          <div className="lc-loading admin__loading">
            <div className="lc-loading__pulse" aria-hidden />
            <p>Loading withdrawals…</p>
          </div>
        ) : withdrawals.length === 0 ? (
          <p className="admin__empty">No pending withdrawals.</p>
        ) : (
          <div className="admin__withdrawals">
            {withdrawals.map((w) => (
              <article key={w.id} className="admin__withdrawal-card">
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
                    Fail & refund
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="admin__section">
        <h2 className="admin__section-title">Recent deposits</h2>
        <p className="admin__section-desc">Last credited on-chain deposits.</p>
        {deposits.length === 0 ? (
          <p className="admin__empty">No credited deposits yet.</p>
        ) : (
          <div className="admin__table-wrap">
            <table className="admin__table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Chain</th>
                  <th>Amount</th>
                  <th>Credited</th>
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

      <section className="admin__section">
        <h2 className="admin__section-title">User access</h2>
        <p className="admin__section-desc">
          Search by username, email, or user ID to grant or revoke admin. You cannot change your own admin status here.
        </p>
        <form className="admin__search" onSubmit={handleUserSearch}>
          <input
            className="admin__input"
            type="search"
            placeholder="Search users…"
            value={userQuery}
            onChange={(e) => setUserQuery(e.target.value)}
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
            {userResults.map((u) => (
              <li key={u.id} className="admin__user-row">
                <div>
                  <p className="admin__user-name">{displayUser(u.username, u.email)}</p>
                  <p className="admin__user-meta">
                    GC {formatUsd(u.balance)} · SC {(u.sweepsCoins ?? 0).toFixed(2)} · {u.isAdmin ? "Admin" : "Member"}
                  </p>
                </div>
                <button
                  type="button"
                  className={`admin__btn${u.isAdmin ? " admin__btn--danger" : " admin__btn--secondary"}`}
                  onClick={() => toggleAdmin(u)}
                >
                  {u.isAdmin ? "Revoke admin" : "Make admin"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="admin__section">
        <h2 className="admin__section-title">Redemption requests</h2>
        <p className="admin__section-desc">
          Pending Sweeps Coins redemption requests. Approve to process payout or reject.
        </p>
        {redemptions.length === 0 ? (
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
                    disabled={fundingApproveBusy === r.id}
                    onClick={async () => {
                      setFundingApproveBusy(r.id);
                      const { error: err } = await processAdminRedemption(r.id, "approve");
                      setFundingApproveBusy(null);
                      if (err) setActionError(err.message);
                      else loadRedemptions();
                    }}
                  >
                    {fundingApproveBusy === r.id ? "Approving…" : "Approve"}
                  </button>
                  <button
                    type="button"
                    className="admin__btn admin__btn--danger"
                    disabled={fundingRejectBusy === r.id}
                    onClick={async () => {
                      setFundingRejectBusy(r.id);
                      const { error: err } = await processAdminRedemption(r.id, "reject");
                      setFundingRejectBusy(null);
                      if (err) setActionError(err.message);
                      else loadRedemptions();
                    }}
                  >
                    {fundingRejectBusy === r.id ? "Rejecting…" : "Reject"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="admin__section">
        <h2 className="admin__section-title">Credit user balance</h2>
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
            />
            <select
              className="admin__input admin__select-coin"
              value={creditCoinType}
              onChange={(e) => setCreditCoinType(e.target.value)}
              disabled={creditBusy}
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
              className={`admin__banner${creditStatus.includes("Error") || creditStatus.includes("error") ? " admin__banner--error" : ""}`}
              role="status"
            >
              {creditStatus}
            </p>
          )}
        </form>
      </section>
    </div>
  );
}
