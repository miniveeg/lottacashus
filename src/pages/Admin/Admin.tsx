import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  adminCreditUser,
  fetchAdminRecentDeposits,
  fetchAdminStats,
  fetchAdminRedemptions,
  processAdminRedemption,
  searchAdminUsers,
  setUserAdmin,
  type AdminDeposit,
  type AdminRedemption,
  type AdminStats,
  type AdminUserResult,
} from "../../lib/admin";
import { useAuth } from "../../contexts/AuthContext";
import { formatUsd } from "../../lib/format";
import { Seo } from "../../components/Seo/Seo";
import { ConfirmDialog } from "../../components/ConfirmDialog/ConfirmDialog";
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

type Tab = "overview" | "withdrawals" | "deposits" | "users" | "credit";

export function Admin() {
  const { user: currentUser } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  // Dashboard data
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [deposits, setDeposits] = useState<AdminDeposit[]>([]);
  const [loading, setLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState<string | null>(null);

  // Withdrawals (now uses the redemptions table — SC cash-outs)
  const [withdrawals, setWithdrawals] = useState<AdminRedemption[]>([]);
  const [withdrawalsLoading, setWithdrawalsLoading] = useState(true);
  const [withdrawalsError, setWithdrawalsError] = useState<string | null>(null);
  const [approveBusy, setApproveBusy] = useState<string | null>(null);
  const [rejectBusy, setRejectBusy] = useState<string | null>(null);

  // Action state
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // User search
  const [userQuery, setUserQuery] = useState("");
  const [userResults, setUserResults] = useState<AdminUserResult[]>([]);
  const [userSearchError, setUserSearchError] = useState<string | null>(null);
  const [userSearching, setUserSearching] = useState(false);

  // Credit form
  const [creditUserId, setCreditUserId] = useState("");
  const [creditAmount, setCreditAmount] = useState("");
  const [creditCoinType, setCreditCoinType] = useState<"balance" | "sweeps_coins">("balance");
  const [creditNote, setCreditNote] = useState("");
  const [creditStatus, setCreditStatus] = useState<string | null>(null);
  const [creditIsError, setCreditIsError] = useState(false);
  const [creditBusy, setCreditBusy] = useState(false);

  // Pending confirmation dialogs (H2/H11 UI/UX audit follow-up: Settings.tsx
  // self-exclusion was migrated to <ConfirmDialog>; same refactor applied
  // here to all three destructive actions). Each dialog's open state is
  // driven independently, so the user only sees one dialog at a time.
  const [withdrawalConfirm, setWithdrawalConfirm] = useState<
    { redemption: AdminRedemption; action: "approve" | "reject" } | null
  >(null);
  const [adminToggleConfirm, setAdminToggleConfirm] = useState<AdminUserResult | null>(null);
  const [adminToggleBusy, setAdminToggleBusy] = useState<string | null>(null);
  const [creditConfirmOpen, setCreditConfirmOpen] = useState(false);
  // Captured credit-form values when the confirm dialog opens. Reading the
  // current form values inside the async confirm handler would let the user
  // edit the fields while the dialog is open and silently change what gets
  // credited — old `window.confirm` was synchronous so this was impossible.
  const [pendingCredit, setPendingCredit] = useState<{
    uid: string;
    amount: number;
    coinType: "balance" | "sweeps_coins";
    note: string;
  } | null>(null);

  const loadWithdrawals = useCallback(async () => {
    setWithdrawalsLoading(true);
    setWithdrawalsError(null);
    const { data, error: err } = await fetchAdminRedemptions("pending");
    setWithdrawalsLoading(false);
    if (err) {
      setWithdrawalsError(err.message);
      return;
    }
    setWithdrawals(data ?? []);
  }, []);

  const loadDashboard = useCallback(async () => {
    setDashboardError(null);
    setLoading(true);

    const statsRes = await fetchAdminStats();
    const depositsRes = await fetchAdminRecentDeposits();

    if (statsRes.data) setStats(statsRes.data);
    if (depositsRes.data) setDeposits(depositsRes.data);

    const firstError =
      statsRes.error?.message ??
      depositsRes.error?.message ??
      null;
    setDashboardError(firstError);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadDashboard();
    loadWithdrawals();
  }, [loadDashboard, loadWithdrawals]);

  function flashSuccess(msg: string) {
    setActionSuccess(msg);
    setActionError(null);
    window.setTimeout(() => setActionSuccess(null), 5000);
  }

  function flashError(msg: string) {
    setActionError(msg);
    setActionSuccess(null);
  }

  async function handleWithdrawalAction(
    r: AdminRedemption,
    action: "approve" | "reject"
  ) {
    // H2/H11 (UI/UX audit): Settings.tsx self-exclusion migrates
    // `window.confirm` to `<ConfirmDialog>` for the same reasons — native
    // dialog breaks visual design and is blocked in some iframe/extension
    // contexts. Approve/reject now opens the shared ConfirmDialog in render;
    // the actual API call lives in `runWithdrawalAction()` so Esc / Cancel
    // cancel cleanly without firing a half-completed request.
    setWithdrawalConfirm({ redemption: r, action });
  }

  async function runWithdrawalAction() {
    if (!withdrawalConfirm) return;
    const { redemption, action } = withdrawalConfirm;
    setActionError(null);
    if (action === "approve") setApproveBusy(redemption.id);
    else setRejectBusy(redemption.id);
    const { error: err } = await processAdminRedemption(redemption.id, action);
    if (action === "approve") setApproveBusy(null);
    else setRejectBusy(null);
    if (err) {
      flashError(err.message);
      return;
    }
    flashSuccess(`Withdrawal ${redemption.id.slice(0, 8)} ${action === "approve" ? "approved" : "rejected"}.`);
    setWithdrawalConfirm(null);
    await Promise.all([loadWithdrawals(), loadDashboard()]);
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
    // H2/H11 (UI/UX audit): see handleWithdrawalAction note. The actual
    // grant/revoke lives in `runAdminToggle()` so the ConfirmDialog's Esc
    // and Cancel button cancel cleanly mid-flow.
    setAdminToggleConfirm(u);
  }

  async function runAdminToggle() {
    if (!adminToggleConfirm) return;
    const u = adminToggleConfirm;
    const next = !u.isAdmin;
    setUserSearchError(null);
    setAdminToggleBusy(u.id);
    const { error: err } = await setUserAdmin(u.id, next);
    setAdminToggleBusy(null);
    if (err) {
      setUserSearchError(err.message);
      setAdminToggleConfirm(null);
      return;
    }
    setUserResults((prev) =>
      prev.map((row) => (row.id === u.id ? { ...row, isAdmin: next } : row))
    );
    setAdminToggleConfirm(null);
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
    // H2/H11 (UI/UX audit): see handleWithdrawalAction note. Validation is
    // synchronous, but the actual `adminCreditUser` call now waits inside
    // `runCreditConfirm()` so the styled ConfirmDialog (open during
    // capture, busy+frozen during the API call) replaces `window.confirm`.
    // Capturing form values into `pendingCredit` here means editing fields
    // after the dialog opens cannot change what actually gets credited —
    // mirrors the synchronous semantics of the old window.confirm.
    setPendingCredit({
      uid,
      amount,
      coinType: creditCoinType,
      note: creditNote.trim() || "Admin credit",
    });
    setCreditConfirmOpen(true);
  }

  async function runCreditConfirm() {
    if (!pendingCredit) return;
    setCreditConfirmOpen(false);
    setCreditBusy(true);
    const { error: err } = await adminCreditUser(
      pendingCredit.uid,
      pendingCredit.amount,
      pendingCredit.note,
      pendingCredit.coinType
    );
    setCreditBusy(false);
    if (err) {
      setCreditStatus(err.message);
      setCreditIsError(true);
      // Don't clear `pendingCredit` on error — the form fields still hold the
      // values the user typed. Clicking "Credit user" again re-validates and
      // reopens the dialog with the same (or edited) inputs, so a transient
      // API failure doesn't force a re-entry of UID + amount.
      return;
    }
    const coinLabel = pendingCredit.coinType === "sweeps_coins" ? "SC" : "GC";
    setCreditStatus(`Credited ${pendingCredit.amount.toFixed(2)} ${coinLabel} to user.`);
    setCreditIsError(false);
    setCreditAmount("");
    setCreditNote("");
    setCreditUserId("");
    setPendingCredit(null);
  }

  const pendingWithdrawalsCount = withdrawals.length;

  const tabs: { id: Tab; label: string; icon: typeof Clock; badge?: number }[] = [
    { id: "overview", label: "Overview", icon: Shield },
    { id: "withdrawals", label: "Withdrawals", icon: ArrowUpRight, badge: pendingWithdrawalsCount },
    { id: "deposits", label: "Deposits", icon: ArrowDownLeft },
    { id: "users", label: "Users", icon: Users },
    { id: "credit", label: "Credit", icon: CreditCard },
  ];

  return (
    <div className="admin admin--dashboard">
      <Seo title="Admin" path="/admin" noindex />
      <header className="admin__header">
        <div className="admin__header-row">
          <div>
            <h1 className="admin__title">Admin Dashboard</h1>
            <p className="admin__subtitle">Manage withdrawals, deposits, users, and credits</p>
          </div>
          <button
            type="button"
            className="admin__refresh-btn"
            onClick={() => { loadDashboard(); loadWithdrawals(); }}
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

      {/* Stats bar */}
      <div className="admin__stats-bar">
        <div className="admin__stat-card admin__stat-card--pending">
          <div className="admin__stat-icon"><Clock size={18} aria-hidden /></div>
          <div className="admin__stat-body">
            <span className="admin__stat-label">Pending Withdrawals</span>
            <span className="admin__stat-value">{withdrawalsLoading ? "…" : pendingWithdrawalsCount}</span>
          </div>
        </div>
        <div className="admin__stat-card">
          <div className="admin__stat-icon"><ArrowUpRight size={18} aria-hidden /></div>
          <div className="admin__stat-body">
            <span className="admin__stat-label">Pending Volume</span>
            <span className="admin__stat-value admin__stat-value--accent">
              {withdrawalsLoading ? "…" : formatUsd(withdrawals.reduce((s, w) => s + (w.scAmount / 100), 0))}
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
              <div
                className="admin__overview-card"
                role="button"
                tabIndex={0}
                aria-label="View pending withdrawals"
                onClick={() => setActiveTab("withdrawals")}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setActiveTab("withdrawals");
                  }
                }}
              >
                <div className="admin__overview-card-head">
                  <ArrowUpRight size={18} aria-hidden />
                  <span>Pending Withdrawals</span>
                </div>
                <p className="admin__overview-count">{pendingWithdrawalsCount}</p>
                <p className="admin__overview-meta">
                  {pendingWithdrawalsCount > 0
                    ? `${formatUsd(withdrawals.reduce((s, w) => s + (w.scAmount / 100), 0))} total`
                    : "All caught up"}
                </p>
              </div>

              <div
                className="admin__overview-card"
                role="button"
                tabIndex={0}
                aria-label="View recent deposits"
                onClick={() => setActiveTab("deposits")}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setActiveTab("deposits");
                  }
                }}
              >
                <div className="admin__overview-card-head">
                  <ArrowDownLeft size={18} aria-hidden />
                  <span>Recent Deposits</span>
                </div>
                <p className="admin__overview-count">{deposits.length}</p>
                <p className="admin__overview-meta">Last 15 credited</p>
              </div>

              <div
                className="admin__overview-card"
                role="button"
                tabIndex={0}
                aria-label="Open user management"
                onClick={() => setActiveTab("users")}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setActiveTab("users");
                  }
                }}
              >
                <div className="admin__overview-card-head">
                  <Users size={18} aria-hidden />
                  <span>User Management</span>
                </div>
                <p className="admin__overview-count">{stats?.totalUsers ?? 0}</p>
                <p className="admin__overview-meta">Search & manage admins</p>
              </div>

              <div
                className="admin__overview-card"
                role="button"
                tabIndex={0}
                aria-label="Open credit user form"
                onClick={() => setActiveTab("credit")}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setActiveTab("credit");
                  }
                }}
              >
                <div className="admin__overview-card-head">
                  <CreditCard size={18} aria-hidden />
                  <span>Credit User</span>
                </div>
                <p className="admin__overview-count">+</p>
                <p className="admin__overview-meta">Manual balance credit</p>
              </div>
            </div>
          </div>
        )}

        {/* WITHDRAWALS (merged — now uses redemptions table) */}
        {activeTab === "withdrawals" && (
          <div className="admin__panel">
            <div className="admin__panel-head">
              <h2 className="admin__panel-title">Pending Withdrawals</h2>
              <p className="admin__panel-desc">
                Users withdrawing Sweeps Coins (SC) as cryptocurrency. Approve to send from treasury, reject to refund SC.
              </p>
            </div>
            {withdrawalsLoading ? (
              <div className="admin__loading-state">
                <RefreshCw size={20} className="admin__spin" aria-hidden />
                <span>Loading withdrawals…</span>
              </div>
            ) : withdrawalsError ? (
              <div className="admin__alert admin__alert--error" role="alert">
                <AlertCircle size={16} aria-hidden />
                <span>{withdrawalsError}</span>
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
                          <span className="admin__chain-badge">{w.scAmount} SC</span>
                          <span>{formatUsd(w.scAmount / 100)}</span>
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
                          <code className="admin__mono">{w.paypalEmail}</code>
                          <button
                            type="button"
                            className="admin__icon-btn"
                            onClick={() => copyText(w.paypalEmail, w.id)}
                            aria-label="Copy destination address"
                          >
                            {copiedId === w.id ? <Check size={14} /> : <Copy size={14} />}
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="admin__withdrawal-action">
                      <div className="admin__tx-input-row">
                        <button
                          type="button"
                          className="admin__btn admin__btn--primary"
                          disabled={approveBusy === w.id || rejectBusy === w.id}
                          onClick={() => handleWithdrawalAction(w, "approve")}
                        >
                          {approveBusy === w.id ? "Processing…" : "Approve & send"}
                        </button>
                        <button
                          type="button"
                          className="admin__btn admin__btn--danger"
                          disabled={approveBusy === w.id || rejectBusy === w.id}
                          onClick={() => handleWithdrawalAction(w, "reject")}
                        >
                          <X size={14} />
                          Reject & refund
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

      {/* Confirmation dialogs (H2/H11 UI/UX audit). Each is independent so
          only one shows at a time — Esc and Cancel cleanly back out without
          firing the API call. During the in-flight mutation we keep the
          dialog mounted with `busy` so the buttons stay disabled and Esc is
          a no-op (returns early in onClose). */}
      <ConfirmDialog
        open={withdrawalConfirm !== null}
        title={
          withdrawalConfirm
            ? `${withdrawalConfirm.action === "approve" ? "Approve" : "Reject"} ${withdrawalConfirm.redemption.scAmount} SC withdrawal?`
            : ""
        }
        body={
          withdrawalConfirm
            ? withdrawalConfirm.action === "approve"
              ? `${displayUser(withdrawalConfirm.redemption.username, withdrawalConfirm.redemption.email)} will receive ${formatUsd(withdrawalConfirm.redemption.scAmount / 100)} from the treasury wallet. This action is recorded in the audit log.`
              : `${withdrawalConfirm.redemption.scAmount} SC will be refunded to ${displayUser(withdrawalConfirm.redemption.username, withdrawalConfirm.redemption.email)} (their redemption will be marked as failed).`
            : ""
        }
        confirmLabel={withdrawalConfirm?.action === "approve" ? "Approve & send" : "Reject & refund"}
        destructive={withdrawalConfirm?.action === "reject"}
        busy={
          withdrawalConfirm != null &&
          ((withdrawalConfirm.action === "approve" && approveBusy === withdrawalConfirm.redemption.id) ||
            (withdrawalConfirm.action === "reject" && rejectBusy === withdrawalConfirm.redemption.id))
        }
        onConfirm={runWithdrawalAction}
        onClose={() => {
          if (
            withdrawalConfirm != null &&
            ((withdrawalConfirm.action === "approve" && approveBusy === withdrawalConfirm.redemption.id) ||
              (withdrawalConfirm.action === "reject" && rejectBusy === withdrawalConfirm.redemption.id))
          ) {
            return;
          }
          setWithdrawalConfirm(null);
        }}
      />
      <ConfirmDialog
        open={adminToggleConfirm !== null}
        title={
          adminToggleConfirm
            ? adminToggleConfirm.isAdmin
              ? `Remove admin access from ${displayUser(adminToggleConfirm.username, adminToggleConfirm.email)}?`
              : `Grant admin access to ${displayUser(adminToggleConfirm.username, adminToggleConfirm.email)}?`
            : ""
        }
        body={
          adminToggleConfirm
            ? adminToggleConfirm.isAdmin
              ? "They will lose access to the admin dashboard, withdrawals, deposits, and the ability to credit users. This action is reversible — you can re-grant admin later."
              : "They will gain full access to the admin dashboard, including managing withdrawals, viewing deposits, and the ability to credit user balances."
            : ""
        }
        confirmLabel={adminToggleConfirm?.isAdmin ? "Remove admin" : "Grant admin"}
        destructive={adminToggleConfirm?.isAdmin ?? false}
        busy={adminToggleConfirm != null && adminToggleBusy === adminToggleConfirm.id}
        onConfirm={runAdminToggle}
        onClose={() => {
          if (adminToggleConfirm && adminToggleBusy === adminToggleConfirm.id) return;
          setAdminToggleConfirm(null);
        }}
      />
      <ConfirmDialog
        open={creditConfirmOpen && pendingCredit !== null}
        title="Credit user balance?"
        body={
          pendingCredit
            ? `Credit ${pendingCredit.amount.toFixed(2)} ${pendingCredit.coinType === "sweeps_coins" ? "SC" : "GC"} to user ${pendingCredit.uid}${pendingCredit.note ? ` (note: “${pendingCredit.note}”)` : ""}? This is logged on the user's transaction history.`
            : ""
        }
        confirmLabel="Credit user"
        busy={creditBusy}
        onConfirm={runCreditConfirm}
        onClose={() => {
          if (creditBusy) return;
          setCreditConfirmOpen(false);
          setPendingCredit(null);
        }}
      />
    </div>
  );
}
