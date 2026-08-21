import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { loginUrl } from "../../lib/authRedirect";
import { useProfile } from "../../contexts/ProfileContext";
import {
  formatCoins,
  formatCoinsWithUsd,
  formatUsd,
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
import { LcSelect } from "../../components/LcSelect/LcSelect";
import { ConfirmDialog } from "../../components/ConfirmDialog/ConfirmDialog";
import "./Settings.css";

export function Settings() {
  const { user, loading: authLoading, isGuest } = useAuth();
  const { profile, profileLoading, updateUsername } = useProfile();
  const location = useLocation();

  useEffect(() => {
    if (!location.hash) return;
    const id = location.hash.replace(/^#/, "");
    const el = document.getElementById(id);
    if (el) {
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
  const [seConfirmOpen, setSeConfirmOpen] = useState(false);
  const [_depositLimits, setDepositLimitsState] = useState<DepositLimits | null>(null);
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

  const hasUnsavedChangesRef = useRef(hasUnsavedChanges);
  hasUnsavedChangesRef.current = hasUnsavedChanges;
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChangesRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  if (!authLoading && (!user || isGuest)) {
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
        <p className="lc-page__subtitle settings__subtitle">
          Manage your profile, view transaction history, and configure responsible gaming limits.
        </p>
      </header>

      {error && <p className="settings__error" role="alert">{error}</p>}
      {success && <p className="settings__success" role="status">{success}</p>}

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
            <label>Balance (SC)</label>
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
              autoComplete="nickname"
            />
            <p className="settings__hint">
              {username.length}/{MAX_USERNAME_LENGTH} characters
              {usernameDirty && <span className="settings__dirty-flag"> · unsaved</span>}
            </p>
          </div>
          <button
            type="submit"
            className="settings__btn"
            disabled={saving || profileLoading || !usernameDirty}
          >
            {saving ? "Saving…" : "Save username"}
          </button>
        </form>
      </section>

      <SettingsDiscordSection
        onError={(msg) => setError(msg)}
        onSuccess={(msg) => setSuccess(msg)}
      />

      <section className="settings__section" id="responsible-gaming">
        <h2 className="settings__section-title">Responsible Gaming</h2>
        <p className="settings__section-desc">
          Set limits on your play and take breaks when needed. Visit the{" "}
          <Link to="/responsible-gaming" className="settings__link">Responsible Gaming page</Link>.
        </p>

        <h3 className="settings__subsection-title">Deposit limits</h3>
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
              inputMode="decimal"
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
          disabled={dlBusy || !limitsDirty}
          onClick={async () => {
            setError(null);
            setSuccess(null);
            const daily = dlDaily.trim() ? Number(dlDaily.trim()) : null;
            const weekly = dlWeekly.trim() ? Number(dlWeekly.trim()) : null;
            setDlBusy(true);
            const { error: limitError } = await setDepositLimits(daily, weekly);
            setDlBusy(false);
            if (limitError) setError(limitError);
            else {
              setSuccess("Deposit limits updated.");
              setInitialDlDaily(dlDaily);
              setInitialDlWeekly(dlWeekly);
            }
          }}
        >
          {dlBusy ? "Saving…" : "Save limits"}
        </button>

        <h3 className="settings__subsection-title settings__subsection-title--top">Self-exclusion</h3>
        {selfExclusion && new Date(selfExclusion.expiresAt) > new Date() ? (
          <div className="settings__se-active">
            <p>
              Self-excluded until{" "}
              <strong>
                {new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(
                  new Date(selfExclusion.expiresAt)
                )}
              </strong>
              .
            </p>
          </div>
        ) : (
          <>
            <p className="settings__hint">
              Self-exclusion bans you for a set period. This cannot be undone early.
            </p>
            <div className="settings__field">
              <label id="se-duration-label">Duration</label>
              <LcSelect
                value={String(seDuration) as "30" | "90" | "180"}
                options={[
                  { value: "30", label: "30 days" },
                  { value: "90", label: "90 days" },
                  { value: "180", label: "180 days" },
                ]}
                onChange={(v) => setSeDuration(Number(v) as 30 | 90 | 180)}
                disabled={seBusy}
                aria-label="Self-exclusion duration"
              />
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
              {seBusy ? "Activating…" : "Activate self-exclusion"}
            </button>
            <ConfirmDialog
              open={seConfirmOpen}
              title={`Self-exclude for ${seDuration} days?`}
              body="You will be unable to play, deposit, or withdraw until the period ends."
              confirmLabel="Activate self-exclusion"
              cancelLabel="Cancel"
              destructive
              busy={seBusy}
              onClose={() => setSeConfirmOpen(false)}
              onConfirm={async () => {
                setError(null);
                setSeBusy(true);
                const { error: seError } = await createSelfExclusion(
                  seDuration,
                  seReason.trim() || undefined
                );
                setSeBusy(false);
                if (seError) setError(seError);
                else {
                  setSuccess(`Self-exclusion activated for ${seDuration} days.`);
                  fetchSelfExclusion().then(setSelfExclusion);
                  setSeConfirmOpen(false);
                }
              }}
            />
          </>
        )}
      </section>

      <SettingsProvablyFairSection />
      <SettingsTransactionsSection userId={user?.id} />
    </div>
  );
}
