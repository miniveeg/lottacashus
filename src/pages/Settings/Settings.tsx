import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { loginUrl } from "../../lib/authRedirect";
import { useProfile } from "../../contexts/ProfileContext";
import {
  formatCoins,
  formatCoinsWithUsd,
  formatUsd,
  GC_USD_RATE,
  getCashFlowTally,
  SC_USD_RATE,
} from "../../lib/format";
import { isSupabaseConfigured } from "../../lib/supabase";
import { SettingsLevelSection } from "../../components/Level/SettingsLevelSection";
import { SettingsProvablyFairSection } from "../../components/Level/SettingsProvablyFairSection";
import { SettingsTransactionsSection } from "../../components/Level/SettingsTransactionsSection";
import { SettingsDiscordSection } from "../../components/Level/SettingsDiscordSection";
import { MAX_USERNAME_LENGTH, validateUsername } from "../../lib/username";
import {
  fetchSelfExclusion,
  createSelfExclusion,
  fetchDepositLimits,
  setDepositLimits,
  type SelfExclusion,
  type DepositLimits,
} from "../../lib/responsibleGaming";
import { Seo } from "../../components/Seo/Seo";
import { ConfirmDialog } from "../../components/ConfirmDialog/ConfirmDialog";
import "./Settings.css";

