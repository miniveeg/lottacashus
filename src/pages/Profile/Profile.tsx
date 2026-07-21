import { useCallback, useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { Lock, Sparkles, Gem, Crown, Calendar } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { useProfile } from "../../contexts/ProfileContext";
import { loginUrl } from "../../lib/authRedirect";
import { formatCoinsWithUsd, formatUsd } from "../../lib/format";
import {
  fetchPublicProfile,
  fetchReferralInfo,
  claimAffiliateBalance,
  type ProfileStats,
  type ReferralInfo,
} from "../../lib/profile";
import { isSupabaseConfigured } from "../../lib/supabase";
import { getLevelProgress, MAX_LEVEL, MAX_WAGER_FOR_MAX_LEVEL } from "../../lib/leveling";
import { UiIcon } from "../../components/icons";
import { Seo } from "../../components/Seo/Seo";
import "./Profile.css";

type Badge = {
  id: string;
  name: string;
  description: string;
  icon: typeof Sparkles;
  check: (p: ProfileStats) => boolean;
};

const BADGES: Badge[] = [
  { id: "first-bet", name: "First Bet", icon: Sparkles, description: "Placed your first game", check: (p) => p.totalWagered > 0 },
  { id: "high-roller", name: "High Roller", icon: Gem, description: "$1,000+ total wagered", check: (p) => p.totalWagered >= 1000 },
  { id: "roller", name: "Roller", icon: Gem, description: "$10,000+ total wagered", check: (p) => p.totalWagered >= 10000 },
  { id: "whale", name: "Whale", icon: Crown, description: "$100,000+ total wagered", check: (p) => p.totalWagered >= 100000 },
  { id: "veteran", name: "Veteran", icon: Calendar, description: "Account age 30+ days", check: (p) => { if (!p.memberSince) return false; return (Date.now() - new Date(p.memberSince).getTime()) / 86400000 >= 30; } },
];

// Level progress is derived from the shared `lib/leveling.ts` engine (curve,
// cap 100, $500k for max) so the Profile page agrees with Settings, the
// Topbar level badge, and the Leaderboard. Previously this page used a
// local linear `totalWagered / 100` calc that produced absurd levels like
// 843 — contradicting the rest of the site.
function calcLevel(totalWagered: number): { level: number; xp: number; xpMax: number } {
  const progress = getLevelProgress(totalWagered);
  if (progress.isMaxLevel) {
    return { level: MAX_LEVEL, xp: MAX_WAGER_FOR_MAX_LEVEL, xpMax: MAX_WAGER_FOR_MAX_LEVEL };
  }
  return {
    level: progress.level,
    xp: progress.wagerInCurrentLevel,
    xpMax: progress.wagerNeededForNextLevel,
  };
}

export function ProfilePage() {
  const { username: routeUsername } = useParams<{ username?: string }>();
  const { user, loading: authLoading, isGuest } = useAuth();
  const { profile: authProfile, profileLoading } = useProfile();
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [referralInfo, setReferralInfo] = useState<ReferralInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [claimMsg, setClaimMsg] = useState<string | null>(null);
  // C3 (UI/UX audit): claim success/error styling was previously decided by
  // substring-matching "error"/"Error" in `claimMsg` — a real success message
  // that happens to contain "error" would render red, and an error phrased
  // without the literal word "error" would render green. Track an explicit
  // `claimIsError` flag set by `handleClaim` based on the API outcome.
  const [claimIsError, setClaimIsError] = useState(false);
  const [copied, setCopied] = useState(false);

  const isOwnProfile = !routeUsername;
  const displayProfile = isOwnProfile ? authProfile : null;

  // For own-profile view, `stats` is derived from `authProfile` purely so the
  // empty-state check has something to read. The render path uses
  // `displayProfile || stats`, so when `authProfile` is loaded the derived
  // stats are shadowed. We only depend on the specific fields we copy so the
  // 1.5s ProfileContext balance-poll doesn't re-run this effect (and re-set
  // state) every cycle.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        let s: ProfileStats | null = null;
        if (isOwnProfile && authProfile) {
          s = {
            username: authProfile.username,
            balance: authProfile.balance,
            totalWagered: authProfile.totalWagered,
            totalDeposited: authProfile.totalDeposited,
            totalWithdrawn: authProfile.totalWithdrawn,
            totalWins: authProfile.totalWins,
            totalLosses: authProfile.totalLosses,
            // audit v3.3: was hardcoded `null` here, which permanently locked
            // the Veteran badge (>30 days member) for own-profile views even
            // for accounts that qualified. Now sourced from ProfileContext's
            // `createdAt` (ProfileContext's PROFILE_SELECT now includes
            // `created_at`).
            memberSince: authProfile.createdAt ?? null,
            referralCode: null,
          };
        } else if (routeUsername) {
          s = await fetchPublicProfile(routeUsername);
        }
        if (!cancelled && s) setStats(s);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [
    isOwnProfile,
    routeUsername,
    authProfile?.username,
    authProfile?.balance,
    authProfile?.totalWagered,
    authProfile?.totalDeposited,
    authProfile?.totalWithdrawn,
    authProfile?.totalWins,
    authProfile?.totalLosses,
    // Include createdAt so the Veteran badge flips from "locked" to "earned"
    // the instant Supabase delivers the row (or realtime updates it).
    authProfile?.createdAt,
  ]);

  useEffect(() => {
    if (!isOwnProfile) return;
    let cancelled = false;
    async function loadRef() {
      const r = await fetchReferralInfo();
      if (!cancelled && r) setReferralInfo(r);
    }
    loadRef();
    return () => { cancelled = true; };
  }, [isOwnProfile]);

  const handleClaim = useCallback(async () => {
    setClaiming(true);
    setClaimMsg(null);
    setClaimIsError(false);
    const { error } = await claimAffiliateBalance();
    if (error) {
      setClaimMsg(error);
      setClaimIsError(true);
    } else {
      setClaimMsg("Balance claimed successfully!");
      setClaimIsError(false);
    }
    setClaiming(false);
    // Refresh referral info
    const r = await fetchReferralInfo();
    if (r) setReferralInfo(r);
  }, []);

  const handleCopy = useCallback(() => {
    if (!referralInfo?.referralCode) return;
    // navigator.clipboard can be undefined in non-secure contexts (HTTP) or
    // when the Permissions API denies write access. Fall back to a transient
    // textarea + execCommand so the copy action never throws an uncaught error.
    const code = referralInfo.referralCode;
    const confirmCopied = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };
    try {
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(code).then(confirmCopied, () => {
          /* clipboard rejected; silently skip confirmation */
        });
        return;
      }
    } catch {
      /* fall through to legacy path */
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = code;
      ta.setAttribute("readonly", "");
      ta.style.position = "absolute";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      confirmCopied();
    } catch {
      /* clipboard unavailable; no confirmation */
    }
  }, [referralInfo]);

  if (!routeUsername && !authLoading && (!user || isGuest)) {
    return <Navigate to={loginUrl("/profile")} replace />;
  }

  // Own-profile view waits on both auth and profile loading so we don't flash
  // "Profile not found" during the brief window between the session resolving
  // and ProfileContext finishing its initial fetch.
  if (loading || (isOwnProfile && (authLoading || profileLoading))) {
    return (
      <div className="lc-page">
        <div className="lc-loading">
          <div className="lc-loading__pulse" aria-hidden />
          <p>Loading profile…</p>
        </div>
      </div>
    );
  }

  const p = displayProfile || stats;
  if (!p) {
    const message = !isSupabaseConfigured
      ? "Profile lookup is unavailable — the database is not configured."
      : routeUsername
        ? `No player named “${routeUsername}” was found.`
        : "Profile not found.";
    return (
      <div className="lc-page">
        <div className="lc-empty">
          <p className="lc-alert lc-alert--error" role="alert">{message}</p>
        </div>
      </div>
    );
  }

  const { level, xp, xpMax } = calcLevel(p.totalWagered);
  const wins = p.totalWins;
  const losses = p.totalLosses;
  const totalGames = wins + losses;
  const winRate = totalGames > 0 ? `${((wins / totalGames) * 100).toFixed(1)}%` : "—";
  const netPL = wins - losses;
  const memberSince = stats?.memberSince
    ? new Date(stats.memberSince).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    : null;

  // Badges only inspect `totalWagered` and `memberSince`. Build a minimal
  // ProfileStats-like input so the badge predicates don't need to know about
  // the UserProfile | ProfileStats union. `memberSince` is now sourced from
  // `authProfile.createdAt` for own-profile views (audit v3.3).
  const badgeInput: ProfileStats = {
    username: p.username ?? null,
    balance: 0,
    totalWagered: p.totalWagered,
    totalDeposited: p.totalDeposited,
    totalWithdrawn: p.totalWithdrawn,
    totalWins: p.totalWins,
    totalLosses: p.totalLosses,
    memberSince: stats?.memberSince ?? null,
    referralCode: null,
  };

  return (
    <div className="lc-page profile-page">
      <Seo
        title="Profile"
        description="LottaCash player profile — level, stats, badges, and referral earnings."
        path={isOwnProfile ? "/profile" : `/profile/${routeUsername}`}
      />
      {/* Hero */}
      <section className="profile-hero">
        <div className="profile-hero__avatar" aria-hidden="true">
          {p.username ? p.username[0].toUpperCase() : "?"}
        </div>
        <div className="profile-hero__info">
          <h1 className="profile-hero__name">{p.username ?? "Player"}</h1>
          {memberSince && <p className="profile-hero__since">Member since {memberSince}</p>}
          <div className="profile-hero__level">
            <div
              className="profile-hero__level-bar"
              role="progressbar"
              aria-label={`Level ${level} progress`}
              aria-valuenow={xp}
              aria-valuemin={0}
              aria-valuemax={xpMax}
              aria-valuetext={`${xp.toLocaleString()} of ${xpMax.toLocaleString()} experience points`}
            >
              <div className="profile-hero__level-fill" style={{ width: `${(xp / xpMax) * 100}%` }} />
            </div>
            <span className="profile-hero__level-text">Level {level} · {xp}/{xpMax} XP</span>
          </div>
        </div>
      </section>

      {/* Stats grid */}
      <section className="profile-stats">
        <div className="profile-stat">
          <UiIcon name="gem" size={18} />
          <span className="profile-stat__label">Gold Coins</span>
          <span className="profile-stat__value">{formatCoinsWithUsd(p.balance, "balance")}</span>
          <span className="profile-stat__sublabel">Play money</span>
        </div>
        <div className="profile-stat">
          <UiIcon name="redeem" size={18} />
          <span className="profile-stat__label">Sweeps Coins</span>
          <span className="profile-stat__value">
            {formatCoinsWithUsd(
              (p as { sweepsCoins?: number }).sweepsCoins ?? 0,
              "sweeps_coins"
            )}
          </span>
          <span className="profile-stat__sublabel">Redeemable for cash</span>
        </div>
        <div className="profile-stat">
          <UiIcon name="target" size={18} />
          <span className="profile-stat__label">Total Wagered</span>
          <span className="profile-stat__value">{formatUsd(p.totalWagered)}</span>
        </div>
        <div className="profile-stat">
          <UiIcon name="gift" size={18} />
          <span className="profile-stat__label">Deposited</span>
          <span className="profile-stat__value">{formatUsd(p.totalDeposited)}</span>
        </div>
        <div className="profile-stat">
          <span className="profile-stat__glow" aria-hidden="true">↑</span>
          <span className="profile-stat__label">Withdrawn</span>
          <span className="profile-stat__value">{formatUsd(p.totalWithdrawn)}</span>
        </div>
        <div className="profile-stat">
          <UiIcon name="trophy" size={18} />
          <span className="profile-stat__label">Net P/L</span>
          <span className={`profile-stat__value ${netPL >= 0 ? "profile-stat__value--positive" : "profile-stat__value--negative"}`}>
            {netPL >= 0 ? "+" : ""}{formatUsd(netPL)}
          </span>
        </div>
        <div className="profile-stat">
          <UiIcon name="check" size={18} />
          <span className="profile-stat__label">Win Rate</span>
          <span className="profile-stat__value">{winRate}</span>
        </div>
      </section>

      {/* Badges */}
      <section className="profile-section">
        <h2 className="profile-section__title">Badges</h2>
        <div className="profile-badges">
          {BADGES.map((badge) => {
            const earned = badge.check(badgeInput);
            const Icon = badge.icon;
            return (
              <div
                key={badge.id}
                className={`profile-badge${earned ? " profile-badge--earned" : " profile-badge--locked"}`}
                title={`${badge.name}: ${badge.description}${earned ? "" : " (locked)"}`}
              >
                <span className="profile-badge__icon" aria-hidden="true">
                  <Icon size={16} strokeWidth={2} />
                </span>
                <span className="profile-badge__name">{badge.name}</span>
                {!earned && (
                  <Lock
                    size={12}
                    className="profile-badge__lock"
                    aria-label="Locked"
                  />
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Referral section (own profile only) */}
      {isOwnProfile && referralInfo && (
        <section className="profile-section">
          <h2 className="profile-section__title">Affiliate & Referrals</h2>
          <div className="profile-referral">
            <div className="profile-referral__code-row">
              <div className="profile-referral__code">
                <span className="profile-referral__label">Your code</span>
                <code className="profile-referral__value">{referralInfo.referralCode}</code>
                <button
                  type="button"
                  className="profile-referral__copy"
                  onClick={handleCopy}
                  aria-label={copied ? "Referral code copied" : "Copy referral code to clipboard"}
                  aria-live="polite"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>
            <div className="profile-referral__stats">
              <div className="profile-referral__stat">
                <span className="profile-referral__stat-label">Referred users</span>
                <span className="profile-referral__stat-value">{referralInfo.referredCount}</span>
              </div>
              <div className="profile-referral__stat">
                <span className="profile-referral__stat-label">Claimable balance</span>
                <span className="profile-referral__stat-value">{formatUsd(referralInfo.claimableBalance)}</span>
              </div>
            </div>
            {referralInfo.claimableBalance > 0 && (
              <button
                type="button"
                className="profile-referral__claim"
                onClick={handleClaim}
                disabled={claiming}
              >
                {claiming ? "Claiming…" : "Claim to balance"}
              </button>
            )}
            {claimMsg && (
              <p
                className={`profile-referral__msg${claimIsError ? " profile-referral__msg--error" : ""}`}
                role="status"
              >
                {claimMsg}
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
