import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  completeAdminWithdrawal,
  failAdminWithdrawal,
  fetchAdminRecentDeposits,
  fetchAdminStats,
  fetchAdminWithdrawals,
  searchAdminUsers,
  setUserAdmin,
  type AdminDeposit,
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

  return (
    <div className="admin lc-page lc-page--medium">
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
                    {formatUsd(u.balance)} · {u.isAdmin ? "Admin" : "Member"}
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
    </div>
  );
}