export function Settings() {
  const { user, loading: authLoading } = useAuth();
  const { profile, profileLoading, updateUsername } = useProfile();
  const location = useLocation();

  // Scroll to the section named by the URL hash (e.g. /settings#responsible-gaming).
  // React Router doesn't auto-scroll to anchors because the page is rendered
  // inside a scrollable <main> rather than the document body.
  useEffect(() => {
    if (!location.hash) return;
    const id = location.hash.replace(/^#/, "");
    const el = document.getElementById(id);
    if (el) {
      // Defer until after paint so the element has a layout box.
      requestAnimationFrame(() => el.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  }, [location.hash]);

  const [username, setUsername] = useState("");
  const [initialUsername, setInitialUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [selfExclusion, setSelfExclusion] = useState<SelfExclusion | null>(null);
  const [seDuration, setSeDuration] = useState<30 | 90 | 180>(30);
  const [seReason, setSeReason] = useState("");
  const [seBusy, setSeBusy] = useState(false);
  // H2/H11 (UI/UX audit): self-exclusion confirmation used to use
  // `window.confirm` (native dialog — breaks visual design, blocked by some
  // iframe/extension configs, no destructive variant). Replaced with the
  // styled `<ConfirmDialog>` below.
  const [seConfirmOpen, setSeConfirmOpen] = useState(false);
  const [depositLimits, setDepositLimitsState] = useState<DepositLimits | null>(null);
  const [dlDaily, setDlDaily] = useState("");
  const [dlWeekly, setDlWeekly] = useState("");
  const [initialDlDaily, setInitialDlDaily] = useState("");
  const [initialDlWeekly, setInitialDlWeekly] = useState("");
  const [dlBusy, setDlBusy] = useState(false);

  useEffect(() => {
    const name =
      profile?.username ?? user?.user_metadata?.username ?? user?.email?.split("@")[0] ?? "";
    setUsername(name);
    setInitialUsername(name);
  }, [profile?.username, user?.user_metadata?.username, user?.email]);

  useEffect(() => {
    if (!user) return;
    fetchSelfExclusion().then(setSelfExclusion);
    fetchDepositLimits().then((limits) => {
      setDepositLimitsState(limits);
      const daily = limits?.daily != null ? String(limits.daily) : "";
      const weekly = limits?.weekly != null ? String(limits.weekly) : "";
      setDlDaily(daily);
      setDlWeekly(weekly);
      setInitialDlDaily(daily);
      setInitialDlWeekly(weekly);
    });
  }, [user]);

  const usernameDirty = username !== initialUsername;
  const limitsDirty = dlDaily !== initialDlDaily || dlWeekly !== initialDlWeekly;
  const hasUnsavedChanges = usernameDirty || limitsDirty;

  // Warn before unloading the tab / navigating away to a different site when
  // the user has unsaved edits in either the username form or the deposit-
  // limits form. BrowserRouter (component routes) doesn't support `useBlocker`,
  // so we can't intercept in-app navigation — but `beforeunload` covers the
  // most-lossy case (closing the tab while a half-typed username is present).
  const hasUnsavedChangesRef = useRef(hasUnsavedChanges);
  hasUnsavedChangesRef.current = hasUnsavedChanges;
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChangesRef.current) return;
      event.preventDefault();
      // Browsers ignore custom text but require returnValue to be set.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  if (!authLoading && !user) {
    // Hardcode the redirect path (don't use `pathname` from useLocation).
    // When Settings returns <Navigate>, React Router updates the location, but
    // Settings stays mounted for one more render before Login takes over — so
    // useLocation() would return the NEW pathname ("/login") on that second
    // render, causing a second Navigate to `/login?redirect=%2Flogin` (clobbering
    // the original `?redirect=%2Fsettings` param and breaking the post-login
    // deep link back to /settings).
    return <Navigate to={loginUrl("/settings")} replace />;
  }

  async function handleSaveUsername(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const validationError = validateUsername(username);
    if (validationError) {
      setError(validationError);
      return;
    }
    if (!isSupabaseConfigured) {
      setError("Supabase is not configured. Add your project URL and anon key to the .env file.");
      return;
    }
    setSaving(true);
    const { error: saveError } = await updateUsername(username);
    setSaving(false);
    if (saveError) setError(saveError);
    else {
      setInitialUsername(username);
      setSuccess("Username updated.");
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
    <div className="settings lc-page lc-page--wide">
      <Seo title="Settings" path="/settings" noindex />
      <header className="lc-page__header">
        <h1 className="lc-page__title settings__title">Settings</h1>
        <p className="lc-page__subtitle settings__subtitle">Manage your profile, view transaction history, and configure responsible gaming limits.</p>
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
          <div className="settings__account-item settings__account-item--balance">
            <label>Gold Coins (GC)</label>
            <span className="settings__balance-inline settings__balance-inline--gc">
              {profileLoading ? "…" : formatCoinsWithUsd(profile?.balance ?? 0, "balance")}
            </span>
            <span className="settings__balance-note">Play money — no redemption value</span>
          </div>
          <div className="settings__account-item settings__account-item--balance">
            <label>Sweeps Coins (SC)</label>
            <span className="settings__balance-inline settings__balance-inline--sc">
              {profileLoading ? "…" : formatCoinsWithUsd(profile?.sweepsCoins ?? 0, "sweeps_coins")}
            </span>
            <span className="settings__balance-note">Redeemable for cash</span>
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
            <p className="settings__stat-label">Gold Coins (GC)</p>
            <p className="settings__stat-value">
              {profileLoading ? "…" : formatCoins(profile?.balance ?? 0, "balance")}
            </p>
            <p className="settings__stat-sub">
              ≈ {formatUsd((profile?.balance ?? 0) * GC_USD_RATE)} · Play money
            </p>
          </div>
          <div className="settings__stat">
            <p className="settings__stat-label">Sweeps Coins (SC)</p>
            <p className="settings__stat-value settings__stat-value--win">
              {profileLoading ? "…" : formatCoins(profile?.sweepsCoins ?? 0, "sweeps_coins")}
            </p>
            <p className="settings__stat-sub">
              ≈ {formatUsd((profile?.sweepsCoins ?? 0) * SC_USD_RATE)} · Redeemable
            </p>
          </div>
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

        <form onSubmit={handleSaveUsername} className="settings__username-form" noValidate>
          <div className="settings__field">
            <label htmlFor="settings-username">Change username</label>
            <input
              id="settings-username"
              type="text"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                if (success) setSuccess(null);
              }}
              maxLength={MAX_USERNAME_LENGTH}
              aria-describedby="settings-username-hint"
              aria-invalid={Boolean(error) || undefined}
              autoComplete="nickname"
            />
            <p className="settings__hint" id="settings-username-hint">
              {username.length}/{MAX_USERNAME_LENGTH} characters
              {usernameDirty && <span className="settings__dirty-flag"> · unsaved</span>}
            </p>
          </div>
          <button
            type="submit"
            className="settings__btn"
            disabled={saving || profileLoading || !usernameDirty}
          >
            {saving && <span className="settings__btn__spinner" aria-hidden="true" />}
            {saving ? "Saving…" : "Save username"}
          </button>
        </form>
      </section>

      {/* 2. Discord (extracted to its own component) */}
      <SettingsDiscordSection
        onError={(msg) => setError(msg)}
        onSuccess={(msg) => setSuccess(msg)}
      />

      {/* 3. Responsible Gaming */}
      <section className="settings__section" id="responsible-gaming">
        <h2 className="settings__section-title">Responsible Gaming</h2>
        <p className="settings__section-desc">
          Set limits on your play and take breaks when needed. All settings can be adjusted at any
          time. For a full overview, visit the{" "}
          <Link to="/responsible-gaming" className="settings__link">Responsible Gaming page</Link>.
          If you need help, visit{" "}
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
              inputMode="decimal"
              placeholder="No limit"
              value={dlDaily}
              onChange={(e) => {
                setDlDaily(e.target.value);
                if (success) setSuccess(null);
              }}
              disabled={dlBusy}
              aria-describedby={limitsDirty ? "dl-dirty-hint" : undefined}
            />
          </div>
          <div className="settings__field settings__field--small">
            <label htmlFor="dl-weekly">Weekly limit ($)</label>
            <input
              id="dl-weekly"
              type="number"
              min="0"
              step="10"
              inputMode="decimal"
              placeholder="No limit"
              value={dlWeekly}
              onChange={(e) => {
                setDlWeekly(e.target.value);
                if (success) setSuccess(null);
              }}
              disabled={dlBusy}
              aria-describedby={limitsDirty ? "dl-dirty-hint" : undefined}
            />
          </div>
        </div>
        {limitsDirty && (
          <p className="settings__hint" id="dl-dirty-hint" role="status">
            You have unsaved deposit-limit changes.
          </p>
        )}
        <button
          type="button"
          className="settings__btn"
          disabled={dlBusy || !limitsDirty}
          onClick={async () => {
            setError(null);
            setSuccess(null);
            const dailyRaw = dlDaily.trim();
            const weeklyRaw = dlWeekly.trim();
            const daily = dailyRaw ? Number(dailyRaw) : null;
            const weekly = weeklyRaw ? Number(weeklyRaw) : null;
            if (
              (daily !== null && !Number.isFinite(daily)) ||
              (weekly !== null && !Number.isFinite(weekly))
            ) {
              setError("Deposit limits must be numeric values.");
              return;
            }
            if (
              (daily !== null && daily < 0) ||
              (weekly !== null && weekly < 0)
            ) {
              setError("Deposit limits cannot be negative.");
              return;
            }
            setDlBusy(true);
            const { error: limitError } = await setDepositLimits(daily, weekly);
            setDlBusy(false);
            if (limitError) setError(limitError);
            else {
              setSuccess("Deposit limits updated.");
              setInitialDlDaily(dlDaily);
              setInitialDlWeekly(dlWeekly);
              fetchDepositLimits().then((limits) => {
                setDepositLimitsState(limits);
                if (limits) {
                  const d = limits.daily != null ? String(limits.daily) : "";
                  const w = limits.weekly != null ? String(limits.weekly) : "";
                  setDlDaily(d);
                  setDlWeekly(w);
                  setInitialDlDaily(d);
                  setInitialDlWeekly(w);
                }
              });
            }
          }}
        >
          {dlBusy && <span className="settings__btn__spinner" aria-hidden="true" />}
          {dlBusy ? "Saving…" : "Save limits"}
        </button>

        {depositLimits && (depositLimits.daily != null || depositLimits.weekly != null) && (
          <div className="settings__limit-usage" aria-live="polite">
            <p className="settings__hint" style={{ margin: 0 }}>
              Current period usage:
            </p>
            <ul className="settings__limit-usage-list">
              {depositLimits.daily != null && (
                <li>
                  <span>
                    <strong>Today:</strong> {formatUsd(depositLimits.dailyUsed)} / {depositLimits.daily === 0 ? "blocked" : formatUsd(depositLimits.daily)}
                  </span>
                  {depositLimits.daily > 0 && (() => {
                    const pct = Math.min(100, (depositLimits.dailyUsed / depositLimits.daily) * 100);
                    const over = depositLimits.dailyUsed >= depositLimits.daily;
                    return (
                      <span
                        className={`settings__limit-bar${over ? " settings__limit-bar--over" : ""}`}
                        role="progressbar"
                        aria-valuenow={Math.round(pct)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      >
                        <span
                          className={`settings__limit-bar-fill${over ? " settings__limit-bar-fill--over" : ""}`}
                          style={{ width: `${pct}%` }}
                        />
                      </span>
                    );
                  })()}
                </li>
              )}
              {depositLimits.weekly != null && (
                <li>
                  <span>
                    <strong>This week:</strong> {formatUsd(depositLimits.weeklyUsed)} / {depositLimits.weekly === 0 ? "blocked" : formatUsd(depositLimits.weekly)}
                  </span>
                  {depositLimits.weekly > 0 && (() => {
                    const pct = Math.min(100, (depositLimits.weeklyUsed / depositLimits.weekly) * 100);
                    const over = depositLimits.weeklyUsed >= depositLimits.weekly;
                    return (
                      <span
                        className={`settings__limit-bar${over ? " settings__limit-bar--over" : ""}`}
                        role="progressbar"
                        aria-valuenow={Math.round(pct)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      >
                        <span
                          className={`settings__limit-bar-fill${over ? " settings__limit-bar-fill--over" : ""}`}
                          style={{ width: `${pct}%` }}
                        />
                      </span>
                    );
                  })()}
                </li>
              )}
            </ul>
          </div>
        )}

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
              onClick={() => setSeConfirmOpen(true)}
            >
              {seBusy && <span className="settings__btn__spinner" aria-hidden="true" />}
              {seBusy ? "Activating…" : "Activate self-exclusion"}
            </button>
            <ConfirmDialog
              open={seConfirmOpen}
              title={`Self-exclude for ${seDuration} days?`}
              body="You will be unable to play, deposit, or withdraw until the period ends. This action cannot be undone early."
              confirmLabel="Activate self-exclusion"
              cancelLabel="Cancel"
              destructive
              busy={seBusy}
              onClose={() => setSeConfirmOpen(false)}
              onConfirm={async () => {
                setError(null);
                setSuccess(null);
                setSeBusy(true);
                const { error: seError } = await createSelfExclusion(
                  seDuration,
                  seReason.trim() || undefined
                );
                setSeBusy(false);
                if (seError) {
                  setError(seError);
                } else {
                  setSuccess(
                    `Self-exclusion activated for ${seDuration} days.`
                  );
                  fetchSelfExclusion().then(setSelfExclusion);
                  setSeConfirmOpen(false);
                }
              }}
            />
          </>
        )}
      </section>

      {/* 4. Provably Fair — server seed rotation (extracted to its own component) */}
      <SettingsProvablyFairSection />

      {/* 5. Transactions (extracted to its own component) */}
      <SettingsTransactionsSection userId={user?.id} />
    </div>
  );
}
