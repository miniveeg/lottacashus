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
import {
  RefreshCw,
  Copy,
  Check,
  X,
  Search,
  ArrowUpRight,
  ArrowDownLeft,
  Users,
  CreditCard,
  Gift,
  Shield,
  AlertCircle,
  Clock,
} from "lucide-react";
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

function timeAgo(iso: string | null) {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

type Tab = "overview" | "withdrawals" | "deposits" | "users" | "redemptions" | "credit";

export function Admin() {
  const { user: currentUser } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  // Dashboard data
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [withdrawals, setWithdrawals] = useState<AdminWithdrawal[]>([]);
  const [deposits, setDeposits] = useState<AdminDeposit[]>([]);
  const [loading, setLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState<string | null>(null);

  // Action state
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [txHashes, setTxHashes] = useState<Record<string, string>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // User search
  const [userQuery, setUserQuery] = useState("");
  const [userResults, setUserResults] = useState<AdminUserResult[]>([]);
  const [userSearchError, setUserSearchError] = useState<string | null>(null);
  const [userSearching, setUserSearching] = useState(false);

  // Redemptions
  const [redemptions, setRedemptions] = useState<AdminRedemption[]>([]);
  const [redemptionsLoading, setRedemptionsLoading] = useState(true);
  const [redemptionsError, setRedemptionsError] = useState<string | null>(null);
  const [fundingApproveBusy, setFundingApproveBusy] = useState<string | null>(null);
  const [fundingRejectBusy, setFundingRejectBusy] = useState<string | null>(null);

  // Credit form
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

  const loadDashboard = useCallback(async () => {
    setDashboardError(null);
    setLoading(true);

    // Fetch independently so one failure doesn't hide the others.
    const statsRes = await fetchAdminStats();
    const withdrawalsRes = await fetchAdminWithdrawals("pending");
    const depositsRes = await fetchAdminRecentDeposits();

    // Apply whatever succeeded — don't let one error blank the whole dashboard.
    if (statsRes.data) setStats(statsRes.data);
    if (withdrawalsRes.data) setWithdrawals(withdrawalsRes.data);
    if (depositsRes.data) setDeposits(depositsRes.data);

    // Collect the first error (if any) for display, but still show data.
    const firstError =
      statsRes.error?.message ??
      withdrawalsRes.error?.message ??
      depositsRes.error?.message ??
      null;
    setDashboardError(firstError);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadDashboard();
    loadRedemptions();
  }, [loadDashboard, loadRedemptions]);

  function flashSuccess(msg: string) {
    setActionSuccess(msg);
    setActionError(null);
    window.setTimeout(() => setActionSuccess(null), 5000);
  }

  function flashError(msg: string) {
    setActionError(msg);
    setActionSuccess(null);
  }

  async function handleComplete(w: AdminWithdrawal) {
    const txHash = txHashes[w.id]?.trim();
    if (!txHash) {
      flashError("Enter the on-chain transaction hash before marking complete.");
      return;
    }
    flashError("");
    setBusyId(w.id);
    const { error: err } = await completeAdminWithdrawal(w.id, txHash);
    setBusyId(null);
    if (err) {
      flashError(err.message);
      return;
    }
    setTxHashes((prev) => {
      if (!prev[w.id]) return prev;
      const next = { ...prev };
      delete next[w.id];
      return next;
    });
    flashSuccess(`Withdrawal ${w.id.slice(0, 8)} marked complete.`);
    await loadDashboard();
  }

  async function handleFail(w: AdminWithdrawal) {
    const confirmed = window.confirm(
      `Fail this ${formatUsd(w.usdAmount)} ${w.chain.toUpperCase()} withdrawal? Funds will be refunded to the user's balance.`
    );
    if (!confirmed) return;

    flashError("");
    setBusyId(w.id);
    const { error: err } = await failAdminWithdrawal(w.id);
    setBusyId(null);
    if (err) {
      flashError(err.message);
      return;
    }
    flashSuccess(`Withdrawal ${w.id.slice(0, 8)} failed and refunded.`);
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

  async function copyText(text: string, id: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(null), 2000);
    } catch {
      /* clipboard unavailable */
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
      flashError(err.message);
      return;
    }
    flashSuccess(`Redemption ${r.id.slice(0, 8)} ${action === "approve" ? "approved" : "rejected"}.`);
    await Promise.all([loadRedemptions(), loadDashboard()]);
  }

  const pendingWithdrawalsCount = withdrawals.length;
  const pendingRedemptionsCount = redemptions.length;

  const tabs: { id: Tab; label: string; icon: typeof Clock; badge?: number }[] = [
    { id: "overview", label: "Overview", icon: Shield },
    { id: "withdrawals", label: "Withdrawals", icon: ArrowUpRight, badge: pendingWithdrawalsCount },
    { id: "deposits", label: "Deposits", icon: ArrowDownLeft },
    { id: "users", label: "Users", icon: Users },
    { id: "redemptions", label: "Redemptions", icon: Gift, badge: pendingRedemptionsCount },
    { id: "credit", label: "Credit", icon: CreditCard },
  ];

  return (
    <div className="admin admin--dashboard">
      <header className="admin__header">
        <div className="admin__header-row">
          <div>
            <h1 className="admin__title">Admin Dashboard</h1>
            <p className="admin__subtitle">Manage withdrawals, deposits, users, and redemptions</p>
          </div>
          <button
            type="button"
            className="admin__refresh-btn"
            onClick={() => { loadDashboard(); loadRedemptions(); }}
            disabled={loading}
            aria-label="Refresh all data"
          >
            <RefreshCw size={16} className={loading ? "admin__spin" : ""} />
            <span>Refresh</span>
          </button>
        </div>
      </header>

      {(dashboardError || actionError) && (
        <div className="admin__alert admin__alert--error" role="alert">
          <AlertCircle size={16} aria-hidden />
          <span>{dashboardError || actionError}</span>
        </div>
      )}
      {actionSuccess && (
        <div className="admin__alert admin__alert--success" role="status">
          <Check size={16} aria-hidden />
          <span>{actionSuccess}</span>
        </div>
      )}

      {/* Stats bar — always visible */}
      <div className="admin__stats-bar">
        <div className="admin__stat-card admin__stat-card--pending">
          <div className="admin__stat-icon"><Clock size={18} aria-hidden /></div>
          <div className="admin__stat-body">
            <span className="admin__stat-label">Pending Withdrawals</span>
            <span className="admin__stat-value">{loading ? "…" : (stats?.pendingWithdrawals ?? 0)}</span>
          </div>
        </div>
        <div className="admin__stat-card">
          <div className="admin__stat-icon"><ArrowUpRight size={18} aria-hidden /></div>
          <div className="admin__stat-body">
            <span className="admin__stat-label">Pending Volume</span>
            <span className="admin__stat-value admin__stat-value--accent">
              {loading ? "…" : formatUsd(stats?.pendingWithdrawalsUsd ?? 0)}
            </span>
          </div>
        </div>
        <div className="admin__stat-card">
          <div className="admin__stat-icon"><Users size={18} aria-hidden /></div>
          <div className="admin__stat-body">
            <span className="admin__stat-label">Total Users</span>
            <span className="admin__stat-value">{loading ? "…" : (stats?.totalUsers ?? 0)}</span>
          </div>
        </div>
        <div className="admin__stat-card">
          <div className="admin__stat-icon"><ArrowDownLeft size={18} aria-hidden /></div>
          <div className="admin__stat-body">
            <span className="admin__stat-label">Deposits (24h)</span>
            <span className="admin__stat-value">{loading ? "…" : (stats?.creditedDeposits24h ?? 0)}</span>
          </div>
        </div>
      </div>

      {/* Tab navigation */}
      <nav className="admin__tabs" role="tablist" aria-label="Admin sections">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={"admin__tab" + (isActive ? " admin__tab--active" : "")}
              onClick={() => setActiveTab(tab.id)}
            >
              <Icon size={15} aria-hidden />
              <span>{tab.label}</span>
              {tab.badge != null && tab.badge > 0 && (
                <span className="admin__tab-badge">{tab.badge}</span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Tab content */}
      <div className="admin__tab-content" role="tabpanel">
        {/* OVERVIEW */}
        {activeTab === "overview" && (
          <div className="admin__overview">
            <div className="admin__overview-grid">
              <div className="admin__overview-card" onClick={() => setActiveTab("withdrawals")}>
                <div className="admin__overview-card-head">
                  <ArrowUpRight size={18} aria-hidden />
                  <span>Pending Withdrawals</span>
                </div>
                <p className="admin__overview-count">{pendingWithdrawalsCount}</p>
                <p className="admin__overview-meta">
                  {pendingWithdrawalsCount > 0
                    ? `${formatUsd(withdrawals.reduce((s, w) => s + w.usdAmount, 0))} total`
                    : "All caught up"}
                </p>
              </div>

              <div className="admin__overview-card" onClick={() => setActiveTab("redemptions")}>
                <div className="admin__overview-card-head">
                  <Gift size={18} aria-hidden />
                  <span>Pending Redemptions</span>
                </div>
                <p className="admin__overview-count">{pendingRedemptionsCount}</p>
                <p className="admin__overview-meta">
                  {pendingRedemptionsCount > 0
                    ? `${redemptions.reduce((s, r) => s + r.scAmount, 0).toFixed(2)} SC total`
                    : "All caught up"}
                </p>
              </div>

              <div className="admin__overview-card" onClick={() => setActiveTab("deposits")}>
                <div className="admin__overview-card-head">
                  <ArrowDownLeft size={18} aria-hidden />
                  <span>Recent Deposits</span>
                </div>
                <p className="admin__overview-count">{deposits.length}</p>
                <p className="admin__overview-meta">Last 15 credited</p>
              </div>

              <div className="admin__overview-card" onClick={() => setActiveTab("users")}>
                <div className="admin__overview-card-head">
                  <Users size={18} aria-hidden />
                  <span>User Management</span>
                </div>
                <p className="admin__overview-count">{stats?.totalUsers ?? 0}</p>
                <p className="admin__overview-meta">Search & manage admins</p>
              </div>
            </div>
          </div>
        )}

        {/* WITHDRAWALS */}
        {activeTab === "withdrawals" && (
          <div className="admin__panel">
            <div className="admin__panel-head">
              <h2 className="admin__panel-title">Pending Withdrawals</h2>
              <p className="admin__panel-desc">
                Send crypto from treasury, then mark complete with the tx hash. Fail refunds the user.
              </p>
            </div>
            {loading ? (
              <div className="admin__loading-state">
                <RefreshCw size={20} className="admin__spin" aria-hidden />
                <span>Loading withdrawals…</span>
              </div>
            ) : withdrawals.length === 0 ? (
              <div className="admin__empty-state">
                <Check size={32} aria-hidden />
                <p>No pending withdrawals</p>
              </div>
            ) : (
              <div className="admin__withdrawals">
                {withdrawals.map((w) => (
                  <article key={w.id} className="admin__withdrawal-card">
                    <div className="admin__withdrawal-head">
                      <div className="admin__withdrawal-user-info">
                        <p className="admin__withdrawal-user">{displayUser(w.username, w.email)}</p>
                        <p className="admin__withdrawal-meta">
                          <span className="admin__chain-badge">{w.chain.toUpperCase()}</span>
                          <span>{formatUsd(w.usdAmount)}</span>
                          <span>·</span>
                          <span>{timeAgo(w.createdAt)}</span>
                        </p>
                      </div>
                      <span className="admin__status-badge admin__status-badge--pending">
                        {w.status}
                      </span>
                    </div>

                    <div className="admin__withdrawal-details">
                      <div className="admin__detail-row">
                        <span className="admin__detail-label">Destination</span>
                        <div className="admin__detail-value">
                          <code className="admin__mono">{w.destinationAddress}</code>
                          <button
                            type="button"
                            className="admin__icon-btn"
                            onClick={() => copyText(w.destinationAddress, w.id)}
                            aria-label="Copy destination address"
                          >
                            {copiedId === w.id ? <Check size={14} /> : <Copy size={14} />}
                          </button>
                        </div>
                      </div>
                      <div className="admin__detail-row">
                        <span className="admin__detail-label">User balance</span>
                        <span className="admin__detail-value">{formatUsd(w.userBalance)}</span>
                      </div>
                    </div>

                    <div className="admin__withdrawal-action">
                      <label className="admin__field-label" htmlFor={`tx-${w.id}`}>
                        Transaction hash
                      </label>
                      <div className="admin__tx-input-row">
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
                        <button
                          type="button"
                          className="admin__btn admin__btn--primary"
                          disabled={busyId === w.id || !txHashes[w.id]?.trim()}
                          onClick={() => handleComplete(w)}
                        >
                          {busyId === w.id ? "Processing…" : "Mark complete"}
                        </button>
                        <button
                          type="button"
                          className="admin__btn admin__btn--danger"
                          disabled={busyId === w.id}
                          onClick={() => handleFail(w)}
                        >
                          <X size={14} />
                          Fail
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        )}

        {/* DEPOSITS */}
        {activeTab === "deposits" && (
          <div className="admin__panel">
            <div className="admin__panel-head">
              <h2 className="admin__panel-title">Recent Deposits</h2>
              <p className="admin__panel-desc">Last credited on-chain deposits</p>
            </div>
            {loading ? (
              <div className="admin__loading-state">
                <RefreshCw size={20} className="admin__spin" aria-hidden />
                <span>Loading deposits…</span>
              </div>
            ) : deposits.length === 0 ? (
              <div className="admin__empty-state">
                <ArrowDownLeft size={32} aria-hidden />
                <p>No credited deposits yet</p>
              </div>
            ) : (
              <div className="admin__table-wrap">
                <table className="admin__table">
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
                        <td><span className="admin__chain-badge">{d.chain.toUpperCase()}</span></td>
                        <td className="admin__mono">{formatUsd(d.usdAmount)}</td>
                        <td className="admin__muted">{formatDate(d.creditedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* USERS */}
        {activeTab === "users" && (
          <div className="admin__panel">
            <div className="admin__panel-head">
              <h2 className="admin__panel-title">User Access</h2>
              <p className="admin__panel-desc">
                Search by username, email, or user ID to grant or revoke admin access.
              </p>
            </div>
            <form className="admin__search-form" onSubmit={handleUserSearch} role="search">
              <div className="admin__search-input-wrap">
                <Search size={16} className="admin__search-icon" aria-hidden />
                <input
                  className="admin__input"
                  type="search"
                  placeholder="Search by username, email, or ID…"
                  value={userQuery}
                  onChange={(e) => setUserQuery(e.target.value)}
                  aria-label="Search users"
                />
              </div>
              <button type="submit" className="admin__btn admin__btn--primary" disabled={userSearching}>
                {userSearching ? "Searching…" : "Search"}
              </button>
            </form>
            {userSearchError && (
              <div className="admin__alert admin__alert--error" role="alert">
                <AlertCircle size={16} aria-hidden />
                <span>{userSearchError}</span>
              </div>
            )}
            {userResults.length > 0 && (
              <ul className="admin__user-list">
                {userResults.map((u) => {
                  const isSelf = Boolean(currentUser && u.id === currentUser.id);
                  return (
                    <li key={u.id} className="admin__user-row">
                      <div className="admin__user-info">
                        <p className="admin__user-name">
                          {displayUser(u.username, u.email)}
                          {isSelf && <span className="admin__self-tag"> (you)</span>}
                          {u.isAdmin && <span className="admin__admin-tag">ADMIN</span>}
                        </p>
                        <p className="admin__user-meta">
                          GC {formatUsd(u.balance)} · SC {(u.sweepsCoins ?? 0).toFixed(2)}
                        </p>
                      </div>
                      <button
                        type="button"
                        className={"admin__btn" + (u.isAdmin ? " admin__btn--danger" : " admin__btn--secondary")}
                        onClick={() => toggleAdmin(u)}
                        disabled={isSelf}
                        title={isSelf ? "You cannot change your own admin status" : undefined}
                      >
                        {u.isAdmin ? "Revoke" : "Make admin"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {/* REDEMPTIONS */}
        {activeTab === "redemptions" && (
          <div className="admin__panel">
            <div className="admin__panel-head">
              <h2 className="admin__panel-title">Redemption Requests</h2>
              <p className="admin__panel-desc">
                Pending SC redemption requests. Approve to process payout or reject to refund.
              </p>
            </div>
            {redemptionsLoading ? (
              <div className="admin__loading-state">
                <RefreshCw size={20} className="admin__spin" aria-hidden />
                <span>Loading redemptions…</span>
              </div>
            ) : redemptionsError ? (
              <div className="admin__alert admin__alert--error" role="alert">
                <AlertCircle size={16} aria-hidden />
                <span>{redemptionsError}</span>
              </div>
            ) : redemptions.length === 0 ? (
              <div className="admin__empty-state">
                <Gift size={32} aria-hidden />
                <p>No pending redemptions</p>
              </div>
            ) : (
              <ul className="admin__user-list">
                {redemptions.map((r) => (
                  <li key={r.id} className="admin__user-row">
                    <div className="admin__user-info">
                      <p className="admin__user-name">{displayUser(r.username, r.email)}</p>
                      <p className="admin__user-meta">
                        <span className="admin__sc-amount">{r.scAmount} SC</span>
                        <span>·</span>
                        <span>{r.paypalEmail}</span>
                        <span>·</span>
                        <span>{timeAgo(r.createdAt)}</span>
                      </p>
                    </div>
                    <div className="admin__btn-group">
                      <button
                        type="button"
                        className="admin__btn admin__btn--primary"
                        disabled={fundingApproveBusy === r.id || fundingRejectBusy === r.id}
                        onClick={() => handleRedemptionAction(r, "approve")}
                      >
                        {fundingApproveBusy === r.id ? "…" : "Approve"}
                      </button>
                      <button
                        type="button"
                        className="admin__btn admin__btn--danger"
                        disabled={fundingApproveBusy === r.id || fundingRejectBusy === r.id}
                        onClick={() => handleRedemptionAction(r, "reject")}
                      >
                        {fundingRejectBusy === r.id ? "…" : "Reject"}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* CREDIT */}
        {activeTab === "credit" && (
          <div className="admin__panel">
            <div className="admin__panel-head">
              <h2 className="admin__panel-title">Credit User Balance</h2>
              <p className="admin__panel-desc">
                Credit funds to a user&apos;s account. Used for manual sweepstakes mail-in entry
                fulfillment and promotions.
              </p>
            </div>
            <form className="admin__credit-form" onSubmit={handleCredit}>
              <div className="admin__credit-grid">
                <div className="admin__credit-field">
                  <label className="admin__field-label" htmlFor="credit-uid">User ID</label>
                  <input
                    id="credit-uid"
                    className="admin__input"
                    type="text"
                    placeholder="UUID"
                    value={creditUserId}
                    onChange={(e) => setCreditUserId(e.target.value)}
                    disabled={creditBusy}
                  />
                </div>
                <div className="admin__credit-field">
                  <label className="admin__field-label" htmlFor="credit-amount">Amount</label>
                  <input
                    id="credit-amount"
                    className="admin__input"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={creditAmount}
                    onChange={(e) => setCreditAmount(e.target.value)}
                    disabled={creditBusy}
                  />
                </div>
                <div className="admin__credit-field admin__credit-field--narrow">
                  <label className="admin__field-label" htmlFor="credit-coin">Coin</label>
                  <select
                    id="credit-coin"
                    className="admin__input"
                    value={creditCoinType}
                    onChange={(e) => setCreditCoinType(e.target.value as "balance" | "sweeps_coins")}
                    disabled={creditBusy}
                  >
                    <option value="balance">GC</option>
                    <option value="sweeps_coins">SC</option>
                  </select>
                </div>
                <div className="admin__credit-field admin__credit-field--wide">
                  <label className="admin__field-label" htmlFor="credit-note">Note (optional)</label>
                  <input
                    id="credit-note"
                    className="admin__input"
                    type="text"
                    placeholder="Reason for credit"
                    value={creditNote}
                    onChange={(e) => setCreditNote(e.target.value)}
                    disabled={creditBusy}
                  />
                </div>
              </div>
              <button
                type="submit"
                className="admin__btn admin__btn--primary admin__credit-submit"
                disabled={creditBusy}
              >
                {creditBusy ? "Crediting…" : "Credit user"}
              </button>
              {creditStatus && (
                <div
                  className={"admin__alert" + (creditIsError ? " admin__alert--error" : " admin__alert--success")}
                  role={creditIsError ? "alert" : "status"}
                >
                  {creditIsError ? <AlertCircle size={16} aria-hidden /> : <Check size={16} aria-hidden />}
                  <span>{creditStatus}</span>
                </div>
              )}
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
