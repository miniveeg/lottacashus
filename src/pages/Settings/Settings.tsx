import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Navigate, useLocation, useSearchParams } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { loginUrl } from "../../lib/authRedirect";
import { useProfile } from "../../contexts/ProfileContext";
import {
  isDiscordConfigured,
  linkDiscordAccount,
  startDiscordOAuth,
  unlinkDiscordAccount,
  validateDiscordState,
} from "../../lib/discord";
import { createUserNotification } from "../../lib/notifications";
import { formatUsd, getCashFlowTally } from "../../lib/format";
import { supabase } from "../../lib/supabase";
import {
  fetchTransactionsPage,
  TRANSACTIONS_PAGE_SIZE,
} from "../../lib/transactions";
import type { Transaction } from "../../types/transaction";
import { TRANSACTION_LABELS } from "../../types/transaction";
import { SettingsLevelSection } from "../../components/Level/SettingsLevelSection";
import { MAX_USERNAME_LENGTH } from "../../lib/username";
import {
  fetchSelfExclusion,
  createSelfExclusion,
  fetchDepositLimits,
  setDepositLimits,
  type SelfExclusion,
  type DepositLimits,
} from "../../lib/responsibleGaming";
import "./Settings.css";

function formatTxDate(iso: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

function txAmountClass(type: Transaction["type"], amount: number) {
  if (type === "deposit" || type === "win" || type === "affiliate") return "settings__tx-amount--pos";
  if (type === "withdrawal" || type === "loss" || type === "wager") return "settings__tx-amount--neg";
  return amount >= 0 ? "settings__tx-amount--pos" : "settings__tx-amount--neg";
}

export function Settings() {
  const { user, loading: authLoading, session } = useAuth();
  const { pathname } = useLocation();
  const { profile, profileLoading, updateUsername, refreshProfile } = useProfile();
  const [searchParams, setSearchParams] = useSearchParams();

  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [discordBusy, setDiscordBusy] = useState(false);

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [txLoading, setTxLoading] = useState(true);
  const [txPage, setTxPage] = useState(0);
  const [txTotal, setTxTotal] = useState(0);

  const [selfExclusion, setSelfExclusion] = useState<SelfExclusion | null>(null);
  const [seDuration, setSeDuration] = useState<30 | 90 | 180>(30);
  const [seReason, setSeReason] = useState("");
  const [seBusy, setSeBusy] = useState(false);
  const [depositLimits, setDepositLimitsState] = useState<DepositLimits | null>(null);
  const [dlDaily, setDlDaily] = useState("");
  const [dlWeekly, setDlWeekly] = useState("");
  const [dlBusy, setDlBusy] = useState(false);

  const txPageCount = Math.max(1, Math.ceil(txTotal / TRANSACTIONS_PAGE_SIZE));

  const loadTransactions = useCallback(async () => {
    if (!user) return;
    setTxLoading(true);
    const { transactions: rows, total, error: txError } = await fetchTransactionsPage(txPage);
    if (!txError) {
      setTransactions(rows);
      setTxTotal(total);
    }
    setTxLoading(false);
  }, [user, txPage]);

  useEffect(() => {
    const name =
      profile?.username ?? user?.user_metadata?.username ?? user?.email?.split("@")[0] ?? "";
    setUsername(name);
  }, [profile?.username, user?.user_metadata?.username, user?.email]);

  useEffect(() => {
    if (!user?.id) return;
    loadTransactions();

    const channel = supabase
      .channel(`transactions-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "transactions",
          filter: `user_id=eq.${user.id}`,
        },
        () => loadTransactions()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, loadTransactions]);

  useEffect(() => {
    if (!user) return;
    fetchSelfExclusion().then(setSelfExclusion);
    fetchDepositLimits().then((limits) => {
      setDepositLimitsState(limits);
      if (limits) {
        setDlDaily(limits.daily != null ? String(limits.daily) : "");
        setDlWeekly(limits.weekly != null ? String(limits.weekly) : "");
      }
    });
  }, [user]);

  useEffect(() => {
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    if (!code || !session) return;

    if (!validateDiscordState(state)) {
      setError("Discord link expired or invalid. Try again.");
      setSearchParams({}, { replace: true });
      return;
    }

    setDiscordBusy(true);
    setSearchParams({}, { replace: true });

    linkDiscordAccount(code).then(async ({ data, error: linkError }) => {
      setDiscordBusy(false);
      if (linkError) {
        await createUserNotification(
          "discord_link_failed",
          "Discord link failed",
          linkError
        );
        setError(linkError);
        return;
      }
      await refreshProfile();
      setSuccess(`Discord linked as ${data?.discordUsername ?? "account"}.`);
    });
  }, [searchParams, session, setSearchParams, refreshProfile]);

  if (!authLoading && !user) {
    return <Navigate to={loginUrl(pathname)} replace />;
  }

  async function handleSaveUsername(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSaving(true);
    const { error: saveError } = await updateUsername(username);
    setSaving(false);
    if (saveError) setError(saveError);
    else setSuccess("Username updated.");
  }

  function handleLinkDiscord() {
    setError(null);
    try {
      startDiscordOAuth();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Discord is not configured.");
    }
  }

  async function handleUnlinkDiscord() {
    setError(null);
    setDiscordBusy(true);
    const { error: unlinkError } = await unlinkDiscordAccount();
    setDiscordBusy(false);
    if (unlinkError) setError(unlinkError);
    else {
      await refreshProfile();
      setSuccess("Discord unlinked.");
    }
  }

  const cashFlow = getCashFlowTally(
    profile?.totalDeposited ?? 0,
    profile?.totalWithdrawn ?? 0
  );

  const tallyClass =
    cashFlow.net > 0
      ? "settings__tally-value--positive"
      : cashFlow.net < 0
        ? "settings__tally-value--negative"
        : "settings__tally-value--neutral";

  return (
    <div className="settings lc-page lc-page--medium">
      <header className="lc-page__header">
        <h1 className="lc-page__title settings__title">Settings</h1>
        <p className="lc-page__subtitle settings__subtitle">Your LottaCash account overview</p>
      </header>

      {error && <p className="settings__error" role="alert">{error}</p>}
      {success && <p className="settings__success" role="status">{success}</p>}

      {/* 1. Account & stats */}
      <section className="settings__section">
        <h2 className="settings__section-title">Account</h2>

        <div className="settings__account-header">
          <div className="settings__account-item">
            <label>Email</label>
            <span>{user?.email ?? profile?.email ?? "—"}</span>
          </div>
          <div className="settings__account-item">
            <label>Username</label>
            <span>{profile?.username ?? "—"}</span>
          </div>
          <div className="settings__account-item">
            <label>Balance</label>
            <span className="settings__balance-inline">
              {profileLoading ? "…" : formatUsd(profile?.balance ?? 0)}
            </span>
          </div>
        </div>

        <div className="settings__level-wrap">
          <h3 className="settings__level-heading">Player level</h3>
          <SettingsLevelSection
            totalWagered={profile?.totalWagered ?? 0}
            loading={profileLoading}
          />
        </div>

        <div className="settings__stats-grid">
          <div className="settings__stat">
            <p className="settings__stat-label">Total wagered</p>
            <p className="settings__stat-value">
              {profileLoading ? "…" : formatUsd(profile?.totalWagered ?? 0)}
            </p>
          </div>
          <div className="settings__stat">
            <p className="settings__stat-label">Total deposited</p>
            <p className="settings__stat-value">
              {profileLoading ? "…" : formatUsd(profile?.totalDeposited ?? 0)}
            </p>
          </div>
          <div className="settings__stat">
            <p className="settings__stat-label">Total withdrawn</p>
            <p className="settings__stat-value">
              {profileLoading ? "…" : formatUsd(profile?.totalWithdrawn ?? 0)}
            </p>
          </div>
          <div className="settings__stat">
            <p className="settings__stat-label">Total wins</p>
            <p className="settings__stat-value settings__stat-value--win">
              {profileLoading ? "…" : formatUsd(profile?.totalWins ?? 0)}
            </p>
          </div>
          <div className="settings__stat">
            <p className="settings__stat-label">Total losses</p>
            <p className="settings__stat-value settings__stat-value--loss">
              {profileLoading ? "…" : formatUsd(profile?.totalLosses ?? 0)}
            </p>
          </div>
        </div>

        <div className="settings__tally">
          <p className="settings__tally-label">Deposit / withdraw tally</p>
          <p className={`settings__tally-value ${tallyClass}`}>
            {profileLoading ? "…" : cashFlow.formatted}
          </p>
          <p className="settings__tally-hint">{cashFlow.label}</p>
          <p className="settings__tally-hint">
            Positive means you withdrew more than you deposited; negative means you deposited more.
          </p>
        </div>

        <form onSubmit={handleSaveUsername} className="settings__username-form">
          <div className="settings__field">
            <label htmlFor="settings-username">Change username</label>
            <input
              id="settings-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
                maxLength={MAX_USERNAME_LENGTH}
              />
              <p className="settings__hint">Maximum {MAX_USERNAME_LENGTH} characters</p>
            </div>
            <button type="submit" className="settings__btn" disabled={saving || profileLoading}>
            {saving ? "Saving…" : "Save username"}
          </button>
        </form>
      </section>

      {/* 2. Discord */}
      <section className="settings__section">
        <h2 className="settings__section-title">Discord</h2>
        <p className="settings__section-desc">
          Link Discord for future rewards, levelling, and server perks when the LottaCash Discord launches.
        </p>

        {profile?.discordId ? (
          <div className="settings__discord">
            <div className="settings__discord-linked">
              {profile.discordAvatar && (
                <img
                  src={profile.discordAvatar}
                  alt=""
                  className="settings__discord-avatar"
                  width={48}
                  height={48}
                />
              )}
              <div>
                <p className="settings__discord-name">{profile.discordUsername}</p>
                <p className="settings__discord-status">Connected</p>
              </div>
            </div>
            <div className="settings__btn-row">
              <button
                type="button"
                className="settings__btn settings__btn--ghost"
                onClick={handleUnlinkDiscord}
                disabled={discordBusy}
              >
                Unlink Discord
              </button>
            </div>
          </div>
        ) : (
          <div className="settings__discord">
              <p className="settings__hint settings__hint--flex">
              No Discord account linked yet.
            </p>
            <button
              type="button"
              className="settings__btn settings__btn--discord"
              onClick={handleLinkDiscord}
              disabled={discordBusy || !isDiscordConfigured}
            >
              {discordBusy ? "Linking…" : "Link Discord"}
            </button>
          </div>
        )}
        {!isDiscordConfigured && (
          <p className="settings__hint settings__hint--top">
            Add <code>VITE_DISCORD_CLIENT_ID</code> and deploy the <code>link-discord</code> Edge Function with Discord secrets.
          </p>
        )}
      </section>

      {/* 3. Responsible Gaming */}
      <section className="settings__section">
        <h2 className="settings__section-title">Responsible Gaming</h2>
        <p className="settings__section-desc">
          Set limits on your play and take breaks when needed. All settings can be adjusted at any
          time. If you need help, visit{" "}
          <a
            href="https://www.ncpgambling.org/"
            target="_blank"
            rel="noopener noreferrer"
            className="settings__link"
          >
            National Council on Problem Gambling
          </a>
          .
        </p>

        <h3 className="settings__subsection-title">Deposit limits</h3>
        <p className="settings__hint">
          Set maximum deposit amounts. Leave empty for no limit.
        </p>
        <div className="settings__limit-row">
          <div className="settings__field settings__field--small">
            <label htmlFor="dl-daily">Daily limit ($)</label>
            <input
              id="dl-daily"
              type="number"
              min="0"
              step="10"
              placeholder="No limit"
              value={dlDaily}
              onChange={(e) => setDlDaily(e.target.value)}
              disabled={dlBusy}
            />
          </div>
          <div className="settings__field settings__field--small">
            <label htmlFor="dl-weekly">Weekly limit ($)</label>
            <input
              id="dl-weekly"
              type="number"
              min="0"
              step="10"
              placeholder="No limit"
              value={dlWeekly}
              onChange={(e) => setDlWeekly(e.target.value)}
              disabled={dlBusy}
            />
          </div>
        </div>
        <button
          type="button"
          className="settings__btn"
          disabled={dlBusy}
          onClick={async () => {
            setError(null);
            setSuccess(null);
            setDlBusy(true);
            const daily = dlDaily.trim() ? parseFloat(dlDaily) : null;
            const weekly = dlWeekly.trim() ? parseFloat(dlWeekly) : null;
            const { error: limitError } = await setDepositLimits(daily, weekly);
            setDlBusy(false);
            if (limitError) setError(limitError);
            else {
              setSuccess("Deposit limits updated.");
              fetchDepositLimits().then(setDepositLimitsState);
            }
          }}
        >
          {dlBusy ? "Saving…" : "Save limits"}
        </button>

        <h3 className="settings__subsection-title settings__subsection-title--top">
          Self-exclusion
        </h3>
        {selfExclusion && new Date(selfExclusion.expiresAt) > new Date() ? (
          <div className="settings__se-active">
            <p>
              You are currently self-excluded until{" "}
              <strong>
                {new Intl.DateTimeFormat(undefined, {
                  dateStyle: "long",
                }).format(new Date(selfExclusion.expiresAt))}
              </strong>
              .
            </p>
            <p className="settings__hint">
              Your account functions will be restricted during this period. This cannot be undone
              early.
            </p>
          </div>
        ) : (
          <>
            <p className="settings__hint">
              Self-exclusion bans you from the platform for a set period. During this time, you
              cannot play, deposit, or withdraw. This action is irreversible until the period ends.
            </p>
            <div className="settings__field">
              <label htmlFor="se-duration">Duration</label>
              <select
                id="se-duration"
                className="settings__select"
                value={seDuration}
                onChange={(e) => setSeDuration(Number(e.target.value) as 30 | 90 | 180)}
                disabled={seBusy}
              >
                <option value={30}>30 days</option>
                <option value={90}>90 days</option>
                <option value={180}>180 days</option>
              </select>
            </div>
            <div className="settings__field">
              <label htmlFor="se-reason">Reason (optional)</label>
              <input
                id="se-reason"
                type="text"
                placeholder="Optional reason"
                value={seReason}
                onChange={(e) => setSeReason(e.target.value)}
                disabled={seBusy}
              />
            </div>
            <button
              type="button"
              className="settings__btn settings__btn--danger"
              disabled={seBusy}
              onClick={async () => {
                if (
                  !window.confirm(
                    `Are you sure? You will be excluded for ${seDuration} days. This cannot be undone.`
                  )
                )
                  return;
                setError(null);
                setSuccess(null);
                setSeBusy(true);
                const { error: seError } = await createSelfExclusion(
                  seDuration,
                  seReason.trim() || undefined
                );
                setSeBusy(false);
                if (seError) setError(seError.message);
                else {
                  setSuccess(
                    `Self-exclusion activated for ${seDuration} days.`
                  );
                  fetchSelfExclusion().then(setSelfExclusion);
                }
              }}
            >
              {seBusy ? "Activating…" : "Activate self-exclusion"}
            </button>
          </>
        )}
      </section>

      {/* 4. Transactions */}
      <section className="settings__section">
        <h2 className="settings__section-title">Transactions</h2>
        <p className="settings__section-desc">
          Deposits, withdrawals, wagers, and wins. Each bet shows the wager before the result.
        </p>

        {txLoading ? (
          <div className="lc-loading">
            <div className="lc-loading__pulse" />
            <span>Loading transactions…</span>
          </div>
        ) : transactions.length === 0 ? (
          <div className="settings__tx-empty">
            <p>No transactions yet.</p>
            <p className="settings__tx-empty-hint">
              Your activity history will show up here automatically.
            </p>
          </div>
        ) : (
          <div className="settings__tx-table-wrap">
            <table className="settings__tx-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Amount</th>
                  <th>Balance after</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr key={tx.id}>
                    <td>{formatTxDate(tx.created_at)}</td>
                    <td>
                      <span className={`settings__tx-type settings__tx-type--${tx.type}`}>
                        {TRANSACTION_LABELS[tx.type]}
                      </span>
                    </td>
                    <td className={txAmountClass(tx.type, tx.amount)}>
                      {formatUsd(Math.abs(tx.amount))}
                    </td>
                    <td>{tx.balance_after != null ? formatUsd(tx.balance_after) : "—"}</td>
                    <td>{tx.description ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!txLoading && txTotal > TRANSACTIONS_PAGE_SIZE && (
          <div className="settings__tx-pagination">
            <button
              type="button"
              className="settings__tx-page-btn"
              disabled={txPage <= 0}
              onClick={() => setTxPage((p) => Math.max(0, p - 1))}
            >
              Previous
            </button>
            <span className="settings__tx-page-info">
              Page {txPage + 1} of {txPageCount}
            </span>
            <button
              type="button"
              className="settings__tx-page-btn"
              disabled={txPage + 1 >= txPageCount}
              onClick={() => setTxPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
